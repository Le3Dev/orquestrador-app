import { normalizarTexto } from "./PerguntaDetectada";

/**
 * Fim de frase: ".", "!", "?" ou "…" (repetidos ou juntos, como "?!" e "..."),
 * com aspas ou parênteses de fechamento grudados, seguidos de espaço ou do fim
 * do texto. "3.5" e "U.S.A" não fecham frase no meio: depois do ponto vem letra
 * ou número, não espaço.
 */
const FIM_DE_FRASE = /[.!?…？！。]+["'”’»)\]]*(?=\s|$)/gu;

/** Um texto dividido em frases. Imutável. */
export interface FrasesDoTexto {
  /** As frases que já fecharam com pontuação, na ordem. */
  readonly fechadas: readonly string[];
  /** O resto, ainda sem pontuação final ("" quando o texto termina numa frase fechada). */
  readonly aberta: string;
}

/** Só pontuação ou símbolo ("...", "—"): não é frase. */
const temPalavra = (texto: string): boolean => normalizarTexto(texto) !== "";

/**
 * Divide um texto em frases pela pontuação final. Pedaços sem palavra (um
 * "..." solto) são descartados. Estável para texto que só cresce no fim (o
 * texto confirmado de uma fala): uma frase fechada continua fechada, com o
 * mesmo texto, e o que entra no fim só aumenta a aberta ou fecha novas frases.
 * Função pura.
 */
export function dividirEmFrases(texto: string): FrasesDoTexto {
  const limpo = texto.replace(/\s+/g, " ").trim();
  const fechadas: string[] = [];
  let inicio = 0;
  for (const fim of limpo.matchAll(FIM_DE_FRASE)) {
    const final = fim.index + fim[0].length;
    const frase = limpo.slice(inicio, final).trim();
    if (temPalavra(frase)) fechadas.push(frase);
    inicio = final;
  }
  const aberta = limpo.slice(inicio).trim();
  return Object.freeze({ fechadas: Object.freeze(fechadas), aberta: temPalavra(aberta) ? aberta : "" });
}

/** Serviço sem estado: divide o texto confirmado da escuta em frases. */
export const SegmentadorDeFrases = Object.freeze({ dividir: dividirEmFrases });
