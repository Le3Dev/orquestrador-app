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
import { limitarAvisos, MOTIVO_DO_SILENCIO, MotorClaudeCodeCli } from "./MotorClaudeCodeCli";

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

  it.each<[boolean, unknown[]]>([
    [false, []],
    [true, [{ tipo: "endereco_local_detectado", url: "http://localhost:8530/health" }]],
  ])("o endereço na saída de um comando só é anunciado se responde (responde: %s)", async (responde, esperado) => {
    const sondados: string[] = [];
    const fachada = new FachadaQueImprimeEndereco();
    const motor = new MotorClaudeCodeCli(fachada as unknown as FachadaClaudeCodeCli, async (url) => {
      sondados.push(url);
      return responde;
    });
    const eventos: unknown[] = [];

    const resultado = await motor.executarTurno(pedidoComInstrucoes(null), (evento) => eventos.push(evento), new AbortController().signal);

    expect(resultado.sucesso).toBe(true);
    expect(sondados).toEqual(["http://localhost:8530/health"]);
    expect(enderecos(eventos)).toEqual(esperado);
  });
});

/** Um turno em que a saída de um comando (um `cat` de docker-compose) cita um endereço. */
class FachadaQueImprimeEndereco {
  async executar(
    _execucao: ExecucaoDoClaudeCode,
    aoReceberMensagem: (mensagem: unknown) => void,
  ): Promise<SaidaDoClaudeCode> {
    aoReceberMensagem({
      type: "assistant",
      parent_tool_use_id: null,
      message: { content: [{ type: "tool_use", id: "c1", name: "Bash", input: { command: "cat docker-compose.yml" } }] },
    });
    aoReceberMensagem({
      type: "user",
      parent_tool_use_id: null,
      message: { content: [{ type: "tool_result", tool_use_id: "c1", content: "" }] },
      tool_use_result: { stdout: "test: curl -f http://localhost:8530/health", stderr: "" },
    });
    aoReceberMensagem({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "feito",
      duration_ms: 1,
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    return { codigoDeSaida: 0, erroPadrao: "" };
  }
}

/** Fachada que roda um roteiro: recebe o que a fachada real receberia e devolve a saída dada. */
function fachadaComRoteiro(
  roteiro: (
    aoReceberMensagem: (mensagem: unknown) => void,
    aoReceberLinha: ((linha: string, origem: "stdout" | "stderr") => void) | undefined,
  ) => SaidaDoClaudeCode,
): FachadaClaudeCodeCli {
  return {
    async executar(
      _execucao: ExecucaoDoClaudeCode,
      aoReceberMensagem: (mensagem: unknown) => void,
      _sinal: AbortSignal,
      aoReceberLinha?: (linha: string, origem: "stdout" | "stderr") => void,
    ): Promise<SaidaDoClaudeCode> {
      return roteiro(aoReceberMensagem, aoReceberLinha);
    },
  } as unknown as FachadaClaudeCodeCli;
}

const RESULTADO_OK = {
  type: "result",
  subtype: "success",
  is_error: false,
  result: "feito",
  duration_ms: 1,
  modelUsage: { m: { inputTokens: 5, outputTokens: 7 } },
};

describe("limitarAvisos", () => {
  it("avisa na primeira vez e depois no máximo uma vez por intervalo", () => {
    let agora = 0;
    let avisos = 0;
    const avisar = limitarAvisos(() => (avisos += 1), 1_000, () => agora);

    avisar();
    agora = 999;
    avisar();
    expect(avisos).toBe(1);
    agora = 1_000;
    avisar();
    avisar();
    expect(avisos).toBe(2);
    agora = 5_000;
    avisar();
    expect(avisos).toBe(3);
  });
});

describe("MotorClaudeCodeCli — sinais de vida e autorrecuperação", () => {
  it("avisa as linhas do processo (inclusive as que não viram evento) no máximo uma vez por segundo", async () => {
    const motor = new MotorClaudeCodeCli(
      fachadaComRoteiro((aoReceberMensagem, aoReceberLinha) => {
        for (let linha = 0; linha < 10; linha++) {
          aoReceberLinha?.(`linha ${linha}`, linha % 2 === 0 ? "stdout" : "stderr");
        }
        aoReceberMensagem(RESULTADO_OK);
        return { codigoDeSaida: 0, erroPadrao: "" };
      }),
    );
    let avisos = 0;

    const resultado = await motor.executarTurno(
      pedidoComInstrucoes(null),
      () => undefined,
      new AbortController().signal,
      () => (avisos += 1),
    );

    expect(resultado.sucesso).toBe(true);
    expect(avisos).toBe(1);
  });

  it("abortado com reason \"silencio\": falha por silêncio, com o consumo que já houve", async () => {
    const controle = new AbortController();
    const motor = new MotorClaudeCodeCli(
      fachadaComRoteiro((aoReceberMensagem) => {
        aoReceberMensagem({ ...RESULTADO_OK, subtype: "error_during_execution", is_error: true, result: "" });
        controle.abort("silencio");
        return { codigoDeSaida: null, erroPadrao: "" };
      }),
    );

    const resultado = await motor.executarTurno(pedidoComInstrucoes(null), () => undefined, controle.signal);

    expect(resultado).toEqual({
      sucesso: false,
      causa: "silencio",
      motivo: MOTIVO_DO_SILENCIO,
      uso: { duracaoMs: 1, tokensDeEntrada: 5, tokensDeSaida: 7, subagentesLancados: 0 },
    });
  });

  it("um cancelamento comum não vira silêncio", async () => {
    const controle = new AbortController();
    const motor = new MotorClaudeCodeCli(
      fachadaComRoteiro(() => {
        controle.abort();
        return { codigoDeSaida: null, erroPadrao: "" };
      }),
    );

    const resultado = await motor.executarTurno(pedidoComInstrucoes(null), () => undefined, controle.signal);

    expect(resultado).toMatchObject({ sucesso: false, causa: "outro", uso: null });
  });
});

describe("MotorClaudeCodeCli — causa da falha pelo stderr", () => {
  it("sem result, o stderr decide: rede", async () => {
    const motor = new MotorClaudeCodeCli(
      fachadaComRoteiro(() => ({ codigoDeSaida: 1, erroPadrao: "Error: read ECONNRESET\n    at TLSWrap.onStreamRead" })),
    );

    const resultado = await motor.executarTurno(pedidoComInstrucoes(null), () => undefined, new AbortController().signal);

    expect(resultado).toMatchObject({
      sucesso: false,
      causa: "rede",
      uso: null,
      motivo: "Falha de conexão com os servidores do Claude (Error: read ECONNRESET at TLSWrap.onStreamRead).",
    });
  });

  it("sem result, um limite com epoch no stderr dá a hora em que libera", async () => {
    const motor = new MotorClaudeCodeCli(
      fachadaComRoteiro(() => ({ codigoDeSaida: 1, erroPadrao: "Claude AI usage limit reached|1793221200" })),
    );

    const resultado = await motor.executarTurno(pedidoComInstrucoes(null), () => undefined, new AbortController().signal);

    expect(resultado).toMatchObject({ causa: "limite_de_uso", liberaEm: new Date(1793221200 * 1000).toISOString() });
  });

  it("um result sem causa conhecida ganha a causa do stderr e mantém o texto do result no motivo", async () => {
    const motor = new MotorClaudeCodeCli(
      fachadaComRoteiro((aoReceberMensagem) => {
        aoReceberMensagem({ ...RESULTADO_OK, is_error: true, result: "Execution error" });
        return { codigoDeSaida: 1, erroPadrao: 'API Error: 529 {"type":"error","error":{"type":"overloaded_error"}}' };
      }),
    );

    const resultado = await motor.executarTurno(pedidoComInstrucoes(null), () => undefined, new AbortController().signal);

    expect(resultado).toMatchObject({
      sucesso: false,
      causa: "sobrecarga",
      motivo: "Os servidores do Claude estão sobrecarregados ou com erro (Execution error).",
    });
  });

  it("sem result e sem pista nenhuma, fica \"outro\" com o motivo de sempre", async () => {
    const motor = new MotorClaudeCodeCli(fachadaComRoteiro(() => ({ codigoDeSaida: 2, erroPadrao: "" })));

    const resultado = await motor.executarTurno(pedidoComInstrucoes(null), () => undefined, new AbortController().signal);

    expect(resultado).toEqual({
      sucesso: false,
      causa: "outro",
      uso: null,
      motivo: "O Claude Code encerrou sem devolver resposta (código 2).",
    });
  });
});
