import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { ConfiguracaoDoOrquestrador } from "../../orquestracao/ConfiguracaoDoOrquestrador";
import { InstrucoesAplicadas } from "../../orquestracao/InstrucoesPersonalizadas";
import { ModoDoTurno } from "../../orquestracao/ModoDoTurno";
import { PedidoDeTurno } from "../../orquestracao/MotorDeAgentes";
import { NivelDePermissao } from "../../orquestracao/NivelDePermissao";
import { PastaDeTrabalho } from "../../orquestracao/PastaDeTrabalho";
import { caminhoParaRegraDePermissao } from "./ArgumentosDoClaudeCode";
import { ExecucaoDoClaudeCode, FachadaClaudeCodeCli, SaidaDoClaudeCode } from "./FachadaClaudeCodeCli";
import { MotorClaudeCodeCli } from "./MotorClaudeCodeCli";

const pastaDoTeste = mkdtempSync(path.join(tmpdir(), "motor-do-orquestrador-"));
afterAll(() => rmSync(pastaDoTeste, { recursive: true, force: true }));

interface Gravado {
  execucao: ExecucaoDoClaudeCode;
  pastaDeArtefatosExistia: boolean;
  agentes: { executor: { tools: string[]; prompt: string } };
}

/** Fachada sem processo: guarda o que recebeu enquanto os arquivos temporários ainda existem. */
class FachadaFalsa extends FachadaClaudeCodeCli {
  gravado: Gravado | null = null;

  constructor() {
    super("claude-falso");
  }

  override async executar(execucao: ExecucaoDoClaudeCode): Promise<SaidaDoClaudeCode> {
    const argumentos = execucao.argumentos;
    const pastaDeArtefatos = argumentos[argumentos.indexOf("--add-dir") + 1] ?? "";
    this.gravado = {
      execucao,
      pastaDeArtefatosExistia: existsSync(pastaDeArtefatos),
      agentes: JSON.parse(readFileSync(argumentos[argumentos.indexOf("--agents") + 1] ?? "", "utf8")) as Gravado["agentes"],
    };
    return { codigoDeSaida: 0, erroPadrao: "" };
  }
}

function pedido(pastaDeArtefatos: string, nivelDePermissao: NivelDePermissao = "leitura", modo: ModoDoTurno = "execucao"): PedidoDeTurno {
  return {
    orquestradorId: "o1",
    sessaoId: "sessao-1",
    sessaoIniciada: false,
    texto: "monte um relatório",
    modo,
    pastaDeTrabalho: PastaDeTrabalho.dentroDe(path.resolve("/projetos"), "painel"),
    configuracao: ConfiguracaoDoOrquestrador.de({
      modeloDoOrquestrador: "haiku",
      modeloDosSubagentes: "haiku",
      quantidadeDeSubagentes: { modo: "automatica", limite: 2 },
      nivelDePermissao,
    }),
    imagens: [],
    pastaDasImagens: null,
    pastaDeArtefatos,
    instrucoes: null,
    revogarInstrucoesAnteriores: false,
    subagentesProntos: [],
  };
}

describe("MotorClaudeCodeCli — artefatos", () => {
  it("cria a pasta de artefatos antes de iniciar o processo e a libera em --add-dir", async () => {
    const pastaDeArtefatos = path.join(pastaDoTeste, "artefatos", "entrada", "orquestradores", "o1");
    const fachada = new FachadaFalsa();

    await new MotorClaudeCodeCli(fachada).executarTurno(pedido(pastaDeArtefatos), () => undefined, new AbortController().signal);

    expect(fachada.gravado?.pastaDeArtefatosExistia).toBe(true);
    expect(fachada.gravado?.execucao.argumentos).toContain(realpathSync.native(pastaDeArtefatos));
    // A pasta é permanente: continua lá depois do turno.
    expect(existsSync(pastaDeArtefatos)).toBe(true);
  });

  it("usa o caminho real da pasta, para a regra de gravação casar com o que o Claude Code compara", async () => {
    const pastaDeArtefatos = path.join(pastaDoTeste, "artefatos-real", "o1");
    const fachada = new FachadaFalsa();

    await new MotorClaudeCodeCli(fachada).executarTurno(pedido(pastaDeArtefatos), () => undefined, new AbortController().signal);

    const real = realpathSync.native(pastaDeArtefatos);
    const argumentos = fachada.gravado?.execucao.argumentos ?? [];
    const regra = argumentos.find((argumento) => argumento.startsWith("Write("));
    expect(argumentos[argumentos.indexOf("--add-dir") + 1]).toBe(real);
    expect(regra).toBe(`Write(${caminhoParaRegraDePermissao(real)}/**)`);
    // O tmpdir do Windows pode vir com nome curto (LEANDR~1.CAN): a regra nunca leva o "~".
    expect(regra).not.toContain("~");
  });

  it.each<[NivelDePermissao, ModoDoTurno]>([
    ["leitura", "execucao"],
    ["edicao_e_comandos", "planejamento"],
  ])("no nível %s, em %s, o executor gravado em agentes.json tem Write e Edit e a pasta nas instruções", async (nivel, modo) => {
    const pastaDeArtefatos = path.join(pastaDoTeste, `artefatos-${nivel}-${modo}`);
    const fachada = new FachadaFalsa();

    await new MotorClaudeCodeCli(fachada).executarTurno(pedido(pastaDeArtefatos, nivel, modo), () => undefined, new AbortController().signal);

    const executor = fachada.gravado?.agentes.executor;
    expect(executor?.tools).toEqual(expect.arrayContaining(["Write", "Edit"]));
    expect(executor?.prompt).toContain(realpathSync.native(pastaDeArtefatos));
  });

  it("a mensagem do turno traz as regras de artefato com a pasta exata", async () => {
    const pastaDeArtefatos = path.join(pastaDoTeste, "artefatos-mensagem");
    const fachada = new FachadaFalsa();

    await new MotorClaudeCodeCli(fachada).executarTurno(pedido(pastaDeArtefatos), () => undefined, new AbortController().signal);

    const entrada = JSON.parse(fachada.gravado?.execucao.entrada ?? "{}") as { message: { content: { text: string }[] } };
    const texto = entrada.message.content[0]?.text ?? "";
    expect(texto).toContain(`UM arquivo autocontido gravado na pasta ${realpathSync.native(pastaDeArtefatos)}`);
    expect(texto.endsWith("monte um relatório")).toBe(true);
  });
});

