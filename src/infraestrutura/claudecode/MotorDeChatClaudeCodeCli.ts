import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  EventoDoMotorDeChat,
  MotorDeChat,
  PerguntaAoMotorDeChat,
  ResultadoDaResposta,
} from "../../chat/MotorDeChat";
import { AdaptadorDeEventosDoChat } from "./AdaptadorDeEventosDoChat";
import { montarAmbienteDoChat, montarArgumentosDoChat } from "./ArgumentosDoChat";
import { linhaDeEntrada } from "./ArgumentosDoClaudeCode";
import { FachadaClaudeCodeCli, SaidaDoClaudeCode } from "./FachadaClaudeCodeCli";

/** Dono dos processos do chat no registro de processos (não é um Orquestrador). */
export const DONO_DOS_PROCESSOS_DO_CHAT = "chat";

const MOTIVO_DO_CANCELAMENTO = "Cancelada.";

function descreverSaidaSemResultado(saida: SaidaDoClaudeCode): string {
  const detalhe = saida.erroPadrao.slice(0, 600);
  const codigo = saida.codigoDeSaida === null ? "" : ` (código ${saida.codigoDeSaida})`;
  return detalhe === ""
    ? `O Claude Code encerrou sem devolver resposta${codigo}.`
    : `O Claude Code encerrou sem devolver resposta${codigo}: ${detalhe}`;
}

/**
 * `MotorDeChat` sobre o Claude Code em modo headless: um processo `claude -p`
 * por pergunta, com o login da assinatura do usuário.
 *
 * As instruções vão num arquivo temporário próprio da pergunta, apagado ao
 * final. Com o sinal abortado, a fachada encerra a árvore do processo e a
 * resposta resolve como cancelada.
 */
export class MotorDeChatClaudeCodeCli implements MotorDeChat {
  constructor(
    private readonly fachada: FachadaClaudeCodeCli,
    private readonly ambienteBase: NodeJS.ProcessEnv = process.env,
  ) {}

  async responder(
    pergunta: PerguntaAoMotorDeChat,
    aoObservar: (evento: EventoDoMotorDeChat) => void,
    sinal: AbortSignal,
  ): Promise<ResultadoDaResposta> {
    if (sinal.aborted) {
      return { sucesso: false, motivo: MOTIVO_DO_CANCELAMENTO, uso: null };
    }
    const pastaTemporaria = path.join(tmpdir(), "orquestrador-chat", randomUUID());
    const arquivos = { instrucoes: path.join(pastaTemporaria, "instrucoes.txt") };

    try {
      await mkdir(pastaTemporaria, { recursive: true });
      await writeFile(arquivos.instrucoes, pergunta.instrucoes, "utf8");
      await mkdir(pergunta.pastaDaSessao, { recursive: true });

      const imagens = await Promise.all(
        pergunta.imagens.map(async (imagem) => ({
          tipoDeMidia: imagem.tipoDeMidia,
          base64: (await readFile(imagem.caminho)).toString("base64"),
        })),
      );

      const adaptador = new AdaptadorDeEventosDoChat();
      const inicio = Date.now();
      const saida = await this.fachada.executar(
        {
          argumentos: montarArgumentosDoChat(pergunta, arquivos),
          pasta: pergunta.pastaDaSessao,
          ambiente: montarAmbienteDoChat(this.ambienteBase, pergunta.esforco),
          entrada: linhaDeEntrada(pergunta.mensagem, imagens),
          dono: { orquestradorId: DONO_DOS_PROCESSOS_DO_CHAT, sessaoId: pergunta.sessaoId },
        },
        (mensagem) => {
          for (const evento of adaptador.traduzir(mensagem)) {
            aoObservar(evento);
          }
        },
        sinal,
      );

      const resultado = adaptador.resultado;
      if (sinal.aborted) {
        return { sucesso: false, motivo: MOTIVO_DO_CANCELAMENTO, uso: resultado?.uso ?? null };
      }
      if (resultado === null) {
        return { sucesso: false, motivo: descreverSaidaSemResultado(saida), uso: null };
      }
      // O tempo que interessa à tela é o de relógio, do início ao fim do processo.
      return resultado.uso === null
        ? resultado
        : { ...resultado, uso: { ...resultado.uso, duracaoMs: Date.now() - inicio } };
    } catch (erro) {
      if (sinal.aborted) {
        return { sucesso: false, motivo: MOTIVO_DO_CANCELAMENTO, uso: null };
      }
      const detalhe = erro instanceof Error ? erro.message : String(erro);
      return { sucesso: false, motivo: `Não foi possível consultar o Claude Code: ${detalhe}`, uso: null };
    } finally {
      await rm(pastaTemporaria, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
