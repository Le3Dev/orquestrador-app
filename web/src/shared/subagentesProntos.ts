/** O nome vira chave no Claude Code: minúsculas, hífen no lugar de espaço, sem acento. */
export function nomeDeSubagente(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

const ouvintesDaBiblioteca = new Set<() => void>();

/**
 * Quem grava a biblioteca de subagentes prontos fora do painel Subagentes (o
 * cartão do chat) avisa aqui, para a contagem do botão da barra reler.
 */
export function avisarSubagentesProntosMudaram(): void {
  for (const ouvinte of ouvintesDaBiblioteca) {
    ouvinte();
  }
}

/** Assina o aviso de que a biblioteca mudou; devolve o cancelamento. */
export function aoMudarSubagentesProntos(ouvinte: () => void): () => void {
  ouvintesDaBiblioteca.add(ouvinte);
  return () => {
    ouvintesDaBiblioteca.delete(ouvinte);
  };
}
