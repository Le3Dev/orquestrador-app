import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useState } from "react";

import { lerLayout, salvarDesenho, type TracoDoDesenho } from "../../shared/canvas/layout";
import { CamadaDeDesenho } from "./CamadaDeDesenho";

/** O canvas no que importa aqui: o botão "Desenhar" dos controles e a camada. */
function CanvasDeTeste({ tracosIniciais }: { tracosIniciais?: TracoDoDesenho[] }) {
  const [aberta, setAberta] = useState(false);
  return (
    <ReactFlowProvider>
      <button type="button" aria-pressed={aberta} onClick={() => setAberta((atual) => !atual)}>
        Desenhar
      </button>
      <CamadaDeDesenho aberta={aberta} aoFechar={() => setAberta(false)} tracosIniciais={tracosIniciais} />
    </ReactFlowProvider>
  );
}

function barra(): HTMLElement {
  return screen.getByRole("toolbar", { name: "Desenho" });
}

function ferramenta(nome: string): HTMLElement {
  return within(barra()).getByRole("button", { name: nome });
}

function camada(): HTMLElement {
  return screen.getByTestId("camada-de-desenho");
}

function areaDeDesenho(): SVGSVGElement {
  const svg = camada().querySelector("svg");
  if (svg === null) {
    throw new Error("sem o svg da camada");
  }
  return svg;
}

/** Arrasta o ponteiro pelos pontos dados (sem domNode, a posição na tela é a do canvas). */
function arrastar(pontos: readonly [number, number][]) {
  const [primeiro, ...resto] = pontos;
  if (primeiro === undefined) {
    return;
  }
  const svg = areaDeDesenho();
  fireEvent.pointerDown(svg, { button: 0, pointerId: 1, clientX: primeiro[0], clientY: primeiro[1] });
  for (const [x, y] of resto) {
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: x, clientY: y });
  }
  const ultimo = resto.at(-1) ?? primeiro;
  fireEvent.pointerUp(svg, { pointerId: 1, clientX: ultimo[0], clientY: ultimo[1] });
}

function tracosNaTela(): Element[] {
  return [...camada().querySelectorAll("[data-traco]")];
}

