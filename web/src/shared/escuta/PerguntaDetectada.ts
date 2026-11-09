/**
 * Forma canônica de um texto para comparar perguntas e procurar termos:
 * minúsculas, sem acentos, sem apóstrofos ("what's" vira "whats"), qualquer
 * outra pontuação ou símbolo vira espaço, e espaços repetidos viram um só.
 * Ex.: "  Qual é  a Complexidade?! " -> "qual e a complexidade".
 */
export function normalizarTexto(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/['’‘`´]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Dados para criar uma PerguntaDetectada. */
export interface DadosDaPerguntaDetectada {
  /** O texto que a escuta entendeu como pedido (normalmente o último trecho transcrito). */
  readonly pergunta: string;
  /** Transcrição dos últimos ~60 s (`JanelaDeTranscricao.contexto()`); pode ser vazia. */
  readonly contexto: string;
  /** Quando a pergunta foi detectada, no mesmo relógio usado no `ControleDeDisparos`. */
  readonly detectadaEmMs: number;
}

/**
 * Objeto de valor: um possível pedido ouvido na escuta, com o contexto da
 * conversa que vai junto para o chat. Imutável.
 */
export class PerguntaDetectada {
  private constructor(
    public readonly pergunta: string,
    public readonly contexto: string,
    public readonly detectadaEmMs: number,
  ) {
    Object.freeze(this);
  }

  /**
   * Valida e normaliza: a pergunta precisa ter alguma palavra (só pontuação é
   * recusado); pergunta e contexto ficam sem espaços sobrando.
   * Lança `Error` com a explicação quando os dados não servem.
   */
  static criar(dados: DadosDaPerguntaDetectada): PerguntaDetectada {
    const pergunta = dados.pergunta.replace(/\s+/g, " ").trim();
    if (normalizarTexto(pergunta) === "") {
      throw new Error("A pergunta detectada está vazia.");
    }
    if (!Number.isFinite(dados.detectadaEmMs)) {
      throw new Error(`Momento inválido para a pergunta detectada: ${dados.detectadaEmMs}.`);
    }
    const contexto = dados.contexto.replace(/\s+/g, " ").trim();
    return new PerguntaDetectada(pergunta, contexto, dados.detectadaEmMs);
  }

  /** A pergunta em forma canônica (`normalizarTexto`), para achar repetidas. */
  get normalizada(): string {
    return normalizarTexto(this.pergunta);
  }
}
