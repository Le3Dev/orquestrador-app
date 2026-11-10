import { dividirEmFrases } from "./SegmentadorDeFrases";

/** Quantas frases a legenda guarda; passando disto, as mais antigas saem. */
export const MAXIMO_DE_FRASES_NA_LEGENDA = 200;

/** Uma frase confirmada da legenda: o texto confirmado de uma fala, dividido por pontuação. */
export interface FraseDaLegenda {
  readonly id: string;
  readonly texto: string;
  readonly inicioMs: number;
  readonly fimMs: number;
  readonly pergunta: boolean;
}

/** Qual fala da escuta: o número (único na sessão) e o começo dela, em ms de relógio. */
export interface FalaDaLegenda {
  readonly numero: number;
  readonly inicioMs: number;
}

/** A fala ainda em andamento na legenda: as frases dela, das quais as primeiras `fechadas` já fecharam. */
interface FalaAberta extends FalaDaLegenda {
  readonly frases: readonly FraseDaLegenda[];
  readonly fechadas: number;
}

/** O resultado de uma mudança na legenda. */
export interface MudancaNaLegenda {
  /** A legenda nova (a mesma, quando nada mudou). */
  readonly legenda: LegendaDaEscuta;
  /** As frases que fecharam nesta mudança, na ordem: são as que podem ser perguntas. */
  readonly fechadasAgora: readonly FraseDaLegenda[];
}

const NENHUMA_FRASE: readonly FraseDaLegenda[] = Object.freeze([]);

const idDaFrase = (numeroDaFala: number, posicao: number): string => `frase-${numeroDaFala}-${posicao + 1}`;

const juntarTextos = (frases: readonly FraseDaLegenda[]): string => frases.map((frase) => frase.texto).join(" ");

function semVazio(texto: string | null): string | null {
  const limpo = texto?.replace(/\s+/g, " ").trim() ?? "";
  return limpo === "" ? null : limpo;
}

function mesmasFrases(a: readonly FraseDaLegenda[], b: readonly FraseDaLegenda[]): boolean {
  return a.length === b.length && a.every((frase, indice) => frase === b[indice]);
}

/**
 * Objeto de valor: a legenda ao vivo da escuta. As frases são o texto
 * confirmado de cada fala, dividido por pontuação (`SegmentadorDeFrases`),
 * com ids estáveis (`frase-<fala>-<posição>`); a última frase da fala em
 * andamento pode crescer até fechar com pontuação ou no fim da fala. O
 * `parcial` é a cauda da fala em andamento ainda não confirmada.
 *
 * Guarda as últimas `MAXIMO_DE_FRASES_NA_LEGENDA` frases. Imutável: cada
 * mudança devolve uma legenda nova, ou a mesma quando nada muda.
 */
export class LegendaDaEscuta {
  private static readonly VAZIA = new LegendaDaEscuta(NENHUMA_FRASE, null, null);

  /** As frases, da mais antiga à mais nova: as das falas encerradas e as da fala em andamento. */
  readonly frases: readonly FraseDaLegenda[];

  private constructor(
    /** Frases das falas já encerradas (até o máximo). */
    private readonly encerradas: readonly FraseDaLegenda[],
    private readonly aberta: FalaAberta | null,
    /** A cauda não confirmada da fala em andamento, ou null. */
    readonly parcial: string | null,
  ) {
    this.frases =
      aberta === null || aberta.frases.length === 0
        ? encerradas
        : Object.freeze([...encerradas, ...aberta.frases].slice(-MAXIMO_DE_FRASES_NA_LEGENDA));
    Object.freeze(this);
  }

  static vazia(): LegendaDaEscuta {
    return LegendaDaEscuta.VAZIA;
  }

  /** O texto confirmado da fala em andamento ("" sem fala em andamento). */
  get textoDaFalaAberta(): string {
    return this.aberta === null ? "" : juntarTextos(this.aberta.frases);
  }

  /** O que está sendo dito agora: o confirmado da fala em andamento mais o parcial; null sem nada. */
  get falaEmAndamento(): string | null {
    return semVazio([this.textoDaFalaAberta, this.parcial ?? ""].join(" "));
  }

  /**
   * Uma passada da fala: `confirmado` é todo o texto confirmado dela até aqui
   * (só cresce), `parcial` a cauda provisória e `fimMs` até onde (em ms de
   * relógio) foi o áudio transcrito. Devolve as frases que fecharam agora.
   * Se outra fala estava aberta, ela é encerrada como está.
   */
  comConfirmado(fala: FalaDaLegenda, confirmado: string, parcial: string | null, fimMs: number): MudancaNaLegenda {
    const base = this.aberta !== null && this.aberta.numero !== fala.numero ? this.semFalaAberta() : this;
    const { frases, fechadas, fechadasAgora } = base.montarFrases(fala, confirmado, fimMs, false);
    const parcialNovo = semVazio(parcial);
    const anteriores = base.aberta?.frases ?? NENHUMA_FRASE;
    if (base === this && base.aberta !== null && mesmasFrases(frases, anteriores) && parcialNovo === base.parcial) {
      return Object.freeze({ legenda: this, fechadasAgora: NENHUMA_FRASE });
    }
    const aberta: FalaAberta = Object.freeze({ numero: fala.numero, inicioMs: fala.inicioMs, frases, fechadas });
    return Object.freeze({ legenda: new LegendaDaEscuta(base.encerradas, aberta, parcialNovo), fechadasAgora });
  }

