import { describe, expect, it } from "vitest";

import { EsforcoHerdado } from "./EsforcoHerdado";

describe("EsforcoHerdado", () => {
  it.each([
    ["baixo", false],
    ["medio", false],
    ["alto", false],
    ["extra_alto", true],
    ["maximo", true],
    ["ultracode", true],
  ] as const)("com nível %s, deveAvisar = %s", (nivel, aviso) => {
    const herdado = EsforcoHerdado.criar({ nivel, origem: "CLAUDE_CODE_EFFORT_LEVEL", modelo: null });

    expect(herdado.deveAvisar()).toBe(aviso);
    expect(herdado.paraDados().deveAvisar).toBe(aviso);
  });

  it("paraDados traz nível, origem e modelo", () => {
    const herdado = EsforcoHerdado.criar({
      nivel: "extra_alto",
      origem: "~/.claude/settings.json",
      modelo: "claude-opus-5-5",
    });

    expect(herdado.paraDados()).toEqual({
      nivel: "extra_alto",
      origem: "~/.claude/settings.json",
      modelo: "claude-opus-5-5",
      deveAvisar: true,
    });
    expect(Object.isFrozen(herdado)).toBe(true);
  });

  it("recusa origem vazia e nível inválido", () => {
    expect(() => EsforcoHerdado.criar({ nivel: "alto", origem: " ", modelo: null })).toThrow(
      expect.objectContaining({ motivo: "dados_invalidos" }),
    );
    expect(() =>
      EsforcoHerdado.criar({ nivel: "padrao" as unknown as "alto", origem: "env", modelo: null }),
    ).toThrow(expect.objectContaining({ motivo: "dados_invalidos" }));
  });
});
