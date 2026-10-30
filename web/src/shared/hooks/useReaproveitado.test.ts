import { renderHook } from "@testing-library/react";

import { mesmoConteudo, reaproveitarLista, useReaproveitado } from "./useReaproveitado";

describe("mesmoConteudo", () => {
  it("compara objetos e arrays vindos de JSON pelo conteúdo", () => {
    expect(mesmoConteudo({ a: 1, b: [1, { c: "x" }], d: null }, { b: [1, { c: "x" }], a: 1, d: null })).toBe(true);
    expect(mesmoConteudo({ a: 1 }, { a: 2 })).toBe(false);
    expect(mesmoConteudo({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(mesmoConteudo([1, 2], [1, 2, 3])).toBe(false);
    expect(mesmoConteudo([], {})).toBe(false);
    expect(mesmoConteudo(null, {})).toBe(false);
  });

  it("outros objetos só são iguais se forem o mesmo", () => {
    const data = new Date("2026-10-30T10:00:00Z");

    expect(mesmoConteudo(data, data)).toBe(true);
    expect(mesmoConteudo(data, new Date("2026-10-30T11:00:00Z"))).toBe(false);
    expect(mesmoConteudo(new Map(), new Map())).toBe(false);
  });
});

describe("reaproveitarLista", () => {
  const a = { id: "a", nome: "A" };
  const b = { id: "b", nome: "B" };

  it("devolve a lista anterior quando o conteúdo não mudou", () => {
    const anteriores = [a, b];

    expect(reaproveitarLista(anteriores, [{ ...a }, { ...b }])).toBe(anteriores);
  });

  it("reaproveita os itens que não mudaram e troca só o que mudou", () => {
    const novos = reaproveitarLista([a, b], [{ ...a }, { id: "b", nome: "B2" }, { id: "c", nome: "C" }]);

    expect(novos[0]).toBe(a);
    expect(novos.map((item) => item.nome)).toEqual(["A", "B2", "C"]);
  });

  it("sem lista anterior, usa a nova", () => {
    const novos = [a];

    expect(reaproveitarLista(null, novos)).toBe(novos);
  });
});

describe("useReaproveitado", () => {
  function mesmoTexto(anterior: { texto: string }, novo: { texto: string }): { texto: string } {
    return anterior.texto === novo.texto ? anterior : novo;
  }

  it("mantém a referência enquanto o valor é equivalente e troca quando muda", () => {
    const { result, rerender } = renderHook(({ texto }) => useReaproveitado({ texto }, mesmoTexto), {
      initialProps: { texto: "a" },
    });
    const primeiro = result.current;

    rerender({ texto: "a" });
    expect(result.current).toBe(primeiro);

    rerender({ texto: "b" });
    expect(result.current).not.toBe(primeiro);
    expect(result.current.texto).toBe("b");

    const segundo = result.current;
    rerender({ texto: "b" });
    expect(result.current).toBe(segundo);
  });
});
