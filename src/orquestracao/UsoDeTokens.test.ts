import { describe, expect, it } from "vitest";

import { UsoDeTokens } from "./UsoDeTokens";

describe("UsoDeTokens", () => {
  it("calcula o índice de custo com os mesmos pesos do benchmark", () => {
    const uso = UsoDeTokens.criar({ entrada: 6, criacaoDeCache: 33062, leituraDeCache: 62885, saida: 383 });

    // 6 + 1,25×33062 + 0,1×62885 + 5×383 = 49536,5 → 49537
    expect(uso.indiceDeCusto()).toBe(49537);
    expect(uso.total()).toBe(6 + 33062 + 62885 + 383);
  });

  it("soma campo a campo sem alterar as parcelas", () => {
    const a = UsoDeTokens.criar({ entrada: 1, criacaoDeCache: 2, leituraDeCache: 3, saida: 4 });
    const b = UsoDeTokens.criar({ entrada: 10, criacaoDeCache: 20, leituraDeCache: 30, saida: 40 });

    expect(a.somar(b).paraDados()).toEqual({ entrada: 11, criacaoDeCache: 22, leituraDeCache: 33, saida: 44 });
    expect(a.paraDados()).toEqual({ entrada: 1, criacaoDeCache: 2, leituraDeCache: 3, saida: 4 });
  });

  it("o vazio é neutro na soma e tem índice zero", () => {
    const uso = UsoDeTokens.criar({ entrada: 5, criacaoDeCache: 0, leituraDeCache: 0, saida: 1 });

    expect(UsoDeTokens.vazio.somar(uso).paraDados()).toEqual(uso.paraDados());
    expect(UsoDeTokens.vazio.indiceDeCusto()).toBe(0);
  });

  it("é imutável", () => {
    const uso = UsoDeTokens.criar({ entrada: 1, criacaoDeCache: 0, leituraDeCache: 0, saida: 0 });

    expect(Object.isFrozen(uso)).toBe(true);
  });

  it.each([
    ["negativo", { entrada: -1, criacaoDeCache: 0, leituraDeCache: 0, saida: 0 }],
    ["fracionário", { entrada: 0, criacaoDeCache: 1.5, leituraDeCache: 0, saida: 0 }],
    ["NaN", { entrada: 0, criacaoDeCache: 0, leituraDeCache: Number.NaN, saida: 0 }],
    ["infinito", { entrada: 0, criacaoDeCache: 0, leituraDeCache: 0, saida: Number.POSITIVE_INFINITY }],
  ])("recusa valor %s", (_caso, dados) => {
    expect(() => UsoDeTokens.criar(dados)).toThrow(expect.objectContaining({ motivo: "dados_invalidos" }));
  });
});
