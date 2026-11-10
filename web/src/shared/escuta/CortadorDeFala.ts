import {
  AMOSTRAS_POR_JANELA_DO_VAD,
  DURACAO_DA_JANELA_DO_VAD_MS,
  type JanelasAnalisadas,
  TAXA_DE_AMOSTRAGEM,
} from "./DetectorDeVoz";

/** A fala começa numa janela com probabilidade de voz a partir disto. */
export const LIMIAR_DE_INICIO_DA_FALA = 0.5;

/** Depois de começar, a fala continua enquanto a probabilidade fica a partir disto (histerese). */
export const LIMIAR_DE_FIM_DA_FALA = 0.35;

/**
 * Silêncio seguido (abaixo do limiar de fim) que encerra a fala. Medido em
 * janelas inteiras: o fim acontece na 16ª janela seguida sem voz (512 ms).
 * A fala curta só serve às passadas do motor; quem junta as falas de uma
 * frase inteira é o enunciado da legenda (`PAUSA_DO_ENUNCIADO_MS`).
 */
export const SILENCIO_PARA_FIM_MS = 500;

/** Áudio guardado antes da primeira janela de voz, para não cortar o começo da palavra. */
export const PRE_ROLL_MS = 200;

/**
 * Falas com menos voz que isto (somando as janelas a partir do limiar de fim)
 * são descartadas: tosse, clique, estalo. Também é quanto de voz a fala
 * precisa para ser anunciada (o evento "inicio").
 */
export const VOZ_MINIMA_MS = 250;

/**
 * Nenhuma fala passa disto: é cortada no vale de probabilidade dos últimos
 * `BUSCA_DO_CORTE_MS`. Curta para que a passada final de cada fala chegue
 * logo, sem esperar a pessoa parar de falar.
 */
export const DURACAO_MAXIMA_DA_FALA_MS = 8_000;

/** Onde a fala longa procura o ponto de corte: os últimos 2 s, na janela de menor probabilidade. */
export const BUSCA_DO_CORTE_MS = 2_000;

const N = AMOSTRAS_POR_JANELA_DO_VAD;
const JANELAS_DE_SILENCIO_PARA_FIM = Math.ceil(SILENCIO_PARA_FIM_MS / DURACAO_DA_JANELA_DO_VAD_MS);
const JANELAS_DE_VOZ_MINIMA = Math.ceil(VOZ_MINIMA_MS / DURACAO_DA_JANELA_DO_VAD_MS);
const AMOSTRAS_DE_PRE_ROLL = (PRE_ROLL_MS * TAXA_DE_AMOSTRAGEM) / 1000;
const JANELAS_GUARDADAS_PARA_PRE_ROLL = Math.ceil(AMOSTRAS_DE_PRE_ROLL / N);
const AMOSTRAS_NA_FALA_MAXIMA = (DURACAO_MAXIMA_DA_FALA_MS * TAXA_DE_AMOSTRAGEM) / 1000;
const JANELAS_NA_BUSCA_DO_CORTE = Math.floor(BUSCA_DO_CORTE_MS / DURACAO_DA_JANELA_DO_VAD_MS);

export type MotivoDoFimDaFala = "silencio" | "duracao_maxima" | "encerramento";

/**
 * O que o cortador avisa. Os tempos são em ms, contados pelas amostras
 * recebidas desde a criação do cortador ou o último `reiniciar()`.
 *
 * - "inicio": a fala passou de `VOZ_MINIMA_MS` de voz e foi anunciada.
 *   `emMs` é o começo do áudio dela (com o pre-roll), já no passado.
 * - "fim": a fala acabou. `emMs` é o fim do áudio dela; `audio` (cópia
 *   própria, com o pre-roll) vai de `inicioMs` a `emMs`.
 */
export type EventoDeFala =
  | { readonly tipo: "inicio"; readonly emMs: number }
  | {
      readonly tipo: "fim";
      readonly emMs: number;
      readonly motivo: MotivoDoFimDaFala;
      readonly inicioMs: number;
      readonly audio: Float32Array;
    };

/** A fala em andamento (ou ainda candidata, antes de ter voz suficiente). */
interface Fala {
  /** Posição (em amostras) do começo do áudio da fala, com o pre-roll. */
  inicio: number;
  preRoll: Float32Array;
  janelas: Float32Array[];
  probabilidades: number[];
  janelasDeVoz: number;
  janelasDeSilencio: number;
  /** true depois do evento "inicio". Uma fala não anunciada some sem aviso se não juntar voz. */
  anunciada: boolean;
}

