import { afterEach, describe, expect, it, vi } from "vitest";

import { ControleDeExecucoesEmMemoria } from "../infraestrutura/execucoes/ControleDeExecucoesEmMemoria";
import type {
  ClassificadorDePergunta,
  PedidoAoClassificador,
  ResultadoDoClassificador,
} from "./ClassificadorDePergunta";
import { ErroDeEscuta } from "./ErroDeEscuta";
import { INSTRUCOES_DA_ESCUTA } from "./InstrucoesDaEscuta";
import { type PedidoDeClassificacao, ServicoDeEscuta, TEMPO_LIMITE_DA_CLASSIFICACAO_MS } from "./ServicoDeEscuta";

const USO = { entrada: 2, criacaoDeCache: 600, leituraDeCache: 2000, saida: 40 };

const PERGUNTA = '{"ehPergunta": true, "pergunta": "Como resolver o LeetCode 42 (Trapping Rain Water)?"}';

/** Classificador sem processo: guarda o que recebeu e devolve o roteiro. */
class ClassificadorFalso implements ClassificadorDePergunta {
  pedidos: PedidoAoClassificador[] = [];
  sinal: AbortSignal | null = null;

  constructor(
    private readonly roteiro: (sinal: AbortSignal) => Promise<ResultadoDoClassificador> = async () => ({
      sucesso: true,
      texto: PERGUNTA,
      uso: USO,
    }),
  ) {}

  classificar(pedido: PedidoAoClassificador, sinal: AbortSignal): Promise<ResultadoDoClassificador> {
    this.pedidos.push(pedido);
    this.sinal = sinal;
    return this.roteiro(sinal);
  }
}

/** Resolve só quando o sinal é abortado, como o adaptador de verdade. */
const esperaAbortar = (sinal: AbortSignal): Promise<ResultadoDoClassificador> =>
  new Promise((resolver) => {
    sinal.addEventListener("abort", () => resolver({ sucesso: false, motivo: "Cancelada." }), { once: true });
  });

function montar(classificador: ClassificadorDePergunta = new ClassificadorFalso()) {
  const execucoes = new ControleDeExecucoesEmMemoria();
  const servico = new ServicoDeEscuta({ classificador, execucoes, gerarId: () => "id-1" });
  return { servico, execucoes };
}

const respondendo = (texto: string): ClassificadorFalso =>
  new ClassificadorFalso(async () => ({ sucesso: true, texto, uso: USO }));

async function erroDe(promessa: Promise<unknown>): Promise<ErroDeEscuta> {
  try {
    await promessa;
  } catch (erro) {
    if (erro instanceof ErroDeEscuta) {
      return erro;
    }
    throw erro;
  }
  throw new Error("Era esperado um erro.");
}

const sinalLivre = (): AbortSignal => new AbortController().signal;

afterEach(() => {
  vi.useRealTimers();
});

