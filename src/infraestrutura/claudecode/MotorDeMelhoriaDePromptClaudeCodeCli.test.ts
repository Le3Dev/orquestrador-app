import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { ExecucaoDoClaudeCode, FachadaClaudeCodeCli, SaidaDoClaudeCode } from "./FachadaClaudeCodeCli";
import {
  montarAmbienteDaMelhoria,
  montarArgumentosDaMelhoria,
  MotorDeMelhoriaDePromptClaudeCodeCli,
  usoDoResultado,
} from "./MotorDeMelhoriaDePromptClaudeCodeCli";

const pastaDoTeste = mkdtempSync(path.join(tmpdir(), "motor-de-melhoria-"));
afterAll(() => rmSync(pastaDoTeste, { recursive: true, force: true }));

type Roteiro = (
  execucao: ExecucaoDoClaudeCode,
  aoReceberMensagem: (mensagem: unknown) => void,
  sinal: AbortSignal,
) => Promise<SaidaDoClaudeCode>;

/** Fachada sem processo: entrega as mensagens do roteiro e guarda o que recebeu. */
class FachadaFalsa extends FachadaClaudeCodeCli {
  execucao: ExecucaoDoClaudeCode | null = null;
  instrucoesGravadas = "";

  constructor(private readonly roteiro: Roteiro) {
    super("claude-falso");
  }

  override executar(
    execucao: ExecucaoDoClaudeCode,
    aoReceberMensagem: (mensagem: unknown) => void,
    sinal: AbortSignal,
  ): Promise<SaidaDoClaudeCode> {
    this.execucao = execucao;
    const argumentos = execucao.argumentos;
    this.instrucoesGravadas = readFileSync(argumentos[argumentos.indexOf("--system-prompt-file") + 1] ?? "", "utf8");
    return this.roteiro(execucao, aoReceberMensagem, sinal);
  }
}

const RESULTADO = {
  type: "result",
  subtype: "success",
  is_error: false,
  result: "Corrija o bug intermitente no login.",
  usage: { input_tokens: 9, cache_creation_input_tokens: 9, cache_read_input_tokens: 9, output_tokens: 9 },
  modelUsage: {
    "claude-haiku-5-5": { inputTokens: 2, outputTokens: 151, cacheReadInputTokens: 2181, cacheCreationInputTokens: 644 },
  },
};

const PEDIDO = { texto: "arruma o bug do login", instrucoes: "Reescreva o pedido." };

function motorCom(roteiro: Roteiro): { motor: MotorDeMelhoriaDePromptClaudeCodeCli; fachada: FachadaFalsa } {
  const fachada = new FachadaFalsa(roteiro);
  const ambiente = { CLAUDECODE: "1", CLAUDE_CODE_EFFORT_LEVEL: "max", PATH: "x" };
  return { motor: new MotorDeMelhoriaDePromptClaudeCodeCli(fachada, ambiente, pastaDoTeste), fachada };
}

describe("montarArgumentosDaMelhoria", () => {
  it("Haiku, esforço baixo, sem ferramentas, sem MCP nem skills, sem sessão gravada, entrada pelo stdin", () => {
    expect(montarArgumentosDaMelhoria("/tmp/x/instrucoes.txt")).toEqual([
      "-p",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--model",
      "haiku",
      "--effort",
      "low",
      "--system-prompt-file",
      "/tmp/x/instrucoes.txt",
      "--tools",
      "",
      "--strict-mcp-config",
      "--disable-slash-commands",
      "--no-session-persistence",
      "--permission-mode",
      "dontAsk",
    ]);
  });

  it("o ambiente sai sem a sessão pai, sem CLAUDE_CODE_EFFORT_LEVEL e sem CLAUDE.md nem memória", () => {
    const ambiente = montarAmbienteDaMelhoria({ CLAUDECODE: "1", CLAUDE_CODE_EFFORT_LEVEL: "max", PATH: "x" });

    expect(ambiente).toEqual({ PATH: "x", CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1", CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" });
  });
});

