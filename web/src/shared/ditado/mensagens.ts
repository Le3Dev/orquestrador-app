/** Mensagens trocadas entre a tela e o worker que roda o Whisper. */

export interface PedidoDeTranscricao {
  id: number;
  /** Áudio mono a 16 kHz, como o Whisper espera. */
  audio: Float32Array;
}

export type RespostaDoTranscritor =
  /** Baixando o modelo (só na primeira vez): de 0 a 100. */
  | { tipo: "baixando"; progresso: number }
  | { tipo: "texto"; id: number; texto: string }
  | { tipo: "erro"; id: number; mensagem: string };
