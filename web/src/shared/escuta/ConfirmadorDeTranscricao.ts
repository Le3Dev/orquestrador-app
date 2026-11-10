/**
 * Quantas palavras do fim do texto confirmado servem para achar, na frente de
 * uma hipótese nova, o pedaço que só repete o que já foi confirmado.
 */
export const PALAVRAS_DA_CAUDA_PARA_ALINHAR = 5;

/**
 * Uma cauda com menos palavras que isto só vale se a hipótese começar por ela:
 * uma ou duas palavras comuns ("de", "que eu") achadas no meio da hipótese
 * podem ser fala nova.
 */
const PALAVRAS_PARA_ALINHAR_NO_MEIO = 3;

/** Uma palavra da transcrição: como veio (`texto`) e a forma usada para comparar (`chave`). */
interface Palavra {
  readonly texto: string;
  readonly chave: string;
}

const NENHUMA_PALAVRA: readonly Palavra[] = Object.freeze([]);

/** Forma de comparar palavras: minúsculas e sem pontuação nas pontas ("Olá," → "olá"). */
export function normalizarPalavra(palavra: string): string {
  return palavra
    .normalize("NFC")
    .toLocaleLowerCase("pt-BR")
    .replace(/^\p{P}+|\p{P}+$/gu, "");
}

/** Separa por espaço. Pontuação solta ("—", "...") fica grudada à palavra vizinha, sem virar palavra. */
function separarPalavras(texto: string): Palavra[] {
  const palavras: Palavra[] = [];
  let pontuacaoAntes = "";
  for (const pedaco of texto.split(/\s+/u)) {
    if (pedaco === "") continue;
    const chave = normalizarPalavra(pedaco);
    if (chave === "") {
      const anterior = palavras.pop();
      if (anterior !== undefined) palavras.push({ texto: `${anterior.texto} ${pedaco}`, chave: anterior.chave });
      else pontuacaoAntes = pontuacaoAntes === "" ? pedaco : `${pontuacaoAntes} ${pedaco}`;
      continue;
    }
    palavras.push({ texto: pontuacaoAntes === "" ? pedaco : `${pontuacaoAntes} ${pedaco}`, chave });
    pontuacaoAntes = "";
  }
  return palavras;
}

const juntar = (palavras: readonly Palavra[]): string => palavras.map((palavra) => palavra.texto).join(" ");

function casam(a: readonly Palavra[], inicioA: number, b: readonly Palavra[], inicioB: number, quantidade: number): boolean {
  for (let i = 0; i < quantidade; i++) {
    if (a[inicioA + i]?.chave !== b[inicioB + i]?.chave) return false;
  }
  return true;
}

/**
 * Quantas palavras da frente da hipótese só repetem o que já foi confirmado
 * (o buffer ainda tem esse áudio). Procura as últimas até 5 palavras
 * confirmadas na hipótese, numa posição que caiba no texto confirmado (antes
 * delas não pode haver mais palavras do que as confirmadas antes da cauda), e
 * descarta tudo até o fim delas. Caudas de 1 ou 2 palavras só valem no começo.
 */
function palavrasRepetidas(hipotese: readonly Palavra[], confirmadas: readonly Palavra[]): number {
  const total = confirmadas.length;
  for (let cauda = Math.min(PALAVRAS_DA_CAUDA_PARA_ALINHAR, total, hipotese.length); cauda >= 1; cauda--) {
    const ultimaPosicao = cauda >= PALAVRAS_PARA_ALINHAR_NO_MEIO ? Math.min(total - cauda, hipotese.length - cauda) : 0;
    // De trás para a frente: com a cauda repetida na própria fala, fica a ocorrência que cobre mais texto confirmado.
    for (let posicao = ultimaPosicao; posicao >= 0; posicao--) {
      if (casam(hipotese, posicao, confirmadas, total - cauda, cauda)) return posicao + cauda;
    }
  }
  return 0;
}

/** O resultado de uma passada do Whisper sobre o buffer da fala. */
export interface PassadaConfirmada {
  /** O confirmador com esta passada; o anterior não muda. */
  readonly confirmador: ConfirmadorDeTranscricao;
  /** Palavras confirmadas agora (na forma desta hipótese), ou "". */
  readonly novasConfirmadas: string;
  /** O resto da hipótese, ainda provisório (ou "", no `finalizar`). */
  readonly parcial: string;
  /**
   * A frente desta hipótese que já está confirmada: as palavras repetidas do
   * que fora confirmado antes mais as `novasConfirmadas`. É o que vai em
   * `fimDoUltimoSegmentoConfirmado` para aparar o buffer.
   */
  readonly confirmadoNaHipotese: string;
}