const amostrasParaMs = (amostras: number): number => (amostras * 1000) / TAXA_DE_AMOSTRAGEM;

const tamanhoDaFala = (fala: Fala): number => fala.preRoll.length + fala.janelas.length * N;

function juntar(partes: readonly Float32Array[]): Float32Array {
  const resultado = new Float32Array(partes.reduce((soma, parte) => soma + parte.length, 0));
  let posicao = 0;
  for (const parte of partes) {
    resultado.set(parte, posicao);
    posicao += parte.length;
  }
  return resultado;
}

/**
 * Corta o áudio contínuo da escuta em falas, pelas probabilidades de voz do
 * Silero (`DetectorDeVoz`). Tem estado interno, mas nenhuma E/S: recebe
 * janelas já analisadas e devolve eventos.
 *
 * - Histerese: a fala começa numa janela com p ≥ 0,5, continua enquanto
 *   p ≥ 0,35 e termina depois de `SILENCIO_PARA_FIM_MS` abaixo de 0,35 (o
 *   silêncio fica no fim do áudio da fala).
 * - Leva ~200 ms de áudio anterior (pre-roll). A fala seguinte nunca
 *   reaproveita áudio da anterior: os tempos não se sobrepõem.
 * - Só é anunciada com `VOZ_MINIMA_MS` de voz; antes disso, se acabar, é
 *   descartada sem nenhum evento.
 * - Ao passar de `DURACAO_MAXIMA_DA_FALA_MS`, é cortada logo depois da janela
 *   de menor probabilidade dos últimos 2 s (o espaço entre palavras) e a fala
 *   seguinte começa ali, sem perder amostras ("fim" e "inicio" no mesmo ms).
 */
export class CortadorDeFala {
  /** Relógio: amostras recebidas. */
  private amostrasRecebidas = 0;
  /** Últimas janelas fora de fala, para o pre-roll. */
  private anteriores: Float32Array[] = [];
  private fala: Fala | null = null;

  /** true entre o evento "inicio" e o "fim". */
  get emAndamento(): boolean {
    return this.fala?.anunciada === true;
  }

  /** Começo (ms) do áudio da fala anunciada, ou null sem fala. */
  get inicioDaFalaMs(): number | null {
    return this.fala?.anunciada === true ? amostrasParaMs(this.fala.inicio) : null;
  }

  /** O relógio do cortador: ms de áudio recebidos. */
  get agoraMs(): number {
    return amostrasParaMs(this.amostrasRecebidas);
  }

  /**
   * Recebe janelas analisadas pelo `DetectorDeVoz` e devolve os eventos que
   * aconteceram nelas, em ordem. A entrada não é guardada.
   */
  adicionar(janelas: JanelasAnalisadas): readonly EventoDeFala[] {
    if (janelas.amostras.length !== janelas.probabilidades.length * N) {
      throw new Error(
        `Janelas desalinhadas: ${janelas.amostras.length} amostras para ${janelas.probabilidades.length} probabilidades (esperado ${N} por janela).`,
      );
    }
    const copia = janelas.amostras.slice();
    const eventos: EventoDeFala[] = [];
    janelas.probabilidades.forEach((probabilidade, indice) => {
      this.analisarJanela(copia.subarray(indice * N, (indice + 1) * N), probabilidade, eventos);
    });
    return Object.freeze(eventos);
  }

  /** Cópia de todo o áudio da fala em andamento, com o pre-roll (vazia sem fala anunciada). */
  audioDaFala(): Float32Array {
    const fala = this.fala;
    if (fala === null || !fala.anunciada) return new Float32Array(0);
    return juntar([fala.preRoll, ...fala.janelas]);
  }

  /**
   * Fecha a fala em andamento (ao pausar ou parar a escuta) e esvazia o
   * cortador. Uma fala ainda não anunciada é descartada. O relógio continua;
   * o pre-roll recomeça vazio, porque haverá uma pausa no áudio.
   */
  encerrar(): readonly EventoDeFala[] {
    const fala = this.fala;
    const eventos: EventoDeFala[] = [];
    if (fala?.anunciada === true) eventos.push(this.eventoDeFim(fala, "encerramento"));
    this.fala = null;
    this.anteriores = [];
    return Object.freeze(eventos);
  }

  /** Zera tudo: relógio, pre-roll e fala em andamento (sem entregá-la). */
  reiniciar(): void {
    this.amostrasRecebidas = 0;
    this.anteriores = [];
    this.fala = null;
  }

