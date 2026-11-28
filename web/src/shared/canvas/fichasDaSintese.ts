import { aparenciaDoBixinho, nomeDoBixinho } from "./bixinhos";

/** Quantas fichas a síntese mostra; o resto vira "+N". */
export const MAXIMO_DE_FICHAS = 6;
/** O intervalo entre uma ficha e a seguinte, em ms (também usado pelo CSS, via `--i`). */
export const INTERVALO_DAS_FICHAS_MS = 110;

export interface FichaDaSintese {
  id: string;
  nome: string;
  /** A cor do bixinho como variável CSS (a mesma paleta do canvas). */
  cor: string;
}

const VARIAVEL_DA_COR: Readonly<Record<string, string>> = {
  laranja: "--claude-laranja",
  kraft: "--claude-kraft",
  azul: "--claude-azul",
  verde: "--claude-verde",
  creme: "--claude-cinza-claro",
};

/** As fichas dos subagentes que alimentaram a resposta, em ordem de chegada, e quantos ficaram de fora. */
export function fichasDaSintese(
  subagentes: readonly { id: string; papel: string | null }[],
): { fichas: FichaDaSintese[]; restantes: number } {
  const fichas = subagentes.slice(0, MAXIMO_DE_FICHAS).map((subagente) => ({
    id: subagente.id,
    nome: nomeDoBixinho(subagente.id, subagente.papel),
    cor: `var(${VARIAVEL_DA_COR[aparenciaDoBixinho(subagente.id).cor] ?? "--active"})`,
  }));
  return { fichas, restantes: Math.max(0, subagentes.length - fichas.length) };
}
