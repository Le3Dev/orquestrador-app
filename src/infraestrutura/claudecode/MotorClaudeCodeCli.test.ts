import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { ConfiguracaoDoOrquestrador } from "../../orquestracao/ConfiguracaoDoOrquestrador";
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
