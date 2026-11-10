import { TAXA_DE_AMOSTRAGEM } from "./DetectorDeVoz";

const AMOSTRAS_POR_MS = TAXA_DE_AMOSTRAGEM / 1000;

/** Capacidade inicial: 5 s de áudio. Cresce dobrando. */
const CAPACIDADE_INICIAL = 5 * TAXA_DE_AMOSTRAGEM;

const amostrasParaMs = (amostras: number): number => amostras / AMOSTRAS_POR_MS;

/** Posição em amostras do instante `ms` (arredondada para a amostra mais perto). */
function msParaAmostras(ms: number): number {
  if (!Number.isFinite(ms)) throw new Error(`Tempo inválido no buffer da fala: ${ms} ms.`);
  return Math.round(ms * AMOSTRAS_POR_MS);
}

/**
 * O áudio da fala em andamento que ainda vai para o Whisper, com o relógio
 * absoluto (ms, o mesmo do `CortadorDeFala`). Aparar descarta o começo (as
 * palavras já confirmadas) sem perder a posição: `inicioMs` avança e os tempos
 * que o Whisper devolver, relativos ao áudio entregue, somam a `inicioMs`.
 */
export class BufferDaFala {
  private dados: Float32Array;
  /** Índice, em `dados`, da primeira amostra guardada. */
  private comeco = 0;
  private tamanho = 0;
  /** Posição absoluta (em amostras) da primeira amostra guardada. */
  private inicio: number;

  /** `inicioMs`: onde, no relógio absoluto, fica a primeira amostra que for acrescentada. */
  constructor(inicioMs = 0) {
    this.inicio = msParaAmostras(inicioMs);
    this.dados = new Float32Array(CAPACIDADE_INICIAL);
  }

  get inicioMs(): number {
    return amostrasParaMs(this.inicio);
  }

  get fimMs(): number {
    return amostrasParaMs(this.inicio + this.tamanho);
  }

  get duracaoMs(): number {
    return amostrasParaMs(this.tamanho);
  }

  /** Acrescenta amostras (mono, 16 kHz) no fim. A entrada é copiada. */
  acrescentar(amostras: Float32Array): void {
    if (amostras.length === 0) return;
    const necessario = this.tamanho + amostras.length;
    if (this.comeco + necessario > this.dados.length) {
      if (necessario <= this.dados.length) {
        // Cabe no espaço que o começo aparado liberou: só desloca para o início.
        this.dados.copyWithin(0, this.comeco, this.comeco + this.tamanho);
      } else {
        const novos = new Float32Array(Math.max(necessario, this.dados.length * 2));
        novos.set(this.dados.subarray(this.comeco, this.comeco + this.tamanho));
        this.dados = novos;
      }
      this.comeco = 0;
    }
    this.dados.set(amostras, this.comeco + this.tamanho);
    this.tamanho = necessario;
  }

  /**
   * Descarta o áudio anterior a `ms` (no relógio absoluto). Fora do intervalo
   * guardado, para na borda: antes do começo não faz nada; depois do fim,
   * esvazia e o relógio fica no fim.
   */
  apararAte(ms: number): void {
    const alvo = msParaAmostras(ms);
    const descartar = Math.min(Math.max(0, alvo - this.inicio), this.tamanho);
    this.comeco += descartar;
    this.tamanho -= descartar;
    this.inicio += descartar;
    if (this.tamanho === 0) this.comeco = 0;
  }

  /** Cópia do áudio guardado (pode ser transferida a um worker). */
  audio(): Float32Array {
    return this.dados.slice(this.comeco, this.comeco + this.tamanho);
  }

  /** Esvazia. O relógio continua de onde estava (o fim), ou recomeça em `inicioMs`, se for dado. */
  limpar(inicioMs?: number): void {
    this.inicio = inicioMs === undefined ? this.inicio + this.tamanho : msParaAmostras(inicioMs);
    this.comeco = 0;
    this.tamanho = 0;
  }
}
