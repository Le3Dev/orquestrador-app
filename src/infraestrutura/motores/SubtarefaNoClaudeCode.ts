import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { UsoDoTurno } from "../../orquestracao/EventoDeOrquestracao";
import { Plataforma } from "../../orquestracao/InstrucoesDoOrquestrador";
import { comoModeloClaude } from "../../orquestracao/ModeloDoMotor";
import { ABORTO_POR_SILENCIO, PedidoDeTurno } from "../../orquestracao/MotorDeAgentes";
import { modeloDoSubagentePronto } from "../../orquestracao/SubagentesProntos";
import { AdaptadorDeEventosDoClaudeCode, falhaComCausa } from "../claudecode/AdaptadorDeEventosDoClaudeCode";
import {
  comandosProibidosDoTurno,
  comFerramentasDeArtefato,
  configuracoesDaSessao,
  ferramentasDeSkill,
  ferramentasDoTurno,
  liberadasComArtefatos,
  linhaDeEntrada,
  montarAmbiente,
  nivelDeEsforcoDosSubagentes,
} from "../claudecode/ArgumentosDoClaudeCode";
import { FachadaClaudeCodeCli } from "../claudecode/FachadaClaudeCodeCli";
import { MOTIVO_DO_SILENCIO, prepararPastaDeArtefatos } from "../claudecode/MotorClaudeCodeCli";
import { mensagemDoErro } from "./ApoioDosMotores";
import { regrasDoSubagente, textoDaSubtarefa } from "./PromptDoTurno";
import { ConversorParaSubagente, ExecucaoDeSubtarefa, ExecutorDeSubtarefa, ResultadoDaSubtarefa } from "./SubtarefaDoApp";

/**
 * Roda uma subtarefa no Claude Code como agente único: um `claude -p` com as
 * regras do executor (ou do subagente pronto) como prompt de sistema, as
 * ferramentas e as permissões do pedido e a subtarefa como mensagem. É o
 * caminho do Orquestrador no Codex ou no Copilot com os subagentes no Claude
 * Code: só o Claude Code lança subagentes sozinho, e aqui não há quem os lance.
 *
 * As ferramentas vêm das mesmas funções do turno do Orquestrador
 * (`ferramentasDoTurno`, `liberadasComArtefatos`, `comandosProibidosDoTurno`):
 * mesmas permissões, e sem a ferramenta `Agent` (o subagente não lança outros).
 * Sessão nova a cada subtarefa.
 */
export class SubtarefaNoClaudeCode implements ExecutorDeSubtarefa {
  constructor(
    private readonly fachada: FachadaClaudeCodeCli,
    private readonly plataforma: Plataforma = "unix",
  ) {}

