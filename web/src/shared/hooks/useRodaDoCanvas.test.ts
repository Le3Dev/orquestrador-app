import { renderHook } from "@testing-library/react";
import type { RefObject } from "react";

import { useRodaDoCanvas } from "./useRodaDoCanvas";

const fluxo = vi.hoisted(() => ({
  viewport: { x: 0, y: 0, zoom: 1 },
  getViewport: vi.fn(),
  setViewport: vi.fn(),
}));

vi.mock("@xyflow/react", () => ({
  useReactFlow: () => ({ getViewport: fluxo.getViewport, setViewport: fluxo.setViewport }),
}));

const LIMITES = { minZoom: 0.1, maxZoom: 2 };

/**
 * Monta o canvas falso: a área com o `.react-flow` (deslocado de 100,50 na
 * tela), o viewport e, dentro dele, uma caixa com uma área `nowheel` e um
 * pedaço sem a classe.
 */
function montarCanvas() {
  const area = document.createElement("div");
  area.innerHTML = `
    <div class="react-flow">
      <div class="react-flow__viewport">
        <div class="react-flow__node">
          <div class="titulo">título</div>
          <div class="corpo nowheel"><p class="texto">conversa</p></div>
        </div>
      </div>
    </div>
    <div class="chat nowheel"><p class="texto-do-chat">chat</p></div>`;
  document.body.appendChild(area);
  const quadro = area.querySelector(".react-flow") as HTMLElement;
  quadro.getBoundingClientRect = () => ({ left: 100, top: 50, width: 1000, height: 700 }) as DOMRect;
  const ref: RefObject<HTMLElement | null> = { current: area };
  renderHook(() => useRodaDoCanvas(ref, LIMITES));
  return {
    area,
    corpo: area.querySelector(".corpo") as HTMLElement,
    texto: area.querySelector(".texto") as HTMLElement,
    titulo: area.querySelector(".titulo") as HTMLElement,
    chat: area.querySelector(".texto-do-chat") as HTMLElement,
  };
}

/** Dispara a roda no alvo e diz se ela seguiu adiante (sem preventDefault e sem parar no caminho). */
function rolar(alvo: HTMLElement, opcoes: WheelEventInit): { cancelada: boolean; chegouAoAlvo: boolean } {
  let chegouAoAlvo = false;
  const ouvinte = () => {
    chegouAoAlvo = true;
  };
  alvo.addEventListener("wheel", ouvinte);
  const evento = new WheelEvent("wheel", { bubbles: true, cancelable: true, ...opcoes });
  alvo.dispatchEvent(evento);
  alvo.removeEventListener("wheel", ouvinte);
  return { cancelada: evento.defaultPrevented, chegouAoAlvo };
}

/** Define a rolagem horizontal de um elemento (o jsdom não calcula layout). */
function comRolagemHorizontal(elemento: HTMLElement, { largura, visivel, posicao }: Record<string, number>) {
  elemento.style.overflowX = "auto";
  Object.defineProperty(elemento, "scrollWidth", { configurable: true, value: largura });
  Object.defineProperty(elemento, "clientWidth", { configurable: true, value: visivel });
  Object.defineProperty(elemento, "scrollLeft", { configurable: true, writable: true, value: posicao });
}

/** Define a rolagem vertical de um elemento (o jsdom não calcula layout). */
function comRolagemVertical(elemento: HTMLElement, { altura, visivel, posicao }: Record<string, number>) {
  elemento.style.overflowY = "auto";
  Object.defineProperty(elemento, "scrollHeight", { configurable: true, value: altura });
  Object.defineProperty(elemento, "clientHeight", { configurable: true, value: visivel });
  Object.defineProperty(elemento, "scrollTop", { configurable: true, writable: true, value: posicao });
}

/** Mais que a pausa que separa dois gestos no hook. */
const DEPOIS_DA_PAUSA_MS = 250;

