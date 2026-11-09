import type { TrechoTranscrito } from "./TrechoTranscrito";

/** A escuta guarda só os últimos 2 min de texto. */
export const DURACAO_DA_JANELA_MS = 120_000;

/** O contexto que vai junto com a pergunta são os últimos 60 s de transcrição. */
export const DURACAO_DO_CONTEXTO_MS = 60_000;

const NENHUM_TRECHO: readonly TrechoTranscrito[] = Object.freeze([]);

/**
 * Objeto de valor: a transcrição recente da escuta, em ordem de fim do trecho.
 * Imutável — `com` e `semAntigos` devolvem uma janela nova (ou a mesma, quando
 * nada muda, o que poupa render no React).
 */
export class JanelaDeTranscricao {
  private constructor(
    /** Quanto tempo de fala a janela guarda, em ms. */
    public readonly duracaoMs: number,
    /** Os trechos guardados, do mais antigo ao mais recente (por `fimMs`). */
    public readonly trechos: readonly TrechoTranscrito[],
  ) {
    Object.freeze(this);
  }

  static vazia(duracaoMs: number = DURACAO_DA_JANELA_MS): JanelaDeTranscricao {
    if (!Number.isFinite(duracaoMs) || duracaoMs <= 0) {
      throw new Error(`Duração da janela de transcrição inválida: ${duracaoMs} ms.`);
    }
    return new JanelaDeTranscricao(duracaoMs, NENHUM_TRECHO);
  }

  get estaVazia(): boolean {
    return this.trechos.length === 0;
  }

  /** O trecho que terminou por último, ou null se a janela está vazia. */
  get maisRecente(): TrechoTranscrito | null {
    return this.trechos[this.trechos.length - 1] ?? null;
  }

  /**
   * Janela nova com o trecho, mantida em ordem de `fimMs` (um trecho fora de
   * ordem entra no lugar certo), sem os trechos que terminaram mais de
   * `duracaoMs` antes do fim do trecho mais recente.
   */
  com(trecho: TrechoTranscrito): JanelaDeTranscricao {
    const trechos = [...this.trechos];
    let posicao = trechos.length;
    while (posicao > 0 && (trechos[posicao - 1]?.fimMs ?? 0) > trecho.fimMs) posicao--;
    trechos.splice(posicao, 0, trecho);
    const referenciaMs = trechos[trechos.length - 1]?.fimMs ?? trecho.fimMs;
    return new JanelaDeTranscricao(this.duracaoMs, Object.freeze(podar(trechos, referenciaMs, this.duracaoMs)));
  }

  /**
   * Mesma poda de `com`, tomando `agoraMs` (no relógio dos tempos dos trechos)
   * como referência: some o que terminou mais de `duracaoMs` antes de agora.
   */
  semAntigos(agoraMs: number): JanelaDeTranscricao {
    const restantes = podar(this.trechos, agoraMs, this.duracaoMs);
    if (restantes.length === this.trechos.length) return this;
    return new JanelaDeTranscricao(this.duracaoMs, Object.freeze(restantes));
  }

  /**
   * Texto dos trechos que terminaram nos últimos `ultimosMs` (referência:
   * `agoraMs` ou, sem ele, o fim do trecho mais recente), unidos por espaço.
   * String vazia quando não há nada nesse intervalo.
   */
  contexto(ultimosMs: number = DURACAO_DO_CONTEXTO_MS, agoraMs?: number): string {
    const referenciaMs = agoraMs ?? this.maisRecente?.fimMs;
    if (referenciaMs === undefined) return "";
    return this.trechos
      .filter((trecho) => referenciaMs - trecho.fimMs <= ultimosMs)
      .map((trecho) => trecho.texto)
      .join(" ");
  }

  /** Os textos dos `n` trechos mais recentes, do mais antigo ao mais novo (para a faixa na tela). */
  ultimasLinhas(n: number): readonly string[] {
    const quantidade = Math.floor(n);
    if (!(quantidade > 0)) return [];
    return this.trechos.slice(-quantidade).map((trecho) => trecho.texto);
  }
}

function podar(trechos: readonly TrechoTranscrito[], referenciaMs: number, duracaoMs: number): TrechoTranscrito[] {
  return trechos.filter((trecho) => referenciaMs - trecho.fimMs <= duracaoMs);
}