/**
 * Objeto de valor: a confirmação da transcrição contínua de uma fala, por
 * concordância entre duas passadas seguidas do Whisper (LocalAgreement-2, como
 * no whisper_streaming). Uma palavra só é confirmada quando duas hipóteses
 * seguidas concordam nela e em tudo antes dela; o resto é provisório.
 *
 * Sem tempos por palavra, o alinhamento é pelo texto: cada hipótese cobre o
 * buffer inteiro, que pode ainda ter palavras já confirmadas (se não foi
 * aparado); essa repetição é tirada da frente antes de comparar. A comparação
 * ignora caixa e pontuação nas pontas; o texto devolvido é o da hipótese mais
 * recente. Imutável: cada passada devolve um confirmador novo.
 */
export class ConfirmadorDeTranscricao {
  private static readonly VAZIO = new ConfirmadorDeTranscricao(NENHUMA_PALAVRA, NENHUMA_PALAVRA);

  private constructor(
    /** Tudo o que já foi confirmado na fala. */
    private readonly confirmadas: readonly Palavra[],
    /** O provisório da hipótese anterior, que a próxima precisa repetir para confirmar. */
    private readonly pendentes: readonly Palavra[],
  ) {
    Object.freeze(this);
  }

  static vazio(): ConfirmadorDeTranscricao {
    return ConfirmadorDeTranscricao.VAZIO;
  }

  /** Todo o texto confirmado da fala. */
  get confirmado(): string {
    return juntar(this.confirmadas);
  }

  /** O provisório da última hipótese. */
  get parcial(): string {
    return juntar(this.pendentes);
  }

  /** Recebe a hipótese de uma passada (o texto do buffer inteiro) e confirma o que concorda com a anterior. */
  comHipotese(texto: string): PassadaConfirmada {
    const hipotese = separarPalavras(texto);
    const repetidas = palavrasRepetidas(hipotese, this.confirmadas);
    const nova = hipotese.slice(repetidas);
    let comum = 0;
    while (comum < nova.length && comum < this.pendentes.length && nova[comum]?.chave === this.pendentes[comum]?.chave) comum++;
    const confirmadasAgora = nova.slice(0, comum);
    const resto = nova.slice(comum);
    return Object.freeze({
      confirmador: new ConfirmadorDeTranscricao(
        Object.freeze([...this.confirmadas, ...confirmadasAgora]),
        Object.freeze(resto),
      ),
      novasConfirmadas: juntar(confirmadasAgora),
      parcial: juntar(resto),
      confirmadoNaHipotese: juntar(hipotese.slice(0, repetidas + comum)),
    });
  }

  /**
   * Fim da fala: vale a transcrição final. Confirma tudo o que ela tem depois
   * do que já estava confirmado; o provisório anterior é substituído por ela
   * (texto final vazio não confirma nada).
   */
  finalizar(textoFinal: string): PassadaConfirmada {
    const hipotese = separarPalavras(textoFinal);
    const nova = hipotese.slice(palavrasRepetidas(hipotese, this.confirmadas));
    return Object.freeze({
      confirmador: new ConfirmadorDeTranscricao(Object.freeze([...this.confirmadas, ...nova]), NENHUMA_PALAVRA),
      novasConfirmadas: juntar(nova),
      parcial: "",
      confirmadoNaHipotese: juntar(hipotese),
    });
  }

  /** Confirmador zerado para a próxima fala. */
  paraNovaFala(): ConfirmadorDeTranscricao {
    return ConfirmadorDeTranscricao.VAZIO;
  }
}

/** Um segmento da transcrição do buffer, com o fim em segundos relativo ao começo do áudio transcrito. */
export interface SegmentoTranscrito {
  readonly texto: string;
  readonly fimS: number;
}

/**
 * Até onde o buffer pode ser aparado: o fim (s, relativo ao áudio transcrito)
 * do último segmento cujas palavras já estão todas confirmadas, contando do
 * começo. `confirmadoNoBuffer` é a frente confirmada da mesma hipótese
 * (`PassadaConfirmada.confirmadoNaHipotese`). Segmentos sem palavras não
 * avançam o corte. Null se nem o primeiro segmento está todo confirmado.
 */
export function fimDoUltimoSegmentoConfirmado(
  segmentos: readonly SegmentoTranscrito[],
  confirmadoNoBuffer: string,
): number | null {
  const confirmadas = separarPalavras(confirmadoNoBuffer);
  let posicao = 0;
  let fim: number | null = null;
  for (const segmento of segmentos) {
    const palavras = separarPalavras(segmento.texto);
    if (palavras.length === 0) continue;
    if (posicao + palavras.length > confirmadas.length || !Number.isFinite(segmento.fimS)) break;
    if (!casam(palavras, 0, confirmadas, posicao, palavras.length)) break;
    posicao += palavras.length;
    fim = segmento.fimS;
  }
  return fim;
}
