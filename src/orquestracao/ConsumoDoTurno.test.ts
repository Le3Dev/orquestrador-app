import { describe, expect, it } from "vitest";

import { ConsumoDoTurno } from "./ConsumoDoTurno";
import { UsoDeTokens } from "./UsoDeTokens";

const principal = UsoDeTokens.criar({ entrada: 6, criacaoDeCache: 33062, leituraDeCache: 62885, saida: 383 });
const subagentes = UsoDeTokens.criar({ entrada: 4, criacaoDeCache: 1000, leituraDeCache: 2000, saida: 100 });

function consumo(parcial = false): ConsumoDoTurno {
  return ConsumoDoTurno.criar({
    principal,
    subagentes,
    subagentesMedidos: 2,
    parcial,
    modeloDoPrincipal: "claude-opus-5-5",
  });
}

describe("ConsumoDoTurno", () => {
  it("o total soma principal e subagentes, e o índice vem do total", () => {
    const medido = consumo();

    expect(medido.total().paraDados()).toEqual({
      entrada: 10,
      criacaoDeCache: 34062,
      leituraDeCache: 64885,
      saida: 483,
    });
    expect(medido.indiceDeCusto()).toBe(principal.somar(subagentes).indiceDeCusto());
  });

  it("paraDados traz as parcelas, o índice e o modelo", () => {
    expect(consumo().paraDados()).toEqual({
      principal: principal.paraDados(),
      subagentes: subagentes.paraDados(),
      subagentesMedidos: 2,
      parcial: false,
      indiceDeCusto: principal.somar(subagentes).indiceDeCusto(),
      modeloDoPrincipal: "claude-opus-5-5",
    });
  });

  it("comoParcial devolve outro consumo marcado, sem mexer no original", () => {
    const original = consumo();
    const parcial = original.comoParcial();

    expect(parcial.parcial).toBe(true);
    expect(original.parcial).toBe(false);
    expect(parcial.indiceDeCusto()).toBe(original.indiceDeCusto());
    expect(consumo(true).comoParcial().parcial).toBe(true);
  });

  it("modelo vazio vira null", () => {
    const semModelo = ConsumoDoTurno.criar({
      principal,
      subagentes: UsoDeTokens.vazio,
      subagentesMedidos: 0,
      parcial: false,
      modeloDoPrincipal: "  ",
    });

    expect(semModelo.modeloDoPrincipal).toBeNull();
  });

  it("recusa quantidade de subagentes inválida", () => {
    expect(() =>
      ConsumoDoTurno.criar({ principal, subagentes, subagentesMedidos: -1, parcial: false, modeloDoPrincipal: null }),
    ).toThrow(expect.objectContaining({ motivo: "dados_invalidos" }));
  });

  it("é imutável", () => {
    expect(Object.isFrozen(consumo())).toBe(true);
  });
});