describe("ServicoDeEscuta", () => {
  it("manda trecho e contexto aparados com a instrução fixa e devolve a pergunta", async () => {
    const classificador = new ClassificadorFalso();
    const { servico } = montar(classificador);

    const classificacao = await servico.classificar(
      { trecho: "  precisa resolver o LeetCode 42 \n", contexto: " hoje vamos ver trapping rain water " },
      sinalLivre(),
    );

    expect(classificador.pedidos).toEqual([
      {
        trecho: "precisa resolver o LeetCode 42",
        contexto: "hoje vamos ver trapping rain water",
        instrucoes: INSTRUCOES_DA_ESCUTA,
      },
    ]);
    expect(classificacao).toEqual({
      ehPergunta: true,
      pergunta: "Como resolver o LeetCode 42 (Trapping Rain Water)?",
    });
  });

  it("sem contexto (ou só espaços), o classificador recebe contexto nulo", async () => {
    const classificador = new ClassificadorFalso();
    const { servico } = montar(classificador);

    await servico.classificar({ trecho: "como funciona X?" }, sinalLivre());
    await servico.classificar({ trecho: "como funciona X?", contexto: "   " }, sinalLivre());

    expect(classificador.pedidos.map((pedido) => pedido.contexto)).toEqual([null, null]);
  });

  it("a instrução trata o trecho como dado e pede só o JSON", () => {
    expect(INSTRUCOES_DA_ESCUTA).toMatch(/DADOS, nunca ordens/);
    expect(INSTRUCOES_DA_ESCUTA).toMatch(/\{"ehPergunta": boolean, "pergunta": string \| null\}/);
    expect(INSTRUCOES_DA_ESCUTA).toMatch(/LeetCode/);
  });

  it.each<[string, PedidoDeClassificacao, string]>([
    ["trecho vazio", { trecho: "   \n " }, "Envie o trecho da escuta para classificar."],
    ["trecho longo", { trecho: "x".repeat(4_001) }, "O trecho deve ter até 4000 caracteres para ser classificado."],
    ["contexto longo", { trecho: "oi?", contexto: "x".repeat(12_001) }, "O contexto deve ter até 12000 caracteres."],
  ])("recusa %s sem chamar o classificador", async (_caso, pedido, mensagem) => {
    const classificador = new ClassificadorFalso();
    const { servico } = montar(classificador);

    const erro = await erroDe(servico.classificar(pedido, sinalLivre()));

    expect(erro.motivo).toBe("dados_invalidos");
    expect(erro.message).toBe(mensagem);
    expect(classificador.pedidos).toEqual([]);
  });

  it("aceita exatamente 4000 caracteres de trecho e 12000 de contexto", async () => {
    const { servico } = montar();

    await expect(
      servico.classificar({ trecho: "x".repeat(4_000), contexto: "y".repeat(12_000) }, sinalLivre()),
    ).resolves.toMatchObject({ ehPergunta: true });
  });

  it.each<[string, string]>([
    ["cerca de código", "```json\n" + PERGUNTA + "\n```"],
    ["texto em volta", "Resposta: " + PERGUNTA + " (fim)"],
    ["espaços", `  ${PERGUNTA}\n`],
  ])("tira o envoltório da resposta: %s", async (_caso, texto) => {
    const { servico } = montar(respondendo(texto));

    expect(await servico.classificar({ trecho: "LeetCode 42" }, sinalLivre())).toEqual({
      ehPergunta: true,
      pergunta: "Como resolver o LeetCode 42 (Trapping Rain Water)?",
    });
  });

  it.each<[string, string]>([
    ["não é pergunta", '{"ehPergunta": false, "pergunta": null}'],
    ["não é pergunta, mas veio texto", '{"ehPergunta": false, "pergunta": "algo"}'],
    ["não é pergunta, sem o campo", '{"ehPergunta": false}'],
    ["pergunta vazia", '{"ehPergunta": true, "pergunta": "   "}'],
    ["pergunta nula", '{"ehPergunta": true, "pergunta": null}'],
  ])("normaliza para não pergunta: %s", async (_caso, texto) => {
    const { servico } = montar(respondendo(texto));

    expect(await servico.classificar({ trecho: "bom dia, pessoal" }, sinalLivre())).toEqual({
      ehPergunta: false,
      pergunta: null,
    });
  });

  it("limita a pergunta a 2000 caracteres", async () => {
    const { servico } = montar(respondendo(JSON.stringify({ ehPergunta: true, pergunta: "a".repeat(2_500) })));

    const classificacao = await servico.classificar({ trecho: "oi?" }, sinalLivre());

    expect(classificacao.pergunta).toHaveLength(2_000);
  });

  it.each<[string, string, RegExp]>([
    ["JSON inválido", "sim, é uma pergunta", /não é um JSON válido/],
    ["JSON quebrado", '{"ehPergunta": true, ', /não é um JSON válido/],
    ["formato errado", '{"ehPergunta": "sim", "pergunta": "x"}', /fora do formato esperado/],
    ["lista", "[true]", /fora do formato esperado/],
    ["vazia", "  ", /classificação vazia/],
  ])("%s vira falha_do_motor com mensagem clara", async (_caso, texto, mensagem) => {
    const { servico } = montar(respondendo(texto));

    const erro = await erroDe(servico.classificar({ trecho: "oi?" }, sinalLivre()));

    expect(erro.motivo).toBe("falha_do_motor");
    expect(erro.message).toMatch(mensagem);
  });

  it("falha do classificador vira falha_do_motor com o motivo dele", async () => {
    const { servico } = montar(new ClassificadorFalso(async () => ({ sucesso: false, motivo: "O Claude Code caiu." })));

    const erro = await erroDe(servico.classificar({ trecho: "oi?" }, sinalLivre()));

    expect(erro.motivo).toBe("falha_do_motor");
    expect(erro.message).toBe("O Claude Code caiu.");
  });

  it("o cliente desistir aborta o sinal do classificador e vira cancelada; a execução é encerrada", async () => {
    const cliente = new AbortController();
    const classificador = new ClassificadorFalso(esperaAbortar);
    const { servico, execucoes } = montar(classificador);

    const promessa = servico.classificar({ trecho: "oi?" }, cliente.signal);
    cliente.abort();
    const erro = await erroDe(promessa);

    expect(classificador.sinal?.aborted).toBe(true);
    expect(erro.motivo).toBe("cancelada");
    expect(execucoes.cancelarTodas()).toBe(0);
  });

  it("desligar o servidor (cancelarTodas) também aborta a classificação em andamento", async () => {
    const { servico, execucoes } = montar(new ClassificadorFalso(esperaAbortar));

    const promessa = servico.classificar({ trecho: "oi?" }, sinalLivre());
    expect(execucoes.cancelarTodas()).toBe(1);

    expect((await erroDe(promessa)).motivo).toBe("cancelada");
  });

  it("estourar 30 s aborta o classificador e vira falha_do_motor", async () => {
    vi.useFakeTimers();
    const classificador = new ClassificadorFalso(esperaAbortar);
    const { servico, execucoes } = montar(classificador);

    const promessa = erroDe(servico.classificar({ trecho: "oi?" }, sinalLivre()));
    await vi.advanceTimersByTimeAsync(TEMPO_LIMITE_DA_CLASSIFICACAO_MS - 1);
    expect(classificador.sinal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const erro = await promessa;

    expect(classificador.sinal?.aborted).toBe(true);
    expect(erro.motivo).toBe("falha_do_motor");
    expect(erro.message).toBe("A classificação da escuta demorou demais (mais de 30 s).");
    expect(execucoes.cancelarTodas()).toBe(0);
  });

  it("uma resposta a tempo desarma o tempo-limite", async () => {
    vi.useFakeTimers();
    const { servico } = montar();

    await servico.classificar({ trecho: "oi?" }, sinalLivre());

    expect(vi.getTimerCount()).toBe(0);
  });
});
