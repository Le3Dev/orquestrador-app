import { ConsumoDoTurno } from "./ConsumoDoTurno";

/** O que identifica um Turno nas transcrições do Claude Code. */
export interface PeriodoDoTurno {
  sessaoId: string;
  /** Pasta onde o processo do Claude Code rodou (o worktree do turno ou a pasta do projeto). */
  pastaDeTrabalho: string;
  inicio: Date;
  fim: Date;
}

/**
 * Mede quanto um Turno gastou depois que ele termina. Porta: a implementação
 * lê as transcrições que o Claude Code grava em disco.
 */
export interface MedidorDeConsumo {
  /** `null` quando não há transcrição da sessão para medir. */
  medirTurno(periodo: PeriodoDoTurno): Promise<ConsumoDoTurno | null>;
}
