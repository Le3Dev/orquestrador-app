/** O nome vira chave no Claude Code: minúsculas, hífen no lugar de espaço, sem acento. */
export function nomeDeSubagente(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}
