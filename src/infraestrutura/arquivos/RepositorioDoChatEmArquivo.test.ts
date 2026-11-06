import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConversaDoChat } from "../../chat/ConversaDoChat";
import type { EventoDoChat, EventoDoChatRegistrado } from "../../chat/EventoDoChat";
import { RepositorioDoChatEmArquivo } from "./RepositorioDoChatEmArquivo";

const uso = { duracaoMs: 1, tokensDeEntrada: 1, tokensDeSaida: 1, modeloUsado: null };

function autorizar(conversa: ConversaDoChat): EventoDoChat {
  const evento = conversa.autorizarAlteracoes();
  if (evento === null) {
    throw new Error("A conversa já estava autorizada.");
  }
  return evento;
}

describe("RepositorioDoChatEmArquivo", () => {
  let pasta: string;
  let sessoes: number;
  const gerarSessao = (): string => `sessao-${++sessoes}`;

  beforeEach(async () => {
    pasta = await mkdtemp(path.join(tmpdir(), "repositorio-chat-teste-"));
    sessoes = 0;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(pasta, { recursive: true, force: true });
  });

  it("cria a pasta do chat e a da sessão, com uma conversa nova e as preferências padrão", async () => {
    const repositorio = await RepositorioDoChatEmArquivo.abrir(pasta, gerarSessao);

    expect(existsSync(path.join(pasta, "chat", "sessao"))).toBe(true);
    expect(repositorio.pastaDaSessao).toBe(path.join(pasta, "chat", "sessao"));
    expect(repositorio.conversa().sessaoId).toBe("sessao-1");
    expect(repositorio.conversa().totalDeMensagens).toBe(0);
    expect(repositorio.preferencias().paraDados()).toEqual({ modelo: "opus", esforco: "alto" });
    expect(repositorio.ultimaSequencia()).toBe(0);
    expect(repositorio.ultimaCota()).toBeNull();
  });

  it("grava e relê conversa, eventos, preferências e a última cota", async () => {
    const repositorio = await RepositorioDoChatEmArquivo.abrir(pasta, gerarSessao);
    const conversa = repositorio.conversa();
    repositorio.anexarEvento(
      conversa.perguntar({ mensagemDoUsuarioId: "u1", mensagemDoClaudeId: "c1", texto: "oi", imagens: [], agora: new Date() }),
    );
    repositorio.anexarEvento({ tipo: "uso_da_cota", janelas: [{ nome: "5 horas", utilizacao: 0.2, renovaEm: null, situacao: "allowed" }] });
    repositorio.anexarEvento(conversa.concluir("olá", [], [], uso));
    await repositorio.salvar(conversa);
    await repositorio.salvarPreferencias(repositorio.preferencias().com({ modelo: "fable" }));
    await repositorio.aguardarGravacoes();

    const reaberto = await RepositorioDoChatEmArquivo.abrir(pasta, gerarSessao);

    expect(reaberto.conversa().sessaoId).toBe("sessao-1");
    expect(reaberto.conversa().sessaoIniciada).toBe(true);
    expect(reaberto.conversa().mensagens.map((mensagem) => mensagem.texto)).toEqual(["oi", "olá"]);
    expect(reaberto.lerEventos(0).map((evento) => [evento.sequencia, evento.tipo])).toEqual([
      [1, "pergunta_enviada"],
      [2, "uso_da_cota"],
      [3, "resposta_concluida"],
    ]);
    expect(reaberto.lerEventos(2)).toHaveLength(1);
    expect(reaberto.ultimaSequencia()).toBe(3);
    expect(reaberto.ultimaCota()?.[0]?.utilizacao).toBe(0.2);
    expect(reaberto.preferencias().modelo).toBe("fable");
  });

  it("/clear arquiva a conversa em historico/conversa-<N>, continua a sequência e mantém as preferências", async () => {
    const repositorio = await RepositorioDoChatEmArquivo.abrir(pasta, gerarSessao);
    await repositorio.salvarPreferencias(repositorio.preferencias().com({ esforco: "baixo" }));
    const conversa = repositorio.conversa();
    repositorio.anexarEvento(
      conversa.perguntar({ mensagemDoUsuarioId: "u1", mensagemDoClaudeId: "c1", texto: "oi", imagens: [], agora: new Date() }),
    );
    repositorio.anexarEvento(conversa.concluir("olá", [], [], uso));
    await repositorio.salvar(conversa);

    const { registrado, gravacao } = repositorio.arquivarConversa(conversa, conversa.limpar("sessao-nova"));
    await gravacao;

    expect(registrado).toMatchObject({ tipo: "conversa_limpa", sequencia: 3 });
    const arquivada = path.join(pasta, "chat", "historico", "conversa-3");
    const eventosArquivados = (await readFile(path.join(arquivada, "eventos.jsonl"), "utf8")).trim().split("\n");
    expect(eventosArquivados).toHaveLength(2);
    expect(JSON.parse(await readFile(path.join(arquivada, "conversa.json"), "utf8")).mensagens).toHaveLength(2);

    const reaberto = await RepositorioDoChatEmArquivo.abrir(pasta, gerarSessao);
    expect(reaberto.conversa().sessaoId).toBe("sessao-nova");
    expect(reaberto.conversa().totalDeMensagens).toBe(0);
    expect(reaberto.lerEventos(0).map((evento: EventoDoChatRegistrado) => evento.tipo)).toEqual(["conversa_limpa"]);
    expect(reaberto.anexarEvento({ tipo: "resposta_cancelada", mensagemId: "x" }).sequencia).toBe(4);
    expect(reaberto.preferencias().esforco).toBe("baixo");
  });

  it("grava e relê a autorização, os eventos dela e a autorização pendente da resposta", async () => {
    const repositorio = await RepositorioDoChatEmArquivo.abrir(pasta, gerarSessao);
    const conversa = repositorio.conversa();
    repositorio.anexarEvento(
      conversa.perguntar({ mensagemDoUsuarioId: "u1", mensagemDoClaudeId: "c1", texto: "rode os testes", imagens: [], agora: new Date() }),
    );
    repositorio.anexarEvento(autorizar(conversa));
    repositorio.anexarEvento(conversa.concluir("Preciso da autorização.", [], [], uso, { acao: "rodar_comando", detalhe: "npm test" }));
    await repositorio.salvar(conversa);
    await repositorio.aguardarGravacoes();

    const reaberto = await RepositorioDoChatEmArquivo.abrir(pasta, gerarSessao);

    expect(reaberto.conversa().alteracoesAutorizadas).toBe(true);
    expect(reaberto.conversa().mensagens[1]?.autorizacaoPendente).toEqual({ acao: "rodar_comando", detalhe: "npm test" });
    expect(reaberto.lerEventos(0).map((evento) => [evento.sequencia, evento.tipo])).toEqual([
      [1, "pergunta_enviada"],
      [2, "alteracoes_autorizadas"],
      [3, "resposta_concluida"],
    ]);
    expect(reaberto.lerEventos(2)[0]).toMatchObject({ autorizacaoPendente: { acao: "rodar_comando", detalhe: "npm test" } });
  });

  it("conversa.json gravado antes da autorização carrega sem ela e sem pendências", async () => {
    const pastaDoChat = path.join(pasta, "chat");
    await mkdir(pastaDoChat, { recursive: true });
    const mensagem = { imagens: [], criadaEm: "2026-11-01T10:00:00.000Z", situacao: "concluida", acoes: [], avisos: [] };
    await writeFile(
      path.join(pastaDoChat, "conversa.json"),
      JSON.stringify({
        sessaoId: "antiga",
        sessaoIniciada: true,
        mensagens: [
          { ...mensagem, id: "u1", papel: "usuario", texto: "oi", uso: null },
          { ...mensagem, id: "c1", papel: "claude", texto: "olá", uso },
        ],
      }),
      "utf8",
    );

    const repositorio = await RepositorioDoChatEmArquivo.abrir(pasta, gerarSessao);

    expect(repositorio.conversa().sessaoId).toBe("antiga");
    expect(repositorio.conversa().alteracoesAutorizadas).toBe(false);
    expect(repositorio.conversa().mensagens.map((dados) => dados.autorizacaoPendente)).toEqual([null, null]);
  });

  it("/clear grava a conversa nova sem autorização", async () => {
    const repositorio = await RepositorioDoChatEmArquivo.abrir(pasta, gerarSessao);
    const conversa = repositorio.conversa();
    repositorio.anexarEvento(autorizar(conversa));
    await repositorio.salvar(conversa);

    await repositorio.arquivarConversa(conversa, conversa.limpar("sessao-nova")).gravacao;
    const reaberto = await RepositorioDoChatEmArquivo.abrir(pasta, gerarSessao);

    expect(reaberto.conversa().alteracoesAutorizadas).toBe(false);
    expect(JSON.parse(await readFile(path.join(pasta, "chat", "conversa.json"), "utf8")).alteracoesAutorizadas).toBe(false);
  });

  it("arquivo ilegível vira aviso e uma cópia ao lado, sem impedir a abertura", async () => {
    const pastaDoChat = path.join(pasta, "chat");
    await mkdir(pastaDoChat, { recursive: true });
    await writeFile(path.join(pastaDoChat, "conversa.json"), "{ quebrado", "utf8");
    await writeFile(path.join(pastaDoChat, "preferencias.json"), '{"modelo":"gpt","esforco":"alto"}', "utf8");
    await writeFile(path.join(pastaDoChat, "eventos.jsonl"), '{"tipo":"conversa_limpa","sequencia":7,"em":"x"}\n{"cortad', "utf8");
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const repositorio = await RepositorioDoChatEmArquivo.abrir(pasta, gerarSessao);

    expect(repositorio.conversa().sessaoId).toBe("sessao-1");
    expect(repositorio.preferencias().modelo).toBe("opus");
    expect(repositorio.ultimaSequencia()).toBe(7);
    expect(aviso).toHaveBeenCalledTimes(2);
    const arquivos = await readdir(pastaDoChat);
    expect(arquivos.filter((nome) => nome.startsWith("conversa.json.ilegivel-"))).toHaveLength(1);
    expect(arquivos.filter((nome) => nome.startsWith("preferencias.json.ilegivel-"))).toHaveLength(1);
    expect(await readFile(path.join(pastaDoChat, "conversa.json"), "utf8")).toBe("{ quebrado");
  });
});
