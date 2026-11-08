"use strict";

// O vitest não pode ser carregado por require(); o resto segue em CommonJS.
import { describe, expect, it } from "vitest";

const { proximaVersao } = require("./proximaVersao.cjs");

describe("proximaVersao", () => {
  it("sem tags usa a version do package.json", () => {
    expect(proximaVersao("0.2.2", [])).toBe("0.2.2");
  });

  it("incrementa o patch da maior tag", () => {
    expect(proximaVersao("0.2.2", ["v0.2.0", "v0.2.1", "v0.2.2"])).toBe("0.2.3");
  });

  it("compara numericamente", () => {
    expect(proximaVersao("0.2.0", ["v0.2.9", "v0.2.10"])).toBe("0.2.11");
  });

  it("salto manual: package maior que a tag", () => {
    expect(proximaVersao("0.3.0", ["v0.2.5"])).toBe("0.3.0");
  });

  it("package menor que a tag segue a tag", () => {
    expect(proximaVersao("0.1.0", ["v0.2.5"])).toBe("0.2.6");
  });

  it("ignora tags fora do padrão", () => {
    expect(proximaVersao("0.2.2", ["v1.0.0-beta", "foo", "1.2.3", "v0.2.2"])).toBe("0.2.3");
  });

  it("version inválida lança erro", () => {
    expect(() => proximaVersao("abc", [])).toThrow(/inválida/);
    expect(() => proximaVersao("1.0.0-beta", [])).toThrow(/inválida/);
  });
});
