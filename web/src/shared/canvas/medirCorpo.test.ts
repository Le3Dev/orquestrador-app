import { LADO_MINIMO_DA_VISTA_PX } from "../previaNativa";
import {
  acompanharCorpo,
  INTERVALO_DA_COBERTURA_MS,
  type LojaDoCanvas,
  type MedidaDoCorpo,
  medirCorpo,
  type OpcoesDoAcompanhamento,
  QUADROS_DE_FOLGA,
} from "./medirCorpo";

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

/** Uma loja do React Flow de mentira: `mudar` troca o estado e avisa quem assina. */
function criarLoja() {
  let estado = { transform: [0, 0, 1] as readonly number[], nodes: [] as unknown, width: 1000, height: 800 };
  const ouvintes = new Set<() => void>();
  const loja: LojaDoCanvas = {
    getState: () => estado,
    subscribe: (ouvinte) => {
      ouvintes.add(ouvinte);
      return () => ouvintes.delete(ouvinte);
    },
  };
  const mudar = (alteracoes: Partial<typeof estado>) => {
    estado = { ...estado, ...alteracoes };
    for (const ouvinte of ouvintes) {
      ouvinte();
    }
  };
  return { loja, mudar, ouvintes };
}

describe("acompanharCorpo", () => {
  let pendentes: Map<number, FrameRequestCallback>;
  let proximoQuadro: number;
  let corpo: HTMLDivElement;
  let retangulo: { left: number; top: number; width: number; height: number };
  let consulta: ReturnType<typeof vi.fn>;
  let larguraDoLayout: PropertyDescriptor | undefined;

  /** Roda os quadros pedidos até agora (os pedidos dentro deles ficam para o próximo). */
  function rodarQuadro(): number {
    const agora = [...pendentes.values()];
    pendentes.clear();
    for (const callback of agora) {
      callback(performance.now());
    }
    return agora.length;
  }

  function rodarQuadros(quantos: number): void {
    for (let i = 0; i < quantos; i += 1) {
      rodarQuadro();
    }
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] });
    pendentes = new Map();
    proximoQuadro = 1;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = proximoQuadro++;
      pendentes.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => pendentes.delete(id));

    const area = document.createElement("div");
    area.className = "react-flow";
    corpo = document.createElement("div");
    area.append(corpo);
    document.body.append(area);
    retangulo = { left: 100, top: 200, width: 360, height: 240 };
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const r = this === corpo ? retangulo : { left: 0, top: 0, width: 1000, height: 800 };
      return { ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top } as DOMRect;
    });
    larguraDoLayout = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 720 });
    consulta = vi.fn(() => corpo);
    document.elementFromPoint = consulta as unknown as typeof document.elementFromPoint;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (larguraDoLayout) {
      Object.defineProperty(HTMLElement.prototype, "offsetWidth", larguraDoLayout);
    } else {
      delete (HTMLElement.prototype as { offsetWidth?: number }).offsetWidth;
    }
    delete (document as { elementFromPoint?: unknown }).elementFromPoint;
    document.body.innerHTML = "";
  });

  /** Começa a acompanhar e deixa o primeiro gesto (a medida inicial) assentar. */
  function comecar(opcoes?: OpcoesDoAcompanhamento) {
    const { loja, mudar, ouvintes } = criarLoja();
    const medidas: (MedidaDoCorpo | null)[] = [];
    const parar = acompanharCorpo(corpo, loja, (medida) => medidas.push(medida), opcoes);
    rodarQuadros(QUADROS_DE_FOLGA + 2);
    return { mudar, medidas, parar, ouvintes };
  }

  it("mede logo no primeiro quadro, com a cobertura, e em repouso para de pedir quadros", () => {
    const { medidas } = comecar();

    expect(medidas[0]).toEqual({ retangulo: { x: 100, y: 200, largura: 360, altura: 240, zoom: 0.5 }, coberta: false });
    expect(pendentes.size).toBe(0);

    // Um segundo inteiro parado: nenhum quadro pedido, só as conferências lentas.
    const antes = medidas.length;
    vi.advanceTimersByTime(1000);
    expect(pendentes.size).toBe(0);
    expect(medidas.length - antes).toBe(Math.floor(1000 / INTERVALO_DA_COBERTURA_MS));
  });

  it("em repouso a cobertura só é conferida no intervalo, não por quadro", () => {
    comecar();
    consulta.mockClear();

    vi.advanceTimersByTime(INTERVALO_DA_COBERTURA_MS - 1);
    expect(consulta).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(consulta).toHaveBeenCalledTimes(9);
  });

  it("um menu aberto por cima em repouso é pego na conferência seguinte", () => {
    const { medidas } = comecar();
    const menu = document.createElement("div");
    document.body.append(menu);
    consulta.mockImplementation(() => menu);

    vi.advanceTimersByTime(INTERVALO_DA_COBERTURA_MS);

    expect(medidas.at(-1)?.coberta).toBe(true);
  });

  it("um clique ou tecla confere a cobertura já no quadro seguinte (o menu que ele abriu)", () => {
    const { medidas } = comecar();
    const menu = document.createElement("div");
    document.body.append(menu);
    consulta.mockImplementation(() => menu);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k" }));
    rodarQuadro();

    expect(medidas.at(-1)?.coberta).toBe(true);
  });

  it("o pan mede a cada quadro enquanto a câmera muda e para alguns quadros depois", () => {
    const { mudar, medidas } = comecar();
    const antes = medidas.length;

    for (let i = 1; i <= 10; i += 1) {
      retangulo = { ...retangulo, left: 100 + i * 5 };
      mudar({ transform: [i * 5, 0, 1] });
      expect(rodarQuadro()).toBe(1);
    }
    expect(medidas.length - antes).toBe(10);
    expect(medidas.at(-1)?.retangulo.x).toBe(150);

    // Soltou: alguns quadros de folga, a última medida com a cobertura, e nada mais.
    consulta.mockClear();
    let quadros = 0;
    while (rodarQuadro() > 0) {
      quadros += 1;
    }
    expect(quadros).toBe(QUADROS_DE_FOLGA);
    expect(consulta).toHaveBeenCalledTimes(9);
    expect(pendentes.size).toBe(0);
  });

  it("arrastar ou redimensionar nós e mudar o tamanho do canvas também acompanham; o resto da loja não", () => {
    const { mudar } = comecar();

    mudar({ nodes: [] });
    expect(pendentes.size).toBe(1);
    rodarQuadros(QUADROS_DE_FOLGA + 1);

    mudar({ width: 900 });
    expect(pendentes.size).toBe(1);
    rodarQuadros(QUADROS_DE_FOLGA + 1);

    // Mudança da loja sem câmera, nós nem tamanho (seleção, conexão): nenhum quadro.
    mudar({});
    expect(pendentes.size).toBe(0);
  });

  it("o retângulo mudado em repouso (layout que não avisa) é pego na conferência e acompanhado até parar", () => {
    const { medidas } = comecar();

    retangulo = { ...retangulo, top: 260 };
    vi.advanceTimersByTime(INTERVALO_DA_COBERTURA_MS);

    expect(medidas.at(-1)?.retangulo.y).toBe(260);
    expect(pendentes.size).toBe(1);
    rodarQuadros(QUADROS_DE_FOLGA + 1);
    expect(pendentes.size).toBe(0);
  });

  it("com a janela oculta, a conferência lenta não mede nada", () => {
    const { medidas } = comecar();
    const oculto = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    const antes = medidas.length;

    vi.advanceTimersByTime(INTERVALO_DA_COBERTURA_MS * 4);
    expect(medidas.length).toBe(antes);

    // Voltou a aparecer: mede de novo no quadro seguinte.
    oculto.mockReturnValue(false);
    document.dispatchEvent(new Event("visibilitychange"));
    rodarQuadro();
    expect(medidas.length).toBe(antes + 1);
  });

  it("parar cancela o quadro pedido, o intervalo e a assinatura da loja", () => {
    const { mudar, medidas, parar, ouvintes } = comecar();
    mudar({ transform: [1, 0, 1] });

    parar();
    const antes = medidas.length;
    rodarQuadro();
    vi.advanceTimersByTime(INTERVALO_DA_COBERTURA_MS * 4);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k" }));

    expect(medidas.length).toBe(antes);
    expect(ouvintes.size).toBe(0);
    expect(pendentes.size).toBe(0);
  });

  describe("opções do navegador do agente", () => {
    it("aoMexerACamera sai na hora, dentro do aviso da loja, e só quando a câmera muda de fato", () => {
      const aoMexerACamera = vi.fn();
      const { mudar } = comecar({ aoMexerACamera });

      mudar({ transform: [10, 0, 1] });
      // Antes de qualquer quadro: o chamador desce a vista nativa a tempo de o quadro seguinte sair sem ela.
      expect(aoMexerACamera).toHaveBeenCalledTimes(1);
      expect(pendentes.size).toBe(1);

      // Outro array com os mesmos valores, nós e tamanho do canvas: não é a câmera.
      mudar({ transform: [10, 0, 1] });
      mudar({ nodes: [] });
      mudar({ width: 900 });
      expect(aoMexerACamera).toHaveBeenCalledTimes(1);

      // Zoom conta.
      mudar({ transform: [10, 0, 2] });
      expect(aoMexerACamera).toHaveBeenCalledTimes(2);
    });

    it("aoMexerACamera usa a mesma escuta da loja: uma assinatura só, desfeita ao parar", () => {
      const { parar, ouvintes } = comecar({ aoMexerACamera: vi.fn() });
      expect(ouvintes.size).toBe(1);

      parar();

      expect(ouvintes.size).toBe(0);
    });

    it("semCorte: o retângulo vai inteiro (x negativo) e os pontos de amostra ficam só na parte visível", () => {
      retangulo = { left: -100, top: 200, width: 360, height: 240 };
      const { medidas } = comecar({ semCorte: true });

      expect(medidas[0]).toEqual({ retangulo: { x: -100, y: 200, largura: 360, altura: 240, zoom: 0.5 }, coberta: false });
      expect(consulta).toHaveBeenCalled();
      for (const [x] of consulta.mock.calls as [number, number][]) {
        // O corpo vai de x = -100 a 260; o canvas começa em 0.
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(260);
      }
    });

    it("semCorte: passar de uma borda do canvas que não é a da janela é cobertura; sem a opção, a Prévia corta e segue", () => {
      // O canvas do teste vai até x = 1000 e a janela do jsdom até 1024: o corpo passa da direita do canvas.
      retangulo = { left: 800, top: 200, width: 360, height: 240 };

      const inteiro = comecar({ semCorte: true });
      expect(inteiro.medidas[0]).toEqual({
        retangulo: { x: 800, y: 200, largura: 360, altura: 240, zoom: 0.5 },
        coberta: true,
      });
      inteiro.parar();

      const cortado = comecar();
      expect(cortado.medidas[0]).toEqual({
        retangulo: { x: 800, y: 200, largura: 200, altura: 240, zoom: 0.5 },
        coberta: false,
      });
    });
  });
});
