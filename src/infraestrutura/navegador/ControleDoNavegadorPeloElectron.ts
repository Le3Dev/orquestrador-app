import { randomUUID } from "node:crypto";

import { ComandoDoNavegador } from "../../navegador/ComandoDoNavegador";
import { ControleDoNavegador } from "../../navegador/ControleDoNavegador";
import {
  ErroDoNavegador,
  MENSAGEM_DE_COMANDO_CANCELADO,
  MENSAGEM_DO_NAVEGADOR_SO_NO_DESKTOP,
  ehMotivoDoErroDoNavegador,
} from "../../navegador/ErroDoNavegador";
import { ResultadoDoComando, criarResultadoDoComando } from "../../navegador/ResultadoDoComando";

/**
 * A porta de mensagens do Electron no servidor (`process.parentPort` do
 * `utilityProcess`). Fora do aplicativo ela não existe.
 */
export interface PortaParaOProcessoPai {
  on(evento: "message", ouvinte: (mensagem: { data: unknown }) => void): void;
  postMessage(mensagem: unknown): void;
}

export const TEMPO_LIMITE_DO_COMANDO_EM_MS = 60_000;

export interface OpcoesDoControleDoNavegadorPeloElectron {
  /** Nula fora do aplicativo desktop (`npm run dev` no terminal). */
  porta: PortaParaOProcessoPai | null;
  tempoLimiteEmMs?: number;
  gerarId?: () => string;
}

interface ComandoEmEspera {
  resolver: (resultado: ResultadoDoComando) => void;
  rejeitar: (erro: ErroDoNavegador) => void;
  encerrar: () => void;
}

/**
 * Executa os comandos do navegador do agente no processo principal do
 * Electron, que é quem tem a janela e o Chromium.
 *
 * Protocolo pela `parentPort`:
 * - servidor -> app: `{ tipo: "navegador:comando", id, orquestradorId, comando }`
 *   e, se o comando for abandonado, `{ tipo: "navegador:cancelar", id }`;
 * - app -> servidor: `{ tipo: "navegador:resposta", id, ok: true, resultado }`
 *   ou `{ tipo: "navegador:resposta", id, ok: false, erro: { motivo, mensagem } }`.
 *
 * Cada comando espera pela resposta de mesmo `id`, até o tempo limite, e pode
 * ser cancelado pelo `AbortSignal`.
 */
export class ControleDoNavegadorPeloElectron implements ControleDoNavegador {
  private readonly emEspera = new Map<string, ComandoEmEspera>();
  private readonly porta: PortaParaOProcessoPai | null;
  private readonly tempoLimiteEmMs: number;
  private readonly gerarId: () => string;
  private encerrado = false;

  constructor(opcoes: OpcoesDoControleDoNavegadorPeloElectron) {
    this.porta = opcoes.porta;
    this.tempoLimiteEmMs = opcoes.tempoLimiteEmMs ?? TEMPO_LIMITE_DO_COMANDO_EM_MS;
    this.gerarId = opcoes.gerarId ?? randomUUID;
    this.porta?.on("message", (mensagem) => this.aoReceber(mensagem.data));
  }

  executar(orquestradorId: string, comando: ComandoDoNavegador, sinal: AbortSignal): Promise<ResultadoDoComando> {
    const { porta } = this;
    if (porta === null) {
      return Promise.reject(new ErroDoNavegador("indisponivel", MENSAGEM_DO_NAVEGADOR_SO_NO_DESKTOP));
    }
    if (this.encerrado || sinal.aborted) {
      return Promise.reject(new ErroDoNavegador("cancelado", MENSAGEM_DE_COMANDO_CANCELADO));
    }

    const id = this.gerarId();
    return new Promise<ResultadoDoComando>((resolver, rejeitar) => {
      const finalizar = (): void => {
        clearTimeout(temporizador);
        sinal.removeEventListener("abort", aoAbortar);
        this.emEspera.delete(id);
      };
      const avisarCancelamento = (): void => {
        try {
          porta.postMessage({ tipo: "navegador:cancelar", id });
        } catch {
          // O app já não ouve: nada a cancelar.
        }
      };
      const aoAbortar = (): void => {
        finalizar();
        avisarCancelamento();
        rejeitar(new ErroDoNavegador("cancelado", MENSAGEM_DE_COMANDO_CANCELADO));
      };
      const temporizador = setTimeout(() => {
        finalizar();
        avisarCancelamento();
        rejeitar(
          new ErroDoNavegador(
            "tempo_esgotado",
            `O navegador não respondeu em ${Math.round(this.tempoLimiteEmMs / 1000)} segundos.`,
          ),
        );
      }, this.tempoLimiteEmMs);
      sinal.addEventListener("abort", aoAbortar, { once: true });

      this.emEspera.set(id, {
        resolver: (resultado) => {
          finalizar();
          resolver(resultado);
        },
        rejeitar: (erro) => {
          finalizar();
          rejeitar(erro);
        },
        encerrar: () => {
          finalizar();
          rejeitar(new ErroDoNavegador("cancelado", MENSAGEM_DE_COMANDO_CANCELADO));
        },
      });

      try {
        porta.postMessage({ tipo: "navegador:comando", id, orquestradorId, comando });
      } catch (erro) {
        finalizar();
        rejeitar(
          new ErroDoNavegador(
            "indisponivel",
            `Não consegui falar com o aplicativo: ${erro instanceof Error ? erro.message : String(erro)}`,
          ),
        );
      }
    });
  }

  /** Cancela os comandos em espera (o servidor está parando). Respostas que chegarem depois são ignoradas. */
  encerrar(): void {
    this.encerrado = true;
    for (const comando of [...this.emEspera.values()]) comando.encerrar();
  }

  private aoReceber(dados: unknown): void {
    if (typeof dados !== "object" || dados === null) return;
    const mensagem = dados as Record<string, unknown>;
    if (mensagem["tipo"] !== "navegador:resposta" || typeof mensagem["id"] !== "string") return;
    const espera = this.emEspera.get(mensagem["id"]);
    // Resposta de um comando que já acabou (tempo limite ou cancelamento): ignora.
    if (espera === undefined) return;

    if (mensagem["ok"] === true) {
      try {
        espera.resolver(criarResultadoDoComando(mensagem["resultado"]));
      } catch (erro) {
        espera.rejeitar(
          erro instanceof ErroDoNavegador ? erro : new ErroDoNavegador("falhou", "Resposta inválida do navegador."),
        );
      }
      return;
    }
    const erro = mensagem["erro"];
    const dadosDoErro = typeof erro === "object" && erro !== null ? (erro as Record<string, unknown>) : {};
    const motivo = ehMotivoDoErroDoNavegador(dadosDoErro["motivo"]) ? dadosDoErro["motivo"] : "falhou";
    const texto = dadosDoErro["mensagem"];
    espera.rejeitar(new ErroDoNavegador(motivo, typeof texto === "string" && texto !== "" ? texto : "O navegador falhou."));
  }
}
