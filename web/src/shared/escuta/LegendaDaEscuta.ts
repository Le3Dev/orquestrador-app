/** Quantos enunciados a legenda guarda; passando disto, os mais antigos saem. */
export const MAXIMO_DE_FRASES_NA_LEGENDA = 200;

/**
 * A pausa que separa dois enunciados. A fala curta seguinte que começa até
 * isto depois do fim da anterior entra no mesmo enunciado; sem fala nova
 * nesse tempo, a sessão fecha o enunciado (`semEnunciadoAberto`).
 */
export const PAUSA_DO_ENUNCIADO_MS = 1_200;

/**
 * Duração máxima do enunciado, contada desde o começo dele: a fala que
 * termina com o enunciado já nesta duração o fecha na hora, e a fala que
 * começa depois disto abre outro. Como cada fala curta tem até 8 s, o
 * enunciado nunca passa de uns 28 s, mesmo com alguém falando sem pausa.
 */
export const DURACAO_MAXIMA_DO_ENUNCIADO_MS = 20_000;

/**
 * Um enunciado fechado da legenda: o texto confirmado de uma fala completa,
 * entre pausas (uma ou mais falas curtas do cortador, unidas por espaço). Um
 * enunciado não se divide por pontuação nem por tempo. O nome "frase" ficou
 * da versão em que a legenda fatiava a fala em frases de até 5 s.
 */
export interface FraseDaLegenda {
  /** `enunciado-<número da primeira fala>`: o mesmo que ele tinha em `emAndamento`. */
  readonly id: string;
  readonly texto: string;
  readonly inicioMs: number;
  readonly fimMs: number;
  readonly pergunta: boolean;
}

/** Qual fala curta da escuta: o número (único na sessão) e o começo dela, em ms de relógio. */
export interface FalaDaLegenda {
  readonly numero: number;
  readonly inicioMs: number;
}

/** O enunciado aberto, como a tela o mostra. Imutável. */
export interface EnunciadoEmAndamento {
  /** O id que o enunciado terá ao fechar. */
  readonly id: string;
  /** Todo o texto já confirmado do enunciado ("" quando só há o parcial). */
  readonly confirmado: string;
  /** A cauda ainda não confirmada da fala em andamento ("" sem nenhuma). */
  readonly parcial: string;
  /** Onde o enunciado começa (o começo da primeira fala), em ms de relógio. */
  readonly inicioMs: number;
}

/** A fala curta ainda em andamento dentro do enunciado aberto. */
interface FalaAberta {
  readonly numero: number;
  /** Todo o texto confirmado da fala até aqui (palavras separadas por um espaço). */
  readonly confirmado: string;
  /** Até onde (ms de relógio) ia a passada em que o confirmado cresceu pela última vez. */
  readonly fimDoConfirmadoMs: number;
}

/** O enunciado ainda aberto: as falas que já terminaram e a que está em andamento. */
interface EnunciadoAberto {
  readonly id: string;
  readonly inicioMs: number;
  /** O confirmado das falas que já terminaram, unido por espaço ("" sem nenhuma). */
  readonly confirmadoDasFalas: string;
  /** O fim da última fala que terminou; antes dela, o começo do enunciado. */
  readonly fimDasFalasMs: number;
  /** A fala em andamento; null entre uma fala e outra. */
  readonly fala: FalaAberta | null;
  readonly pergunta: boolean;
}

/** O resultado de uma mudança na legenda. */
export interface MudancaNaLegenda {
  /** A legenda nova (a mesma, quando nada mudou). */
  readonly legenda: LegendaDaEscuta;
  /** Os enunciados que fecharam nesta mudança, na ordem: são os que podem ser perguntas. */
  readonly fechadasAgora: readonly FraseDaLegenda[];
}

const NENHUMA_FRASE: readonly FraseDaLegenda[] = Object.freeze([]);

const idDoEnunciado = (numeroDaPrimeiraFala: number): string => `enunciado-${numeroDaPrimeiraFala}`;

