import { describe, expect, it } from "vitest";

import type { DadosDoPedidoNaFila } from "../api/tipos";
import { mesclarFilaAnimada, textoDoContadorDaFila } from "./filaAnimada";

const pedido = (id: string): DadosDoPedidoNaFila => ({
  id,
  texto: `pedido ${id}`,
  modo: "execucao",
  enfileiradoEm: "2026-01-01T00:00:00.000Z",
});

describe("textoDoContadorDaFila", () => {
  it("conta os pedidos e some sem nenhum", () => {
    expect(textoDoContadorDaFila(0)).toBe("");
    expect(textoDoContadorDaFila(1)).toBe("1 na fila");
    expect(textoDoContadorDaFila(3)).toBe("3 na fila");
  });
});

describe("mesclarFilaAnimada", () => {
  it("marca como novo só quem chegou depois", () => {
    const inicial = mesclarFilaAnimada([], [pedido("a")]).map((i) => ({ ...i, novo: false }));
    const depois = mesclarFilaAnimada(inicial, [pedido("a"), pedido("b")]);
    expect(depois.map((i) => [i.pedido.id, i.numero, i.novo, i.saindo])).toEqual([
      ["a", 1, false, false],
      ["b", 2, true, false],
    ]);
  });

  it("quem saiu fica como saindo, no lugar, e os outros sobem de número", () => {
    const antes = mesclarFilaAnimada([], [pedido("a"), pedido("b")]);
    const depois = mesclarFilaAnimada(antes, [pedido("b")]);
    expect(depois.map((i) => [i.pedido.id, i.numero, i.saindo])).toEqual([
      ["a", 1, true],
      ["b", 1, false],
    ]);
    expect(mesclarFilaAnimada(depois, [pedido("b")]).filter((i) => i.saindo)).toHaveLength(1);
  });
});
