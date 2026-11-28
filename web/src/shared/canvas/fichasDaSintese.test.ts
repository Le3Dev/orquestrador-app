import { describe, expect, it } from "vitest";

import { fichasDaSintese, MAXIMO_DE_FICHAS } from "./fichasDaSintese";

const sub = (id: string, papel: string | null = null) => ({ id, papel });

describe("fichasDaSintese", () => {
  it("uma ficha por subagente, na ordem, com o nome do papel quando ele nomeia", () => {
    const { fichas, restantes } = fichasDaSintese([sub("aaaa1111", "revisor"), sub("bbbb2222", "executor")]);
    expect(fichas.map((f) => f.id)).toEqual(["aaaa1111", "bbbb2222"]);
    expect(fichas[0]?.nome).toBe("revisor");
    expect(fichas[1]?.nome).not.toBe("executor");
    expect(fichas.every((f) => /^var\(--claude-[a-z-]+\)$/.test(f.cor))).toBe(true);
    expect(restantes).toBe(0);
  });

  it("limita as fichas e conta as que ficaram de fora", () => {
    const muitos = Array.from({ length: MAXIMO_DE_FICHAS + 3 }, (_, i) => sub(`sub-${i}`));
    const { fichas, restantes } = fichasDaSintese(muitos);
    expect(fichas).toHaveLength(MAXIMO_DE_FICHAS);
    expect(restantes).toBe(3);
  });

  it("sem subagentes, nada", () => {
    expect(fichasDaSintese([])).toEqual({ fichas: [], restantes: 0 });
  });
});
