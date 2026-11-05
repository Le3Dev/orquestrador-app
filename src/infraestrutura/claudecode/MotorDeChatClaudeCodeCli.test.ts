import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import type { EventoDoMotorDeChat, PerguntaAoMotorDeChat } from "../../chat/MotorDeChat";
import { ExecucaoDoClaudeCode, FachadaClaudeCodeCli, SaidaDoClaudeCode } from "./FachadaClaudeCodeCli";
import { MotorDeChatClaudeCodeCli } from "./MotorDeChatClaudeCodeCli";

const pastaDoTeste = mkdtempSync(path.join(tmpdir(), "motor-de-chat-"));
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
  configuracoesGravadas = "";

  constructor(private readonly roteiro: Roteiro) {
    super("claude-falso");
  }

  override executar(
    execucao: ExecucaoDoClaudeCode,
    aoReceberMensagem: (mensagem: unknown) => void,
    sinal: AbortSignal,
  ): Promise<SaidaDoClaudeCode> {
    this.execucao = execucao;
    this.instrucoesGravadas = readFileSync(argumentoDe(execucao, "--append-system-prompt-file"), "utf8");
    this.configuracoesGravadas = readFileSync(argumentoDe(execucao, "--settings"), "utf8");
    return this.roteiro(execucao, aoReceberMensagem, sinal);
  }
}

function argumentoDe(execucao: ExecucaoDoClaudeCode | null, opcao: string): string {
  const argumentos = execucao?.argumentos ?? [];
  return argumentos[argumentos.indexOf(opcao) + 1] ?? "";
}

function pergunta(alteracoes: Partial<PerguntaAoMotorDeChat> = {}): PerguntaAoMotorDeChat {
  return {
    sessaoId: "sessao-chat",
    sessaoIniciada: false,
    mensagem: "Qual a versão do Node?",
    instrucoes: "Responda curto.",
    imagens: [],
    pastaDasImagens: null,
    pastaDaSessao: path.join(pastaDoTeste, "sessoes", "sessao-chat"),
    pastaDosProjetos: pastaDoTeste,
    modelo: "haiku",
    esforco: "baixo",
    alteracoesAutorizadas: false,
    ...alteracoes,
  };
}

const RESULTADO = {
  type: "result",
  subtype: "success",
  is_error: false,
  result: "Node 26.",
  duration_ms: 10,
  modelUsage: { "claude-haiku-5-5": { inputTokens: 3, outputTokens: 4 } },
};

/** Negação de um Write, como o Claude Code manda sem a ferramenta liberada. */
const NEGACAO_DO_WRITE = [
  { type: "system", subtype: "permission_denied", tool_name: "Write", tool_use_id: "toolu_1", decision_reason_type: "mode" },
  {
    ...RESULTADO,
    result: "Preciso da autorização.",
    permission_denials: [{ tool_name: "Write", tool_use_id: "toolu_1", tool_input: { file_path: "C:\\p\\a.ts", content: "x" } }],
  },
];

