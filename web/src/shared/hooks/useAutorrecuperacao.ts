import { useEffect, useSyncExternalStore } from "react";

import { api } from "../api/cliente";

/**
 * A preferência global "Autorrecuperação" (do servidor, não do navegador),
 * compartilhada entre o painel ⚙ e os terminais: quem grava avisa os outros.
 * `null` enquanto não foi lida.
 */
let valor: boolean | null = null;
let leitura: Promise<void> | null = null;
const ouvintes = new Set<() => void>();

function avisar(): void {
  for (const ouvinte of ouvintes) {
    ouvinte();
  }
}

function inscrever(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => ouvintes.delete(ouvinte);
}

/** Guarda o valor lido ou gravado; o servidor sem o campo vale ligado (o padrão). */
export function definirAutorrecuperacao(novo: boolean | undefined): void {
  const ligado = novo ?? true;
  if (valor !== ligado) {
    valor = ligado;
    avisar();
  }
}

/** Lê uma vez do servidor; se falhar, a próxima montagem tenta de novo. */
function carregar(): void {
  if (valor !== null || leitura !== null) {
    return;
  }
  leitura = api
    .lerPreferencias()
    .then((preferencias) => definirAutorrecuperacao(preferencias.autorrecuperacao))
    .catch(() => undefined)
    .finally(() => {
      leitura = null;
    });
}

/** O valor guardado, sem ler do servidor: `null` enquanto ninguém o leu. */
export function useValorDaAutorrecuperacao(): boolean | null {
  return useSyncExternalStore(inscrever, () => valor);
}

/**
 * Se o app retoma sozinho os turnos travados. Lê do servidor na primeira vez;
 * enquanto não leu (ou se a leitura falhou), vale o padrão: ligado.
 */
export function useAutorrecuperacao(): boolean {
  const atual = useValorDaAutorrecuperacao();
  useEffect(carregar, []);
  return atual ?? true;
}

/** Só para os testes: esquece o valor lido. */
export function esquecerAutorrecuperacao(): void {
  valor = null;
  leitura = null;
}
