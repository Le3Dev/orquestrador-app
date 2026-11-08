import { describe, expect, it } from "vitest";

import { ControleDeExecucoesEmMemoria } from "../infraestrutura/execucoes/ControleDeExecucoesEmMemoria";
import { ErroDeMelhoriaDePrompt } from "./ErroDeMelhoriaDePrompt";
import type {
  MotorDeMelhoriaDePrompt,
  PedidoAoMotorDeMelhoria,
  ResultadoDoMotorDeMelhoria,
} from "./MotorDeMelhoriaDePrompt";
import {
  instrucoesDaMelhoria,
  limparRespostaDaMelhoria,
  type PedidoDeMelhoria,
  ServicoDeMelhoriaDePrompt,
} from "./ServicoDeMelhoriaDePrompt";

const USO = { entrada: 2, criacaoDeCache: 600, leituraDeCache: 2000, saida: 150 };

/** Motor sem processo: guarda o que recebeu e devolve o roteiro. */
class MotorFalso implements MotorDeMelhoriaDePrompt {
  pedidos: PedidoAoMotorDeMelhoria[] = [];
  sinal: AbortSignal | null = null;

  constructor(
    private readonly roteiro: (sinal: AbortSignal) => Promise<ResultadoDoMotorDeMelhoria> = async () => ({
      sucesso: true,
      texto: "Corrija o bug intermitente no login.",
      uso: USO,
    }),
  ) {}

  melhorar(pedido: PedidoAoMotorDeMelhoria, sinal: AbortSignal): Promise<ResultadoDoMotorDeMelhoria> {
    this.pedidos.push(pedido);
    this.sinal = sinal;
    return this.roteiro(sinal);
  }
}

function montar(motor: MotorDeMelhoriaDePrompt = new MotorFalso()) {
  const execucoes = new ControleDeExecucoesEmMemoria();
  let instante = 1_000;
  const servico = new ServicoDeMelhoriaDePrompt({
    motor,
    execucoes,
    gerarId: () => "id-1",
    agora: () => {
      const data = new Date(instante);
      instante += 750;
      return data;
    },
  });
  return { servico, execucoes };
}

async function erroDe(promessa: Promise<unknown>): Promise<ErroDeMelhoriaDePrompt> {
  try {
    await promessa;
  } catch (erro) {
    if (erro instanceof ErroDeMelhoriaDePrompt) {
      return erro;
    }
    throw erro;
  }
  throw new Error("Era esperado um erro.");
}

const sinalLivre = (): AbortSignal => new AbortController().signal;