describe("MotorDeChatClaudeCodeCli", () => {
  it("roda o Claude Code com dono chat, instruções em arquivo e mensagem pelo stdin", async () => {
    const fachada = new FachadaFalsa(async (_execucao, aoReceber) => {
      aoReceber({ type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", delta: { type: "text_delta", text: "Node 26." } } });
      aoReceber(RESULTADO);
      return { codigoDeSaida: 0, erroPadrao: "" };
    });
    const imagem = path.join(pastaDoTeste, "a.png");
    writeFileSync(imagem, Buffer.from([1, 2, 3]));
    const eventos: EventoDoMotorDeChat[] = [];

    const resultado = await new MotorDeChatClaudeCodeCli(fachada, { CLAUDECODE: "1", PATH: "x" }).responder(
      pergunta({ imagens: [{ caminho: imagem, tipoDeMidia: "image/png" }], pastaDasImagens: pastaDoTeste }),
      (evento) => eventos.push(evento),
      new AbortController().signal,
    );

    expect(resultado).toMatchObject({ sucesso: true, resposta: "Node 26.", uso: { tokensDeSaida: 4, modeloUsado: "claude-haiku-5-5" } });
    expect(eventos).toEqual([{ tipo: "trecho_da_resposta", texto: "Node 26." }]);
    expect(fachada.execucao?.dono).toEqual({ orquestradorId: "chat", sessaoId: "sessao-chat" });
    expect(fachada.execucao?.pasta).toBe(pergunta().pastaDaSessao);
    expect(existsSync(pergunta().pastaDaSessao)).toBe(true);
    expect(fachada.execucao?.ambiente.CLAUDECODE).toBeUndefined();
    expect(fachada.instrucoesGravadas).toBe("Responda curto.");

    const entrada = JSON.parse(fachada.execucao?.entrada ?? "{}") as { message: { content: unknown[] } };
    expect(entrada.message.content).toEqual([
      { type: "text", text: "Qual a versão do Node?" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AQID" } },
    ]);
  });

  it("grava o --settings sem a atribuição Co-authored-by e apaga os temporários ao final", async () => {
    const fachada = new FachadaFalsa(async (_execucao, aoReceber) => {
      aoReceber(RESULTADO);
      return { codigoDeSaida: 0, erroPadrao: "" };
    });

    await new MotorDeChatClaudeCodeCli(fachada).responder(pergunta(), () => undefined, new AbortController().signal);

    expect(JSON.parse(fachada.configuracoesGravadas)).toEqual({ attribution: { commit: "", pr: "" } });
    expect(path.basename(argumentoDe(fachada.execucao, "--settings"))).toBe("configuracoes.json");
    expect(existsSync(argumentoDe(fachada.execucao, "--append-system-prompt-file"))).toBe(false);
    expect(existsSync(argumentoDe(fachada.execucao, "--settings"))).toBe(false);
  });

  it("sem autorização, a edição negada volta como autorização pendente", async () => {
    const fachada = new FachadaFalsa(async (_execucao, aoReceber) => {
      NEGACAO_DO_WRITE.forEach(aoReceber);
      return { codigoDeSaida: 0, erroPadrao: "" };
    });

    const resultado = await new MotorDeChatClaudeCodeCli(fachada).responder(pergunta(), () => undefined, new AbortController().signal);

    expect(resultado).toMatchObject({ sucesso: true, autorizacaoPendente: { acao: "editar", detalhe: "C:\\p\\a.ts" }, avisos: [] });
    expect(fachada.execucao?.argumentos).toContain("--allowedTools");
    expect(fachada.execucao?.argumentos).not.toContain("--dangerously-skip-permissions");
  });

  it("com autorização, libera as alterações e nenhuma negação vira pendência", async () => {
    const fachada = new FachadaFalsa(async (_execucao, aoReceber) => {
      NEGACAO_DO_WRITE.forEach(aoReceber);
      return { codigoDeSaida: 0, erroPadrao: "" };
    });

    const resultado = await new MotorDeChatClaudeCodeCli(fachada).responder(
      pergunta({ alteracoesAutorizadas: true }),
      () => undefined,
      new AbortController().signal,
    );

    expect(resultado).toMatchObject({ sucesso: true, autorizacaoPendente: null, avisos: [expect.stringContaining("Write")] });
    const argumentos = fachada.execucao?.argumentos ?? [];
    const liberadas = argumentos.slice(argumentos.indexOf("--allowedTools") + 1, argumentos.indexOf("--disallowedTools"));
    expect(liberadas).toContain("Edit");
    expect(liberadas).toContain("PowerShell");
  });

  it("resolve como cancelada quando o sinal é abortado", async () => {
    const controle = new AbortController();
    const fachada = new FachadaFalsa(async () => {
      controle.abort();
      return { codigoDeSaida: null, erroPadrao: "" };
    });

    const resultado = await new MotorDeChatClaudeCodeCli(fachada).responder(pergunta(), () => undefined, controle.signal);

    expect(resultado).toEqual({ sucesso: false, motivo: "Cancelada.", uso: null });
  });

  it("explica quando o processo encerra sem resposta", async () => {
    const fachada = new FachadaFalsa(async () => ({ codigoDeSaida: 1, erroPadrao: "Erro de login" }));

    const resultado = await new MotorDeChatClaudeCodeCli(fachada).responder(pergunta(), () => undefined, new AbortController().signal);

    expect(resultado).toMatchObject({ sucesso: false, motivo: expect.stringContaining("Erro de login"), uso: null });
  });

  it("devolve falha legível quando o Claude Code nem inicia", async () => {
    const fachada = new FachadaFalsa(async () => {
      throw new Error("Não foi possível iniciar o Claude Code.");
    });

    const resultado = await new MotorDeChatClaudeCodeCli(fachada).responder(pergunta(), () => undefined, new AbortController().signal);

    expect(resultado).toMatchObject({ sucesso: false, motivo: expect.stringContaining("Não foi possível iniciar") });
  });
});