const limpo = (texto: string | null): string => texto?.replace(/\s+/g, " ").trim() ?? "";

function semVazio(texto: string | null): string | null {
  const resultado = limpo(texto);
  return resultado === "" ? null : resultado;
}

const unir = (antes: string, depois: string): string => (antes === "" ? depois : depois === "" ? antes : `${antes} ${depois}`);

const textoDe = (enunciado: EnunciadoAberto): string => unir(enunciado.confirmadoDasFalas, enunciado.fala?.confirmado ?? "");

function comAsNovas(frases: readonly FraseDaLegenda[], novas: readonly FraseDaLegenda[]): readonly FraseDaLegenda[] {
  return novas.length === 0 ? frases : Object.freeze([...frases, ...novas].slice(-MAXIMO_DE_FRASES_NA_LEGENDA));
}

function enunciadoNovo(fala: FalaDaLegenda): EnunciadoAberto {
  return Object.freeze({
    id: idDoEnunciado(fala.numero),
    inicioMs: fala.inicioMs,
    confirmadoDasFalas: "",
    fimDasFalasMs: fala.inicioMs,
    fala: null,
    pergunta: false,
  });
}

/** A fala em andamento termina como está: o confirmado dela passa às falas terminadas. */
function semFalaEmAndamento(enunciado: EnunciadoAberto): EnunciadoAberto {
  const fala = enunciado.fala;
  if (fala === null) return enunciado;
  return Object.freeze({
    ...enunciado,
    confirmadoDasFalas: unir(enunciado.confirmadoDasFalas, fala.confirmado),
    fimDasFalasMs: Math.max(enunciado.fimDasFalasMs, fala.fimDoConfirmadoMs),
    fala: null,
  });
}

/** O enunciado como frase fechada; null se ele não tem texto confirmado. */
function fechado(enunciado: EnunciadoAberto): FraseDaLegenda | null {
  const comAFala = semFalaEmAndamento(enunciado);
  if (comAFala.confirmadoDasFalas === "") return null;
  return Object.freeze({
    id: comAFala.id,
    texto: comAFala.confirmadoDasFalas,
    inicioMs: comAFala.inicioMs,
    fimMs: Math.max(comAFala.fimDasFalasMs, comAFala.inicioMs),
    pergunta: comAFala.pergunta,
  });
}

/** A fala cabe no enunciado: começou até a pausa depois da última fala terminada e antes da duração máxima. */
const cabeNoEnunciado = (enunciado: EnunciadoAberto, fala: FalaDaLegenda): boolean =>
  fala.inicioMs - enunciado.fimDasFalasMs <= PAUSA_DO_ENUNCIADO_MS &&
  fala.inicioMs - enunciado.inicioMs < DURACAO_MAXIMA_DO_ENUNCIADO_MS;

/**
 * O enunciado em que a fala entra, e o que fechou para isso. Se outra fala
 * estava em andamento, ela termina como está. Se a fala não cabe no enunciado
 * aberto (pausa longa ou duração máxima), ele fecha e outro abre com ela; um
 * enunciado sem nenhum texto confirmado é só esquecido.
 */
function enunciadoDaFala(
  aberto: EnunciadoAberto | null,
  fala: FalaDaLegenda,
): { readonly enunciado: EnunciadoAberto; readonly fechadoAgora: FraseDaLegenda | null } {
  if (aberto !== null && aberto.fala?.numero === fala.numero) return { enunciado: aberto, fechadoAgora: null };
  const anterior = aberto === null ? null : semFalaEmAndamento(aberto);
  if (anterior === null || anterior.confirmadoDasFalas === "") return { enunciado: enunciadoNovo(fala), fechadoAgora: null };
  if (cabeNoEnunciado(anterior, fala)) return { enunciado: anterior, fechadoAgora: null };
  return { enunciado: enunciadoNovo(fala), fechadoAgora: fechado(anterior) };
}