describe("ServicoDeMelhoriaDePrompt", () => {
  it("manda o texto aparado e a instrução ao motor e devolve texto, uso, índice e duração", async () => {
    const motor = new MotorFalso();
    const { servico } = montar(motor);

    const melhorado = await servico.melhorar(
      { texto: "  arruma o bug do login q ta quebrando as vezes \n", onde: "chat" },
      sinalLivre(),
    );

    expect(motor.pedidos).toEqual([
      { texto: "arruma o bug do login q ta quebrando as vezes", instrucoes: instrucoesDaMelhoria("chat") },
    ]);
    expect(melhorado).toEqual({
      texto: "Corrija o bug intermitente no login.",
      uso: USO,
      // 2 + 1,25×600 + 0,1×2000 + 5×150
      indiceDeCusto: 1702,
      duracaoMs: 750,
    });
  });

  it("a instrução do orquestrador cita os subagentes e, se veio, só o nome da pasta", () => {
    expect(instrucoesDaMelhoria("chat")).not.toMatch(/orquestrador/);
    expect(instrucoesDaMelhoria("orquestrador")).toMatch(/orquestrador que divide o trabalho entre subagentes\.$/);
    expect(instrucoesDaMelhoria("orquestrador", "C:\\Projetos\\PIR_app\\")).toMatch(
      /entre subagentes no projeto "PIR_app"\.$/,
    );
    expect(instrucoesDaMelhoria("orquestrador", "   ")).toMatch(/entre subagentes\.$/);
    expect(instrucoesDaMelhoria("chat")).toMatch(/^Reescreva o pedido do usuário para um agente de programação/);
  });

  it.each<[string, PedidoDeMelhoria, string]>([
    ["texto vazio", { texto: "   \n ", onde: "chat" }, "Escreva o pedido para melhorar."],
    ["texto longo", { texto: "x".repeat(20_001), onde: "chat" }, "O pedido deve ter até 20000 caracteres para ser melhorado."],
    ["destino inválido", { texto: "oi", onde: "terminal" }, "Destino do pedido inválido."],
  ])("recusa %s sem chamar o motor", async (_caso, pedido, mensagem) => {
    const motor = new MotorFalso();
    const { servico } = montar(motor);

    const erro = await erroDe(servico.melhorar(pedido, sinalLivre()));

    expect(erro.motivo).toBe("dados_invalidos");
    expect(erro.message).toBe(mensagem);
    expect(motor.pedidos).toEqual([]);
  });

  it("aceita exatamente 20000 caracteres", async () => {
    const { servico } = montar();

    await expect(servico.melhorar({ texto: "x".repeat(20_000), onde: "orquestrador" }, sinalLivre())).resolves.toMatchObject({
      texto: "Corrija o bug intermitente no login.",
    });
  });

  it("falha do motor vira falha_do_motor com o motivo dele", async () => {
    const { servico } = montar(new MotorFalso(async () => ({ sucesso: false, motivo: "O Claude Code caiu." })));

    const erro = await erroDe(servico.melhorar({ texto: "oi", onde: "chat" }, sinalLivre()));

    expect(erro.motivo).toBe("falha_do_motor");
    expect(erro.message).toBe("O Claude Code caiu.");
  });

  it.each(["", "   ", '""', "```\n\n```"])("resposta vazia (%j) vira falha_do_motor", async (texto) => {
    const { servico } = montar(new MotorFalso(async () => ({ sucesso: true, texto, uso: USO })));

    const erro = await erroDe(servico.melhorar({ texto: "oi", onde: "chat" }, sinalLivre()));

    expect(erro.motivo).toBe("falha_do_motor");
    expect(erro.message).toMatch(/resposta vazia/);
  });

  it("o cliente desistir aborta o sinal do motor e vira cancelada; a execução é encerrada", async () => {
    const cliente = new AbortController();
    const motor = new MotorFalso(
      (sinal) =>
        new Promise((resolver) => {
          sinal.addEventListener("abort", () => resolver({ sucesso: false, motivo: "Cancelada." }), { once: true });
        }),
    );
    const { servico, execucoes } = montar(motor);

    const promessa = servico.melhorar({ texto: "oi", onde: "chat" }, cliente.signal);
    cliente.abort();
    const erro = await erroDe(promessa);

    expect(motor.sinal?.aborted).toBe(true);
    expect(erro.motivo).toBe("cancelada");
    expect(execucoes.cancelarTodas()).toBe(0);
  });

  it("desligar o servidor (cancelarTodas) também aborta a melhoria em andamento", async () => {
    const motor = new MotorFalso(
      (sinal) =>
        new Promise((resolver) => {
          sinal.addEventListener("abort", () => resolver({ sucesso: false, motivo: "Cancelada." }), { once: true });
        }),
    );
    const { servico, execucoes } = montar(motor);

    const promessa = servico.melhorar({ texto: "oi", onde: "chat" }, sinalLivre());
    expect(execucoes.cancelarTodas()).toBe(1);

    expect((await erroDe(promessa)).motivo).toBe("cancelada");
  });
});

describe("limparRespostaDaMelhoria", () => {
  it.each<[string, string]>([
    ["  Corrija o login.  \n", "Corrija o login."],
    ['"Corrija o login."', "Corrija o login."],
    ["\u201CCorrija o login.\u201D", "Corrija o login."],
    ["'Corrija o login.'", "Corrija o login."],
    ["```\nCorrija o login.\n```", "Corrija o login."],
    ["```markdown\nCorrija o login.\nUse `src/a.ts`.\n```", "Corrija o login.\nUse `src/a.ts`."],
    ['```\n"Corrija o login."\n```', "Corrija o login."],
  ])("tira o envoltório de %j", (entrada, esperado) => {
    expect(limparRespostaDaMelhoria(entrada)).toBe(esperado);
  });

  it.each([
    'Troque "a" por "b".',
    "Rode:\n```\nnpm test\n```\ne confira.",
    "```\na\n```\ntexto\n```\nb\n```",
    "`npm test` e depois `npm run lint`",
    '"a" e "b"',
  ])("mantém aspas e cercas que não envolvem tudo: %j", (entrada) => {
    expect(limparRespostaDaMelhoria(entrada)).toBe(entrada);
  });
});
