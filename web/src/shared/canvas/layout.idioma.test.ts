import { definirIdioma } from "../idioma/idioma";
import { opcoesDaEscalaDaLetra } from "./layout";

describe("opcoesDaEscalaDaLetra", () => {
  afterEach(() => definirIdioma("pt-BR"));

  it("em português, os títulos saem em português", () => {
    expect(opcoesDaEscalaDaLetra()).toEqual([
      { valor: 1, titulo: "Normal" },
      { valor: 1.15, titulo: "Grande" },
      { valor: 1.3, titulo: "Maior" },
    ]);
  });

  it("em inglês, os títulos saem em inglês", () => {
    definirIdioma("en");
    expect(opcoesDaEscalaDaLetra()).toEqual([
      { valor: 1, titulo: "Normal" },
      { valor: 1.15, titulo: "Large" },
      { valor: 1.3, titulo: "Larger" },
    ]);
  });
});
