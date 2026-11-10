/** Mensagens trocadas entre a tela e o worker que roda o Whisper (a reserva no navegador). */
import type { SegmentoTranscrito } from "./motor";

/** Os modelos do Whisper que o worker sabe carregar (um pipeline por modelo, no primeiro uso). */
export const MODELO_DO_DITADO = "onnx-community/whisper-small";
/** Menor e mais rápido: serve à escuta, que transcreve quase ao vivo. */
export const MODELO_DA_ESCUTA = "onnx-community/whisper-base";
/** A precisão dos pesos que o worker carrega, nos dois modelos. */
export const PRECISAO_NO_NAVEGADOR = "q8";

/** Amostras por segundo do áudio que o Whisper espera. */
export const AMOSTRAS_POR_SEGUNDO = 16_000;

export interface PedidoDeTranscricao {
  tipo: "transcrever";
  id: number;
  /** Qual modelo do Whisper usa: o ditado, o `whisper-small`; a escuta, o `whisper-base`. */
  modelo: string;
  /** Áudio mono a 16 kHz, como o Whisper espera. */
  audio: Float32Array;
  /**
   * Idioma da fala: `"portuguese"` (o padrão) ou um código já detectado
   * (`"pt"`, `"en"`...) fixam o idioma; `null` pede ao worker que detecte
   * antes de transcrever (a escuta, no começo de cada fala).
   */
  idioma: string | null;
}

/** Carrega o modelo sem transcrever nada (a escuta, ao começar). */
export interface PedidoDePreparo {
  tipo: "preparar";
  id: number;
  modelo: string;
}

export type PedidoAoTranscritor = PedidoDeTranscricao | PedidoDePreparo;

export type RespostaDoTranscritor =
  /** Baixando o modelo (só na primeira vez): de 0 a 100; `totalMb`, quando o transformers.js informa. */
  | { tipo: "baixando"; modelo: string; progresso: number; totalMb: number | null }
  /** O modelo do pedido de preparo carregou. */
  | { tipo: "pronto"; id: number }
  | {
      tipo: "resultado";
      id: number;
      texto: string;
      segmentos: SegmentoTranscrito[];
      /** Código do idioma usado ("pt", "en"...). */
      idioma: string;
      duracaoDaPassadaMs: number;
    }
  | { tipo: "erro"; id: number; mensagem: string };

/** O idioma que o worker devolve: sempre um código ("portuguese" vira "pt"). */
export function codigoDoIdioma(idioma: string): string {
  return idioma === "portuguese" ? "pt" : idioma;
}

/** Um trecho da saída do pipeline com `return_timestamps: true`. */
export interface TrechoComTempo {
  readonly text: string;
  /** Em segundos; o fim do último trecho pode vir nulo. */
  readonly timestamp: readonly [number | null, number | null];
}

/**
 * Os segmentos da saída do Whisper. Sem tempo de fim (o último trecho, às
 * vezes), o segmento vai até o fim do áudio; trechos vazios saem.
 */
export function segmentosDaSaida(trechos: readonly TrechoComTempo[], duracaoDoAudioS: number): SegmentoTranscrito[] {
  const segmentos: SegmentoTranscrito[] = [];
  for (const trecho of trechos) {
    const texto = trecho.text.trim();
    if (texto === "") continue;
    const [inicio, fim] = trecho.timestamp;
    const inicioS = typeof inicio === "number" && Number.isFinite(inicio) ? inicio : 0;
    const fimS = typeof fim === "number" && Number.isFinite(fim) ? fim : Math.max(inicioS, duracaoDoAudioS);
    segmentos.push({ texto, inicioS, fimS });
  }
  return segmentos;
}

/** Bytes em MB (uma casa), ou null sem total conhecido. */
export function emMegabytes(bytes: number | null | undefined): number | null {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return null;
  return Math.round((bytes / 1_048_576) * 10) / 10;
}
