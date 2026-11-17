import { DadosDaExecucao, SituacaoDaExecucao } from "./ExecucaoDaRotina";
import { DadosDaRotina } from "./Rotina";

/**
 * O que acontece com as Rotinas e as execuções, para as telas conectadas. Só
 * ao vivo: não há histórico; a tela recarrega as listas ao (re)conectar.
 */
export type EventoDeRotina =
  | { tipo: "rotina_criada"; rotina: DadosDaRotina }
  /** Também quando a agenda anda: `ultimaExecucaoEm` e `proximaExecucaoEm` mudaram. */
  | { tipo: "rotina_alterada"; rotina: DadosDaRotina }
  | { tipo: "rotina_removida"; id: string }
  | { tipo: "execucao_iniciada"; execucao: DadosDaExecucao }
  | { tipo: "etapa_iniciada"; execucao: DadosDaExecucao; indice: number }
  | { tipo: "etapa_concluida"; execucao: DadosDaExecucao; indice: number }
  | { tipo: "aguardando_aprovacao"; execucao: DadosDaExecucao }
  /** Qualquer fim: concluída, falhou, cancelada, recusada, interrompida ou pulada. */
  | { tipo: "execucao_encerrada"; execucao: DadosDaExecucao; situacao: SituacaoDaExecucao };

export type TipoDeEventoDeRotina = EventoDeRotina["tipo"];

/** Porta: entrega os eventos às telas (na infraestrutura, por SSE). */
export interface PublicadorDeRotinas {
  publicar(evento: EventoDeRotina): void;
}