/** No lugar do processo `claude -p`: guarda o que receberia e responde com um resultado. */
class FachadaQueGuardaAEntrada {
  execucao: ExecucaoDoClaudeCode | null = null;
  instrucoesIniciais: string | null = null;

  async executar(
    execucao: ExecucaoDoClaudeCode,
    aoReceberMensagem: (mensagem: unknown) => void,
  ): Promise<SaidaDoClaudeCode> {
    this.execucao = execucao;
    // O arquivo é apagado ao fim do turno: lido aqui, enquanto existe.
    const indice = execucao.argumentos.indexOf("--append-system-prompt-file");
    this.instrucoesIniciais = readFileSync(execucao.argumentos[indice + 1] ?? "", "utf8");
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

function pedidoComInstrucoes(instrucoes: InstrucoesAplicadas | null, revogarInstrucoesAnteriores = false): PedidoDeTurno {
  return {
    orquestradorId: "o1",
    sessaoId: "sessao-1",
    sessaoIniciada: true,
    texto: "analise o projeto",
    modo: "execucao",
    pastaDeTrabalho: PastaDeTrabalho.dentroDe(path.resolve("/projetos"), "painel"),
    configuracao: ConfiguracaoDoOrquestrador.de({
      modeloDoOrquestrador: "haiku",
      modeloDosSubagentes: "haiku",
      quantidadeDeSubagentes: { modo: "automatica", limite: 2 },
      nivelDePermissao: "leitura",
    }),
    imagens: [],
    pastaDasImagens: null,
    pastaDeArtefatos: path.join(pastaDoTeste, "artefatos-instrucoes"),
    instrucoes,
    revogarInstrucoesAnteriores,
    subagentesProntos: [],
  };
}

/** O texto da mensagem como vai no stdin (`stream-json`). */
function textoDaEntrada(fachada: FachadaQueGuardaAEntrada): string {
  const linha = JSON.parse(fachada.execucao?.entrada ?? "{}") as {
    message: { content: Array<{ type: string; text?: string }> };
  };
  return linha.message.content.find((parte) => parte.type === "text")?.text ?? "";
}

describe("MotorClaudeCodeCli e as instruções personalizadas", () => {
  it("manda as instruções no bloco da mensagem (stdin) e deixa o system prompt como está", async () => {
    const fachada = new FachadaQueGuardaAEntrada();
    const motor = new MotorClaudeCodeCli(fachada as unknown as FachadaClaudeCodeCli);

    const resultado = await motor.executarTurno(
      pedidoComInstrucoes({ texto: "Sempre comece a resposta com a palavra PIRULITO.", origem: "orquestrador" }),
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
    const fachada = new FachadaQueGuardaAEntrada();
    const motor = new MotorClaudeCodeCli(fachada as unknown as FachadaClaudeCodeCli);

    await motor.executarTurno(pedidoComInstrucoes(null), () => undefined, new AbortController().signal);

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

    const resultado = await motor.executarTurno(pedidoComInstrucoes(null), (evento) => eventos.push(evento), new AbortController().signal);

    expect(resultado.sucesso).toBe(true);
    expect(sondados).toEqual(["http://localhost:4173", "http://localhost:9000"]);
    expect(enderecos(eventos)).toEqual([{ tipo: "endereco_local_detectado", url: "http://localhost:4173" }]);
  });

  it("uma sonda que falha não derruba o turno", async () => {
    const motor = new MotorClaudeCodeCli(new FachadaQueCitaServidor() as unknown as FachadaClaudeCodeCli, () =>
      Promise.reject(new Error("rede")),
    );
    const eventos: unknown[] = [];

    const resultado = await motor.executarTurno(pedidoComInstrucoes(null), (evento) => eventos.push(evento), new AbortController().signal);

    expect(resultado.sucesso).toBe(true);
    expect(enderecos(eventos)).toEqual([]);
  });
});
