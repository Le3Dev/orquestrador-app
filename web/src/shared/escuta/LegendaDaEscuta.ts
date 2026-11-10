import { dividirEmFrases } from "./SegmentadorDeFrases";

/** Quantas frases a legenda guarda; passando disto, as mais antigas saem. */
export const MAXIMO_DE_FRASES_NA_LEGENDA = 200;

/**
 * A frase aberta fecha, mesmo sem pontuação, na primeira passada cujo relógio
 * passe isto desde o começo dela. O Whisper quase não pontua fala corrida: sem
 * o corte, a fala toda ficaria numa frase só, e a pergunta nunca seria avaliada.
 */
export const DURACAO_MAXIMA_DA_FRASE_MS = 5_000;

/** Por que a frase fechou: pontuação final, fim da fala ou a duração máxima da frase. */
export type MotivoDoFechamento = "pontuacao" | "fim_da_fala" | "tempo";

/** Uma frase fechada da legenda: um pedaço do texto confirmado de uma fala. */
export interface FraseDaLegenda {
  readonly id: string;
  readonly texto: string;
  readonly inicioMs: number;
  readonly fimMs: number;
  readonly pergunta: boolean;
  /** Por que fechou. A legenda sempre o preenche; é opcional só para frases montadas fora dela. */
  readonly motivo?: MotivoDoFechamento;
}

/** Qual fala da escuta: o número (único na sessão) e o começo dela, em ms de relógio. */
export interface FalaDaLegenda {
  readonly numero: number;
  readonly inicioMs: number;
}

/** A frase aberta da fala atual, como a tela a mostra. Imutável. */
export interface FraseEmAndamento {
  /** O texto já confirmado da frase ("" quando só há o parcial). */
  readonly confirmado: string;
  /** A cauda ainda não confirmada da fala ("" sem nenhuma). */
  readonly parcial: string;
  /** Onde a frase começa, em ms de relógio. */
  readonly inicioMs: number;
}

/** A fala ainda em andamento: quanto dela já virou frase fechada e a frase aberta. */
interface FalaAberta extends FalaDaLegenda {
  /** Todo o texto confirmado da fala até aqui (palavras separadas por um espaço). */
  readonly confirmado: string;
  /** Até onde (ms de relógio) ia a passada em que o confirmado cresceu pela última vez. */
  readonly fimDoConfirmadoMs: number;
  /** Quantas palavras do confirmado já estão em frases fechadas. */
  readonly palavrasFechadas: number;
  /** Quantas frases da fala já fecharam: a próxima é a `frase-<fala>-<fechadas + 1>`. */
  readonly frasesFechadas: number;
  /** O texto confirmado da frase aberta ("" sem nenhum). */
  readonly textoDaFrase: string;
  /** Onde a frase aberta começa: o fim da última frase fechada da fala ou, antes dela, o começo da fala. */
  readonly inicioDaFraseMs: number;
}

/** O resultado de uma mudança na legenda. */
export interface MudancaNaLegenda {
  /** A legenda nova (a mesma, quando nada mudou). */
  readonly legenda: LegendaDaEscuta;
  /** As frases que fecharam nesta mudança, na ordem, cada uma com o `motivo`: são as que podem ser perguntas. */
  readonly fechadasAgora: readonly FraseDaLegenda[];
}

const NENHUMA_FRASE: readonly FraseDaLegenda[] = Object.freeze([]);

const idDaFrase = (numeroDaFala: number, posicao: number): string => `frase-${numeroDaFala}-${posicao + 1}`;

function palavrasDe(texto: string): readonly string[] {
  const limpo = texto.replace(/\s+/g, " ").trim();
  return limpo === "" ? [] : limpo.split(" ");
}

function semVazio(texto: string | null): string | null {
  const limpo = texto?.replace(/\s+/g, " ").trim() ?? "";
  return limpo === "" ? null : limpo;
}

function comAsNovas(frases: readonly FraseDaLegenda[], novas: readonly FraseDaLegenda[]): readonly FraseDaLegenda[] {
  return novas.length === 0 ? frases : Object.freeze([...frases, ...novas].slice(-MAXIMO_DE_FRASES_NA_LEGENDA));
}

function falaNova(fala: FalaDaLegenda): FalaAberta {
  return Object.freeze({
    numero: fala.numero,
    inicioMs: fala.inicioMs,
    confirmado: "",
    fimDoConfirmadoMs: fala.inicioMs,
    palavrasFechadas: 0,
    frasesFechadas: 0,
    textoDaFrase: "",
    inicioDaFraseMs: fala.inicioMs,
  });
}

const mesmaFala = (a: FalaAberta, b: FalaAberta): boolean =>
  a.numero === b.numero &&
  a.confirmado === b.confirmado &&
  a.palavrasFechadas === b.palavrasFechadas &&
  a.frasesFechadas === b.frasesFechadas &&
  a.textoDaFrase === b.textoDaFrase &&
  a.inicioDaFraseMs === b.inicioDaFraseMs;