// O jsdom não tem PointerEvent: sem ele, o fireEvent manda um Event sem botão, clientX nem pointerId.
class EventoDePonteiroFalso extends MouseEvent {
  readonly pointerId: number;
  constructor(tipo: string, inicio: PointerEventInit = {}) {
    super(tipo, inicio);
    this.pointerId = inicio.pointerId ?? 0;
  }
}
beforeEach(() => vi.stubGlobal("PointerEvent", EventoDePonteiroFalso));
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("CamadaDeDesenho", () => {
  it("o Desenhar abre a barra já com a caneta; o fechar da barra e o Desenhar de novo a fecham", () => {
    render(<CanvasDeTeste />);

    expect(screen.queryByRole("toolbar", { name: "Desenho" })).not.toBeInTheDocument();
    expect(camada()).not.toHaveClass("camada-de-desenho-ativa");

    fireEvent.click(screen.getByRole("button", { name: "Desenhar" }));
    expect(ferramenta("Caneta")).toHaveAttribute("aria-pressed", "true");
    expect(camada()).toHaveClass("camada-de-desenho-ativa");

    fireEvent.click(ferramenta("Fechar a barra de desenho"));
    expect(screen.queryByRole("toolbar", { name: "Desenho" })).not.toBeInTheDocument();
    expect(camada()).not.toHaveClass("camada-de-desenho-ativa");

    fireEvent.click(screen.getByRole("button", { name: "Desenhar" }));
    fireEvent.click(screen.getByRole("button", { name: "Desenhar" }));
    expect(screen.queryByRole("toolbar", { name: "Desenho" })).not.toBeInTheDocument();
  });

  it("Esc volta para Selecionar: a camada para de pegar o ponteiro e a barra fica aberta", () => {
    render(<CanvasDeTeste />);
    fireEvent.click(screen.getByRole("button", { name: "Desenhar" }));
    fireEvent.click(ferramenta("Seta"));

    const esc = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => {
      window.dispatchEvent(esc);
    });

    expect(esc.defaultPrevented).toBe(true);
    expect(ferramenta("Selecionar")).toHaveAttribute("aria-pressed", "true");
    expect(ferramenta("Seta")).toHaveAttribute("aria-pressed", "false");
    expect(camada()).not.toHaveClass("camada-de-desenho-ativa");
    // Arrastar com Selecionar não desenha nada: o canvas fica com o ponteiro.
    arrastar([
      [0, 0],
      [50, 50],
    ]);
    expect(tracosNaTela()).toHaveLength(0);
  });

  it("com a barra fechada, Esc e Ctrl+Z não são do desenho", () => {
    render(<CanvasDeTeste />);

    const esc = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    const desfazer = new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true });
    act(() => {
      window.dispatchEvent(esc);
      window.dispatchEvent(desfazer);
    });

    expect(esc.defaultPrevented).toBe(false);
    expect(desfazer.defaultPrevented).toBe(false);
  });

  it("desenha com a caneta e a seta, grava no layout e o Ctrl+Z desfaz o último", () => {
    render(<CanvasDeTeste />);
    fireEvent.click(screen.getByRole("button", { name: "Desenhar" }));

    arrastar([
      [10, 10],
      [20, 14],
      [30, 22],
      [40, 34],
    ]);
    fireEvent.click(ferramenta("Seta"));
    fireEvent.click(within(barra()).getByRole("button", { name: "Cor azul" }));
    arrastar([
      [100, 100],
      [200, 160],
    ]);

    expect(tracosNaTela().map((traco) => traco.getAttribute("data-traco"))).toEqual(["caneta", "seta"]);
    expect(lerLayout().desenho?.map((traco) => [traco.tipo, traco.cor])).toEqual([
      ["caneta", "laranja"],
      ["seta", "azul"],
    ]);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true, cancelable: true }));
    });

    expect(tracosNaTela().map((traco) => traco.getAttribute("data-traco"))).toEqual(["caneta"]);
    expect(lerLayout().desenho?.map((traco) => traco.tipo)).toEqual(["caneta"]);
  });

  it("um clique sem arrastar não vira retângulo", () => {
    render(<CanvasDeTeste />);
    fireEvent.click(screen.getByRole("button", { name: "Desenhar" }));
    fireEvent.click(ferramenta("Retângulo"));

    arrastar([[60, 60]]);

    expect(tracosNaTela()).toHaveLength(0);
  });

  it("a borracha apaga o traço inteiro que tocar, e o desfazer o traz de volta", () => {
    const tracos: TracoDoDesenho[] = [
      {
        id: "a",
        tipo: "linha",
        cor: "verde",
        espessura: 3,
        pontos: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
      },
      {
        id: "b",
        tipo: "retangulo",
        cor: "laranja",
        espessura: 3,
        pontos: [
          { x: 0, y: 200 },
          { x: 100, y: 300 },
        ],
      },
    ];
    salvarDesenho(tracos);
    render(<CanvasDeTeste tracosIniciais={lerLayout().desenho} />);
    expect(tracosNaTela()).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Desenhar" }));
    fireEvent.click(ferramenta("Borracha"));

    // Passa pela linha no meio dela: a linha inteira sai; o retângulo, longe, fica.
    arrastar([
      [50, -30],
      [50, 30],
    ]);

    expect(tracosNaTela().map((traco) => traco.getAttribute("data-traco"))).toEqual(["retangulo"]);
    expect(lerLayout().desenho?.map((traco) => traco.id)).toEqual(["b"]);

    fireEvent.click(ferramenta("Desfazer"));
    expect(tracosNaTela()).toHaveLength(2);
  });

  describe("texto solto", () => {
    /** Abre a barra, escolhe o Texto e clica em (x, y): o campo abre já com o foco. */
    function abrirCampoDeTexto(x: number, y: number): HTMLElement {
      render(<CanvasDeTeste />);
      fireEvent.click(screen.getByRole("button", { name: "Desenhar" }));
      fireEvent.click(ferramenta("Texto"));
      return abrirOutroCampoDeTexto(x, y);
    }

    function abrirOutroCampoDeTexto(x: number, y: number): HTMLElement {
      fireEvent.pointerDown(areaDeDesenho(), { button: 0, pointerId: 1, clientX: x, clientY: y });
      const campo = screen.getByRole("textbox", { name: "Texto solto" });
      expect(campo).toHaveFocus();
      return campo;
    }

    function campoAberto(): boolean {
      return screen.queryByRole("textbox", { name: "Texto solto" }) !== null;
    }

    function linhasNaTela(): string[] {
      return [...camada().querySelectorAll("text tspan")].map((linha) => linha.textContent ?? "");
    }

    it("é um campo de várias linhas: Enter e Shift+Enter quebram a linha, sem terminar o texto", () => {
      const campo = abrirCampoDeTexto(40, 50);

      expect(campo.tagName).toBe("TEXTAREA");
      // fireEvent devolve false quando o evento teve o padrão (a quebra de linha) cancelado.
      expect(fireEvent.keyDown(campo, { key: "Enter" })).toBe(true);
      expect(fireEvent.keyDown(campo, { key: "Enter", shiftKey: true })).toBe(true);
      expect(campoAberto()).toBe(true);
      expect(lerLayout().desenho ?? []).toHaveLength(0);
    });

    it("Ctrl+Enter (ou Cmd+Enter) termina: vira um traço com as linhas separadas por quebra, um tspan por linha", () => {
      const campo = abrirCampoDeTexto(40, 50);
      fireEvent.change(campo, { target: { value: "Fila de pedidos\n\n  segunda linha" } });
      fireEvent.keyDown(campo, { key: "Enter", ctrlKey: true });

      expect(campoAberto()).toBe(false);
      expect(linhasNaTela()).toEqual(["Fila de pedidos", "", "  segunda linha"]);
      expect(lerLayout().desenho?.[0]).toMatchObject({
        tipo: "texto",
        texto: "Fila de pedidos\n\n  segunda linha",
        pontos: [{ x: 40, y: 50 }],
      });

      // Cada linha desce uma altura de linha, a linha vazia inclusive; todas começam no mesmo x.
      const linhas = [...camada().querySelectorAll("text tspan")];
      const [primeiro = 0, segundo = 0, terceiro = 0] = linhas.map((linha) => Number(linha.getAttribute("y")));
      expect(primeiro).toBe(50);
      expect(segundo - primeiro).toBeGreaterThan(0);
      expect(terceiro - segundo).toBeCloseTo(segundo - primeiro);
      expect(linhas.map((linha) => linha.getAttribute("x"))).toEqual(["40", "40", "40"]);

      const outro = abrirOutroCampoDeTexto(90, 90);
      fireEvent.change(outro, { target: { value: "Mac" } });
      fireEvent.keyDown(outro, { key: "Enter", metaKey: true });
      expect(camada().querySelectorAll("text")).toHaveLength(2);
    });

    it("Esc termina o texto (não descarta) e não troca a ferramenta nem fecha a barra", () => {
      const campo = abrirCampoDeTexto(40, 50);
      fireEvent.change(campo, { target: { value: "Fila" } });
      // O Esc do campo não pode chegar ao atalho global da camada (que trocaria a ferramenta).
      const noGlobal = vi.fn();
      window.addEventListener("keydown", noGlobal);
      fireEvent.keyDown(campo, { key: "Escape" });
      window.removeEventListener("keydown", noGlobal);

      expect(noGlobal).not.toHaveBeenCalled();
      expect(campoAberto()).toBe(false);
      expect(linhasNaTela()).toEqual(["Fila"]);
      expect(lerLayout().desenho?.[0]).toMatchObject({ tipo: "texto", texto: "Fila" });
      expect(barra()).toBeInTheDocument();
      expect(ferramenta("Texto")).toHaveAttribute("aria-pressed", "true");

      // Fora do campo, o Esc segue sendo da camada: volta para Selecionar.
      fireEvent.keyDown(window, { key: "Escape" });
      expect(ferramenta("Selecionar")).toHaveAttribute("aria-pressed", "true");
    });

    it("clicar fora (perder o foco) termina o texto, como antes", () => {
      const campo = abrirCampoDeTexto(40, 50);
      fireEvent.change(campo, { target: { value: "Fora" } });
      fireEvent.blur(campo);

      expect(campoAberto()).toBe(false);
      expect(lerLayout().desenho?.[0]).toMatchObject({ tipo: "texto", texto: "Fora" });
    });

    it("texto vazio ou só com espaços e quebras some", () => {
      const vazio = abrirCampoDeTexto(40, 50);
      fireEvent.keyDown(vazio, { key: "Escape" });
      expect(campoAberto()).toBe(false);

      const soEspacos = abrirOutroCampoDeTexto(90, 90);
      fireEvent.change(soEspacos, { target: { value: "  \n \n" } });
      fireEvent.keyDown(soEspacos, { key: "Enter", ctrlKey: true });

      expect(campoAberto()).toBe(false);
      expect(camada().querySelectorAll("text")).toHaveLength(0);
      expect(lerLayout().desenho ?? []).toHaveLength(0);
    });
  });

  it("com uma ferramenta na mão, a página do artefato e da prévia fica sem o mouse (o CSS é lido do arquivo)", () => {
    const css = readFileSync(resolve(__dirname, "../../theme/index.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const regras = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, seletores = "", corpo = ""]) => ({
      seletores: seletores.split(",").map((seletor) => seletor.trim()),
      corpo,
    }));
    for (const alvo of [".corpo-do-artefato-html", ".quadro-da-previa"]) {
      const regra = regras.find(({ seletores }) =>
        seletores.includes(`.react-flow:has(.camada-de-desenho-ativa) ${alvo}`),
      );
      expect(regra?.corpo, alvo).toMatch(/pointer-events:\s*none/);
    }
  });
});