  async executarSubtarefa(execucao: ExecucaoDeSubtarefa): Promise<ResultadoDaSubtarefa> {
    const inicio = Date.now();
    const falhou = (relatorio: string): ResultadoDaSubtarefa => ({
      situacao: execucao.sinal.aborted ? "cancelado" : "falhou",
      relatorio,
      tokensDeEntrada: 0,
      tokensDeSaida: 0,
      duracaoMs: Date.now() - inicio,
    });
    if (execucao.sinal.aborted) {
      return falhou("Subtarefa cancelada.");
    }

    const pastaTemporaria = path.join(tmpdir(), "orquestrador-agentes", randomUUID());
    try {
      await mkdir(pastaTemporaria, { recursive: true });
      const pedido: PedidoDeTurno = {
        ...execucao.pedido,
        pastaDeArtefatos: await prepararPastaDeArtefatos(execucao.pedido.pastaDeArtefatos),
      };
      const arquivos = {
        instrucoes: path.join(pastaTemporaria, "instrucoes.txt"),
        configuracoes: path.join(pastaTemporaria, "configuracoes.json"),
      };
      await writeFile(arquivos.instrucoes, regrasDoSubagente(pedido, execucao.especialidade, this.plataforma), "utf8");
      const configuracoes = configuracoesDaSessao(pedido);
      if (configuracoes !== null) {
        await writeFile(arquivos.configuracoes, JSON.stringify(configuracoes), "utf8");
      }

      const adaptador = new AdaptadorDeEventosDoClaudeCode();
      const conversor = new ConversorParaSubagente(execucao.subagenteId, inicio);
      const saida = await this.fachada.executar(
        {
          argumentos: argumentosDaSubtarefa(pedido, execucao, arquivos, randomUUID()),
          pasta: pedido.pastaDeTrabalho.caminho,
          ambiente: montarAmbiente(process.env, pedido),
          entrada: linhaDeEntrada(textoDaSubtarefa(execucao.subtarefa), []),
          dono: { orquestradorId: pedido.orquestradorId, sessaoId: execucao.subagenteId },
        },
        (mensagem) => {
          for (const evento of adaptador.traduzir(mensagem)) {
            for (const convertido of conversor.converter(evento)) {
              execucao.aoProgredir(convertido);
            }
          }
        },
        execucao.sinal,
      );

      if (execucao.sinal.aborted) {
        return falhou(execucao.sinal.reason === ABORTO_POR_SILENCIO ? MOTIVO_DO_SILENCIO : "Subtarefa cancelada.");
      }
      const resultado =
        adaptador.resultado ??
        falhaComCausa(
          `O Claude Code encerrou sem devolver resposta${saida.codigoDeSaida === null ? "" : ` (código ${saida.codigoDeSaida})`}.${saida.erroPadrao === "" ? "" : ` ${saida.erroPadrao.slice(0, 600)}`}`,
          [saida.erroPadrao],
          adaptador.pistasDaFalha,
          null,
        );
      const uso: UsoDoTurno | null = resultado.uso;
      const tokens = { tokensDeEntrada: uso?.tokensDeEntrada ?? 0, tokensDeSaida: uso?.tokensDeSaida ?? 0 };
      const duracaoMs = Date.now() - inicio;
      return resultado.sucesso
        ? { situacao: "concluido", relatorio: resultado.resposta, duracaoMs, ...tokens }
        : { situacao: "falhou", relatorio: resultado.motivo, duracaoMs, ...tokens };
    } catch (erro) {
      return falhou(`Falha ao executar a subtarefa no Claude Code: ${mensagemDoErro(erro)}`);
    } finally {
      await rm(pastaTemporaria, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

/**
 * Linha de comando do `claude -p` de uma subtarefa. Igual à do Orquestrador
 * (`montarArgumentos`), menos o que é só dele: sem `--agents` nem a ferramenta
 * `Agent`, sem o esforço do Orquestrador (vale o dos subagentes) e com
 * `--session-id` novo (nunca retoma).
 */
export function argumentosDaSubtarefa(
  pedido: PedidoDeTurno,
  execucao: Pick<ExecucaoDeSubtarefa, "especialidade">,
  arquivos: { instrucoes: string; configuracoes: string },
  sessaoId: string,
): string[] {
  const doNivel = [...ferramentasDoTurno(pedido), ...ferramentasDeSkill(pedido)];
  const ferramentas = comFerramentasDeArtefato(doNivel);
  const liberadas = liberadasComArtefatos(doNivel, pedido.pastaDeArtefatos);
  const modeloBase = comoModeloClaude(pedido.configuracao.modeloDosSubagentes);
  const modelo = execucao.especialidade === null ? modeloBase : modeloDoSubagentePronto(execucao.especialidade, modeloBase);
  const esforco = nivelDeEsforcoDosSubagentes(pedido.configuracao.esforcoDosSubagentes, pedido.configuracao.esforcoDoOrquestrador);
  return [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--add-dir",
    pedido.pastaDeArtefatos,
    ...(pedido.pastaDosAnexos === null ? [] : ["--add-dir", pedido.pastaDosAnexos]),
    "--session-id",
    sessaoId,
    "--model",
    modelo,
    ...(esforco === null ? [] : ["--effort", esforco]),
    "--append-system-prompt-file",
    arquivos.instrucoes,
    "--strict-mcp-config",
    ...(configuracoesDaSessao(pedido) === null ? [] : ["--settings", arquivos.configuracoes]),
    "--permission-mode",
    "dontAsk",
    "--tools",
    ...ferramentas,
    "--allowedTools",
    ...liberadas,
    "--disallowedTools",
    ...comandosProibidosDoTurno(pedido),
  ];
}