/**
 * Avança a fala com o texto confirmado dela (que só cresce no fim). Fecham,
 * nesta ordem: as frases que terminam em pontuação (`SegmentadorDeFrases`) e
 * o resto, se a fala terminou (`fimDaFala`) ou se o relógio da passada já
 * passou `DURACAO_MAXIMA_DA_FRASE_MS` desde o começo da frase aberta. Nesse
 * caso todo o texto confirmado entra na frase que fecha, sem cortar palavra;
 * o que for confirmado depois abre a próxima, que começa onde esta terminou.
 */
function avancar(
  aberta: FalaAberta,
  confirmado: string,
  fimMs: number,
  fimDaFala: boolean,
): { fala: FalaAberta; fechadasAgora: readonly FraseDaLegenda[] } {
  const palavras = palavrasDe(confirmado);
  const resto = palavras.slice(aberta.palavrasFechadas).join(" ");
  const { fechadas, aberta: semPontuacao } = dividirEmFrases(resto);
  const passouDoTempo = fimMs - aberta.inicioDaFraseMs >= DURACAO_MAXIMA_DA_FRASE_MS;

  const fechadasAgora: FraseDaLegenda[] = [];
  let palavrasFechadas = aberta.palavrasFechadas;
  let inicioMs = aberta.inicioDaFraseMs;
  let cursor = 0;
  /** Fecha a frase `texto`, que vai até o caractere `ate` do resto (os pedaços sem palavra antes dela também saem). */
  const fechar = (texto: string, motivo: MotivoDoFechamento, ate: number): void => {
    const frase: FraseDaLegenda = Object.freeze({
      id: idDaFrase(aberta.numero, aberta.frasesFechadas + fechadasAgora.length),
      texto,
      inicioMs,
      fimMs: Math.max(fimMs, inicioMs),
      pergunta: false,
      motivo,
    });
    fechadasAgora.push(frase);
    palavrasFechadas += palavrasDe(resto.slice(cursor, ate)).length;
    cursor = ate;
    inicioMs = frase.fimMs;
  };

  for (const texto of fechadas) {
    const posicao = resto.indexOf(texto, cursor);
    fechar(texto, "pontuacao", posicao < 0 ? resto.length : posicao + texto.length);
  }
  let textoDaFrase = semPontuacao;
  if (semPontuacao !== "" && (fimDaFala || passouDoTempo)) {
    fechar(semPontuacao, fimDaFala ? "fim_da_fala" : "tempo", resto.length);
    textoDaFrase = "";
  }

  const confirmadoNovo = palavras.join(" ");
  return {
    fala: Object.freeze({
      ...aberta,
      confirmado: confirmadoNovo,
      fimDoConfirmadoMs: confirmadoNovo === aberta.confirmado ? aberta.fimDoConfirmadoMs : fimMs,
      palavrasFechadas,
      frasesFechadas: aberta.frasesFechadas + fechadasAgora.length,
      textoDaFrase,
      inicioDaFraseMs: inicioMs,
    }),
    fechadasAgora: Object.freeze(fechadasAgora),
  };
}

/**
 * Objeto de valor: a legenda ao vivo da escuta. As `frases` são só as já
 * FECHADAS, com ids estáveis (`frase-<fala>-<posição>`) e o motivo do
 * fechamento: pontuação final, fim da fala ou a duração máxima da frase
 * (`DURACAO_MAXIMA_DA_FRASE_MS`). A frase aberta da fala atual (o texto já
 * confirmado e a cauda ainda não confirmada) fica em `emAndamento`.
 *
 * Guarda as últimas `MAXIMO_DE_FRASES_NA_LEGENDA` frases. Imutável: cada
 * mudança devolve uma legenda nova, ou a mesma quando nada muda.
 */
export class LegendaDaEscuta {
  private static readonly VAZIA = new LegendaDaEscuta(NENHUMA_FRASE, null, null);

  /** A frase aberta da fala atual; null sem frase aberta. */
  readonly emAndamento: FraseEmAndamento | null;

  private constructor(
    /** As frases fechadas, da mais antiga à mais nova (até o máximo). */
    readonly frases: readonly FraseDaLegenda[],
    private readonly aberta: FalaAberta | null,
    /** A cauda não confirmada da fala em andamento, ou null. */
    private readonly parcial: string | null,
  ) {
    this.emAndamento =
      aberta === null || (aberta.textoDaFrase === "" && parcial === null)
        ? null
        : Object.freeze({ confirmado: aberta.textoDaFrase, parcial: parcial ?? "", inicioMs: aberta.inicioDaFraseMs });
    Object.freeze(this);
  }

