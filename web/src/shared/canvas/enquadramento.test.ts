import { type CaixaParaEnquadrar, escolherEnquadramento, ZOOM_MINIMO_DO_ENQUADRAMENTO } from "./enquadramento";

function caixa(id: string, x: number, y: number, extras: Partial<CaixaParaEnquadrar> = {}): CaixaParaEnquadrar {
  return { id, retangulo: { x, y, width: 600, height: 500 }, selecionada: false, ...extras };
}

// Uma tela de notebook: 1280 x 720 de área do canvas.
const TELA = { largura: 1280, altura: 720 };
const FOLGA = 0.12;

describe("escolherEnquadramento", () => {
  it("o piso é 0,6", () => {
    expect(ZOOM_MINIMO_DO_ENQUADRAMENTO).toBe(0.6);
  });

  it("enquadra tudo quando tudo cabe com zoom de pelo menos 0,6", () => {
    // 1300 x 500 numa tela 1280 x 720 cabe com zoom ~0,87.
    const caixas = [caixa("a", 0, 0), caixa("b", 700, 0)];

    expect(escolherEnquadramento({ caixas, tela: TELA, centro: { x: 0, y: 0 }, folga: FOLGA })).toEqual({ tipo: "tudo" });
  });

  it("sem caber, enquadra a caixa selecionada", () => {
    const caixas = [caixa("a", 0, 0), caixa("b", 700, 0), caixa("c", 1400, 0, { selecionada: true }), caixa("d", 2100, 0)];

    expect(escolherEnquadramento({ caixas, tela: TELA, centro: { x: 0, y: 0 }, folga: FOLGA })).toEqual({
      tipo: "caixa",
      id: "c",
    });
  });

  it("com várias selecionadas, fica com a mais perto do centro da tela", () => {
    const caixas = [
      caixa("a", 0, 0, { selecionada: true }),
      caixa("b", 700, 0),
      caixa("c", 1400, 0),
      caixa("d", 2100, 0, { selecionada: true }),
    ];

    expect(escolherEnquadramento({ caixas, tela: TELA, centro: { x: 2300, y: 200 }, folga: FOLGA })).toEqual({
      tipo: "caixa",
      id: "d",
    });
  });

  it("sem seleção, enquadra a janela mais perto do centro da tela atual, sem escolher um bixinho", () => {
    const caixas = [
      caixa("a", 0, 0),
      caixa("b", 700, 0),
      caixa("c", 1400, 0),
      caixa("d", 2100, 0),
      { id: "bixinho", retangulo: { x: 1700, y: 220, width: 60, height: 60 }, selecionada: false, acessoria: true },
    ];

    expect(escolherEnquadramento({ caixas, tela: TELA, centro: { x: 1720, y: 250 }, folga: FOLGA })).toEqual({
      tipo: "caixa",
      id: "c",
    });
  });

  it("um bixinho selecionado vira o foco", () => {
    const caixas = [
      caixa("a", 0, 0),
      caixa("b", 3000, 0),
      { id: "bixinho", retangulo: { x: 3000, y: 600, width: 60, height: 60 }, selecionada: true, acessoria: true },
    ];

    expect(escolherEnquadramento({ caixas, tela: TELA, centro: { x: 0, y: 0 }, folga: FOLGA })).toEqual({
      tipo: "caixa",
      id: "bixinho",
    });
  });

  it("sem caixas ou sem o tamanho da tela, fica no enquadrar tudo de sempre", () => {
    expect(escolherEnquadramento({ caixas: [], tela: TELA, centro: { x: 0, y: 0 }, folga: FOLGA })).toEqual({ tipo: "tudo" });
    expect(
      escolherEnquadramento({
        caixas: [caixa("a", 0, 0), caixa("b", 9000, 0)],
        tela: { largura: 0, altura: 0 },
        centro: { x: 0, y: 0 },
        folga: FOLGA,
      }),
    ).toEqual({ tipo: "tudo" });
  });
});
