import { getViewportForBounds, type Rect } from "@xyflow/react";

import type { Ponto } from "./layout";

/**
 * Piso do zoom do "enquadrar tudo": abaixo de 60% o texto das caixas fica
 * ilegível na tela de um notebook. Se tudo não cabe com pelo menos esse zoom,
 * o enquadramento mostra uma caixa só (ver `escolherEnquadramento`).
 */
export const ZOOM_MINIMO_DO_ENQUADRAMENTO = 0.6;
/** Teto do enquadramento: acima de 100% o texto dos terminais deixa de ser nítido (ver ADR-20). */
export const ZOOM_MAXIMO_DO_ENQUADRAMENTO = 1;

export interface CaixaParaEnquadrar {
  id: string;
  /** O retângulo da caixa no canvas (coordenadas do fluxo, já absolutas). */
  retangulo: Rect;
  selecionada: boolean;
  /** Caixa que acompanha outra (o bixinho do terminal): só vira foco se estiver selecionada. */
  acessoria?: boolean;
}

export type Enquadramento = { tipo: "tudo" } | { tipo: "caixa"; id: string };

export interface PedidoDeEnquadramento {
  caixas: readonly CaixaParaEnquadrar[];
  /** O tamanho, em pixels, da área do canvas. */
  tela: { largura: number; altura: number };
  /** O centro da área visível, em coordenadas do fluxo. */
  centro: Ponto;
  /** A mesma folga passada ao `fitView` (fração da tela). */
  folga: number;
}

function uniao(retangulos: readonly Rect[]): Rect {
  const esquerda = Math.min(...retangulos.map((r) => r.x));
  const topo = Math.min(...retangulos.map((r) => r.y));
  const direita = Math.max(...retangulos.map((r) => r.x + r.width));
  const base = Math.max(...retangulos.map((r) => r.y + r.height));
  return { x: esquerda, y: topo, width: direita - esquerda, height: base - topo };
}

function distanciaAoCentro(retangulo: Rect, centro: Ponto): number {
  return Math.hypot(retangulo.x + retangulo.width / 2 - centro.x, retangulo.y + retangulo.height / 2 - centro.y);
}

/**
 * O que o "enquadrar tudo" mostra. Se tudo cabe na tela com zoom de pelo menos
 * `ZOOM_MINIMO_DO_ENQUADRAMENTO`, tudo. Senão, uma caixa só: a selecionada
 * (com várias, a mais perto do centro da tela); sem seleção, a janela mais
 * perto do centro da tela atual. O código não guarda a "última caixa usada"
 * além da seleção (clicar numa caixa a seleciona).
 */
export function escolherEnquadramento({ caixas, tela, centro, folga }: PedidoDeEnquadramento): Enquadramento {
  if (caixas.length === 0 || tela.largura <= 0 || tela.altura <= 0) {
    return { tipo: "tudo" };
  }
  const limites = uniao(caixas.map((caixa) => caixa.retangulo));
  if (limites.width <= 0 || limites.height <= 0) {
    return { tipo: "tudo" };
  }
  const { zoom } = getViewportForBounds(limites, tela.largura, tela.altura, 0, Number.POSITIVE_INFINITY, folga);
  if (zoom >= ZOOM_MINIMO_DO_ENQUADRAMENTO) {
    return { tipo: "tudo" };
  }
  const selecionadas = caixas.filter((caixa) => caixa.selecionada);
  const janelas = caixas.filter((caixa) => caixa.acessoria !== true);
  const candidatas = selecionadas.length > 0 ? selecionadas : janelas.length > 0 ? janelas : caixas;
  const maisPerto = candidatas.reduce((melhor, caixa) =>
    distanciaAoCentro(caixa.retangulo, centro) < distanciaAoCentro(melhor.retangulo, centro) ? caixa : melhor,
  );
  return { tipo: "caixa", id: maisPerto.id };
}
