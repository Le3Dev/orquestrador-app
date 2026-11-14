import type { VinculoDto } from "../api/tipos";
import type { NoDoCanvas, NoTerminal } from "./nos";
import {
  arestasDosVinculos,
  candidatosAoVinculo,
  idDaArestaDoVinculo,
  ladoDoVinculo,
  lerIdDaArestaDoVinculo,
  vinculosDoOrquestrador,
} from "./vinculos";

function terminal(id: string, x: number, y: number): NoTerminal {
  return { id, type: "terminal", position: { x, y }, width: 100, height: 100, data: { orquestradorId: id } };
}

function vinculo(id: string, a: string, b: string): VinculoDto {
  return { id, orquestradorAId: a, orquestradorBId: b, notas: "", criadoEm: "2026-01-01T00:00:00Z", atualizadoEm: "2026-01-01T00:00:00Z" };
}

describe("arestasDosVinculos", () => {
  it("liga os dois terminais, do lado de A voltado para B ao lado de B voltado para A", () => {
    const nos: NoDoCanvas[] = [terminal("a", 0, 0), terminal("b", 400, 20)];

    const [aresta] = arestasDosVinculos(nos, [vinculo("v1", "a", "b")]);

    expect(aresta).toMatchObject({
      id: "vinculo:v1",
      type: "vinculo",
      source: "a",
      sourceHandle: "direita",
      target: "b",
      targetHandle: "vinculo-esquerda",
      className: "aresta-vinculo",
      selected: false,
    });
  });

  it("usa o eixo vertical quando B está mais abaixo ou acima que ao lado", () => {
    expect(ladoDoVinculo(terminal("a", 0, 0), terminal("b", 10, 300))).toBe("baixo");
    expect(ladoDoVinculo(terminal("a", 0, 300), terminal("b", 10, 0))).toBe("cima");
    expect(ladoDoVinculo(terminal("a", 400, 0), terminal("b", 0, 10))).toBe("esquerda");
  });

  it("marca como selecionado o vínculo com o painel aberto", () => {
    const nos: NoDoCanvas[] = [terminal("a", 0, 0), terminal("b", 400, 0)];

    const arestas = arestasDosVinculos(nos, [vinculo("v1", "a", "b"), vinculo("v2", "b", "a")], "v2");

    expect(arestas.map((aresta) => aresta.selected)).toEqual([false, true]);
  });

  it("vínculo de orquestrador fora do canvas (ou removido) não desenha linha", () => {
    const nos: NoDoCanvas[] = [terminal("a", 0, 0), terminal("b", 400, 0)];

    expect(arestasDosVinculos(nos, [vinculo("v1", "a", "removido")])).toEqual([]);
    expect(arestasDosVinculos(nos, [])).toEqual([]);
  });

  it("vários vínculos por orquestrador viram várias linhas", () => {
    const nos: NoDoCanvas[] = [terminal("a", 0, 0), terminal("b", 400, 0), terminal("c", 0, 400)];

    const arestas = arestasDosVinculos(nos, [vinculo("v1", "a", "b"), vinculo("v2", "a", "c")]);

    expect(arestas.map((aresta) => aresta.id)).toEqual(["vinculo:v1", "vinculo:v2"]);
  });
});

describe("ids e candidatos", () => {
  it("o id da linha é reversível, e outras linhas dão nulo", () => {
    expect(lerIdDaArestaDoVinculo(idDaArestaDoVinculo("v9"))).toBe("v9");
    expect(lerIdDaArestaDoVinculo("ligacao:a:b")).toBeNull();
  });

  it("vinculosDoOrquestrador pega os dois lados", () => {
    const todos = [vinculo("v1", "a", "b"), vinculo("v2", "c", "a"), vinculo("v3", "b", "c")];

    expect(vinculosDoOrquestrador(todos, "a").map((v) => v.id)).toEqual(["v1", "v2"]);
  });

  it("candidatos: tira o próprio e quem já está vinculado", () => {
    const todos = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

    const candidatos = candidatosAoVinculo(todos, [vinculo("v1", "a", "b"), vinculo("v2", "c", "a")], "a");

    expect(candidatos).toEqual([{ id: "d" }]);
  });
});
