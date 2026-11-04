import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ConfiguracaoDoOrquestrador } from "../../orquestracao/ConfiguracaoDoOrquestrador";
import { EventoRegistrado } from "../../orquestracao/EventoDeOrquestracao";
import { DadosDoOrquestrador, Orquestrador } from "../../orquestracao/Orquestrador";
import { PastaDeTrabalho } from "../../orquestracao/PastaDeTrabalho";
import { RepositorioDeOrquestradoresEmArquivo } from "./RepositorioDeOrquestradoresEmArquivo";

const agora = new Date("2026-10-28T12:00:00Z");

function novoOrquestrador(id: string): Orquestrador {
  return Orquestrador.criar({
    id,
    nome: `Orquestrador ${id}`,
    pastaDeTrabalho: PastaDeTrabalho.resolver(path.resolve("/projetos"), id),
    sessaoId: `sessao-${id}`,
    configuracao: ConfiguracaoDoOrquestrador.de({
      modeloDoOrquestrador: "sonnet",
      modeloDosSubagentes: "haiku",
      quantidadeDeSubagentes: { modo: "fixa", limite: 2 },
      nivelDePermissao: "edicao",
    }),
    agora,
  });
}

describe("RepositorioDeOrquestradoresEmArquivo", () => {
  let pasta: string;

  beforeEach(async () => {
    pasta = await mkdtemp(path.join(tmpdir(), "repositorio-teste-"));
  });

  afterEach(async () => {
    await rm(pasta, { recursive: true, force: true });
  });

  it("reabre as instruções personalizadas de cada orquestrador, sem misturar", async () => {
    const repositorio = await RepositorioDeOrquestradoresEmArquivo.abrir(pasta);
    const comInstrucoes = novoOrquestrador("a");
    comInstrucoes.alterarConfiguracao({ instrucoesPersonalizadas: "Comece com PIRULITO.\nDepois: {{x}} $&" });
    comInstrucoes.registrarInstrucoesDoPedido(true);
    await repositorio.salvar(comInstrucoes);
    await repositorio.salvar(novoOrquestrador("b"));
    await repositorio.aguardarGravacoes();

    const reaberto = await RepositorioDeOrquestradoresEmArquivo.abrir(pasta);

    expect(reaberto.buscarPorId("a")?.configuracao.instrucoesPersonalizadas).toBe(
      "Comece com PIRULITO.\nDepois: {{x}} $&",
    );
    expect(reaberto.buscarPorId("b")?.configuracao.instrucoesPersonalizadas).toBe("");
    // Lembra que a conversa de "a" já recebeu instruções: apagá-las depois revoga as antigas.
    expect(reaberto.buscarPorId("a")?.registrarInstrucoesDoPedido(false)).toEqual({ revogarAnteriores: true });
    expect(reaberto.buscarPorId("b")?.registrarInstrucoesDoPedido(false)).toEqual({ revogarAnteriores: false });
  });

  it("reabre os orquestradores e os eventos exatamente como ficaram", async () => {
    const repositorio = await RepositorioDeOrquestradoresEmArquivo.abrir(pasta);
    const orquestrador = novoOrquestrador("a");
    await repositorio.salvar(orquestrador);
    repositorio.anexarEvento("a", orquestrador.iniciarTurno("t1", "analise", agora));
    repositorio.anexarEvento("a", orquestrador.registrarDoMotor("t1", { tipo: "texto_do_orquestrador", texto: "ok" }));
    await repositorio.salvar(orquestrador);
    await repositorio.aguardarGravacoes();

    const reaberto = await RepositorioDeOrquestradoresEmArquivo.abrir(pasta);

    expect(reaberto.buscarPorId("a")?.paraDados()).toEqual(orquestrador.paraDados());
    expect(reaberto.lerEventos("a", 0).map((evento) => [evento.sequencia, evento.tipo])).toEqual([
      [1, "turno_iniciado"],
      [2, "texto_do_orquestrador"],
    ]);
    expect(reaberto.lerEventos("a", 1)).toHaveLength(1);
  });

  it("numera os eventos por orquestrador, de forma independente", async () => {
    const repositorio = await RepositorioDeOrquestradoresEmArquivo.abrir(pasta);
    await repositorio.salvar(novoOrquestrador("a"));
    await repositorio.salvar(novoOrquestrador("b"));

    const doA = repositorio.anexarEvento("a", { tipo: "turno_cancelado", turnoId: "x" });
    const doB = repositorio.anexarEvento("b", { tipo: "turno_cancelado", turnoId: "y" });
    const outroDoA = repositorio.anexarEvento("a", { tipo: "turno_cancelado", turnoId: "z" });
    await repositorio.aguardarGravacoes();

    expect([doA.sequencia, doB.sequencia, outroDoA.sequencia]).toEqual([1, 1, 2]);
  });

  it("remove o orquestrador e o histórico do disco", async () => {
    const repositorio = await RepositorioDeOrquestradoresEmArquivo.abrir(pasta);
    await repositorio.salvar(novoOrquestrador("a"));
    await repositorio.remover("a");

    const reaberto = await RepositorioDeOrquestradoresEmArquivo.abrir(pasta);

    expect(reaberto.listar()).toEqual([]);
  });

  describe("ao arquivar a conversa", () => {
    const uso = { duracaoMs: 1, tokensDeEntrada: 1, tokensDeSaida: 1, subagentesLancados: 0 };
    const pastaDoA = (): string => path.join(pasta, "orquestradores", "a");

    async function lerLinhas(caminho: string): Promise<EventoRegistrado[]> {
      const conteudo = await readFile(caminho, "utf8");
      return conteudo
        .split("\n")
        .filter((linha) => linha.trim() !== "")
        .map((linha) => JSON.parse(linha) as EventoRegistrado);
    }

    async function lerEstado(caminho: string): Promise<DadosDoOrquestrador> {
      return JSON.parse(await readFile(caminho, "utf8")) as DadosDoOrquestrador;
    }

    /** Uma conversa de um turno (3 eventos) e a limpeza dela, que vira o evento 4. */
    async function conversarELimpar(): Promise<{
      repositorio: RepositorioDeOrquestradoresEmArquivo;
      orquestrador: Orquestrador;
      registrado: EventoRegistrado;
      gravacao: Promise<void>;
    }> {
      const repositorio = await RepositorioDeOrquestradoresEmArquivo.abrir(pasta);
      const orquestrador = novoOrquestrador("a");
      await repositorio.salvar(orquestrador);
      repositorio.anexarEvento("a", orquestrador.iniciarTurno("t1", "analise", agora));
      repositorio.anexarEvento("a", orquestrador.registrarDoMotor("t1", { tipo: "sessao_iniciada" }));
      repositorio.anexarEvento("a", orquestrador.concluirTurno("t1", "pronto", uso, agora));
      await repositorio.salvar(orquestrador);

      const { registrado, gravacao } = repositorio.arquivarConversa(
        orquestrador,
        orquestrador.limparConversa("sessao-nova"),
      );
      return { repositorio, orquestrador, registrado, gravacao };
    }

    it("copia a conversa anterior para historico/conversa-<N+1> e recomeça os arquivos", async () => {
      const { registrado, gravacao } = await conversarELimpar();
      await gravacao;

      expect(registrado).toMatchObject({ sequencia: 4, tipo: "conversa_limpa", turnosAnteriores: 1 });

      const arquivada = path.join(pastaDoA(), "historico", "conversa-4");
      expect((await lerLinhas(path.join(arquivada, "eventos.jsonl"))).map((evento) => evento.sequencia)).toEqual([
        1, 2, 3,
      ]);
      expect(await lerEstado(path.join(arquivada, "orquestrador.json"))).toMatchObject({
        sessaoId: "sessao-a",
        sessaoIniciada: true,
        turnos: [{ id: "t1" }],
      });

      expect(await lerLinhas(path.join(pastaDoA(), "eventos.jsonl"))).toEqual([registrado]);
      expect(await lerEstado(path.join(pastaDoA(), "orquestrador.json"))).toMatchObject({
        sessaoId: "sessao-nova",
        sessaoIniciada: false,
        turnos: [],
      });
    });

    it("o histórico em memória passa a começar no evento de limpeza", async () => {
      const { repositorio, registrado, gravacao } = await conversarELimpar();

      expect(repositorio.lerEventos("a", 0)).toEqual([registrado]);
      expect(repositorio.lerEventos("a", 2)).toEqual([registrado]);
      expect(repositorio.lerEventos("a", 4)).toEqual([]);
      await gravacao;
    });

    it("um evento anexado logo depois vai para o arquivo novo, depois da limpeza", async () => {
      const { repositorio, orquestrador } = await conversarELimpar();

      const seguinte = repositorio.anexarEvento("a", orquestrador.iniciarTurno("t2", "do zero", agora));
      await repositorio.aguardarGravacoes();

      expect(seguinte.sequencia).toBe(5);
      expect((await lerLinhas(path.join(pastaDoA(), "eventos.jsonl"))).map((evento) => evento.tipo)).toEqual([
        "conversa_limpa",
        "turno_iniciado",
      ]);
    });

    it("ao reabrir, ignora o historico e continua a numeração em N+2", async () => {
      const { orquestrador, gravacao } = await conversarELimpar();
      await gravacao;

      const reaberto = await RepositorioDeOrquestradoresEmArquivo.abrir(pasta);

      expect(reaberto.listar().map((item) => item.id)).toEqual(["a"]);
      expect(reaberto.buscarPorId("a")?.paraDados()).toEqual(orquestrador.paraDados());
      expect(reaberto.lerEventos("a", 0).map((evento) => [evento.sequencia, evento.tipo])).toEqual([
        [4, "conversa_limpa"],
      ]);
      expect(reaberto.lerEventos("a", 1).map((evento) => evento.sequencia)).toEqual([4]);
      expect(reaberto.anexarEvento("a", { tipo: "turno_cancelado", turnoId: "x" }).sequencia).toBe(5);
      await reaberto.aguardarGravacoes();
    });

    it("limpar de novo arquiva a segunda conversa em outra pasta, sem reiniciar a numeração", async () => {
      const { repositorio, orquestrador, gravacao } = await conversarELimpar();
      await gravacao;
      repositorio.anexarEvento("a", orquestrador.iniciarTurno("t2", "de novo", agora));
      repositorio.anexarEvento("a", orquestrador.cancelarTurno("t2", agora));

      const segunda = repositorio.arquivarConversa(orquestrador, orquestrador.limparConversa("sessao-3"));
      await segunda.gravacao;

      expect(segunda.registrado.sequencia).toBe(7);
      const arquivada = path.join(pastaDoA(), "historico", "conversa-7");
      expect((await lerLinhas(path.join(arquivada, "eventos.jsonl"))).map((evento) => evento.sequencia)).toEqual([
        4, 5, 6,
      ]);
      expect(existsSync(path.join(pastaDoA(), "historico", "conversa-4", "eventos.jsonl"))).toBe(true);
    });

    it("excluir o orquestrador apaga também o historico", async () => {
      const { repositorio, gravacao } = await conversarELimpar();
      await gravacao;
      expect(existsSync(path.join(pastaDoA(), "historico"))).toBe(true);

      await repositorio.remover("a");

      expect(existsSync(pastaDoA())).toBe(false);
    });
  });
});
