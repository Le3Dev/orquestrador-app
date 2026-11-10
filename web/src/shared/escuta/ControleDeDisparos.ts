import { normalizarTexto, type PerguntaDetectada } from "./PerguntaDetectada";

/** Intervalo mínimo entre dois envios da escuta ao chat. */
export const INTERVALO_MINIMO_MS = 8_000;

/** A partir desta similaridade de Jaccard (palavras normalizadas), duas perguntas são a mesma. */
export const LIMITE_DE_SIMILARIDADE = 0.8;

/** Quantas perguntas enviadas o controle lembra para descartar repetidas. */
export const MAXIMO_DE_RECENTES = 20;

/** Por quanto tempo uma pergunta enviada conta como recente. */
export const VALIDADE_DAS_RECENTES_MS = 10 * 60_000;

/**
 * O que fazer com uma pergunta detectada:
 * - `enviar`: mandar ao chat agora;
 * - `guardar`: o chat está ocupado; virou a pendente (só a mais recente fica);
 * - `aguardar_intervalo`: ainda não passaram 8 s do último envio; virou a pendente;
 * - `descartar_repetida`: igual ou parecida demais com uma recente ou com a pendente.
 */
export type DecisaoDeDisparo = "enviar" | "guardar" | "aguardar_intervalo" | "descartar_repetida";

export interface ResultadoDaAvaliacao {
  readonly decisao: DecisaoDeDisparo;
  /** O controle novo: use-o daqui em diante no lugar do anterior. */
  readonly controle: ControleDeDisparos;
}

export interface ResultadoDaRetirada {
  /** A pendente que deve ser enviada agora, ou null se ainda não é hora (ou não há). */
  readonly pergunta: PerguntaDetectada | null;
  /** O controle novo: use-o daqui em diante no lugar do anterior. */
  readonly controle: ControleDeDisparos;
}

/** Uma pergunta já enviada, lembrada para descartar repetidas. */
export interface PerguntaRecente {
  readonly normalizada: string;
  readonly enviadaEmMs: number;
}

/**
 * Similaridade de Jaccard entre os conjuntos de palavras normalizadas de dois
 * textos: |A ∩ B| / |A ∪ B|, de 0 (nada em comum) a 1 (as mesmas palavras).
 * Dois textos sem nenhuma palavra valem 1.
 */
export function similaridadeDePalavras(a: string, b: string): number {
  const palavrasDeA = conjuntoDePalavras(a);
  const palavrasDeB = conjuntoDePalavras(b);
  if (palavrasDeA.size === 0 && palavrasDeB.size === 0) return 1;
  let comuns = 0;
  for (const palavra of palavrasDeA) if (palavrasDeB.has(palavra)) comuns++;
  return comuns / (palavrasDeA.size + palavrasDeB.size - comuns);
}

function conjuntoDePalavras(texto: string): Set<string> {
  const normalizado = normalizarTexto(texto);
  return new Set(normalizado === "" ? [] : normalizado.split(" "));
}

function saoParecidas(a: string, b: string): boolean {
  return a === b || similaridadeDePalavras(a, b) >= LIMITE_DE_SIMILARIDADE;
}

const NENHUMA_RECENTE: readonly PerguntaRecente[] = Object.freeze([]);

/**
 * Objeto de valor com a política de envio da escuta ao chat: intervalo mínimo
 * de 8 s, descarte de repetidas e uma única pendente (a mais recente) para
 * quando o chat estiver ocupado ou o intervalo não tiver vencido.
 *
 * Imutável: `avaliar` e `retirarPendente` devolvem um controle novo, que deve
 * substituir o anterior (ex.: num `useRef`). Todos os tempos (`agoraMs`) vêm
 * do mesmo relógio, por exemplo `Date.now()`.
 *
 * Uso típico:
 * - pergunta confirmada → `avaliar(pergunta, agora, chatLivre)`; se a decisão
 *   for `enviar`, mande ao chat;
 * - o chat ficou livre, ou passou `msAteLiberar(agora)` → `retirarPendente(agora, true)`;
 *   se vier uma pergunta, mande ao chat.
 */
export class ControleDeDisparos {
  private constructor(
    /** Quando foi o último envio, ou null se nada foi enviado ainda. */
    public readonly ultimoDisparoMs: number | null,
    /** Perguntas enviadas há pouco (no máximo 20, dos últimos 10 min), da mais antiga à mais nova. */
    public readonly recentes: readonly PerguntaRecente[],
    /** A pergunta à espera do chat livre ou do intervalo, ou null. */
    public readonly pendente: PerguntaDetectada | null,
  ) {
    Object.freeze(this);
  }

