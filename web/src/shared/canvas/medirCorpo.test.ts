import { acompanharCorpo, INTERVALO_DA_COBERTURA_MS, type LojaDoCanvas, type MedidaDoCorpo, QUADROS_DE_FOLGA } from "./medirCorpo";

/** Uma loja do React Flow de mentira: `mudar` troca o estado e avisa quem assina. */
function criarLoja() {
  let estado = { transform: [0, 0, 1] as unknown, nodes: [] as unknown, width: 1000, height: 800 };
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
  function comecar() {
    const { loja, mudar, ouvintes } = criarLoja();
    const medidas: (MedidaDoCorpo | null)[] = [];
    const parar = acompanharCorpo(corpo, loja, (medida) => medidas.push(medida));
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
});
