/** O cortador trabalha com áudio mono a 16 kHz, o formato que o Whisper espera. */
export const TAXA_DE_AMOSTRAGEM = 16_000;

/** A voz é avaliada em quadros de 30 ms. */
export const DURACAO_DO_QUADRO_MS = 30;

/** 480 amostras por quadro a 16 kHz. */
export const AMOSTRAS_POR_QUADRO = (TAXA_DE_AMOSTRAGEM * DURACAO_DO_QUADRO_MS) / 1000;

/**
 * Silêncio seguido que encerra o trecho. Medido em quadros inteiros: o corte
 * acontece no 17º quadro seguido sem voz (510 ms, o múltiplo de 30 ms mais
 * perto de 500 ms). Curto, para a fala aparecer logo na conversa.
 */
export const SILENCIO_PARA_CORTAR_MS = 500;

/** Nenhum trecho passa disto; aos 8 s ele é entregue e o seguinte continua sem perder amostras. */
export const DURACAO_MAXIMA_DO_TRECHO_MS = 8_000;

/** Áudio guardado antes da primeira voz do trecho (7 quadros), para não cortar o começo da palavra. */
export const PRE_ROLL_MS = 210;

/** Silêncio mantido depois da última voz de um trecho cortado por silêncio (10 quadros); o resto do silêncio fica de fora. */
export const CAUDA_MS = 300;

/** Trechos com menos voz que isto (somando os quadros com voz) são descartados: tosse, clique, estalo. */
export const VOZ_MINIMA_MS = 400;

/** Abaixo deste RMS nunca é voz, por mais silencioso que seja o ambiente. */
export const LIMIAR_MINIMO = 0.01;

/** O limiar de voz é `max(LIMIAR_MINIMO, piso de ruído × MULTIPLICADOR_DO_RUIDO)`. */
export const MULTIPLICADOR_DO_RUIDO = 3;

/** Peso de cada quadro sem voz na média móvel do piso de ruído (constante de tempo de ~1,5 s). */
export const SUAVIZACAO_DO_RUIDO = 0.02;

const QUADROS_DE_SILENCIO_PARA_CORTAR = Math.round(SILENCIO_PARA_CORTAR_MS / DURACAO_DO_QUADRO_MS);
const QUADROS_NO_TRECHO_MAXIMO = Math.floor(DURACAO_MAXIMA_DO_TRECHO_MS / DURACAO_DO_QUADRO_MS);
const QUADROS_DE_PRE_ROLL = Math.round(PRE_ROLL_MS / DURACAO_DO_QUADRO_MS);
const QUADROS_DE_CAUDA = Math.round(CAUDA_MS / DURACAO_DO_QUADRO_MS);

/**
 * Um pedaço de fala pronto para transcrever. `amostras` é uma cópia própria
 * (mono, 16 kHz): pode ser transferida a um worker sem afetar o cortador.
 * Os tempos são em ms, contados pelas amostras recebidas desde a criação do
 * cortador ou o último `reiniciar()`.
 */
export interface TrechoDeAudio {
  readonly amostras: Float32Array;
  readonly inicioMs: number;
  readonly fimMs: number;
}

type MotivoDoCorte = "silencio" | "duracao_maxima" | "encerramento";

const amostrasParaMs = (amostras: number): number => (amostras * 1000) / TAXA_DE_AMOSTRAGEM;

function rms(quadro: Float32Array): number {
  let soma = 0;
  for (const amostra of quadro) soma += amostra * amostra;
  return Math.sqrt(soma / quadro.length);
}

/**
 * Detector de voz por energia (VAD) que corta o áudio contínuo da escuta em
 * trechos de fala. Tem estado interno, mas nenhuma E/S: recebe amostras e
 * devolve trechos.
 *
 * - Analisa quadros de 30 ms pelo RMS. É voz quando o RMS passa de
 *   `max(LIMIAR_MINIMO, piso de ruído × 3)`; o piso de ruído é uma média
 *   móvel lenta dos quadros sem voz.
 * - O trecho começa na primeira voz, com ~200 ms de áudio anterior (pre-roll).
 * - Termina com ~500 ms de silêncio (fica só `CAUDA_MS` dele) ou ao chegar a
 *   8 s; nesse caso o trecho seguinte começa na amostra seguinte.
 * - Trechos com menos de `VOZ_MINIMA_MS` de voz são descartados.
 */