  static vazia(): LegendaDaEscuta {
    return LegendaDaEscuta.VAZIA;
  }

  /** O que está sendo dito agora: todo o confirmado da fala em andamento mais o parcial; null sem nada. */
  get falaEmAndamento(): string | null {
    return this.aberta === null ? null : semVazio(`${this.aberta.confirmado} ${this.parcial ?? ""}`);
  }

  /**
   * Uma passada da fala: `confirmado` é todo o texto confirmado dela até aqui
   * (só cresce), `parcial` a cauda provisória e `fimMs` até onde (em ms de
   * relógio) foi o áudio transcrito. Devolve as frases que fecharam agora
   * (por pontuação ou por tempo). Se outra fala estava aberta, ela é
   * encerrada como está.
   */
  comConfirmado(fala: FalaDaLegenda, confirmado: string, parcial: string | null, fimMs: number): MudancaNaLegenda {
    const base = this.aberta !== null && this.aberta.numero !== fala.numero ? this.semFalaAberta() : this;
    const { fala: aberta, fechadasAgora } = avancar(base.aberta ?? falaNova(fala), confirmado, fimMs, false);
    const parcialNovo = semVazio(parcial);
    if (
      base === this &&
      this.aberta !== null &&
      fechadasAgora.length === 0 &&
      mesmaFala(aberta, this.aberta) &&
      parcialNovo === this.parcial
    ) {
      return Object.freeze({ legenda: this, fechadasAgora: NENHUMA_FRASE });
    }
    return Object.freeze({ legenda: new LegendaDaEscuta(comAsNovas(base.frases, fechadasAgora), aberta, parcialNovo), fechadasAgora });
  }

  /**
   * Fim da fala: com o texto confirmado final, o que ainda não tinha fechado
   * fecha (a última frase, mesmo sem pontuação, pelo motivo "fim_da_fala") e
   * o parcial some.
   */
  comFimDaFala(fala: FalaDaLegenda, confirmado: string, fimMs: number): MudancaNaLegenda {
    const base = this.aberta !== null && this.aberta.numero !== fala.numero ? this.semFalaAberta() : this;
    const { fechadasAgora } = avancar(base.aberta ?? falaNova(fala), confirmado, fimMs, true);
    if (this.aberta === null && fechadasAgora.length === 0) {
      return Object.freeze({ legenda: this, fechadasAgora: NENHUMA_FRASE });
    }
    return Object.freeze({ legenda: new LegendaDaEscuta(comAsNovas(base.frases, fechadasAgora), null, null), fechadasAgora });
  }

  /**
   * Encerra a fala em andamento como está (a escuta parou no meio dela): o
   * confirmado da frase aberta vira uma frase fechada ("fim_da_fala") e o
   * parcial some.
   */
  semFalaAberta(): LegendaDaEscuta {
    const aberta = this.aberta;
    if (aberta === null) return this;
    const sobra: readonly FraseDaLegenda[] =
      aberta.textoDaFrase === ""
        ? NENHUMA_FRASE
        : [
            Object.freeze({
              id: idDaFrase(aberta.numero, aberta.frasesFechadas),
              texto: aberta.textoDaFrase,
              inicioMs: aberta.inicioDaFraseMs,
              fimMs: Math.max(aberta.fimDoConfirmadoMs, aberta.inicioDaFraseMs),
              pergunta: false,
              motivo: "fim_da_fala",
            }),
          ];
    const frases = comAsNovas(this.frases, sobra);
    return frases.length === 0 ? LegendaDaEscuta.VAZIA : new LegendaDaEscuta(frases, null, null);
  }

  /** Esquece as frases fechadas (o /clear da conversa); a frase aberta continua. */
  semFrases(): LegendaDaEscuta {
    if (this.frases.length === 0) return this;
    return this.aberta === null ? LegendaDaEscuta.VAZIA : new LegendaDaEscuta(NENHUMA_FRASE, this.aberta, this.parcial);
  }

  /** Marca a frase como pergunta detectada. Frase que já saiu da legenda (ou já marcada) não muda nada. */
  comPergunta(id: string): LegendaDaEscuta {
    if (!this.frases.some((frase) => frase.id === id && !frase.pergunta)) return this;
    const frases = Object.freeze(
      this.frases.map((frase) => (frase.id === id ? Object.freeze({ ...frase, pergunta: true }) : frase)),
    );
    return new LegendaDaEscuta(frases, this.aberta, this.parcial);
  }

  /** A frase fechada logo antes da frase `id`; null se ela é a primeira ou não está na legenda. */
  fraseAnterior(id: string): FraseDaLegenda | null {
    const posicao = this.frases.findIndex((frase) => frase.id === id);
    return posicao > 0 ? (this.frases[posicao - 1] ?? null) : null;
  }
}