describe("useRodaDoCanvas", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fluxo.viewport = { x: 0, y: 0, zoom: 1 };
    fluxo.getViewport.mockImplementation(() => fluxo.viewport);
    fluxo.setViewport.mockReset();
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("pinça (ctrlKey) sobre uma área nowheel dá zoom no canvas centrado no ponteiro", () => {
    const { texto } = montarCanvas();
    fluxo.viewport = { x: 40, y: 20, zoom: 1 };

    // No Mac: 2^(50 * 0,002 * 10) = 2.
    const resultado = rolar(texto, { ctrlKey: true, deltaY: -50, clientX: 300, clientY: 250 });

    expect(resultado).toEqual({ cancelada: true, chegouAoAlvo: false });
    // Ponteiro em (200, 200) dentro do canvas: o ponto do fluxo sob ele fica parado.
    const [novo] = fluxo.setViewport.mock.calls[0] as [{ x: number; y: number; zoom: number }];
    expect(novo.zoom).toBeCloseTo(2);
    expect(novo.x).toBeCloseTo(200 - (200 - 40) * 2);
    expect(novo.y).toBeCloseTo(200 - (200 - 20) * 2);
  });

  it("o zoom respeita os limites do canvas", () => {
    const { texto } = montarCanvas();
    fluxo.viewport = { x: 0, y: 0, zoom: 1.5 };

    rolar(texto, { ctrlKey: true, deltaY: -500, clientX: 100, clientY: 50 });
    expect(fluxo.setViewport).toHaveBeenLastCalledWith({ x: 0, y: 0, zoom: 2 });

    fluxo.viewport = { x: 0, y: 0, zoom: 0.2 };
    rolar(texto, { ctrlKey: true, deltaY: 500, clientX: 100, clientY: 50 });
    expect(fluxo.setViewport).toHaveBeenLastCalledWith({ x: 0, y: 0, zoom: 0.1 });

    // Já no limite: não chama, mas ainda impede o zoom da página.
    fluxo.setViewport.mockReset();
    fluxo.viewport = { x: 0, y: 0, zoom: 0.1 };
    expect(rolar(texto, { ctrlKey: true, deltaY: 500 }).cancelada).toBe(true);
    expect(fluxo.setViewport).not.toHaveBeenCalled();
  });

  it("fora do Mac, Ctrl+roda dá zoom na velocidade do React Flow (sem o fator da pinça)", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    const { texto } = montarCanvas();

    rolar(texto, { ctrlKey: true, deltaY: -100, clientX: 100, clientY: 50 });

    expect(fluxo.setViewport).toHaveBeenCalledWith({ x: 0, y: 0, zoom: Math.pow(2, 0.2) });
  });

  it("a roda vertical com conteúdo para rolar segue para a caixa", () => {
    const { corpo, texto } = montarCanvas();
    comRolagemVertical(corpo, { altura: 900, visivel: 300, posicao: 100 });

    // Diagonal com o vertical dominante: o eixo dominante é da caixa.
    expect(rolar(texto, { deltaY: 80, deltaX: 10 })).toEqual({ cancelada: false, chegouAoAlvo: true });
    vi.advanceTimersByTime(DEPOIS_DA_PAUSA_MS);
    expect(rolar(texto, { deltaY: -80 })).toEqual({ cancelada: false, chegouAoAlvo: true });
    expect(fluxo.setViewport).not.toHaveBeenCalled();
  });

  it("um textarea com texto para rolar fica com a roda vertical", () => {
    const { corpo } = montarCanvas();
    const campo = document.createElement("textarea");
    corpo.appendChild(campo);
    Object.defineProperty(campo, "scrollHeight", { configurable: true, value: 400 });
    Object.defineProperty(campo, "clientHeight", { configurable: true, value: 100 });
    Object.defineProperty(campo, "scrollTop", { configurable: true, writable: true, value: 0 });

    expect(rolar(campo, { deltaY: 40 }).cancelada).toBe(false);
    // Para cima o campo já está no topo: o canvas anda.
    vi.advanceTimersByTime(DEPOIS_DA_PAUSA_MS);
    expect(rolar(campo, { deltaY: -40 }).cancelada).toBe(true);
    expect(fluxo.setViewport).toHaveBeenCalledWith({ x: 0, y: 20, zoom: 1 });
  });

  it("a roda vertical sem nada para rolar move o canvas", () => {
    const { texto } = montarCanvas();
    fluxo.viewport = { x: 10, y: 30, zoom: 0.8 };

    expect(rolar(texto, { deltaY: 80 })).toEqual({ cancelada: true, chegouAoAlvo: false });
    expect(fluxo.setViewport).toHaveBeenLastCalledWith({ x: 10, y: 30 - 40, zoom: 0.8 });

    // Em linhas (deltaMode 1), normaliza como o React Flow: 3 linhas = 60 px.
    rolar(texto, { deltaY: 3, deltaMode: 1 });
    expect(fluxo.setViewport).toHaveBeenLastCalledWith({ x: 10, y: 30 - 30, zoom: 0.8 });
  });

  it("um deslize diagonal que a caixa não rola move o canvas nos dois eixos", () => {
    const { texto } = montarCanvas();
    fluxo.viewport = { x: 10, y: 30, zoom: 0.8 };

    expect(rolar(texto, { deltaX: 60, deltaY: 20 })).toEqual({ cancelada: true, chegouAoAlvo: false });
    expect(fluxo.setViewport).toHaveBeenCalledWith({ x: 10 - 30, y: 30 - 10, zoom: 0.8 });
  });

  it("um deslize horizontal com rolagem possível fica com a caixa; no limite, vai para o canvas", () => {
    const { corpo, texto } = montarCanvas();
    comRolagemHorizontal(corpo, { largura: 900, visivel: 300, posicao: 100 });

    expect(rolar(texto, { deltaX: 40 })).toEqual({ cancelada: false, chegouAoAlvo: true });
    vi.advanceTimersByTime(DEPOIS_DA_PAUSA_MS);
    expect(rolar(texto, { deltaX: -40 })).toEqual({ cancelada: false, chegouAoAlvo: true });
    expect(fluxo.setViewport).not.toHaveBeenCalled();

    // Encostado na direita: para a direita não rola mais, para a esquerda ainda rola.
    corpo.scrollLeft = 600;
    vi.advanceTimersByTime(DEPOIS_DA_PAUSA_MS);
    expect(rolar(texto, { deltaX: 40 }).cancelada).toBe(true);
    expect(fluxo.setViewport).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(DEPOIS_DA_PAUSA_MS);
    expect(rolar(texto, { deltaX: -40 }).cancelada).toBe(false);
  });

  it("um gesto que começou rolando a caixa não vaza para o canvas ao chegar no fim", () => {
    const { corpo, texto } = montarCanvas();
    comRolagemVertical(corpo, { altura: 900, visivel: 300, posicao: 500 });

    expect(rolar(texto, { deltaY: 80 }).cancelada).toBe(false);
    // A caixa chega ao fim, mas o deslize (com a inércia) segue sem pausa.
    corpo.scrollTop = 600;
    for (let passo = 0; passo < 5; passo++) {
      vi.advanceTimersByTime(100);
      expect(rolar(texto, { deltaY: 80 })).toEqual({ cancelada: false, chegouAoAlvo: true });
    }
    expect(fluxo.setViewport).not.toHaveBeenCalled();

    // Depois da pausa, um novo gesto no fim da caixa move o canvas.
    vi.advanceTimersByTime(DEPOIS_DA_PAUSA_MS);
    expect(rolar(texto, { deltaY: 80 }).cancelada).toBe(true);
    expect(fluxo.setViewport).toHaveBeenCalledWith({ x: 0, y: -40, zoom: 1 });
  });

  it("um gesto que começou movendo o canvas continua no canvas por cima de uma caixa rolável", () => {
    const { corpo, texto, titulo } = montarCanvas();
    comRolagemVertical(corpo, { altura: 900, visivel: 300, posicao: 100 });

    // Começa fora da área nowheel: quem move é o React Flow.
    expect(rolar(titulo, { deltaY: 80 })).toEqual({ cancelada: false, chegouAoAlvo: true });
    vi.advanceTimersByTime(50);
    // O canvas anda e a conversa fica sob o ponteiro: o gesto segue movendo o canvas.
    expect(rolar(texto, { deltaY: 80 }).cancelada).toBe(true);
    expect(fluxo.setViewport).toHaveBeenLastCalledWith({ x: 0, y: -40, zoom: 1 });

    // O mesmo se o gesto começou na caixa sem nada para rolar e o conteúdo cresceu.
    vi.advanceTimersByTime(DEPOIS_DA_PAUSA_MS);
    comRolagemVertical(corpo, { altura: 300, visivel: 300, posicao: 0 });
    expect(rolar(texto, { deltaY: 80 }).cancelada).toBe(true);
    comRolagemVertical(corpo, { altura: 900, visivel: 300, posicao: 0 });
    vi.advanceTimersByTime(100);
    expect(rolar(texto, { deltaY: 80 }).cancelada).toBe(true);
    expect(fluxo.setViewport).toHaveBeenCalledTimes(3);

    // Depois da pausa, a caixa rolável volta a ficar com a roda.
    vi.advanceTimersByTime(DEPOIS_DA_PAUSA_MS);
    expect(rolar(texto, { deltaY: 80 }).cancelada).toBe(false);
  });

  it("fora do Mac, Shift+roda é deslize horizontal e segue a mesma regra", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    const { texto } = montarCanvas();

    expect(rolar(texto, { shiftKey: true, deltaY: 100 }).cancelada).toBe(true);
    expect(fluxo.setViewport).toHaveBeenCalledWith({ x: -50, y: 0, zoom: 1 });
  });

  it("fora de uma área nowheel, ou fora das caixas, deixa a roda para o React Flow", () => {
    const { titulo, chat } = montarCanvas();

    expect(rolar(titulo, { ctrlKey: true, deltaY: -50 })).toEqual({ cancelada: false, chegouAoAlvo: true });
    expect(rolar(titulo, { deltaX: 60 })).toEqual({ cancelada: false, chegouAoAlvo: true });
    // O chat rápido é nowheel, mas fica fora do viewport do canvas.
    expect(rolar(chat, { ctrlKey: true, deltaY: -50 })).toEqual({ cancelada: false, chegouAoAlvo: true });
    expect(rolar(chat, { deltaX: 60 })).toEqual({ cancelada: false, chegouAoAlvo: true });
    expect(fluxo.setViewport).not.toHaveBeenCalled();
  });
});
