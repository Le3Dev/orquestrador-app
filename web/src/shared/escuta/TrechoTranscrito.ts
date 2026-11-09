/** Dados para criar um TrechoTranscrito. Tempos em ms desde o início da escuta. */
export interface DadosDoTrechoTranscrito {
  readonly texto: string;
  readonly inicioMs: number;
  readonly fimMs: number;
}

/**
 * Objeto de valor: um pedaço da fala capturada do áudio do sistema, já
 * transcrito pelo Whisper, com o intervalo que ele ocupa no áudio (os tempos
 * do `TrechoDeAudio` que o originou). Imutável.
 */
export class TrechoTranscrito {
  private constructor(
    public readonly texto: string,
    public readonly inicioMs: number,
    public readonly fimMs: number,
  ) {
    Object.freeze(this);
  }

  /**
   * Valida e normaliza: tira os espaços das pontas (e junta espaços repetidos
   * no meio), recusa texto vazio e exige `fimMs >= inicioMs`.
   * Lança `Error` com a explicação quando os dados não servem.
   */
  static criar(dados: DadosDoTrechoTranscrito): TrechoTranscrito {
    const texto = dados.texto.replace(/\s+/g, " ").trim();
    if (texto === "") {
      throw new Error("O trecho transcrito está vazio.");
    }
    if (!Number.isFinite(dados.inicioMs) || !Number.isFinite(dados.fimMs)) {
      throw new Error(`Tempos inválidos no trecho transcrito: início ${dados.inicioMs} ms, fim ${dados.fimMs} ms.`);
    }
    if (dados.fimMs < dados.inicioMs) {
      throw new Error(
        `O fim do trecho transcrito (${dados.fimMs} ms) é anterior ao início (${dados.inicioMs} ms).`,
      );
    }
    return new TrechoTranscrito(texto, dados.inicioMs, dados.fimMs);
  }

  /** Quanto o trecho dura no áudio, em ms. */
  get duracaoMs(): number {
    return this.fimMs - this.inicioMs;
  }
}