  /**
   * Fim da fala: com o texto confirmado final, todas as frases dela fecham
   * (inclusive a última, sem pontuação) e o parcial some.
   */
  comFimDaFala(fala: FalaDaLegenda, confirmado: string, fimMs: number): MudancaNaLegenda {
    const base = this.aberta !== null && this.aberta.numero !== fala.numero ? this.semFalaAberta() : this;
    const { frases, fechadasAgora } = base.montarFrases(fala, confirmado, fimMs, true);
    const encerradas =
      frases.length === 0
        ? base.encerradas
        : Object.freeze([...base.encerradas, ...frases].slice(-MAXIMO_DE_FRASES_NA_LEGENDA));
    if (encerradas === this.encerradas && this.aberta === null && this.parcial === null) {
      return Object.freeze({ legenda: this, fechadasAgora: NENHUMA_FRASE });
    }
    return Object.freeze({ legenda: new LegendaDaEscuta(encerradas, null, null), fechadasAgora });
  }

  /** Encerra a fala em andamento como está (a escuta parou no meio dela); o parcial some. */
  semFalaAberta(): LegendaDaEscuta {
    if (this.aberta === null && this.parcial === null) return this;
    const encerradas =
      this.aberta === null || this.aberta.frases.length === 0
        ? this.encerradas
        : Object.freeze([...this.encerradas, ...this.aberta.frases].slice(-MAXIMO_DE_FRASES_NA_LEGENDA));
    return new LegendaDaEscuta(encerradas, null, null);
  }

  /** Marca a frase como pergunta detectada. Frase que já saiu da legenda (ou já marcada) não muda nada. */
  comPergunta(id: string): LegendaDaEscuta {
    const marcar = (frases: readonly FraseDaLegenda[]): readonly FraseDaLegenda[] =>
      frases.some((frase) => frase.id === id && !frase.pergunta)
        ? Object.freeze(frases.map((frase) => (frase.id === id ? Object.freeze({ ...frase, pergunta: true }) : frase)))
        : frases;
    const encerradas = marcar(this.encerradas);
    const frasesDaAberta = this.aberta === null ? null : marcar(this.aberta.frases);
    if (encerradas === this.encerradas && (this.aberta === null || frasesDaAberta === this.aberta.frases)) return this;
    const aberta = this.aberta === null || frasesDaAberta === null ? null : Object.freeze({ ...this.aberta, frases: frasesDaAberta });
    return new LegendaDaEscuta(encerradas, aberta, this.parcial);
  }

  /**
   * As frases da fala com o texto confirmado. As que já tinham fechado ficam
   * as mesmas (o texto confirmado só cresce); a aberta ganha o texto e o fim
   * novos. Cada frase começa onde a anterior terminou.
   */
  private montarFrases(
    fala: FalaDaLegenda,
    confirmado: string,
    fimMs: number,
    fecharTudo: boolean,
  ): { frases: readonly FraseDaLegenda[]; fechadas: number; fechadasAgora: readonly FraseDaLegenda[] } {
    const existentes = this.aberta?.numero === fala.numero ? this.aberta.frases : NENHUMA_FRASE;
    const jaFechadas = this.aberta?.numero === fala.numero ? this.aberta.fechadas : 0;
    const { fechadas, aberta } = dividirEmFrases(confirmado);
    const textos = aberta === "" ? fechadas : [...fechadas, aberta];
    const quantasFecham = fecharTudo ? textos.length : fechadas.length;

    const frases: FraseDaLegenda[] = [];
    const fechadasAgora: FraseDaLegenda[] = [];
    let inicioMs = fala.inicioMs;
    textos.forEach((texto, posicao) => {
      const existente = existentes[posicao];
      const fecha = posicao < quantasFecham;
      let frase: FraseDaLegenda;
      if (existente !== undefined && existente.texto === texto && (posicao < jaFechadas || !fecha)) {
        frase = existente;
      } else {
        frase = Object.freeze({
          id: idDaFrase(fala.numero, posicao),
          texto,
          inicioMs: existente?.inicioMs ?? inicioMs,
          fimMs: Math.max(fimMs, existente?.inicioMs ?? inicioMs),
          pergunta: existente?.pergunta ?? false,
        });
      }
      if (fecha && !(posicao < jaFechadas && frase === existente)) fechadasAgora.push(frase);
      frases.push(frase);
      inicioMs = frase.fimMs;
    });
    return {
      frases: Object.freeze(frases),
      fechadas: quantasFecham,
      fechadasAgora: Object.freeze(fechadasAgora),
    };
  }
}