  private analisarJanela(janela: Float32Array, probabilidade: number, eventos: EventoDeFala[]): void {
    const inicioDaJanela = this.amostrasRecebidas;
    this.amostrasRecebidas += N;
    const fala = this.fala;

    if (fala === null) {
      if (probabilidade < LIMIAR_DE_INICIO_DA_FALA) {
        this.anteriores.push(janela);
        if (this.anteriores.length > JANELAS_GUARDADAS_PARA_PRE_ROLL) this.anteriores.shift();
        return;
      }
      const anteriores = juntar(this.anteriores);
      const preRoll = anteriores.slice(Math.max(0, anteriores.length - AMOSTRAS_DE_PRE_ROLL));
      this.anteriores = [];
      this.fala = {
        inicio: inicioDaJanela - preRoll.length,
        preRoll,
        janelas: [janela],
        probabilidades: [probabilidade],
        janelasDeVoz: 1,
        janelasDeSilencio: 0,
        anunciada: false,
      };
      this.anunciarSeTemVoz(this.fala, eventos);
      return;
    }

    fala.janelas.push(janela);
    fala.probabilidades.push(probabilidade);
    if (probabilidade >= LIMIAR_DE_FIM_DA_FALA) {
      fala.janelasDeVoz++;
      fala.janelasDeSilencio = 0;
    } else {
      fala.janelasDeSilencio++;
    }
    this.anunciarSeTemVoz(fala, eventos);

    if (fala.janelasDeSilencio >= JANELAS_DE_SILENCIO_PARA_FIM) {
      if (fala.anunciada) {
        eventos.push(this.eventoDeFim(fala, "silencio"));
        this.anteriores = [];
      } else {
        // Pouca voz: some sem aviso, e o fim dela serve de pre-roll para a próxima.
        this.anteriores = fala.janelas.slice(-JANELAS_GUARDADAS_PARA_PRE_ROLL);
      }
      this.fala = null;
      return;
    }
    if (fala.anunciada && tamanhoDaFala(fala) > AMOSTRAS_NA_FALA_MAXIMA) this.cortarFalaLonga(fala, eventos);
  }

  private anunciarSeTemVoz(fala: Fala, eventos: EventoDeFala[]): void {
    if (fala.anunciada || fala.janelasDeVoz < JANELAS_DE_VOZ_MINIMA) return;
    fala.anunciada = true;
    eventos.push(Object.freeze({ tipo: "inicio", emMs: amostrasParaMs(fala.inicio) }));
  }

  /** Corta logo depois da janela de menor probabilidade dos últimos 2 s; o resto vira a fala seguinte. */
  private cortarFalaLonga(fala: Fala, eventos: EventoDeFala[]): void {
    const inicioDaBusca = Math.max(0, fala.janelas.length - JANELAS_NA_BUSCA_DO_CORTE);
    let vale = inicioDaBusca;
    for (let indice = inicioDaBusca + 1; indice < fala.probabilidades.length; indice++) {
      if ((fala.probabilidades[indice] ?? 1) < (fala.probabilidades[vale] ?? 1)) vale = indice;
    }
    const corte = vale + 1;
    const primeira: Fala = { ...fala, janelas: fala.janelas.slice(0, corte), probabilidades: fala.probabilidades.slice(0, corte) };
    eventos.push(this.eventoDeFim(primeira, "duracao_maxima"));

    const probabilidades = fala.probabilidades.slice(corte);
    let janelasDeSilencio = 0;
    while (
      janelasDeSilencio < probabilidades.length &&
      (probabilidades[probabilidades.length - 1 - janelasDeSilencio] ?? 1) < LIMIAR_DE_FIM_DA_FALA
    ) {
      janelasDeSilencio++;
    }
    const seguinte: Fala = {
      inicio: primeira.inicio + tamanhoDaFala(primeira),
      preRoll: new Float32Array(0),
      janelas: fala.janelas.slice(corte),
      probabilidades,
      janelasDeVoz: probabilidades.filter((p) => p >= LIMIAR_DE_FIM_DA_FALA).length,
      janelasDeSilencio,
      anunciada: true,
    };
    this.fala = seguinte;
    eventos.push(Object.freeze({ tipo: "inicio", emMs: amostrasParaMs(seguinte.inicio) }));
  }

  private eventoDeFim(fala: Fala, motivo: MotivoDoFimDaFala): EventoDeFala {
    return Object.freeze({
      tipo: "fim",
      emMs: amostrasParaMs(fala.inicio + tamanhoDaFala(fala)),
      motivo,
      inicioMs: amostrasParaMs(fala.inicio),
      audio: juntar([fala.preRoll, ...fala.janelas]),
    });
  }
}
