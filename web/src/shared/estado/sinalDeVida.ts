import type { SinalDeVida } from "../api/tipos";
import type { TurnoNaTela } from "./aplicarEvento";
import { faseDoTurno } from "./faseDoTurno";

/**
 * Quanto silêncio é normal antes de preocupar. Pensando (planejar ou
 * sintetizar), o Claude dá sinal a cada poucos segundos; executando, um
 * Subagente pode passar minutos num comando longo (um build, uma suíte de
 * testes) sem nenhuma notícia.
 */
export const SILENCIO_PREOCUPANTE_MS = { pensando: 90_000, executando: 5 * 60_000 } as const;

export interface EstadoDeVida {
  /** Tempo desde o último sinal — evento do turno ou sinal de vida, o que for mais recente. */
  ultimoSinalHaMs: number;
  /** Tokens de raciocínio, quando o que está acontecendo agora é o Claude pensando. */
  tokensPensando: number | null;
  /** Silêncio além do esperado para a fase: pode ter travado. */
  preocupante: boolean;
  duracaoMs: number;
}

export function estadoDeVida(turno: TurnoNaTela, sinal: SinalDeVida | undefined, agora: Date): EstadoDeVida {
  const ultimaAtividade = Date.parse(turno.ultimaAtividadeEm);
  const sinalDoTurno = sinal?.turnoId === turno.id ? sinal : undefined;
  const ultimoSinal = sinalDoTurno === undefined ? 0 : Date.parse(sinalDoTurno.em);
  const ultimoSinalHaMs = Math.max(0, agora.getTime() - Math.max(ultimaAtividade, ultimoSinal));
  const limite = faseDoTurno(turno).atual === "executar" ? SILENCIO_PREOCUPANTE_MS.executando : SILENCIO_PREOCUPANTE_MS.pensando;

  return {
    ultimoSinalHaMs,
    // Só vale enquanto o raciocínio é a novidade mais recente: depois de um
    // evento (um Subagente lançado, um texto), aquela contagem já passou.
    tokensPensando: sinalDoTurno !== undefined && ultimoSinal >= ultimaAtividade ? sinalDoTurno.tokensPensando : null,
    preocupante: ultimoSinalHaMs > limite,
    duracaoMs: Math.max(0, agora.getTime() - Date.parse(turno.iniciadoEm)),
  };
}
