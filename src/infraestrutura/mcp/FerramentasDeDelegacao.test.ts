import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { EventoDoMotor } from "../../orquestracao/EventoDeOrquestracao";
import { PedidoDeTurno } from "../../orquestracao/MotorDeAgentes";
import { DadosDoSubagentePronto } from "../../orquestracao/SubagentesProntos";
import { configuracaoDeTeste, criarPastasDeTeste, pedidoDeTeste } from "../motores/fixtures/pedidoDeTeste";
import { RegistroDeTurnosDoApp } from "../motores/RegistroDeTurnosDoApp";
import { ExecucaoDeSubtarefa, ExecutorDeSubtarefa, ResultadoDaSubtarefa } from "../motores/SubtarefaDoApp";
import { criarGrupoDeFerramentasDeDelegacao, NOME_DO_GRUPO_DE_DELEGACAO } from "./FerramentasDeDelegacao";
import { configuracaoMcpParaClaudeCode, NOME_DO_SERVIDOR_MCP, ServidorMcpDoApp } from "./ServidorMcpDoApp";

type RespostaMcp = { content: Array<{ type: string; text: string }>; isError?: boolean };

/** Executor falso: cada subtarefa espera o que o teste mandar, e as execuções ficam registradas. */
class ExecutorFalso implements ExecutorDeSubtarefa {
  readonly execucoes: ExecucaoDeSubtarefa[] = [];
  private iniciadas = 0;
  private liberarTodas: (() => void) | null = null;
  private readonly esperaPelasIniciadas: Array<{ quantas: number; resolver: () => void }> = [];
  /** Quando não nulo, as subtarefas só terminam depois de `liberar()`. */
  segurar = false;
  private readonly porteira = new Promise<void>((resolver) => {
    this.liberarTodas = resolver;
  });

  liberar(): void {
    this.liberarTodas?.();
  }

  aguardarIniciadas(quantas: number): Promise<void> {
    if (this.iniciadas >= quantas) return Promise.resolve();
    return new Promise((resolver) => this.esperaPelasIniciadas.push({ quantas, resolver }));
  }

  async executarSubtarefa(execucao: ExecucaoDeSubtarefa): Promise<ResultadoDaSubtarefa> {
    this.execucoes.push(execucao);
    this.iniciadas += 1;
    for (const espera of this.esperaPelasIniciadas) if (this.iniciadas >= espera.quantas) espera.resolver();
    execucao.aoProgredir({
      tipo: "progresso_do_subagente",
      subagenteId: execucao.subagenteId,
      atividade: "lendo",
      ultimaFerramenta: "Read",
      tokens: 5,
      ferramentasUsadas: 1,
      duracaoMs: 1,
    });
    if (this.segurar) {
      await Promise.race([
        this.porteira,
        new Promise<void>((resolver) => execucao.sinal.addEventListener("abort", () => resolver(), { once: true })),
      ]);
    }
    if (execucao.sinal.aborted) {
      return { situacao: "cancelado", relatorio: "Subtarefa cancelada.", tokensDeEntrada: 0, tokensDeSaida: 0, duracaoMs: 2 };
    }
    return {
      situacao: "concluido",
      relatorio: `Relatório de ${execucao.subtarefa.descricao}`,
      tokensDeEntrada: 100,
      tokensDeSaida: 20,
      duracaoMs: 3,
    };
  }
}