const semMudanca = (legenda: LegendaDaEscuta): MudancaNaLegenda => Object.freeze({ legenda, fechadasAgora: NENHUMA_FRASE });

/**
 * Objeto de valor: a legenda ao vivo da escuta, em enunciados. Um enunciado
 * é uma fala completa entre pausas: as falas curtas do cortador (até 8 s,
 * para as passadas do motor serem rápidas) entram no mesmo enunciado enquanto
 * a seguinte começa até `PAUSA_DO_ENUNCIADO_MS` depois do fim da anterior, e
 * o texto confirmado delas é unido por espaço. O enunciado não se divide:
 * fecha quando a sessão vê a pausa passar (`semEnunciadoAberto`), quando
 * chega a `DURACAO_MAXIMA_DO_ENUNCIADO_MS` no fim de uma fala, ou quando a
 * fala seguinte começa depois da pausa ou da duração máxima.
 *
 * As `frases` são só os enunciados já FECHADOS; o aberto (com o id que terá
 * ao fechar) fica em `emAndamento`. Guarda os últimos
 * `MAXIMO_DE_FRASES_NA_LEGENDA`. Imutável: cada mudança devolve uma legenda
 * nova, ou a mesma quando nada muda.
 */
export class LegendaDaEscuta {
  private static readonly VAZIA = new LegendaDaEscuta(NENHUMA_FRASE, null, null);

  /** O enunciado aberto; null sem enunciado aberto ou sem nada a mostrar dele. */
  readonly emAndamento: EnunciadoEmAndamento | null;

  private constructor(
    /** Os enunciados fechados, do mais antigo ao mais novo (até o máximo). */
    readonly frases: readonly FraseDaLegenda[],
    private readonly aberto: EnunciadoAberto | null,
    /** A cauda não confirmada da fala em andamento, ou null. */
    private readonly parcial: string | null,
  ) {
    const confirmado = aberto === null ? "" : textoDe(aberto);
    this.emAndamento =
      aberto === null || (confirmado === "" && parcial === null)
        ? null
        : Object.freeze({ id: aberto.id, confirmado, parcial: parcial ?? "", inicioMs: aberto.inicioMs });
    Object.freeze(this);
  }

  static vazia(): LegendaDaEscuta {
    return LegendaDaEscuta.VAZIA;
  }

  /** O que está sendo dito no enunciado aberto: o confirmado dele mais o parcial; null sem nada. */
  get falaEmAndamento(): string | null {
    return this.aberto === null ? null : semVazio(`${textoDe(this.aberto)} ${this.parcial ?? ""}`);
  }

  /**
   * Uma passada parcial da fala: `confirmado` é todo o texto confirmado dela
   * até aqui (só cresce), `parcial` a cauda provisória e `fimMs` até onde (em
   * ms de relógio) foi o áudio transcrito. A fala entra no enunciado aberto
   * (ou abre um); se o aberto não a comporta, ele fecha e volta em
   * `fechadasAgora`.
   */
  comConfirmado(fala: FalaDaLegenda, confirmado: string, parcial: string | null, fimMs: number): MudancaNaLegenda {
    const { enunciado, fechadoAgora } = enunciadoDaFala(this.aberto, fala);
    const falaAtual: FalaAberta =
      enunciado.fala ?? Object.freeze({ numero: fala.numero, confirmado: "", fimDoConfirmadoMs: fala.inicioMs });
    const confirmadoNovo = limpo(confirmado);
    const falaNova =
      confirmadoNovo === falaAtual.confirmado ? falaAtual : Object.freeze({ ...falaAtual, confirmado: confirmadoNovo, fimDoConfirmadoMs: fimMs });
    const parcialNovo = semVazio(parcial);
    if (fechadoAgora === null && enunciado === this.aberto && falaNova === enunciado.fala && parcialNovo === this.parcial) {
      return semMudanca(this);
    }
    const fechadas = fechadoAgora === null ? NENHUMA_FRASE : Object.freeze([fechadoAgora]);
    const aberto = falaNova === enunciado.fala ? enunciado : Object.freeze({ ...enunciado, fala: falaNova });
    return Object.freeze({ legenda: new LegendaDaEscuta(comAsNovas(this.frases, fechadas), aberto, parcialNovo), fechadasAgora: fechadas });
  }

