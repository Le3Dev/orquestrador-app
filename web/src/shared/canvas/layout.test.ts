import {
  interpretarLayout,
  organizarEmGrade,
  posicaoParaNovoTerminal,
  posicoesDosBixinhos,
  TAMANHO_DO_BIXINHO,
} from "./layout";

describe("posicoesDosBixinhos", () => {
  it("centraliza a fileira abaixo do terminal", () => {
    const [unico] = posicoesDosBixinhos(1, 600, 500);

    expect(unico?.x).toBe(300 - TAMANHO_DO_BIXINHO.largura / 2);
    expect(unico?.y).toBeGreaterThan(500);
  });

  it("espalha em leque e quebra em fileiras de cinco", () => {
    const posicoes = posicoesDosBixinhos(7, 600, 500);
    const primeiraFileira = posicoes.slice(0, 5);
    const segundaFileira = posicoes.slice(5);

    expect(new Set(primeiraFileira.map((posicao) => posicao.y)).size).toBe(1);
    expect(segundaFileira.every((posicao) => posicao.y > (primeiraFileira[0]?.y ?? 0))).toBe(true);
    // A fileira de cinco fica centralizada no meio do terminal.
    const centro = ((primeiraFileira[0]?.x ?? 0) + (primeiraFileira[4]?.x ?? 0) + TAMANHO_DO_BIXINHO.largura) / 2;
    expect(centro).toBeCloseTo(300);
  });
});

describe("posicaoParaNovoTerminal", () => {
  const tamanho = { largura: 600, altura: 500 };

  it("centraliza no ponto pedido", () => {
    expect(posicaoParaNovoTerminal({ x: 1000, y: 800 }, tamanho, [])).toEqual({ x: 700, y: 550 });
  });

  it("desloca em cascata quando já há terminal no mesmo lugar", () => {
    const primeiro = posicaoParaNovoTerminal({ x: 1000, y: 800 }, tamanho, []);
    const segundo = posicaoParaNovoTerminal({ x: 1000, y: 800 }, tamanho, [primeiro]);
    const terceiro = posicaoParaNovoTerminal({ x: 1000, y: 800 }, tamanho, [primeiro, segundo]);

    expect(segundo).not.toEqual(primeiro);
    expect(terceiro).not.toEqual(segundo);
    expect(terceiro.x).toBeGreaterThan(segundo.x);
  });
});

describe("organizarEmGrade", () => {
  it("põe os terminais lado a lado, sem sobrepor, quebrando a cada três", () => {
    const terminais = ["a", "b", "c", "d"].map((id) => ({ id, largura: 600, altura: 500 }));
    const posicoes = organizarEmGrade(terminais);

    expect(posicoes.a).toEqual({ x: 0, y: 0 });
    expect(posicoes.b?.x).toBeGreaterThanOrEqual(600);
    expect(posicoes.c?.x).toBeGreaterThan(posicoes.b?.x ?? 0);
    expect(posicoes.d).toEqual({ x: 0, y: expect.any(Number) });
    expect(posicoes.d?.y).toBeGreaterThan(500);
  });
});

describe("interpretarLayout", () => {
  it("lê um layout válido", () => {
    const texto = JSON.stringify({
      terminais: { o1: { x: 10, y: 20, largura: 600, altura: 500 } },
      viewport: { x: 1, y: 2, zoom: 0.8 },
    });

    expect(interpretarLayout(texto)).toEqual({
      terminais: { o1: { x: 10, y: 20, largura: 600, altura: 500 } },
      viewport: { x: 1, y: 2, zoom: 0.8 },
    });
  });

  it.each([null, "", "não é json", "[]", JSON.stringify({ terminais: 5, viewport: { zoom: 0 } })])(
    "não quebra com conteúdo inválido: %s",
    (texto) => {
      expect(interpretarLayout(texto)).toEqual({ terminais: {}, viewport: null });
    },
  );

  it("descarta só os terminais corrompidos", () => {
    const texto = JSON.stringify({ terminais: { bom: { x: 0, y: 0, largura: 1, altura: 1 }, ruim: { x: "a" } } });

    expect(Object.keys(interpretarLayout(texto).terminais)).toEqual(["bom"]);
  });
});
