/**
 * O tamanho que o servidor vai conferir nas instruções personalizadas: ele tira
 * o espaço sobrando antes de contar (fim das linhas, linhas em branco
 * repetidas e as pontas). Mesma regra de `normalizarInstrucoes` no servidor.
 */
export function tamanhoDasInstrucoes(texto: string): number {
  return texto
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((linha) => linha.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim().length;
}