describe("ferramenta delegar_subtarefas", () => {
  let servidor: ServidorMcpDoApp;
  let turnos: RegistroDeTurnosDoApp;
  let executor: ExecutorFalso;
  let eventos: EventoDoMotor[];
  let controleDoTurno: AbortController;
  let clientes: Client[];
  let pedido: PedidoDeTurno;

  beforeEach(async () => {
    const pastas = criarPastasDeTeste();
    pedido = pedidoDeTeste(pastas, "codex", { configuracao: configuracaoDeTeste({ motorDoOrquestrador: "codex", motorDosSubagentes: "copilot", quantidadeDeSubagentes: { modo: "automatica", limite: 3 } }) });
    servidor = new ServidorMcpDoApp();
    turnos = new RegistroDeTurnosDoApp();
    executor = new ExecutorFalso();
    eventos = [];
    controleDoTurno = new AbortController();
    clientes = [];
    let proximo = 0;
    servidor.registrarGrupoDeFerramentas(
      NOME_DO_GRUPO_DE_DELEGACAO,
      criarGrupoDeFerramentasDeDelegacao({ turnos, executor, gerarId: () => `sub-${++proximo}` }),
    );
    await servidor.iniciar();
  });

  afterEach(async () => {
    for (const cliente of clientes) await cliente.close().catch(() => undefined);
    await servidor.encerrar();
  });

  /** Abre o turno do Orquestrador (no registro de turnos e no servidor MCP) e conecta um cliente MCP, como o CLI faria. */
  async function abrirTurno(sobrepor: Partial<PedidoDeTurno> = {}, ligado = true): Promise<Client> {
    turnos.registrar({ ...pedido, ...sobrepor }, (evento) => eventos.push(evento), controleDoTurno.signal);
    const registro = servidor.registrarTurno({ orquestradorId: pedido.orquestradorId, ferramentas: { [NOME_DO_GRUPO_DE_DELEGACAO]: ligado } });
    const configuracao = configuracaoMcpParaClaudeCode(registro).mcpServers[NOME_DO_SERVIDOR_MCP];
    const cliente = new Client({ name: "teste", version: "1.0.0" });
    await cliente.connect(new StreamableHTTPClientTransport(new URL(configuracao.url), { requestInit: { headers: configuracao.headers } }));
    clientes.push(cliente);
    return cliente;
  }

  const delegar = (cliente: Client, subtarefas: unknown[]): Promise<RespostaMcp> =>
    cliente.callTool({ name: "delegar_subtarefas", arguments: { subtarefas } }) as Promise<RespostaMcp>;

  it("aparece para o agente só quando o turno liga o grupo", async () => {
    const ligado = await abrirTurno();
    expect((await ligado.listTools()).tools.map((ferramenta) => ferramenta.name)).toEqual(["delegar_subtarefas"]);

    // Sem o grupo ligado o servidor nem oferece ferramentas: a chamada falha e nada roda.
    const desligado = await abrirTurno({}, false);
    const resultado = await delegar(desligado, [{ descricao: "A", prompt: "a" }]).then(
      (resposta) => (resposta.isError === true ? "erro" : "ok"),
      () => "erro",
    );
    expect(resultado).toBe("erro");
    expect(executor.execucoes).toHaveLength(0);
  });

  it("roda as subtarefas em paralelo, com a pasta e as permissões do turno, e devolve o relatório de cada uma na ordem", async () => {
    executor.segurar = true;
    const cliente = await abrirTurno();

    const chamada = delegar(cliente, [
      { descricao: "Primeira", prompt: "faça A" },
      { descricao: "Segunda", prompt: "faça B" },
      { descricao: "Terceira", prompt: "faça C" },
    ]);
    // As três começaram antes de qualquer uma terminar: se fossem em sequência, isto nunca resolveria.
    await executor.aguardarIniciadas(3);
    executor.liberar();
    const resposta = await chamada;

    expect(resposta.isError).toBeUndefined();
    const texto = resposta.content[0]?.text ?? "";
    expect(texto).toContain("Resultado das 3 subtarefas");
    expect(texto.indexOf("1. Primeira — concluída")).toBeGreaterThan(-1);
    expect(texto.indexOf("Relatório de Primeira")).toBeLessThan(texto.indexOf("Relatório de Segunda"));
    expect(texto.indexOf("Relatório de Segunda")).toBeLessThan(texto.indexOf("Relatório de Terceira"));
    expect(executor.execucoes.every((execucao) => execucao.pedido.pastaDeTrabalho.caminho === pedido.pastaDeTrabalho.caminho)).toBe(true);
    expect(executor.execucoes.every((execucao) => execucao.pedido.configuracao.nivelDePermissao === "edicao_e_comandos")).toBe(true);
    expect(executor.execucoes.map((execucao) => execucao.subtarefa.prompt)).toEqual(["faça A", "faça B", "faça C"]);
  });

  it("emite pelo aoObservar do turno os mesmos eventos de subagente do Claude Code: início, progresso, fim e relatório", async () => {
    const cliente = await abrirTurno();

    await delegar(cliente, [{ descricao: "Ler o projeto", prompt: "leia tudo" }]);

    expect(eventos).toEqual([
      { tipo: "subagente_iniciado", subagenteId: "sub-1", descricao: "Ler o projeto", tarefa: "leia tudo", papel: "executor" },
      { tipo: "progresso_do_subagente", subagenteId: "sub-1", atividade: "lendo", ultimaFerramenta: "Read", tokens: 5, ferramentasUsadas: 1, duracaoMs: 1 },
      { tipo: "subagente_concluido", subagenteId: "sub-1", situacao: "concluido", resumo: "Relatório de Ler o projeto", tokens: 120, duracaoMs: 3 },
      { tipo: "resultado_do_subagente", subagenteId: "sub-1", resultado: "Relatório de Ler o projeto" },
    ]);
  });

  it("conta os subagentes e os tokens deles no turno, para somar ao consumo", async () => {
    const cliente = await abrirTurno();

    await delegar(cliente, [{ descricao: "A", prompt: "a" }, { descricao: "B", prompt: "b" }]);

    const turno = turnos.obter(pedido.orquestradorId);
    expect(turno).toMatchObject({ subagentesLancados: 2, tokensDeEntradaDosSubagentes: 200, tokensDeSaidaDosSubagentes: 40 });
  });

  it("usa um subagente pronto pelo nome, com a especialidade dele, e recusa nome que não existe", async () => {
    const revisor: DadosDoSubagentePronto = { nome: "revisor", descricao: "Revisa o código", prompt: "Revise com rigor.", modelo: "herdar" };
    const cliente = await abrirTurno({ subagentesProntos: [revisor] });

    const certo = await delegar(cliente, [{ descricao: "Revisar", prompt: "revise a.ts", subagente: "revisor" }]);
    expect(certo.isError).toBeUndefined();
    expect(executor.execucoes[0]?.especialidade).toEqual(revisor);
    expect(eventos[0]).toMatchObject({ tipo: "subagente_iniciado", papel: "revisor" });

    const errado = await delegar(cliente, [{ descricao: "Revisar", prompt: "revise", subagente: "inexistente" }]);
    expect(errado.isError).toBe(true);
    expect(errado.content[0]?.text).toContain('O subagente "inexistente" não existe');
    expect(errado.content[0]?.text).toContain("executor, revisor");
  });

  it("recusa mais subtarefas do que a quantidade de subagentes configurada, sem rodar nenhuma", async () => {
    const cliente = await abrirTurno();

    const resposta = await delegar(cliente, [1, 2, 3, 4].map((indice) => ({ descricao: `T${indice}`, prompt: "x" })));

    expect(resposta.isError).toBe(true);
    expect(resposta.content[0]?.text).toContain("O limite deste pedido é de 3 subagentes");
    expect(executor.execucoes).toHaveLength(0);
  });

  it("vale o teto também entre chamadas simultâneas do mesmo turno", async () => {
    executor.segurar = true;
    const cliente = await abrirTurno();
    const primeira = delegar(cliente, [{ descricao: "A", prompt: "a" }, { descricao: "B", prompt: "b" }]);
    await executor.aguardarIniciadas(2);

    const segunda = await delegar(cliente, [{ descricao: "C", prompt: "c" }, { descricao: "D", prompt: "d" }]);

    expect(segunda.isError).toBe(true);
    expect(segunda.content[0]?.text).toContain("já há 2 em andamento");
    executor.liberar();
    expect((await primeira).isError).toBeUndefined();
  });

  it("o cancelamento do turno cancela as subtarefas em andamento", async () => {
    executor.segurar = true;
    const cliente = await abrirTurno();
    const chamada = delegar(cliente, [{ descricao: "Demorada", prompt: "espere" }, { descricao: "Outra", prompt: "espere" }]);
    await executor.aguardarIniciadas(2);

    controleDoTurno.abort();
    const resposta = await chamada;

    expect(executor.execucoes.every((execucao) => execucao.sinal.aborted)).toBe(true);
    expect(resposta.isError).toBe(true);
    expect(resposta.content[0]?.text).toContain("cancelada");
    expect(eventos.filter((evento) => evento.tipo === "subagente_concluido")).toEqual([
      expect.objectContaining({ situacao: "cancelado" }),
      expect.objectContaining({ situacao: "cancelado" }),
    ]);
  });

  it("devolve a falha de uma subtarefa como relatório, sem derrubar as outras", async () => {
    executor.executarSubtarefa = async (execucao) =>
      execucao.subtarefa.descricao === "Quebra"
        ? { situacao: "falhou", relatorio: "Limite de uso do Codex atingido.", tokensDeEntrada: 0, tokensDeSaida: 0, duracaoMs: 1 }
        : { situacao: "concluido", relatorio: "tudo certo", tokensDeEntrada: 1, tokensDeSaida: 1, duracaoMs: 1 };
    const cliente = await abrirTurno();

    const resposta = await delegar(cliente, [{ descricao: "Quebra", prompt: "a" }, { descricao: "Boa", prompt: "b" }]);

    expect(resposta.isError).toBeUndefined();
    expect(resposta.content[0]?.text).toContain("1. Quebra — falhou");
    expect(resposta.content[0]?.text).toContain("Limite de uso do Codex atingido.");
    expect(resposta.content[0]?.text).toContain("2. Boa — concluída");
  });

  it("trata um executor que lança erro como subtarefa que falhou", async () => {
    executor.executarSubtarefa = async () => {
      throw new Error("explodiu");
    };
    const cliente = await abrirTurno();

    const resposta = await delegar(cliente, [{ descricao: "A", prompt: "a" }]);

    expect(resposta.isError).toBe(true);
    expect(resposta.content[0]?.text).toContain("explodiu");
    expect(eventos).toContainEqual(expect.objectContaining({ tipo: "subagente_concluido", situacao: "falhou" }));
  });

  it("recusa a chamada quando o Orquestrador não tem turno em andamento", async () => {
    const outro = servidor.registrarTurno({ orquestradorId: "orq-sem-turno", ferramentas: { [NOME_DO_GRUPO_DE_DELEGACAO]: true } });
    const configuracao = configuracaoMcpParaClaudeCode(outro).mcpServers[NOME_DO_SERVIDOR_MCP];
    const semTurno = new Client({ name: "teste", version: "1.0.0" });
    await semTurno.connect(new StreamableHTTPClientTransport(new URL(configuracao.url), { requestInit: { headers: configuracao.headers } }));
    clientes.push(semTurno);

    const resposta = await delegar(semTurno, [{ descricao: "A", prompt: "a" }]);

    expect(resposta.isError).toBe(true);
    expect(resposta.content[0]?.text).toContain("Não há um pedido em andamento");
  });

  it("valida a entrada: sem subtarefas ou com descrição vazia, o agente recebe o erro", async () => {
    const cliente = await abrirTurno();

    await expect(delegar(cliente, [])).resolves.toMatchObject({ isError: true });
    await expect(delegar(cliente, [{ descricao: "", prompt: "x" }])).resolves.toMatchObject({ isError: true });
    expect(executor.execucoes).toHaveLength(0);
  });
});
