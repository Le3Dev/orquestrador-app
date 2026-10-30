/**
 * Como cada Subagente aparece no canvas: um bixinho em pixel art.
 *
 * A aparência sai do id do Subagente, sempre igual para o mesmo id — o
 * bixinho que aparece no mapa é o mesmo citado no terminal, e continua o
 * mesmo depois de recarregar a página.
 */

export const FORMAS = ["gota", "robo", "fantasma"] as const;
export const ACESSORIOS = ["nenhum", "antena", "chapeu", "oculos", "broto"] as const;
export const CORES = ["laranja", "kraft", "azul", "verde", "creme"] as const;
/** Laranja, a cor do Claude, aparece com o dobro da frequência das outras. */
const PALETA = ["laranja", "laranja", "kraft", "azul", "verde", "creme"] as const;

export type FormaDoBixinho = (typeof FORMAS)[number];
export type AcessorioDoBixinho = (typeof ACESSORIOS)[number];
export type CorDoBixinho = (typeof CORES)[number];

export interface AparenciaDoBixinho {
  readonly nome: string;
  readonly forma: FormaDoBixinho;
  readonly acessorio: AcessorioDoBixinho;
  readonly cor: CorDoBixinho;
}

const NOMES = [
  "Bit", "Byte", "Pixel", "Nibble", "Pip", "Kilo", "Chip", "Cache", "Loop", "Tick", "Ping", "Pong",
  "Hash", "Lambda", "Fork", "Patch", "Merge", "Stack", "Heap", "Token", "Glyph", "Bolt", "Mega", "Giga",
] as const;

/** FNV-1a: espalha bem ids parecidos (os ids de Subagente diferem em poucos caracteres). */
function espalhar(texto: string): number {
  let valor = 2166136261;
  for (const caractere of texto) {
    valor ^= caractere.codePointAt(0) ?? 0;
    valor = Math.imul(valor, 16777619);
  }
  return valor >>> 0;
}

function escolher<Item>(opcoes: readonly [Item, ...Item[]], semente: number): Item {
  return opcoes[semente % opcoes.length] ?? opcoes[0];
}

/**
 * Aparências já calculadas, por id do Subagente. Devolver sempre o mesmo
 * objeto deixa o `memo` do desenho funcionar: com um objeto novo a cada
 * chamada, cada evento redesenhava as ~150 células de cada bixinho. Tem teto
 * para não crescer sem fim numa aba aberta por dias.
 */
const APARENCIAS = new Map<string, AparenciaDoBixinho>();
const LIMITE_DE_APARENCIAS = 1_000;

export function aparenciaDoBixinho(subagenteId: string): AparenciaDoBixinho {
  const guardada = APARENCIAS.get(subagenteId);
  if (guardada !== undefined) {
    return guardada;
  }
  const semente = espalhar(subagenteId);
  const aparencia: AparenciaDoBixinho = Object.freeze({
    nome: escolher(NOMES, semente),
    forma: escolher(FORMAS, semente >>> 5),
    acessorio: escolher(ACESSORIOS, semente >>> 10),
    cor: escolher(PALETA, semente >>> 15),
  });
  if (APARENCIAS.size >= LIMITE_DE_APARENCIAS) {
    // Sai a mais antiga (o Map guarda a ordem de inserção).
    const maisAntiga = APARENCIAS.keys().next();
    if (maisAntiga.done !== true) {
      APARENCIAS.delete(maisAntiga.value);
    }
  }
  APARENCIAS.set(subagenteId, aparencia);
  return aparencia;
}