export class CortadorDeTrechos {
  /** Amostras recebidas que ainda não completam um quadro. */
  private readonly parcial = new Float32Array(AMOSTRAS_POR_QUADRO);
  private preenchidoDoParcial = 0;
  /** Posição (em amostras) do começo do próximo quadro a analisar. */
  private amostraDoProximoQuadro = 0;
  private pisoDeRuido = 0;
  /** Últimos quadros sem trecho em andamento, para o pre-roll. */
  private anteriores: Float32Array[] = [];

  /** Quadros do trecho em andamento, ou null quando não há trecho. */
  private quadros: Float32Array[] | null = null;
  private amostraDeInicio = 0;
  private quadrosDeVoz = 0;
  private indiceDaUltimaVoz = -1;
  private quadrosDeSilencio = 0;

  /** true enquanto há um trecho de fala em andamento. */
  get emAndamento(): boolean {
    return this.quadros !== null;
  }

  /** Limiar de voz atual (RMS), para depuração ou um indicador na tela. */
  get limiarAtual(): number {
    return Math.max(LIMIAR_MINIMO, this.pisoDeRuido * MULTIPLICADOR_DO_RUIDO);
  }

  /**
   * Recebe amostras mono de 16 kHz, num pedaço de qualquer tamanho, e devolve
   * os trechos que ficaram prontos com elas (quase sempre nenhum ou um). A
   * entrada não é guardada: o chamador pode reaproveitar o buffer.
   */
  adicionar(amostras: Float32Array): TrechoDeAudio[] {
    const prontos: TrechoDeAudio[] = [];
    let posicao = 0;
    while (posicao < amostras.length) {
      const quantidade = Math.min(AMOSTRAS_POR_QUADRO - this.preenchidoDoParcial, amostras.length - posicao);
      this.parcial.set(amostras.subarray(posicao, posicao + quantidade), this.preenchidoDoParcial);
      this.preenchidoDoParcial += quantidade;
      posicao += quantidade;
      if (this.preenchidoDoParcial === AMOSTRAS_POR_QUADRO) {
        this.preenchidoDoParcial = 0;
        const trecho = this.analisarQuadro(this.parcial.slice());
        if (trecho !== null) prontos.push(trecho);
      }
    }
    return prontos;
  }

  /**
   * Uma cópia do que já se ouviu do trecho em andamento (para a transcrição
   * provisória), sem alterar o cortador. Null sem trecho, ou com voz ainda
   * abaixo de `VOZ_MINIMA_MS`.
   */
  parcialEmAndamento(): TrechoDeAudio | null {
    if (this.quadros === null || this.indiceDaUltimaVoz < 0) return null;
    if (this.quadrosDeVoz * DURACAO_DO_QUADRO_MS < VOZ_MINIMA_MS) return null;
    const corte = Math.min(this.quadros.length, this.indiceDaUltimaVoz + 1 + QUADROS_DE_CAUDA);
    return montarTrecho(this.quadros.slice(0, corte), null, this.amostraDeInicio);
  }

  /**
   * Entrega o trecho em andamento (ao pausar ou parar a escuta), se tiver voz
   * suficiente, e esvazia o cortador. O relógio de amostras e o piso de ruído
   * continuam; o pre-roll recomeça vazio, porque haverá uma pausa no áudio.
   */
  encerrar(): TrechoDeAudio[] {
    const trecho = this.quadros === null ? null : this.fecharTrecho("encerramento");
    this.amostraDoProximoQuadro += this.preenchidoDoParcial;
    this.preenchidoDoParcial = 0;
    this.anteriores = [];
    return trecho === null ? [] : [trecho];
  }

  /** Zera tudo: relógio de amostras, piso de ruído, pre-roll e trecho em andamento (sem entregá-lo). */
  reiniciar(): void {
    this.preenchidoDoParcial = 0;
    this.amostraDoProximoQuadro = 0;
    this.pisoDeRuido = 0;
    this.anteriores = [];
    this.quadros = null;
    this.quadrosDeVoz = 0;
    this.indiceDaUltimaVoz = -1;
    this.quadrosDeSilencio = 0;
  }

