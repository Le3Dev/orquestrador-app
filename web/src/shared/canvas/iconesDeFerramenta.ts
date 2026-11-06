/**
 * O ícone que o bixinho mostra enquanto trabalha: o tipo da ferramenta que o
 * Subagente usou por último (ler, editar, rodar comando, pesquisar na web).
 */
export type IconeDeFerramenta = "lupa" | "lapis" | "engrenagem" | "globo";

/** O que o Subagente está fazendo, em palavras: a dica do ícone. */
export const ROTULO_DO_ICONE: Readonly<Record<IconeDeFerramenta, string>> = {
  lupa: "lendo",
  lapis: "editando",
  engrenagem: "rodando comando",
  globo: "pesquisando na web",
};

/**
 * Ferramentas do Claude Code por ícone, em minúsculas. Um `Map`, e não um
 * objeto: um nome como "constructor" não pode achar nada no protótipo.
 */
const ICONE_POR_FERRAMENTA: ReadonlyMap<string, IconeDeFerramenta> = new Map([
  ["read", "lupa"],
  ["grep", "lupa"],
  ["glob", "lupa"],
  ["ls", "lupa"],
  ["edit", "lapis"],
  ["write", "lapis"],
  ["multiedit", "lapis"],
  ["notebookedit", "lapis"],
  ["bash", "engrenagem"],
  ["powershell", "engrenagem"],
  ["bashoutput", "engrenagem"],
  ["killshell", "engrenagem"],
  ["websearch", "globo"],
  ["webfetch", "globo"],
]);

/**
 * O ícone da ferramenta, sem diferenciar maiúsculas. Ferramenta desconhecida
 * (inclusive as de MCP) ou nenhuma: sem ícone.
 */
export function iconeDaFerramenta(ferramenta: string | null): IconeDeFerramenta | null {
  if (ferramenta === null) {
    return null;
  }
  return ICONE_POR_FERRAMENTA.get(ferramenta.trim().toLowerCase()) ?? null;
}
