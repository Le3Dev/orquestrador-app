/** Último trecho do caminho, com barra de Windows ou de Unix ("C:\\" e "/" ficam como estão). */
export function nomeDaPasta(caminho: string): string {
  const ultimo = caminho.split(/[\\/]+/).filter((trecho) => trecho !== "").at(-1);
  return ultimo === undefined || /^[A-Za-z]:$/.test(ultimo) ? caminho : ultimo;
}