  private analisarQuadro(quadro: Float32Array): TrechoDeAudio | null {
    const inicioDoQuadro = this.amostraDoProximoQuadro;
    this.amostraDoProximoQuadro += AMOSTRAS_POR_QUADRO;
    const energia = rms(quadro);
    const temVoz = energia > this.limiarAtual;
    if (!temVoz) this.pisoDeRuido += (energia - this.pisoDeRuido) * SUAVIZACAO_DO_RUIDO;

    if (this.quadros === null) {
      if (temVoz) {
        this.quadros = [...this.anteriores, quadro];
        this.amostraDeInicio = inicioDoQuadro - this.anteriores.length * AMOSTRAS_POR_QUADRO;
        this.quadrosDeVoz = 1;
        this.indiceDaUltimaVoz = this.quadros.length - 1;
        this.quadrosDeSilencio = 0;
        this.anteriores = [];
      } else {
        this.anteriores.push(quadro);
        if (this.anteriores.length > QUADROS_DE_PRE_ROLL) this.anteriores.shift();
      }
      return null;
    }

    this.quadros.push(quadro);
    if (temVoz) {
      this.quadrosDeVoz++;
      this.indiceDaUltimaVoz = this.quadros.length - 1;
      this.quadrosDeSilencio = 0;
    } else {
      this.quadrosDeSilencio++;
    }
    if (this.quadrosDeSilencio >= QUADROS_DE_SILENCIO_PARA_CORTAR) return this.fecharTrecho("silencio");
    if (this.quadros.length >= QUADROS_NO_TRECHO_MAXIMO) return this.fecharTrecho("duracao_maxima");
    return null;
  }

  /** Monta o trecho em andamento (ou null, se tiver pouca voz) e prepara o estado seguinte. */
  private fecharTrecho(motivo: MotivoDoCorte): TrechoDeAudio | null {
    const quadros = this.quadros ?? [];
    const corte =
      motivo === "duracao_maxima" ? quadros.length : Math.min(quadros.length, this.indiceDaUltimaVoz + 1 + QUADROS_DE_CAUDA);
    // No encerramento sem silêncio sobrando, as amostras que não fecham um quadro também vão.
    const resto =
      motivo === "encerramento" && corte === quadros.length ? this.parcial.subarray(0, this.preenchidoDoParcial) : null;
    const vozSuficiente = this.quadrosDeVoz * DURACAO_DO_QUADRO_MS >= VOZ_MINIMA_MS;
    const trecho = vozSuficiente ? montarTrecho(quadros.slice(0, corte), resto, this.amostraDeInicio) : null;

    if (motivo === "duracao_maxima") {
      // A fala continua: o trecho seguinte começa exatamente onde este acabou.
      this.quadros = [];
      this.amostraDeInicio += corte * AMOSTRAS_POR_QUADRO;
      this.quadrosDeVoz = 0;
      this.indiceDaUltimaVoz = -1;
    } else {
      this.anteriores = quadros.slice(Math.max(corte, quadros.length - QUADROS_DE_PRE_ROLL));
      this.quadros = null;
      this.quadrosDeVoz = 0;
      this.indiceDaUltimaVoz = -1;
      this.quadrosDeSilencio = 0;
    }
    return trecho;
  }
}

function montarTrecho(quadros: readonly Float32Array[], resto: Float32Array | null, amostraDeInicio: number): TrechoDeAudio {
  const total = quadros.length * AMOSTRAS_POR_QUADRO + (resto?.length ?? 0);
  const amostras = new Float32Array(total);
  quadros.forEach((quadro, indice) => amostras.set(quadro, indice * AMOSTRAS_POR_QUADRO));
  if (resto !== null) amostras.set(resto, quadros.length * AMOSTRAS_POR_QUADRO);
  return Object.freeze({
    amostras,
    inicioMs: amostrasParaMs(amostraDeInicio),
    fimMs: amostrasParaMs(amostraDeInicio + total),
  });
}
