/**
 * O que cabe na barra de título do terminal. Os controles (alterações,
 * arquivos, terminal, ⚙ e ✕) nunca encolhem nem saem: isso é do CSS. Os chips
 * encolhem com reticências e, se nem cortados couberem, vão para o menu "⋯",
 * um por vez, na ordem de `ORDEM_DE_SAIDA`. O nome do orquestrador fica sempre.
 *
 * As larguras são estimativas do menor tamanho em que cada chip ainda se lê
 * (cortado): os chips do menu não estão na barra para serem medidos.
 */

export type ChipDaBarra = "pasta" | "branch" | "reconectando" | "memoria" | "situacao";

/** Quem vai primeiro para o "⋯": a memória; por último, o aviso de reconexão. */
export const ORDEM_DE_SAIDA: readonly ChipDaBarra[] = [
  "memoria",
  "pasta",
  "branch",
  "situacao",
  "reconectando",
];

/** A menor largura (px) de cada chip na barra. A situação não corta: é a do "TRABALHANDO". */
export const LARGURA_MINIMA_DO_CHIP: Readonly<Record<ChipDaBarra, number>> = {
  pasta: 56,
  branch: 64,
  reconectando: 64,
  memoria: 56,
  situacao: 100,
};

/** O `gap` da barra (`.barra-do-terminal`). */
const ESPACO = 8;
/** O que a barra sempre tem fora os controles: o recuo, o semáforo, o ícone e o nome (cortado). */
const LARGURA_FIXA =
  20 + // recuo da barra (12 à esquerda, 8 à direita)
  46 + // semáforo
  14 + // ícone do orquestrador
  64 + // nome, cortado
  4 * ESPACO; // entre semáforo, ícone, nome, o espaçador e os controles
const LARGURA_DO_BOTAO_MAIS = 30;

/**
 * Os chips presentes que vão para o menu "⋯", com a barra de `larguraDaBarra`
 * (a `clientWidth`, com o recuo) e os controles de `larguraDosControles`. Sem
 * medida ainda (zero), nenhum: o CSS já garante os controles visíveis.
 */
export function chipsParaOMenu(
  larguraDaBarra: number,
  larguraDosControles: number,
  presentes: readonly ChipDaBarra[],
): ReadonlySet<ChipDaBarra> {
  const fora = new Set<ChipDaBarra>();
  if (larguraDaBarra <= 0) {
    return fora;
  }
  const ocupa = (chip: ChipDaBarra): number => LARGURA_MINIMA_DO_CHIP[chip] + ESPACO;
  let chips = presentes.reduce((soma, chip) => soma + ocupa(chip), 0);
  const livre = larguraDaBarra - LARGURA_FIXA - larguraDosControles;
  if (chips <= livre) {
    return fora;
  }
  // Com algum chip no menu, o "⋯" também ocupa a barra.
  const livreComOMais = livre - LARGURA_DO_BOTAO_MAIS - ESPACO;
  for (const chip of ORDEM_DE_SAIDA) {
    if (chips <= livreComOMais) {
      break;
    }
    if (presentes.includes(chip)) {
      fora.add(chip);
      chips -= ocupa(chip);
    }
  }
  return fora;
}
