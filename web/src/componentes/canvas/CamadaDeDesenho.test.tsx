import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { type ReactFlowState, ReactFlowProvider, useStoreApi } from "@xyflow/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Profiler, useState } from "react";

import { lerLayout, salvarDesenho, type TracoDoDesenho } from "../../shared/canvas/layout";
import { CamadaDeDesenho } from "./CamadaDeDesenho";

type Loja = ReturnType<typeof useStoreApi>;

/** Entrega a loja do React Flow ao teste, para mover a câmera como o pan e o zoom movem. */
function PegarLoja({ aoPegar }: { aoPegar: (loja: Loja) => void }) {
  aoPegar(useStoreApi());
  return null;
}

/** O canvas no que importa aqui: o botão "Desenhar" dos controles e a camada (com os renders dela contados). */
function CanvasDeTeste({
  tracosIniciais,
  aoPegarLoja,
  aoRenderizarACamada,
}: {
  tracosIniciais?: TracoDoDesenho[];
  aoPegarLoja?: (loja: Loja) => void;
  aoRenderizarACamada?: () => void;
}) {
  const [aberta, setAberta] = useState(false);
  return (
    <ReactFlowProvider>
      {aoPegarLoja !== undefined && <PegarLoja aoPegar={aoPegarLoja} />}
      <button type="button" aria-pressed={aberta} onClick={() => setAberta((atual) => !atual)}>
        Desenhar
      </button>
      <Profiler id="camada" onRender={() => aoRenderizarACamada?.()}>
        <CamadaDeDesenho aberta={aberta} aoFechar={() => setAberta(false)} tracosIniciais={tracosIniciais} />
      </Profiler>
    </ReactFlowProvider>
  );
}

/** Move a câmera do canvas, quadro a quadro, como um pan ou zoom. */
function moverACamera(loja: Loja, quadros: readonly ReactFlowState["transform"][]) {
  act(() => {
    for (const transform of quadros) {
      loja.setState({ transform });
    }
  });
}

