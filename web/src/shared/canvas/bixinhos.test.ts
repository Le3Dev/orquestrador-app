import { ACESSORIOS, aparenciaDoBixinho, CORES, FORMAS } from "./bixinhos";
import { ACESSORIOS_DESENHADOS, COLUNAS, expressaoPara, LINHAS, linhasDoCorpo, pixelsDoCorpo, ROSTOS } from "./sprites";

describe("aparenciaDoBixinho", () => {
  it("é sempre a mesma para o mesmo subagente", () => {
    expect(aparenciaDoBixinho("a41787646eec07830")).toEqual(aparenciaDoBixinho("a41787646eec07830"));
  });

  it("varia entre subagentes com ids parecidos", () => {
    const ids = Array.from({ length: 40 }, (_, indice) => `a41787646eec0${String(7800 + indice)}`);
    const aparencias = ids.map(aparenciaDoBixinho);

    expect(new Set(aparencias.map((aparencia) => aparencia.nome)).size).toBeGreaterThan(10);
    expect(new Set(aparencias.map((aparencia) => aparencia.forma))).toEqual(new Set(FORMAS));
    expect(new Set(aparencias.map((aparencia) => aparencia.cor))).toEqual(new Set(CORES));
    expect(new Set(aparencias.map((aparencia) => aparencia.acessorio))).toEqual(new Set(ACESSORIOS));
  });
});

describe("sprites", () => {
  it.each(FORMAS)("o corpo %s tem 14 linhas de 16 colunas", (forma) => {
    const linhas = linhasDoCorpo(forma);

    expect(linhas).toHaveLength(LINHAS - 2);
    expect(linhas.every((linha) => linha.length === COLUNAS)).toBe(true);
    expect(pixelsDoCorpo(forma).length).toBeGreaterThan(100);
  });

  it("rostos e acessórios cabem na grade", () => {
    const todos = [
      ...Object.values(ROSTOS).flatMap((rosto) => [...rosto.olhos, ...rosto.brilho, ...rosto.boca, ...rosto.bochechas]),
      ...Object.values(ACESSORIOS_DESENHADOS).flatMap((acessorio) => [...acessorio.escuro, ...acessorio.destaque]),
    ];
    for (const [linha, coluna] of todos) {
      expect(linha).toBeGreaterThanOrEqual(0);
      expect(linha).toBeLessThan(LINHAS);
      expect(coluna).toBeGreaterThanOrEqual(0);
      expect(coluna).toBeLessThan(COLUNAS);
    }
  });

  it("os olhos ficam sobre o corpo em todas as formas", () => {
    for (const forma of FORMAS) {
      const corpo = new Set(pixelsDoCorpo(forma).map(([linha, coluna]) => `${linha},${coluna}`));
      for (const [linha, coluna] of ROSTOS.atento.olhos) {
        expect(corpo.has(`${linha},${coluna}`)).toBe(true);
      }
    }
  });

  it("cada situação tem a sua expressão", () => {
    expect(expressaoPara("executando")).toBe("atento");
    expect(expressaoPara("concluido")).toBe("feliz");
    expect(expressaoPara("cancelado")).toBe("dormindo");
    expect(expressaoPara("falhou")).toBe("tonto");
  });
});
