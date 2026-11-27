import { useEffect, useState } from "react";

import type { DadosDoPedidoNaFila } from "../api/tipos";

/** Quanto o pedido que saiu da fila ainda fica na tela, só para a animação de saída (um pouco mais que o CSS). */
export const DURACAO_DA_SAIDA_NA_FILA_MS = 300;

/** Um pedido da fila como a tela o mostra: o que acabou de entrar e o que está saindo ganham animação. */
export interface PedidoAnimadoDaFila {
  pedido: DadosDoPedidoNaFila;
  /** Posição (a partir de 1) na fila; para quem está saindo, a que tinha. */
  numero: number;
  /** Entrou depois de a fila aparecer: ganha a animação de entrada. */
  novo: boolean;
  /** Já não está na fila: fica só até a animação de saída acabar. */
  saindo: boolean;
}

/** "3 na fila", ou "" sem pedidos (o chip da barra do terminal some). */
export function textoDoContadorDaFila(total: number): string {
  return total > 0 ? `${total} na fila` : "";
}

/**
 * Junta o que a tela mostra com a fila de agora: quem continua fica no lugar,
 * quem saiu vira `saindo` (na posição em que estava) e quem chegou entra no fim
 * como `novo`. Sem `anterior`, nada é novo (a fila que já existia ao abrir não anima).
 */
export function mesclarFilaAnimada(
  anterior: readonly PedidoAnimadoDaFila[],
  atual: readonly DadosDoPedidoNaFila[],
): PedidoAnimadoDaFila[] {
  const porId = new Map(atual.map((pedido, indice) => [pedido.id, { pedido, numero: indice + 1 }]));
  const resultado: PedidoAnimadoDaFila[] = [];
  const conhecidos = new Set<string>();
  for (const item of anterior) {
    conhecidos.add(item.pedido.id);
    const agora = porId.get(item.pedido.id);
    resultado.push(
      agora === undefined
        ? { ...item, novo: false, saindo: true }
        : { pedido: agora.pedido, numero: agora.numero, novo: item.novo, saindo: false },
    );
  }
  for (const [id, { pedido, numero }] of porId) {
    if (!conhecidos.has(id)) {
      resultado.push({ pedido, numero, novo: true, saindo: false });
    }
  }
  return resultado;
}

/** A fila para a tela: os pedidos de agora mais os que saíram há pouco (até a animação acabar). */
export function useFilaAnimada(fila: readonly DadosDoPedidoNaFila[]): readonly PedidoAnimadoDaFila[] {
  const [itens, setItens] = useState<PedidoAnimadoDaFila[]>(() =>
    fila.map((pedido, indice) => ({ pedido, numero: indice + 1, novo: false, saindo: false })),
  );

  useEffect(() => {
    setItens((anteriores) => mesclarFilaAnimada(anteriores, fila));
  }, [fila]);

  const temSaindo = itens.some((item) => item.saindo);
  useEffect(() => {
    if (!temSaindo) {
      return;
    }
    const prazo = setTimeout(() => setItens((atuais) => atuais.filter((item) => !item.saindo)), DURACAO_DA_SAIDA_NA_FILA_MS);
    return () => clearTimeout(prazo);
  }, [temSaindo, itens]);

  return itens;
}