  /**
   * Fim da fala, com o texto confirmado final dela: ele passa ao enunciado e
   * o parcial some. O enunciado continua aberto, esperando a próxima fala ou
   * a pausa, a não ser que já tenha chegado a `DURACAO_MAXIMA_DO_ENUNCIADO_MS`
   * (aí fecha agora). Um enunciado ainda sem texto é esquecido.
   */
  comFimDaFala(fala: FalaDaLegenda, confirmado: string, fimMs: number): MudancaNaLegenda {
    const { enunciado, fechadoAgora } = enunciadoDaFala(this.aberto, fala);
    const fechadas: FraseDaLegenda[] = fechadoAgora === null ? [] : [fechadoAgora];
    const texto = unir(enunciado.confirmadoDasFalas, limpo(confirmado));
    let aberto: EnunciadoAberto | null =
      texto === ""
        ? null
        : Object.freeze({ ...enunciado, confirmadoDasFalas: texto, fimDasFalasMs: Math.max(enunciado.fimDasFalasMs, fimMs), fala: null });
    if (aberto !== null && aberto.fimDasFalasMs - aberto.inicioMs >= DURACAO_MAXIMA_DO_ENUNCIADO_MS) {
      const frase = fechado(aberto);
      if (frase !== null) fechadas.push(frase);
      aberto = null;
    }
    if (fechadas.length === 0 && aberto === null && this.aberto === null) return semMudanca(this);
    const frases = comAsNovas(this.frases, fechadas);
    const legenda = frases.length === 0 && aberto === null ? LegendaDaEscuta.VAZIA : new LegendaDaEscuta(frases, aberto, null);
    return Object.freeze({ legenda, fechadasAgora: Object.freeze(fechadas) });
  }

  /**
   * Fecha o enunciado aberto como está: a pausa passou, ou a escuta pausou,
   * parou ou saiu do modo. O confirmado (com o da fala em andamento) vira um
   * enunciado fechado e o parcial some. Sem texto confirmado, nada fecha.
   */
  semEnunciadoAberto(): MudancaNaLegenda {
    const aberto = this.aberto;
    if (aberto === null) return semMudanca(this);
    const frase = fechado(aberto);
    const fechadas = frase === null ? NENHUMA_FRASE : Object.freeze([frase]);
    const frases = comAsNovas(this.frases, fechadas);
    return Object.freeze({
      legenda: frases.length === 0 ? LegendaDaEscuta.VAZIA : new LegendaDaEscuta(frases, null, null),
      fechadasAgora: fechadas,
    });
  }

  /** Esquece os enunciados fechados (o /clear da conversa); o aberto continua. */
  semFrases(): LegendaDaEscuta {
    if (this.frases.length === 0) return this;
    return this.aberto === null ? LegendaDaEscuta.VAZIA : new LegendaDaEscuta(NENHUMA_FRASE, this.aberto, this.parcial);
  }

  /**
   * Marca o enunciado (aberto ou fechado) como pergunta detectada; o aberto
   * leva a marca ao fechar. Enunciado que já saiu da legenda (ou já marcado)
   * não muda nada.
   */
  comPergunta(id: string): LegendaDaEscuta {
    const aberto = this.aberto;
    if (aberto !== null && aberto.id === id) {
      return aberto.pergunta ? this : new LegendaDaEscuta(this.frases, Object.freeze({ ...aberto, pergunta: true }), this.parcial);
    }
    if (!this.frases.some((frase) => frase.id === id && !frase.pergunta)) return this;
    const frases = Object.freeze(
      this.frases.map((frase) => (frase.id === id ? Object.freeze({ ...frase, pergunta: true }) : frase)),
    );
    return new LegendaDaEscuta(frases, aberto, this.parcial);
  }
}
