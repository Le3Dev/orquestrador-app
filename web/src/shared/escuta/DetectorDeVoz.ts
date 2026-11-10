/** A escuta trabalha com áudio mono a 16 kHz: o formato do Silero e do Whisper. */
export const TAXA_DE_AMOSTRAGEM = 16_000;

/** O Silero VAD v5 analisa janelas de 512 amostras a 16 kHz. */
export const AMOSTRAS_POR_JANELA_DO_VAD = 512;

/** 32 ms por janela. */
export const DURACAO_DA_JANELA_DO_VAD_MS = (AMOSTRAS_POR_JANELA_DO_VAD * 1000) / TAXA_DE_AMOSTRAGEM;

/**
 * O resultado de uma análise: o áudio já cortado em janelas inteiras e a
 * probabilidade de voz (0 a 1) de cada uma, na ordem.
 */
export interface JanelasAnalisadas {
  /** Exatamente `probabilidades.length × AMOSTRAS_POR_JANELA_DO_VAD` amostras, alinhadas às janelas. É uma cópia própria. */
  readonly amostras: Float32Array;
  readonly probabilidades: readonly number[];
}

/**
 * Porta do detector de voz (VAD). Recebe o áudio contínuo da escuta em
 * pedaços de qualquer tamanho; o que não fecha uma janela fica guardado e
 * entra na frente do pedaço seguinte. O modelo carrega o estado de uma
 * janela para a outra, por isso as análises são respondidas na ordem dos
 * pedidos.
 */
export interface DetectorDeVoz {
  /** Analisa as janelas que fecharam com estas amostras. A entrada não é guardada nem transferida. */
  analisar(amostras: Float32Array): Promise<JanelasAnalisadas>;
  /** Descarta as amostras guardadas e zera o estado do modelo (depois de uma pausa no áudio). */
  reiniciar(): void;
  /** Libera o modelo; análises pendentes são rejeitadas. */
  encerrar(): void;
}