  static inicial(): ControleDeDisparos {
    return new ControleDeDisparos(null, NENHUMA_RECENTE, null);
  }

  /** true quando já passaram `INTERVALO_MINIMO_MS` desde o último envio (ou nunca houve envio). */
  intervaloVencido(agoraMs: number): boolean {
    return this.msAteLiberar(agoraMs) === 0;
  }

  /** Quanto falta, em ms, para o intervalo mínimo vencer; 0 se já venceu. */
  msAteLiberar(agoraMs: number): number {
    if (this.ultimoDisparoMs === null) return 0;
    return Math.max(0, this.ultimoDisparoMs + INTERVALO_MINIMO_MS - agoraMs);
  }

  /**
   * Decide o que fazer com uma pergunta detectada, nesta ordem:
   * 1. `descartar_repetida` — igual ou parecida (≥ `LIMITE_DE_SIMILARIDADE`)
   *    com uma recente ou com a pendente; nada muda além da poda das recentes;
   * 2. `guardar` — o chat não está livre: ela substitui a pendente;
   * 3. `aguardar_intervalo` — menos de 8 s do último envio: ela substitui a
   *    pendente, para sair quando o intervalo vencer;
   * 4. `enviar` — registra o envio e a pergunta nas recentes. Uma pendente
   *    mais antiga é descartada: fica valendo só a mais recente.
   */
  avaliar(pergunta: PerguntaDetectada, agoraMs: number, chatLivre: boolean): ResultadoDaAvaliacao {
    const recentes = podarRecentes(this.recentes, agoraMs);
    const normalizada = pergunta.normalizada;
    const repetida =
      recentes.some((recente) => saoParecidas(normalizada, recente.normalizada)) ||
      (this.pendente !== null && saoParecidas(normalizada, this.pendente.normalizada));
    if (repetida) {
      return resultado("descartar_repetida", new ControleDeDisparos(this.ultimoDisparoMs, recentes, this.pendente));
    }
    if (!chatLivre) {
      return resultado("guardar", new ControleDeDisparos(this.ultimoDisparoMs, recentes, pergunta));
    }
    if (!this.intervaloVencido(agoraMs)) {
      return resultado("aguardar_intervalo", new ControleDeDisparos(this.ultimoDisparoMs, recentes, pergunta));
    }
    return resultado("enviar", new ControleDeDisparos(agoraMs, registrar(recentes, normalizada, agoraMs), null));
  }

  /**
   * Devolve a pendente para envio só se o chat estiver livre e o intervalo
   * tiver vencido; nesse caso registra o envio e limpa a pendente. Senão,
   * devolve `pergunta: null` e o mesmo controle.
   */
  retirarPendente(agoraMs: number, chatLivre: boolean): ResultadoDaRetirada {
    const pendente = this.pendente;
    if (pendente === null || !chatLivre || !this.intervaloVencido(agoraMs)) {
      return Object.freeze({ pergunta: null, controle: this });
    }
    const recentes = registrar(podarRecentes(this.recentes, agoraMs), pendente.normalizada, agoraMs);
    return Object.freeze({ pergunta: pendente, controle: new ControleDeDisparos(agoraMs, recentes, null) });
  }
}

function resultado(decisao: DecisaoDeDisparo, controle: ControleDeDisparos): ResultadoDaAvaliacao {
  return Object.freeze({ decisao, controle });
}

/** Tira as recentes com mais de 10 min e fica com as 20 mais novas. */
function podarRecentes(recentes: readonly PerguntaRecente[], agoraMs: number): readonly PerguntaRecente[] {
  const validas = recentes.filter((recente) => agoraMs - recente.enviadaEmMs <= VALIDADE_DAS_RECENTES_MS);
  const podadas = validas.slice(-MAXIMO_DE_RECENTES);
  return podadas.length === recentes.length ? recentes : Object.freeze(podadas);
}

function registrar(recentes: readonly PerguntaRecente[], normalizada: string, agoraMs: number): readonly PerguntaRecente[] {
  const nova: PerguntaRecente = Object.freeze({ normalizada, enviadaEmMs: agoraMs });
  return Object.freeze([...recentes, nova].slice(-MAXIMO_DE_RECENTES));
}
