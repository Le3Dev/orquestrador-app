import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EventoDoChatRegistrado } from "../../chat/EventoDoChat";
import { RepositorioDoChatEmArquivo } from "./RepositorioDoChatEmArquivo";

const uso = { duracaoMs: 1, tokensDeEntrada: 1, tokensDeSaida: 1, modeloUsado: null };

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
    expect(repositorio.preferencias().paraDados()).toEqual({ modelo: "sonnet", esforco: "medio" });
    expect(repositorio.ultimaSequencia()).toBe(0);
    expect(repositorio.ultimaCota()).toBeNull();
  });

  it("preferências já gravadas continuam valendo: o padrão novo é só para quem não tem o arquivo", async () => {
    const pastaDoChat = path.join(pasta, "chat");
    await mkdir(pastaDoChat, { recursive: true });
    await writeFile(path.join(pastaDoChat, "preferencias.json"), '{"modelo":"opus","esforco":"alto"}', "utf8");

    const repositorio = await RepositorioDoChatEmArquivo.abrir(pasta, gerarSessao);

    expect(repositorio.preferencias().paraDados()).toEqual({ modelo: "opus", esforco: "alto" });
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

  it("arquivo ilegível vira aviso e uma cópia ao lado, sem impedir a abertura", async () => {
    const pastaDoChat = path.join(pasta, "chat");
    await mkdir(pastaDoChat, { recursive: true });
    await writeFile(path.join(pastaDoChat, "conversa.json"), "{ quebrado", "utf8");
    await writeFile(path.join(pastaDoChat, "preferencias.json"), '{"modelo":"gpt","esforco":"alto"}', "utf8");
    await writeFile(path.join(pastaDoChat, "eventos.jsonl"), '{"tipo":"conversa_limpa","sequencia":7,"em":"x"}\n{"cortad', "utf8");
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const repositorio = await RepositorioDoChatEmArquivo.abrir(pasta, gerarSessao);

    expect(repositorio.conversa().sessaoId).toBe("sessao-1");
    expect(repositorio.preferencias().modelo).toBe("sonnet");
    expect(repositorio.ultimaSequencia()).toBe(7);
    expect(aviso).toHaveBeenCalledTimes(2);
    const arquivos = await readdir(pastaDoChat);
    expect(arquivos.filter((nome) => nome.startsWith("conversa.json.ilegivel-"))).toHaveLength(1);
    expect(arquivos.filter((nome) => nome.startsWith("preferencias.json.ilegivel-"))).toHaveLength(1);
    expect(await readFile(path.join(pastaDoChat, "conversa.json"), "utf8")).toBe("{ quebrado");
  });
});
