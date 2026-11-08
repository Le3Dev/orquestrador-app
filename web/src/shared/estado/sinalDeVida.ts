import type { DiagnosticoDoSilencio, SinalDeVida } from "../api/tipos";
import type { TurnoNaTela } from "./aplicarEvento";
import { faseDoTurno } from "./faseDoTurno";

/**
 * Quanto silêncio é normal antes de preocupar. Pensando (planejar ou
 * sintetizar), o Claude dá sinal a cada poucos segundos; executando, um
 * Subagente pode passar minutos num comando longo (um build, uma suíte de
 * testes) sem nenhuma notícia.
 */
export const SILENCIO_PREOCUPANTE_MS = { pensando: 90_000, executando: 5 * 60_000 } as const;

/**
 * Por quanto tempo vale o último diagnóstico do servidor. Ele chega a cada
 * ~30 s enquanto o silêncio dura; passado isto sem outro (servidor parou de
 * mandar), a tela volta a decidir sozinha pelo tempo de silêncio.
 */
export const VALIDADE_DO_DIAGNOSTICO_MS = 90_000;

export interface EstadoDeVida {
  /** Tempo desde o último sinal: evento do turno ou sinal de vida comum, o que for mais recente. */
  ultimoSinalHaMs: number;
  /** Tokens de raciocínio, quando o que está acontecendo agora é o Claude pensando. */
  tokensPensando: number | null;
  /** Silêncio além do esperado para a fase (ou o servidor desconfia): pode ter travado. */
  preocupante: boolean;
  duracaoMs: number;
  /** O que o servidor apurou do silêncio, quando o diagnóstico é atual; nulo sem ele. */
  diagnostico: DiagnosticoDoSilencio | null;
}

export function estadoDeVida(turno: TurnoNaTela, sinal: SinalDeVida | undefined, agora: Date): EstadoDeVida {
  const ultimaAtividade = Date.parse(turno.ultimaAtividadeEm);
  const sinalDoTurno = sinal?.turnoId === turno.id ? sinal : undefined;
  const emDoSinal = sinalDoTurno === undefined ? 0 : Date.parse(sinalDoTurno.em);
  // O sinal com diagnóstico só explica o silêncio: não é notícia nova do Claude
  // e não zera a contagem. Ele substitui o sinal comum anterior, então o
  // silêncio passa a contar do último evento do turno.
  const diagnosticoDoSinal = sinalDoTurno?.diagnostico;
  const comDiagnostico = diagnosticoDoSinal !== undefined;
  const ultimoSinal = comDiagnostico ? 0 : emDoSinal;
  const ultimoSinalHaMs = Math.max(0, agora.getTime() - Math.max(ultimaAtividade, ultimoSinal));
  const limite = faseDoTurno(turno).atual === "executar" ? SILENCIO_PREOCUPANTE_MS.executando : SILENCIO_PREOCUPANTE_MS.pensando;
  // Vale enquanto nenhum evento do turno chegou depois dele e ele não envelheceu.
  const diagnostico =
    diagnosticoDoSinal !== undefined &&
    emDoSinal >= ultimaAtividade &&
    agora.getTime() - emDoSinal <= VALIDADE_DO_DIAGNOSTICO_MS
      ? diagnosticoDoSinal
      : null;

  return {
    ultimoSinalHaMs,
    // Só vale enquanto o raciocínio é a novidade mais recente: depois de um
    // evento (um Subagente lançado, um texto), aquela contagem já passou.
    tokensPensando:
      sinalDoTurno !== undefined && !comDiagnostico && ultimoSinal >= ultimaAtividade ? sinalDoTurno.tokensPensando : null,
    // O servidor sabe mais que o relógio da tela: "trabalhando" (um comando
    // longo) não preocupa; "suspeito" preocupa mesmo antes do limite da fase.
    preocupante: diagnostico === null ? ultimoSinalHaMs > limite : diagnostico.situacao === "suspeito",
    duracaoMs: Math.max(0, agora.getTime() - Date.parse(turno.iniciadoEm)),
    diagnostico,
  };
}
