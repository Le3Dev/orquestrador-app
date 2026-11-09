import {
  caixaDoTexto,
  caminhoDaMaoLivre,
  caminhoDaSeta,
  distanciaAoSegmento,
  larguraDoTraco,
  pontosEntre,
  retanguloEntre,
  simplificarPontos,
  tamanhoDoTexto,
  tracoTocado,
} from "./desenho";
import type { TracoDoDesenho } from "./layout";

function traco(alteracoes: Partial<TracoDoDesenho>): TracoDoDesenho {
  return { id: "t", tipo: "caneta", cor: "laranja", espessura: 2, pontos: [{ x: 0, y: 0 }], ...alteracoes };
}

describe("caminhoDaMaoLivre", () => {
  it("sem pontos, caminho vazio; um ponto vira um pingo; dois, uma reta", () => {
    expect(caminhoDaMaoLivre([])).toBe("");
    expect(caminhoDaMaoLivre([{ x: 1, y: 2 }])).toBe("M 1 2 L 1 2");
    expect(
      caminhoDaMaoLivre([
        { x: 0, y: 0 },
        { x: 10, y: 5 },
      ]),
    ).toBe("M 0 0 L 10 5");
  });

  it("com três ou mais, suaviza pelas metades e termina no último ponto", () => {
    expect(
      caminhoDaMaoLivre([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 20, y: 10 },
      ]),
    ).toBe("M 0 0 L 5 0 Q 10 0 10 5 Q 10 10 15 10 L 20 10");
  });

  it("arredonda a uma casa", () => {
    expect(
      caminhoDaMaoLivre([
        { x: 0.04, y: 1.26 },
        { x: 3.333, y: 4.999 },
      ]),
    ).toBe("M 0 1.3 L 3.3 5");
  });
});

describe("caminhoDaSeta", () => {
  it("desenha a haste e as duas abas terminando na ponta", () => {
    const caminho = caminhoDaSeta({ x: 0, y: 0 }, { x: 100, y: 0 }, 3);
    const [haste, abas] = caminho.split(" M ");

    expect(haste).toBe("M 0 0 L 100 0");
    // As abas voltam da ponta (12 de comprimento, o mínimo), uma de cada lado da haste.
    const numeros = (abas ?? "").match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
    expect(numeros).toHaveLength(6);
    const [x1, y1, xPonta, yPonta, x2, y2] = numeros;
    expect([xPonta, yPonta]).toEqual([100, 0]);
    expect(x1).toBeLessThan(100);
    expect(x2).toBeLessThan(100);
    expect(Math.sign(y1 ?? 0)).toBe(-Math.sign(y2 ?? 0));
  });

  it("sem comprimento, só o pingo", () => {
    expect(caminhoDaSeta({ x: 4, y: 4 }, { x: 4, y: 4 }, 2)).toBe("M 4 4 L 4 4");
  });
});

describe("retanguloEntre", () => {
  it("aceita o arraste em qualquer direção", () => {
    expect(retanguloEntre({ x: 50, y: 40 }, { x: 10, y: 100 })).toEqual({ x: 10, y: 40, largura: 40, altura: 60 });
  });
});

describe("simplificarPontos", () => {
  it("tira os pontos alinhados e mantém as pontas", () => {
    const pontos = Array.from({ length: 11 }, (_, indice) => ({ x: indice * 10, y: 0 }));

    expect(simplificarPontos(pontos, 0.5)).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
  });

  it("mantém a quina que se desvia mais que a tolerância", () => {
    const pontos = [
      { x: 0, y: 0 },
      { x: 5, y: 0.1 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];

    expect(simplificarPontos(pontos, 0.5)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
  });

  it("com um ou dois pontos, só arredonda", () => {
    expect(simplificarPontos([{ x: 1.234, y: 5.678 }], 1)).toEqual([{ x: 1.2, y: 5.7 }]);
  });
});

describe("tracoTocado (a borracha)", () => {
  it("toca a mão livre perto da linha e não longe dela", () => {
    const rabisco = traco({
      pontos: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
    });

    expect(tracoTocado(rabisco, { x: 50, y: 5 }, 5)).toBe(true);
    expect(tracoTocado(rabisco, { x: 50, y: 20 }, 5)).toBe(false);
    expect(tracoTocado(rabisco, { x: 110, y: 0 }, 5)).toBe(false);
  });

  it("o marca-texto, mais largo, é tocado de mais longe", () => {
    const pontos = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    const ponto = { x: 50, y: 12 };

    expect(larguraDoTraco({ tipo: "marca-texto", espessura: 6 })).toBe(24);
    expect(tracoTocado(traco({ tipo: "caneta", espessura: 6, pontos }), ponto, 2)).toBe(false);
    expect(tracoTocado(traco({ tipo: "marca-texto", espessura: 6, pontos }), ponto, 2)).toBe(true);
  });

  it("o retângulo só pela borda: o meio dele não apaga", () => {
    const caixa = traco({
      tipo: "retangulo",
      pontos: [
        { x: 0, y: 0 },
        { x: 100, y: 60 },
      ],
    });

    expect(tracoTocado(caixa, { x: 100, y: 30 }, 4)).toBe(true);
    expect(tracoTocado(caixa, { x: 50, y: 60 }, 4)).toBe(true);
    expect(tracoTocado(caixa, { x: 50, y: 30 }, 4)).toBe(false);
  });

  it("a seta também pela ponta", () => {
    const seta = traco({
      tipo: "seta",
      espessura: 3,
      pontos: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
    });

    expect(tracoTocado(seta, { x: 92, y: 4 }, 1)).toBe(true);
    expect(tracoTocado(seta, { x: 50, y: 10 }, 1)).toBe(false);
  });

  it("o texto pela caixa que ele ocupa", () => {
    const solto = traco({ tipo: "texto", espessura: 3, pontos: [{ x: 10, y: 10 }], texto: "Banco" });
    const caixa = caixaDoTexto({ x: 10, y: 10 }, "Banco", 3);

    expect(caixa.altura).toBeGreaterThan(tamanhoDoTexto(3));
    expect(tracoTocado(solto, { x: 20, y: 20 }, 0)).toBe(true);
    expect(tracoTocado(solto, { x: caixa.x + caixa.largura + 10, y: 20 }, 0)).toBe(false);
  });
});

describe("distanciaAoSegmento e pontosEntre", () => {
  it("mede até o ponto mais perto do segmento (ou da ponta)", () => {
    expect(distanciaAoSegmento({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3);
    expect(distanciaAoSegmento({ x: 13, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
    expect(distanciaAoSegmento({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(5);
  });

  it("preenche o caminho da borracha em passos, até o ponto final", () => {
    const pontos = pontosEntre({ x: 0, y: 0 }, { x: 30, y: 0 }, 10);

    expect(pontos).toEqual([
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ]);
    expect(pontosEntre({ x: 1, y: 1 }, { x: 1, y: 1 }, 10)).toEqual([{ x: 1, y: 1 }]);
  });
});