describe("usoDoResultado", () => {
  it("soma o modelUsage de todos os modelos", () => {
    expect(
      usoDoResultado({
        modelUsage: {
          a: { inputTokens: 1, cacheCreationInputTokens: 2, cacheReadInputTokens: 3, outputTokens: 4 },
          b: { inputTokens: 10, cacheCreationInputTokens: 20, cacheReadInputTokens: 30, outputTokens: 40 },
        },
      }),
    ).toEqual({ entrada: 11, criacaoDeCache: 22, leituraDeCache: 33, saida: 44 });
  });

  it("sem modelUsage, usa o usage", () => {
    expect(usoDoResultado({ usage: RESULTADO.usage })).toEqual({ entrada: 9, criacaoDeCache: 9, leituraDeCache: 9, saida: 9 });
  });
});

describe("MotorDeMelhoriaDePromptClaudeCodeCli", () => {
  it("roda com a instrução em arquivo, o texto pelo stdin, numa pasta neutra, e devolve texto e uso", async () => {
    const { motor, fachada } = motorCom(async (_execucao, aoReceber) => {
      aoReceber({ type: "system", subtype: "init" });
      aoReceber(RESULTADO);
      return { codigoDeSaida: 0, erroPadrao: "" };
    });

    const resultado = await motor.melhorar(PEDIDO, new AbortController().signal);

    expect(resultado).toEqual({
      sucesso: true,
      texto: "Corrija o bug intermitente no login.",
      uso: { entrada: 2, criacaoDeCache: 644, leituraDeCache: 2181, saida: 151 },
    });
    const execucao = fachada.execucao!;
    expect(fachada.instrucoesGravadas).toBe("Reescreva o pedido.");
    expect(execucao.argumentos).toContain("--no-session-persistence");
    expect(execucao.argumentos[execucao.argumentos.indexOf("--model") + 1]).toBe("haiku");
    expect(execucao.argumentos[execucao.argumentos.indexOf("--tools") + 1]).toBe("");
    expect(path.dirname(execucao.pasta)).toBe(pastaDoTeste);
    expect(execucao.dono.orquestradorId).toBe("melhoria-de-prompt");
    expect(execucao.ambiente.CLAUDECODE).toBeUndefined();
    expect(execucao.ambiente.CLAUDE_CODE_EFFORT_LEVEL).toBeUndefined();
    const entrada = JSON.parse(execucao.entrada) as { type: string; message: { content: unknown[] } };
    expect(entrada.type).toBe("user");
    expect(entrada.message.content).toEqual([{ type: "text", text: "arruma o bug do login" }]);
    // A pasta temporária (com a instrução) é apagada ao final.
    expect(existsSync(execucao.pasta)).toBe(false);
  });

  it("result com erro vira falha com motivo legível; limite de uso em português", async () => {
    const { motor } = motorCom(async (_execucao, aoReceber) => {
      aoReceber({ ...RESULTADO, subtype: "success", is_error: true, result: "Claude AI usage limit reached|1794236400" });
      return { codigoDeSaida: 1, erroPadrao: "" };
    });

    const resultado = await motor.melhorar(PEDIDO, new AbortController().signal);

    expect(resultado).toEqual({
      sucesso: false,
      motivo: "Limite de uso da assinatura do Claude atingido; tente de novo quando a cota renovar (Claude AI usage limit reached|1794236400).",
    });
  });

  it("sem result, a falha traz o código e o stderr", async () => {
    const { motor } = motorCom(async () => ({ codigoDeSaida: 1, erroPadrao: "Invalid API key" }));

    const resultado = await motor.melhorar(PEDIDO, new AbortController().signal);

    expect(resultado).toEqual({
      sucesso: false,
      motivo: "O Claude Code encerrou sem devolver o pedido melhorado (código 1): Invalid API key",
    });
  });

  it("falha ao iniciar o processo vira motivo legível", async () => {
    const { motor } = motorCom(async () => {
      throw new Error("Não foi possível iniciar o Claude Code.");
    });

    const resultado = await motor.melhorar(PEDIDO, new AbortController().signal);

    expect(resultado).toEqual({
      sucesso: false,
      motivo: "Não foi possível consultar o Claude Code: Não foi possível iniciar o Claude Code.",
    });
  });

  it("com o sinal abortado durante a execução, resolve como cancelada", async () => {
    const controle = new AbortController();
    const { motor } = motorCom(async () => {
      controle.abort();
      return { codigoDeSaida: null, erroPadrao: "" };
    });

    expect(await motor.melhorar(PEDIDO, controle.signal)).toEqual({ sucesso: false, motivo: "Cancelada." });
  });
});
