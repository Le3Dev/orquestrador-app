import { LADO_MINIMO_DA_VISTA_PX } from "../previaNativa";
import { medirCorpo } from "./medirCorpo";

interface Caixa {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** O jsdom não calcula layout: o elemento devolve a caixa e a largura de layout combinadas. */
function elementoCom(caixa: Caixa, larguraDoLayout = caixa.width, classe?: string): HTMLDivElement {
  const elemento = document.createElement("div");
  if (classe !== undefined) {
    elemento.className = classe;
  }
  Object.defineProperty(elemento, "getBoundingClientRect", {
    value: () => ({ ...caixa, right: caixa.left + caixa.width, bottom: caixa.top + caixa.height, x: caixa.left, y: caixa.top }),
  });
  Object.defineProperty(elemento, "offsetWidth", { value: larguraDoLayout });
  return elemento;
}

describe("medirCorpo", () => {
  // O canvas ocupa a janela toda, menos um cabeçalho de 40 px no alto.
  const canvas = { left: 0, top: 40, width: window.innerWidth, height: window.innerHeight - 40 };
  let tela: HTMLDivElement;

  /** Monta o corpo dentro de um `.react-flow` com a área do canvas. */
  function montar(corpo: Caixa, larguraDoLayout = corpo.width, area: Caixa = canvas): HTMLDivElement {
    tela = elementoCom(area, area.width, "react-flow");
    const elemento = elementoCom(corpo, larguraDoLayout);
    tela.append(elemento);
    document.body.append(tela);
    return elemento;
  }

  afterEach(() => {
    tela?.remove();
    delete (document as { elementFromPoint?: unknown }).elementFromPoint;
  });

  describe("como a Prévia usa (sem a opção semCorte)", () => {
    it("o retângulo é cortado pela área do canvas, e o zoom vem do corpo inteiro", () => {
      const corpo = montar({ left: -100, top: 20, width: 350, height: 400 }, 700);

      const medida = medirCorpo(corpo, { conferirCobertura: false });

      expect(medida?.retangulo).toEqual({ x: 0, y: 40, largura: 250, altura: 380, zoom: 0.5 });
      expect(medida?.coberta).toBe(false);
    });

    it("passar da borda do cabeçalho não é cobertura: a Prévia corta e segue", () => {
      document.elementFromPoint = vi.fn(() => corpo);
      const corpo = montar({ left: 100, top: 0, width: 700, height: 400 });

      expect(medirCorpo(corpo)?.coberta).toBe(false);
    });

    it("sobrando menos que o lado mínimo, é nulo", () => {
      const corpo = montar({ left: window.innerWidth - (LADO_MINIMO_DA_VISTA_PX - 1), top: 100, width: 700, height: 400 });

      expect(medirCorpo(corpo)).toBeNull();
    });
  });

  describe("sem corte (o navegador do agente)", () => {
    it("o retângulo é o corpo inteiro, mesmo saindo da tela: x negativo e caixa além da borda da janela", () => {
      const corpo = montar({ left: -100, top: 500, width: 700, height: 600 }, 1400);

      const medida = medirCorpo(corpo, { semCorte: true, conferirCobertura: false });

      expect(medida?.retangulo).toEqual({ x: -100, y: 500, largura: 700, altura: 600, zoom: 0.5 });
      // O canvas encosta na janela na esquerda e embaixo: nada fora do canvas seria coberto.
      expect(medida?.coberta).toBe(false);
    });

    it("sem a área do canvas (nenhum .react-flow acima), a área é a janela", () => {
      const solto = elementoCom({ left: -50, top: -20, width: 400, height: 300 });
      document.body.append(solto);

      const medida = medirCorpo(solto, { semCorte: true, conferirCobertura: false });
      solto.remove();

      expect(medida?.retangulo).toEqual({ x: -50, y: -20, largura: 400, altura: 300, zoom: 1 });
      expect(medida?.coberta).toBe(false);
    });

    it("nulo quando a parte visível tem menos que o lado mínimo, mesmo com o corpo inteiro enorme", () => {
      const quaseFora = montar({ left: window.innerWidth - (LADO_MINIMO_DA_VISTA_PX - 1), top: 100, width: 700, height: 400 });
      expect(medirCorpo(quaseFora, { semCorte: true })).toBeNull();
      tela.remove();

      const naBorda = montar({ left: window.innerWidth - LADO_MINIMO_DA_VISTA_PX, top: 100, width: 700, height: 400 });
      expect(medirCorpo(naBorda, { semCorte: true, conferirCobertura: false })).not.toBeNull();
    });

    it("os pontos de amostra ficam só na parte visível, não no corpo inteiro", () => {
      const consulta = vi.fn<(x: number, y: number) => Element | null>();
      document.elementFromPoint = consulta;
      const corpo = montar({ left: -300, top: 100, width: 700, height: 400 });
      consulta.mockReturnValue(corpo);

      const medida = medirCorpo(corpo, { semCorte: true });

      expect(medida?.coberta).toBe(false);
      expect(consulta).toHaveBeenCalledTimes(9);
      for (const [x, y] of consulta.mock.calls) {
        // A parte visível vai de x = 0 a 400 (o corpo vai de -300 a 400) e de y = 100 a 500.
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(400);
        expect(y).toBeGreaterThanOrEqual(100);
        expect(y).toBeLessThanOrEqual(500);
      }
      // O retângulo que vai para o app continua inteiro.
      expect(medida?.retangulo).toMatchObject({ x: -300, largura: 700 });
    });

    it("algo por cima da parte visível (painel, menu) é cobertura; o próprio corpo e o que há dentro dele, não", () => {
      const painel = document.createElement("div");
      document.body.append(painel);
      const corpo = montar({ left: 100, top: 100, width: 700, height: 400 });
      const filho = document.createElement("span");
      corpo.append(filho);

      document.elementFromPoint = vi.fn(() => painel);
      expect(medirCorpo(corpo, { semCorte: true })?.coberta).toBe(true);
      document.elementFromPoint = vi.fn(() => null);
      expect(medirCorpo(corpo, { semCorte: true })?.coberta).toBe(true);
      document.elementFromPoint = vi.fn(() => filho);
      expect(medirCorpo(corpo, { semCorte: true })?.coberta).toBe(false);
      painel.remove();
    });

    it("passar de uma borda do canvas que não é a da janela (o cabeçalho) é cobertura, sem teste de acerto", () => {
      const consulta = vi.fn(() => null);
      document.elementFromPoint = consulta;
      const corpo = montar({ left: 100, top: 10, width: 700, height: 400 });

      const medida = medirCorpo(corpo, { semCorte: true, conferirCobertura: false });

      expect(medida?.coberta).toBe(true);
      expect(medida?.retangulo).toMatchObject({ y: 10, altura: 400 });
      expect(consulta).not.toHaveBeenCalled();
    });

    it("com um painel lateral, passar da borda esquerda do canvas é cobertura; a da janela, não", () => {
      const comPainel = { left: 260, top: 0, width: window.innerWidth - 260, height: window.innerHeight };
      const sobOPainel = montar({ left: 200, top: 100, width: 400, height: 300 }, 400, comPainel);
      expect(medirCorpo(sobOPainel, { semCorte: true, conferirCobertura: false })?.coberta).toBe(true);
      tela.remove();

      const naJanela = montar({ left: 300, top: 100, width: window.innerWidth, height: 300 }, window.innerWidth, comPainel);
      // Passa da direita do canvas, que é a da janela.
      expect(medirCorpo(naJanela, { semCorte: true, conferirCobertura: false })?.coberta).toBe(false);
    });

    it("sem conferir a cobertura, não há teste de acerto na tela", () => {
      const consulta = vi.fn(() => null);
      document.elementFromPoint = consulta;
      const corpo = montar({ left: 100, top: 100, width: 700, height: 400 });

      expect(medirCorpo(corpo, { semCorte: true, conferirCobertura: false })?.coberta).toBe(false);
      expect(consulta).not.toHaveBeenCalled();
    });
  });
});
