import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ConfiguracaoDoOrquestrador } from "../../orquestracao/ConfiguracaoDoOrquestrador";
import { InstrucoesAplicadas } from "../../orquestracao/InstrucoesPersonalizadas";
import { PedidoDeTurno } from "../../orquestracao/MotorDeAgentes";
import { PastaDeTrabalho } from "../../orquestracao/PastaDeTrabalho";
import { ExecucaoDoClaudeCode, FachadaClaudeCodeCli, SaidaDoClaudeCode } from "./FachadaClaudeCodeCli";
import { MotorClaudeCodeCli } from "./MotorClaudeCodeCli";

/** No lugar do processo `claude -p`: guarda o que receberia e responde com um resultado. */
class FachadaFalsa {
  execucao: ExecucaoDoClaudeCode | null = null;
  instrucoesIniciais: string | null = null;

  async executar(
    execucao: ExecucaoDoClaudeCode,
    aoReceberMensagem: (mensagem: unknown) => void,
  ): Promise<SaidaDoClaudeCode> {
    this.execucao = execucao;
    // O arquivo é apagado ao fim do turno: lido aqui, enquanto existe.
    const indice = execucao.argumentos.indexOf("--append-system-prompt-file");
    this.instrucoesIniciais = await readFile(execucao.argumentos[indice + 1] ?? "", "utf8");
    aoReceberMensagem({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "PIRULITO, feito.",
      duration_ms: 1,
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    return { codigoDeSaida: 0, erroPadrao: "" };
  }
}

function pedido(instrucoes: InstrucoesAplicadas | null, revogarInstrucoesAnteriores = false): PedidoDeTurno {
  return {
    orquestradorId: "o1",
    sessaoId: "sessao-1",
    sessaoIniciada: true,
    texto: "analise o projeto",
    modo: "execucao",
    pastaDeTrabalho: PastaDeTrabalho.resolver(path.resolve("/projetos"), "painel"),
    configuracao: ConfiguracaoDoOrquestrador.de({
      modeloDoOrquestrador: "haiku",
      modeloDosSubagentes: "haiku",
      quantidadeDeSubagentes: { modo: "automatica", limite: 2 },
      nivelDePermissao: "leitura",
    }),
    imagens: [],
    pastaDasImagens: null,
    instrucoes,
    revogarInstrucoesAnteriores,
    subagentesProntos: [],
  };
}

/** O texto da mensagem como vai no stdin (`stream-json`). */
function textoDaEntrada(fachada: FachadaFalsa): string {
  const linha = JSON.parse(fachada.execucao?.entrada ?? "{}") as {
    message: { content: Array<{ type: string; text?: string }> };
  };
  return linha.message.content.find((parte) => parte.type === "text")?.text ?? "";
}

describe("MotorClaudeCodeCli e as instruções personalizadas", () => {
  it("manda as instruções no bloco da mensagem (stdin) e deixa o system prompt como está", async () => {
    const fachada = new FachadaFalsa();
    const motor = new MotorClaudeCodeCli(fachada as unknown as FachadaClaudeCodeCli);

    const resultado = await motor.executarTurno(
      pedido({ texto: "Sempre comece a resposta com a palavra PIRULITO.", origem: "orquestrador" }),
      () => undefined,
      new AbortController().signal,
    );

    expect(resultado.sucesso).toBe(true);
    const texto = textoDaEntrada(fachada);
    expect(texto).toContain(
      "<instrucoes-do-usuario>\nSempre comece a resposta com a palavra PIRULITO.\n</instrucoes-do-usuario>\n</configuracao-do-pedido>",
    );
    expect(texto.endsWith("\n\nanalise o projeto")).toBe(true);
    expect(fachada.instrucoesIniciais).not.toContain("PIRULITO");
    // Nada do texto do usuário vai por argumento de linha de comando.
    expect(fachada.execucao?.argumentos.join(" ")).not.toContain("PIRULITO");
  });

  it("sem instruções, a mensagem não ganha bloco nem cabeçalho", async () => {
    const fachada = new FachadaFalsa();
    const motor = new MotorClaudeCodeCli(fachada as unknown as FachadaClaudeCodeCli);

    await motor.executarTurno(pedido(null), () => undefined, new AbortController().signal);

    expect(textoDaEntrada(fachada)).not.toContain("instrucoes-do-usuario");
    expect(textoDaEntrada(fachada)).not.toContain("Instruções personalizadas");
  });
});

/** Um turno em que o agente só cita o servidor: no comando e na resposta final. */
class FachadaQueCitaServidor {
  async executar(
    _execucao: ExecucaoDoClaudeCode,
    aoReceberMensagem: (mensagem: unknown) => void,
  ): Promise<SaidaDoClaudeCode> {
    aoReceberMensagem({
      type: "assistant",
      parent_tool_use_id: null,
      message: {
        content: [
          { type: "tool_use", id: "c1", name: "Bash", input: { command: "open http://127.0.0.1:4173/" } },
        ],
      },
    });
    aoReceberMensagem({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "No ar em http://127.0.0.1:4173/ e a documentação em http://localhost:9000.",
      duration_ms: 1,
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    return { codigoDeSaida: 0, erroPadrao: "" };
  }
}

function enderecos(eventos: unknown[]): unknown[] {
  return eventos.filter((evento) => (evento as { tipo: string }).tipo === "endereco_local_detectado");
}

describe("MotorClaudeCodeCli e os servidores citados", () => {
  it("anuncia, antes do fim do turno, só os endereços citados que respondem, uma vez cada", async () => {
    const sondados: string[] = [];
    const motor = new MotorClaudeCodeCli(
      new FachadaQueCitaServidor() as unknown as FachadaClaudeCodeCli,
      async (url) => {
        sondados.push(url);
        await new Promise((resolver) => setTimeout(resolver, 5));
        return url === "http://localhost:4173";
      },
    );
    const eventos: unknown[] = [];

    const resultado = await motor.executarTurno(pedido(null), (evento) => eventos.push(evento), new AbortController().signal);

    expect(resultado.sucesso).toBe(true);
    expect(sondados).toEqual(["http://localhost:4173", "http://localhost:9000"]);
    expect(enderecos(eventos)).toEqual([{ tipo: "endereco_local_detectado", url: "http://localhost:4173" }]);
  });

  it("uma sonda que falha não derruba o turno", async () => {
    const motor = new MotorClaudeCodeCli(new FachadaQueCitaServidor() as unknown as FachadaClaudeCodeCli, () =>
      Promise.reject(new Error("rede")),
    );
    const eventos: unknown[] = [];

    const resultado = await motor.executarTurno(pedido(null), (evento) => eventos.push(evento), new AbortController().signal);

    expect(resultado.sucesso).toBe(true);
    expect(enderecos(eventos)).toEqual([]);
  });
});