const LINHA: TracoDoDesenho = {
  id: "l",
  tipo: "linha",
  cor: "azul",
  espessura: 3,
  pontos: [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ],
};

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
    render(<CanvasDeTeste tracosIniciais={[LINHA]} />);

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

  it("sem traços e com a barra fechada, a camada não monta o SVG; abrir a barra monta, fechar sem desenhar desmonta", () => {
    const { container } = render(<CanvasDeTeste />);

    expect(screen.queryByTestId("camada-de-desenho")).not.toBeInTheDocument();
    expect(container.querySelector("svg")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Desenhar" }));
    expect(areaDeDesenho()).toBeInTheDocument();

    fireEvent.click(ferramenta("Fechar a barra de desenho"));
    expect(screen.queryByTestId("camada-de-desenho")).not.toBeInTheDocument();

    // Com um traço feito, o desenho continua no canvas depois de fechar a barra.
    fireEvent.click(screen.getByRole("button", { name: "Desenhar" }));
    arrastar([
      [10, 10],
      [40, 40],
    ]);
    fireEvent.click(ferramenta("Fechar a barra de desenho"));
    expect(tracosNaTela()).toHaveLength(1);
  });

  it("o pan e o zoom não renderizam a camada, com ou sem traços", () => {
    let loja: Loja | undefined;
    let renders = 0;
    const { unmount } = render(
      <CanvasDeTeste aoPegarLoja={(atual) => (loja = atual)} aoRenderizarACamada={() => (renders += 1)} />,
    );
    if (loja === undefined) {
      throw new Error("sem a loja do React Flow");
    }
    const antesSemTracos = renders;
    expect(antesSemTracos).toBeGreaterThan(0);
    moverACamera(loja, [
      [10, 0, 1],
      [20, 5, 1.1],
      [30, 10, 1.2],
    ]);
    expect(renders).toBe(antesSemTracos);
    unmount();

    render(
      <CanvasDeTeste
        tracosIniciais={[LINHA]}
        aoPegarLoja={(atual) => (loja = atual)}
        aoRenderizarACamada={() => (renders += 1)}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Desenhar" }));
    const antesComTracos = renders;
    moverACamera(loja, [
      [10, 0, 1],
      [20, 5, 1.1],
      [30, 10, 1.2],
      [40, 15, 0.8],
    ]);
    expect(renders).toBe(antesComTracos);
  });

  it("a transformação posta no grupo do SVG e o campo do texto solto acompanham a câmera", () => {
    let loja: Loja | undefined;
    render(<CanvasDeTeste tracosIniciais={[LINHA]} aoPegarLoja={(atual) => (loja = atual)} />);
    if (loja === undefined) {
      throw new Error("sem a loja do React Flow");
    }
    const grupo = areaDeDesenho().querySelector("g");
    expect(grupo).toHaveAttribute("transform", "translate(0 0) scale(1)");

    moverACamera(loja, [
      [10, 10, 1],
      [100, 50, 2],
    ]);
    expect(grupo).toHaveAttribute("transform", "translate(100 50) scale(2)");

    // Sem domNode, o ponto da tela é o do canvas: o texto começa em (40, 50) do canvas.
    fireEvent.click(screen.getByRole("button", { name: "Desenhar" }));
    fireEvent.click(ferramenta("Texto"));
    fireEvent.pointerDown(areaDeDesenho(), { button: 0, pointerId: 1, clientX: 40, clientY: 50 });
    const campo = screen.getByRole("textbox", { name: "Texto solto" });
    expect(campo.style).toMatchObject({ left: "180px", top: "150px", fontSize: "48px" });

    moverACamera(loja, [[0, 0, 1]]);
    expect(grupo).toHaveAttribute("transform", "translate(0 0) scale(1)");
    expect(campo.style).toMatchObject({ left: "40px", top: "50px", fontSize: "24px" });
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

  it("Limpar tudo: desabilitado sem traço; apaga todos num passo, grava, e o Desfazer traz todos de volta", () => {
    render(<CanvasDeTeste />);
    fireEvent.click(screen.getByRole("button", { name: "Desenhar" }));
    const limpar = () => ferramenta("Limpar todos os desenhos");
    expect(limpar()).toBeDisabled();
    expect(limpar()).toHaveAttribute("title", expect.stringContaining("Desfazer"));

    arrastar([
      [10, 10],
      [40, 34],
    ]);
    fireEvent.click(ferramenta("Seta"));
    arrastar([
      [100, 100],
      [200, 160],
    ]);
    expect(tracosNaTela()).toHaveLength(2);
    expect(limpar()).toBeEnabled();

    fireEvent.click(limpar());
    expect(tracosNaTela()).toHaveLength(0);
    expect(lerLayout().desenho ?? []).toEqual([]);
    expect(limpar()).toBeDisabled();

    // Um passo só: o desfazer traz os dois de volta, também no layout.
    fireEvent.click(ferramenta("Desfazer"));
    expect(tracosNaTela().map((traco) => traco.getAttribute("data-traco"))).toEqual(["caneta", "seta"]);
    expect(lerLayout().desenho?.map((traco) => traco.tipo)).toEqual(["caneta", "seta"]);
  });

  it("o texto solto vira traço ao teclar Enter; vazio, não", () => {
    render(<CanvasDeTeste />);
    fireEvent.click(screen.getByRole("button", { name: "Desenhar" }));
    fireEvent.click(ferramenta("Texto"));

    fireEvent.pointerDown(areaDeDesenho(), { button: 0, pointerId: 1, clientX: 40, clientY: 50 });
    const campo = screen.getByRole("textbox", { name: "Texto solto" });
    expect(campo).toHaveFocus();
    fireEvent.change(campo, { target: { value: "Fila de pedidos" } });
    fireEvent.keyDown(campo, { key: "Enter" });

    expect(screen.queryByRole("textbox", { name: "Texto solto" })).not.toBeInTheDocument();
    expect(camada().querySelector("text")).toHaveTextContent("Fila de pedidos");
    expect(lerLayout().desenho?.[0]).toMatchObject({ tipo: "texto", texto: "Fila de pedidos", pontos: [{ x: 40, y: 50 }] });

    fireEvent.pointerDown(areaDeDesenho(), { button: 0, pointerId: 1, clientX: 90, clientY: 90 });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Texto solto" }), { key: "Enter" });
    expect(camada().querySelectorAll("text")).toHaveLength(1);
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
