/** Mensagens trocadas entre a tela e o worker que roda o Whisper. */

/** Os modelos do Whisper que o worker sabe carregar (um pipeline por modelo, no primeiro uso). */
export const MODELO_DO_DITADO = "onnx-community/whisper-small";
/** Menor e mais rápido: serve à escuta, que transcreve quase ao vivo. */
export const MODELO_DA_ESCUTA = "onnx-community/whisper-base";

export interface PedidoDeTranscricao {
  id: number;
  /** Qual modelo do Whisper usa: o ditado, o `whisper-small`; a escuta, o `whisper-base`. */
  modelo: string;
  /** Áudio mono a 16 kHz, como o Whisper espera. */
  audio: Float32Array;
  /**
   * Idioma da fala. `"portuguese"` fixa o português (o ditado); `null` pede ao
   * worker que detecte o idioma antes de transcrever (a escuta, que ouve
   * vídeos e chamadas em qualquer língua).
   */
  idioma: "portuguese" | null;
}

export type RespostaDoTranscritor =
  /** Baixando o modelo (só na primeira vez): de 0 a 100. */
  | { tipo: "baixando"; progresso: number }
  | { tipo: "texto"; id: number; texto: string }
  | { tipo: "erro"; id: number; mensagem: string };
