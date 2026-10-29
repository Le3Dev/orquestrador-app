import type { LeituraDeMemoria } from "./api/tipos";

export type NivelDaMemoria = "normal" | "baixa" | "critica";

const GB = 1024 ** 3;

/**
 * Quão apertada está a memória do computador. Vale o mais grave entre o
 * absoluto e o relativo: 1,5 GB livres é pouco em qualquer máquina, e 10%
 * livres é pouco mesmo numa com muita memória.
 */
export function nivelDaMemoria(leitura: LeituraDeMemoria): NivelDaMemoria {
  const fracaoLivre = leitura.livreBytes / leitura.totalBytes;
  if (leitura.livreBytes < 0.8 * GB || fracaoLivre < 0.05) {
    return "critica";
  }
  if (leitura.livreBytes < 1.5 * GB || fracaoLivre < 0.1) {
    return "baixa";
  }
  return "normal";
}
