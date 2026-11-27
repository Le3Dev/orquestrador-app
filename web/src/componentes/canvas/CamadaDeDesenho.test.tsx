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

/**
 * O canvas no que importa aqui: o botão "Desenhar" dos controles e a camada (com os renders dela contados).
 * Com `aoApertarNoCanvas`, o ponteiro que a camada deixa passar (o vazio, no navegador) chega a ele, como
 * chegaria ao canvas de verdade.
 */
function CanvasDeTeste({
  tracosIniciais,
  aoApertarNoCanvas,
  aoPegarLoja,
  aoRenderizarACamada,
}: {
  tracosIniciais?: TracoDoDesenho[];
  aoApertarNoCanvas?: () => void;
  aoPegarLoja?: (loja: Loja) => void;
  aoRenderizarACamada?: () => void;
}) {
  const [aberta, setAberta] = useState(false);
  return (
    <ReactFlowProvider>
      {aoPegarLoja !== undefined && <PegarLoja aoPegar={aoPegarLoja} />}
      <div onPointerDown={aoApertarNoCanvas}>
        <button type="button" aria-pressed={aberta} onClick={() => setAberta((atual) => !atual)}>
          Desenhar
        </button>
        <Profiler id="camada" onRender={() => aoRenderizarACamada?.()}>
          <CamadaDeDesenho aberta={aberta} aoFechar={() => setAberta(false)} tracosIniciais={tracosIniciais} />
        </Profiler>
      </div>
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

/** As áreas de toque dos traços (só existem com a barra aberta em Selecionar). */
function toques(): Element[] {
  return [...camada().querySelectorAll("[data-toque]")];
}

function toque(id: string): Element {
  const alvo = camada().querySelector(`[data-toque="${id}"]`);
  if (alvo === null) {
    throw new Error(`sem a área de toque do traço ${id}`);
  }
  return alvo;
}

function contorno(): Element | null {
  return camada().querySelector(".contorno-da-selecao");
}

/** Aperta o ponteiro no traço, anda até os pontos dados e solta (em pixels da tela, que sem domNode são os do canvas). */
function arrastarTraco(id: string, pontos: readonly [number, number][]) {
  const [primeiro, ...resto] = pontos;
  if (primeiro === undefined) {
    return;
  }
  const alvo = toque(id);
  fireEvent.pointerDown(alvo, { button: 0, pointerId: 1, clientX: primeiro[0], clientY: primeiro[1] });
  for (const [x, y] of resto) {
    fireEvent.pointerMove(alvo, { pointerId: 1, clientX: x, clientY: y });
  }
  const ultimo = resto.at(-1) ?? primeiro;
  fireEvent.pointerUp(alvo, { pointerId: 1, clientX: ultimo[0], clientY: ultimo[1] });
}

/** Uma linha verde e um retângulo laranja, longe um do outro. */
function tracosDeExemplo(): TracoDoDesenho[] {
  return [
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
}

/** Desenha os traços de exemplo, abre a barra e fica em Selecionar. */
function abrirEmSelecionar(tracos: TracoDoDesenho[] = tracosDeExemplo(), aoApertarNoCanvas?: () => void) {
  salvarDesenho(tracos);
  render(<CanvasDeTeste tracosIniciais={lerLayout().desenho} aoApertarNoCanvas={aoApertarNoCanvas} />);
  fireEvent.click(screen.getByRole("button", { name: "Desenhar" }));
  fireEvent.click(ferramenta("Selecionar"));
}

function pontosSalvos(id: string) {
  return lerLayout().desenho?.find((traco) => traco.id === id)?.pontos;
}

function desfazerComCtrlZ() {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }));
  });
}

/** As regras do CSS do tema (sem comentários), lidas do arquivo: o jsdom não aplica o CSS. */
function regrasDoCss(): { seletores: string[]; corpo: string }[] {
  const css = readFileSync(resolve(__dirname, "../../theme/index.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, seletores = "", corpo = ""]) => ({
    seletores: seletores.split(",").map((seletor) => seletor.trim()),
    corpo,
  }));
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
  vi.restoreAllMocks();
  localStorage.clear();
  // O layout guarda em memória o último texto gravado (e não regrava o mesmo): relê o armazenamento já vazio,
  // senão o próximo teste que salvar os mesmos traços não gravaria nada.
  lerLayout();
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

  it("Limpar tudo também tira a seleção; o Desfazer traz os traços de volta, sem seleção", () => {
    salvarDesenho(tracosDeExemplo());
    render(<CanvasDeTeste tracosIniciais={lerLayout().desenho} />);
    fireEvent.click(screen.getByRole("button", { name: "Desenhar" }));
    fireEvent.click(ferramenta("Selecionar"));
    fireEvent.pointerDown(toque("a"), { button: 0, pointerId: 1, clientX: 50, clientY: 0 });
    fireEvent.pointerUp(toque("a"), { pointerId: 1, clientX: 50, clientY: 0 });
    expect(contorno()).not.toBeNull();

    fireEvent.click(ferramenta("Limpar todos os desenhos"));

    expect(contorno()).toBeNull();
    expect(toques()).toHaveLength(0);
    expect(lerLayout().desenho ?? []).toEqual([]);
    // Sem seleção, o Delete não faz nada (nem um passo a mais no desfazer).
    fireEvent.keyDown(window, { key: "Delete" });

    fireEvent.click(ferramenta("Desfazer"));
    expect(toques().map((alvo) => alvo.getAttribute("data-toque"))).toEqual(["a", "b"]);
    expect(contorno()).toBeNull();
    expect(ferramenta("Desfazer")).toBeDisabled();
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

  describe("selecionar e mover", () => {
    it("só com a barra aberta em Selecionar os traços ganham área de toque (um por traço)", () => {
      salvarDesenho(tracosDeExemplo());
      render(<CanvasDeTeste tracosIniciais={lerLayout().desenho} />);
      expect(toques()).toHaveLength(0);

      fireEvent.click(screen.getByRole("button", { name: "Desenhar" }));
      // Aberta, a caneta já está na mão: a camada pega o ponteiro inteira, sem áreas de toque.
      expect(toques()).toHaveLength(0);

      fireEvent.click(ferramenta("Selecionar"));
      expect(toques().map((alvo) => alvo.getAttribute("data-toque"))).toEqual(["a", "b"]);
      expect(camada()).toHaveClass("camada-de-desenho-selecionando");
      expect(camada()).not.toHaveClass("camada-de-desenho-ativa");

      fireEvent.click(ferramenta("Borracha"));
      expect(toques()).toHaveLength(0);
      fireEvent.click(ferramenta("Selecionar"));
      fireEvent.click(ferramenta("Fechar a barra de desenho"));
      expect(toques()).toHaveLength(0);
    });

    it("clicar num traço o seleciona, com o contorno tracejado em volta da caixa dele", () => {
      abrirEmSelecionar();
      expect(contorno()).toBeNull();

      fireEvent.pointerDown(toque("a"), { button: 0, pointerId: 1, clientX: 50, clientY: 0 });
      fireEvent.pointerUp(toque("a"), { pointerId: 1, clientX: 50, clientY: 0 });

      // A linha vai de 0 a 100 com 3 de espessura; o contorno tem 6 px de folga de cada lado.
      expect(contorno()).toHaveAttribute("x", "-7.5");
      expect(contorno()).toHaveAttribute("width", "115");
      expect(contorno()).toHaveClass("contorno-da-selecao");

      // Selecionar outro traço troca o contorno de lugar.
      fireEvent.pointerDown(toque("b"), { button: 0, pointerId: 1, clientX: 50, clientY: 200 });
      fireEvent.pointerUp(toque("b"), { pointerId: 1, clientX: 50, clientY: 200 });
      expect(camada().querySelectorAll(".contorno-da-selecao")).toHaveLength(1);
      expect(contorno()).toHaveAttribute("y", "192.5");
    });

    it("o pan e o zoom não renderizam a camada nem com a seleção: o contorno e a transformação seguem a câmera pelo DOM", () => {
      let loja: Loja | undefined;
      let renders = 0;
      salvarDesenho(tracosDeExemplo());
      render(
        <CanvasDeTeste
          tracosIniciais={lerLayout().desenho}
          aoPegarLoja={(atual) => (loja = atual)}
          aoRenderizarACamada={() => (renders += 1)}
        />,
      );
      if (loja === undefined) {
        throw new Error("sem a loja do React Flow");
      }
      fireEvent.click(screen.getByRole("button", { name: "Desenhar" }));
      fireEvent.click(ferramenta("Selecionar"));
      fireEvent.pointerDown(toque("a"), { button: 0, pointerId: 1, clientX: 50, clientY: 0 });
      fireEvent.pointerUp(toque("a"), { pointerId: 1, clientX: 50, clientY: 0 });
      expect(contorno()).toHaveAttribute("x", "-7.5");

      const antes = renders;
      moverACamera(loja, [
        [10, 0, 1.5],
        [100, 50, 2],
      ]);

      expect(renders).toBe(antes);
      expect(areaDeDesenho().querySelector("g")).toHaveAttribute("transform", "translate(100 50) scale(2)");
      // Em pixels da tela: a caixa (de -1,5 e 103 de largura, no canvas) vai pelo zoom e ganha 6 px de folga de cada lado.
      expect(contorno()).toHaveAttribute("x", "91");
      expect(contorno()).toHaveAttribute("width", "218");
    });

    it("a área de toque tem uma faixa mínima em pixels da tela (traço fino ou grosso, em qualquer zoom)", () => {
      abrirEmSelecionar();

      const [doTraco, minima] = [...toque("a").children];
      expect(toque("a").children).toHaveLength(2);
      // A forma na espessura do traço cresce com o zoom; a mínima não (vector-effect), e vale LARGURA_DO_TOQUE_PX.
      expect(doTraco).toHaveAttribute("stroke-width", "3");
      expect(doTraco).not.toHaveAttribute("vector-effect");
      expect(minima).toHaveAttribute("stroke-width", "10");
      expect(minima).toHaveAttribute("vector-effect", "non-scaling-stroke");
    });

    it("clicar no vazio, Esc ou trocar de ferramenta tira a seleção; o Esc com seleção não troca a ferramenta", () => {
      abrirEmSelecionar();
      const selecionarA = () => {
        fireEvent.pointerDown(toque("a"), { button: 0, pointerId: 1, clientX: 50, clientY: 0 });
        fireEvent.pointerUp(toque("a"), { pointerId: 1, clientX: 50, clientY: 0 });
      };

      selecionarA();
      expect(contorno()).not.toBeNull();
      // A barra de desenho não conta como vazio: mexer nela não perde a seleção.
      fireEvent.pointerDown(barra(), { button: 0, pointerId: 1 });
      expect(contorno()).not.toBeNull();
      fireEvent.pointerDown(document.body, { button: 0, pointerId: 1, clientX: 400, clientY: 400 });
      expect(contorno()).toBeNull();

      selecionarA();
      const esc = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
      act(() => {
        window.dispatchEvent(esc);
      });
      expect(esc.defaultPrevented).toBe(true);
      expect(contorno()).toBeNull();
      // Só a seleção saiu: a barra continua aberta, em Selecionar. O próximo Esc fecha a barra, como antes.
      expect(ferramenta("Selecionar")).toHaveAttribute("aria-pressed", "true");
      fireEvent.keyDown(window, { key: "Escape" });
      expect(screen.queryByRole("toolbar", { name: "Desenho" })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Desenhar" }));
      fireEvent.click(ferramenta("Selecionar"));
      selecionarA();
      fireEvent.click(ferramenta("Caneta"));
      fireEvent.click(ferramenta("Selecionar"));
      expect(contorno()).toBeNull();
    });

    it("arrastar move o traço (selecionado ou não): grava uma vez, ao soltar, e o Ctrl+Z desfaz o movimento todo", () => {
      abrirEmSelecionar();
      const gravar = vi.spyOn(Storage.prototype, "setItem");
      const alvo = toque("a");

      fireEvent.pointerDown(alvo, { button: 0, pointerId: 1, clientX: 50, clientY: 0 });
      // Até o limite do clique (3 px) ainda não é movimento.
      fireEvent.pointerMove(alvo, { pointerId: 1, clientX: 52, clientY: 1 });
      expect(camada().querySelector('[data-traco="linha"]')).toHaveAttribute("d", "M 0 0 L 100 0");

      fireEvent.pointerMove(alvo, { pointerId: 1, clientX: 80, clientY: 20 });
      fireEvent.pointerMove(alvo, { pointerId: 1, clientX: 130, clientY: 40 });
      // Em curso, o traço acompanha o ponteiro na tela, mas nada foi gravado.
      expect(camada().querySelector('[data-traco="linha"]')).toHaveAttribute("d", "M 80 40 L 180 40");
      expect(gravar).not.toHaveBeenCalled();
      expect(ferramenta("Desfazer")).toBeDisabled();

      fireEvent.pointerUp(alvo, { pointerId: 1, clientX: 130, clientY: 40 });

      expect(pontosSalvos("a")).toEqual([
        { x: 80, y: 40 },
        { x: 180, y: 40 },
      ]);
      expect(pontosSalvos("b")).toEqual([
        { x: 0, y: 200 },
        { x: 100, y: 300 },
      ]);
      expect(gravar).toHaveBeenCalledTimes(1);
      // Passou a ser o selecionado: o contorno acompanha o traço movido.
      expect(contorno()).toHaveAttribute("x", "72.5");

      desfazerComCtrlZ();

      expect(pontosSalvos("a")).toEqual([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ]);
      expect(camada().querySelector('[data-traco="linha"]')).toHaveAttribute("d", "M 0 0 L 100 0");
      // Um movimento inteiro foi um passo só.
      expect(ferramenta("Desfazer")).toBeDisabled();
    });

    it("o retângulo e o texto também se movem, com o resto do traço intacto", () => {
      abrirEmSelecionar([
        ...tracosDeExemplo(),
        { id: "t", tipo: "texto", cor: "azul", espessura: 3, pontos: [{ x: 300, y: 300 }], texto: "Fila\nde pedidos" },
      ]);

      arrastarTraco("b", [
        [50, 200],
        [70, 210],
        [90, 250],
      ]);
      arrastarTraco("t", [
        [310, 310],
        [300, 290],
      ]);

      expect(pontosSalvos("b")).toEqual([
        { x: 40, y: 250 },
        { x: 140, y: 350 },
      ]);
      expect(lerLayout().desenho?.find((traco) => traco.id === "t")).toMatchObject({
        tipo: "texto",
        cor: "azul",
        espessura: 3,
        texto: "Fila\nde pedidos",
        pontos: [{ x: 290, y: 280 }],
      });
      expect(lerLayout().desenho?.map((traco) => traco.id)).toEqual(["a", "b", "t"]);
    });

    it("um clique sem arrastar (até 3 px) só seleciona: nada é gravado nem entra no desfazer", () => {
      abrirEmSelecionar();
      const gravar = vi.spyOn(Storage.prototype, "setItem");

      arrastarTraco("a", [
        [50, 0],
        [51, 1],
        [52, 2],
      ]);

      expect(contorno()).not.toBeNull();
      expect(gravar).not.toHaveBeenCalled();
      expect(pontosSalvos("a")).toEqual([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ]);
      expect(ferramenta("Desfazer")).toBeDisabled();
    });

    it("o clique no vazio não é da camada: o svg não pega o ponteiro (o CSS) e o canvas o recebe inteiro", () => {
      const noCanvas = vi.fn();
      abrirEmSelecionar(tracosDeExemplo(), noCanvas);

      // Sem a área de toque, o ponteiro cai no svg (o que o CSS evita no navegador); nem assim ele o prende.
      const evento = new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 });
      act(() => {
        areaDeDesenho().dispatchEvent(evento);
      });
      expect(evento.defaultPrevented).toBe(false);
      expect(noCanvas).toHaveBeenCalledTimes(1);
      expect(contorno()).toBeNull();

      // O traço, sim, pega o clique: o canvas não o recebe (nem arrasta a tela nem seleciona janelas).
      fireEvent.pointerDown(toque("a"), { button: 0, pointerId: 1, clientX: 50, clientY: 0 });
      expect(noCanvas).toHaveBeenCalledTimes(1);

      // O CSS: o svg só pega o ponteiro com uma ferramenta; em Selecionar, só as áreas de toque.
      const regras = regrasDoCss();
      const corpoDe = (seletor: string) =>
        regras
          .filter(({ seletores }) => seletores.includes(seletor))
          .map(({ corpo }) => corpo)
          .join(";");
      expect(corpoDe(".camada-de-desenho")).toMatch(/pointer-events:\s*none/);
      expect(corpoDe(".camada-de-desenho-ativa .camada-de-desenho-svg")).toMatch(/pointer-events:\s*auto/);
      expect(corpoDe(".camada-de-desenho-selecionando .camada-de-desenho-svg")).not.toMatch(/pointer-events/);
      expect(corpoDe(".camada-de-desenho-selecionando .toque-do-traco")).toMatch(/pointer-events:\s*stroke/);
      expect(corpoDe(".camada-de-desenho-selecionando .toque-do-traco")).toMatch(/cursor:\s*move/);
      expect(corpoDe(".camada-de-desenho-selecionando .toque-do-texto")).toMatch(/pointer-events:\s*all/);
    });

    it("Delete (ou Backspace) apaga o traço selecionado em um passo do desfazer; sem seleção, não faz nada", () => {
      abrirEmSelecionar();

      fireEvent.keyDown(window, { key: "Delete" });
      expect(tracosNaTela()).toHaveLength(2);

      fireEvent.pointerDown(toque("a"), { button: 0, pointerId: 1, clientX: 50, clientY: 0 });
      fireEvent.pointerUp(toque("a"), { pointerId: 1, clientX: 50, clientY: 0 });
      const apertada = new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true });
      act(() => {
        window.dispatchEvent(apertada);
      });

      expect(apertada.defaultPrevented).toBe(true);
      expect(tracosNaTela().map((traco) => traco.getAttribute("data-traco"))).toEqual(["retangulo"]);
      expect(lerLayout().desenho?.map((traco) => traco.id)).toEqual(["b"]);
      expect(contorno()).toBeNull();
      expect(toques().map((alvo) => alvo.getAttribute("data-toque"))).toEqual(["b"]);

      desfazerComCtrlZ();
      expect(lerLayout().desenho?.map((traco) => traco.id)).toEqual(["a", "b"]);
      expect(ferramenta("Desfazer")).toBeDisabled();

      fireEvent.pointerDown(toque("b"), { button: 0, pointerId: 1, clientX: 50, clientY: 200 });
      fireEvent.pointerUp(toque("b"), { pointerId: 1, clientX: 50, clientY: 200 });
      fireEvent.keyDown(window, { key: "Backspace" });
      expect(lerLayout().desenho?.map((traco) => traco.id)).toEqual(["a"]);
    });

    it("com o foco num campo de texto, o Delete é do campo: o traço selecionado fica", () => {
      abrirEmSelecionar();
      fireEvent.pointerDown(toque("a"), { button: 0, pointerId: 1, clientX: 50, clientY: 0 });
      fireEvent.pointerUp(toque("a"), { pointerId: 1, clientX: 50, clientY: 0 });
      const campo = document.createElement("input");
      document.body.append(campo);
      campo.focus();

      const apertada = new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true });
      act(() => {
        campo.dispatchEvent(apertada);
      });
      campo.remove();

      expect(apertada.defaultPrevented).toBe(false);
      expect(lerLayout().desenho?.map((traco) => traco.id)).toEqual(["a", "b"]);
      expect(contorno()).not.toBeNull();
    });

    it("apertar num traço tira o foco de um campo de texto (para o Delete valer para o traço)", () => {
      abrirEmSelecionar();
      const campo = document.createElement("textarea");
      document.body.append(campo);
      campo.focus();
      expect(campo).toHaveFocus();

      fireEvent.pointerDown(toque("a"), { button: 0, pointerId: 1, clientX: 50, clientY: 0 });
      expect(campo).not.toHaveFocus();
      fireEvent.pointerUp(toque("a"), { pointerId: 1, clientX: 50, clientY: 0 });
      campo.remove();

      fireEvent.keyDown(window, { key: "Delete" });
      expect(lerLayout().desenho?.map((traco) => traco.id)).toEqual(["b"]);
    });

    describe("duplo clique no texto", () => {
      const textoSalvo: TracoDoDesenho = {
        id: "t",
        tipo: "texto",
        cor: "azul",
        espessura: 3,
        pontos: [{ x: 40, y: 50 }],
        texto: "Fila",
      };

      function campoDoTexto(): HTMLElement {
        return screen.getByRole("textbox", { name: "Texto solto" });
      }

      it("reabre a edição com o valor atual; confirmar troca o texto (mesmo traço, um passo do desfazer)", () => {
        abrirEmSelecionar([...tracosDeExemplo(), textoSalvo]);

        fireEvent.doubleClick(toque("t"));

        const campo = campoDoTexto();
        expect(campo).toHaveValue("Fila");
        expect(campo).toHaveFocus();
        // O texto sai do desenho enquanto o campo ocupa o lugar dele.
        expect(camada().querySelectorAll("text")).toHaveLength(0);

        fireEvent.change(campo, { target: { value: "Fila de pedidos\nsegunda linha" } });
        fireEvent.keyDown(campo, { key: "Enter", ctrlKey: true });

        expect(screen.queryByRole("textbox", { name: "Texto solto" })).not.toBeInTheDocument();
        expect([...camada().querySelectorAll("text tspan")].map((linha) => linha.textContent)).toEqual([
          "Fila de pedidos",
          "segunda linha",
        ]);
        expect(lerLayout().desenho?.map((traco) => traco.id)).toEqual(["a", "b", "t"]);
        expect(lerLayout().desenho?.find((traco) => traco.id === "t")).toMatchObject({
          tipo: "texto",
          cor: "azul",
          texto: "Fila de pedidos\nsegunda linha",
          pontos: [{ x: 40, y: 50 }],
        });

        desfazerComCtrlZ();
        expect(lerLayout().desenho?.find((traco) => traco.id === "t")?.texto).toBe("Fila");
        expect(ferramenta("Desfazer")).toBeDisabled();
      });

      it("esvaziar o texto o apaga (um passo do desfazer); deixar igual não muda nada", () => {
        abrirEmSelecionar([...tracosDeExemplo(), textoSalvo]);

        fireEvent.doubleClick(toque("t"));
        fireEvent.keyDown(campoDoTexto(), { key: "Escape" });
        expect(camada().querySelectorAll("text")).toHaveLength(1);
        expect(ferramenta("Desfazer")).toBeDisabled();

        fireEvent.doubleClick(toque("t"));
        fireEvent.change(campoDoTexto(), { target: { value: " \n " } });
        fireEvent.keyDown(campoDoTexto(), { key: "Enter", ctrlKey: true });

        expect(camada().querySelectorAll("text")).toHaveLength(0);
        expect(lerLayout().desenho?.map((traco) => traco.id)).toEqual(["a", "b"]);

        desfazerComCtrlZ();
        expect(lerLayout().desenho?.map((traco) => traco.id)).toEqual(["a", "b", "t"]);
        expect(ferramenta("Desfazer")).toBeDisabled();
      });

      it("clicar fora (perder o foco) também confirma; só o texto reabre, os outros traços não", () => {
        abrirEmSelecionar([...tracosDeExemplo(), textoSalvo]);

        fireEvent.doubleClick(toque("a"));
        expect(screen.queryByRole("textbox", { name: "Texto solto" })).not.toBeInTheDocument();

        fireEvent.doubleClick(toque("t"));
        fireEvent.change(campoDoTexto(), { target: { value: "Fora" } });
        fireEvent.blur(campoDoTexto());

        expect(lerLayout().desenho?.find((traco) => traco.id === "t")?.texto).toBe("Fora");
      });
    });

    it("com a barra fechada, ou com outra ferramenta, nada se move nem se apaga", () => {
      salvarDesenho(tracosDeExemplo());
      render(<CanvasDeTeste tracosIniciais={lerLayout().desenho} />);
      const gravar = vi.spyOn(Storage.prototype, "setItem");

      // Fechada: não há área de toque, e o gesto sobre o próprio traço (ou o svg) não mexe em nada.
      expect(toques()).toHaveLength(0);
      const visivel = tracosNaTela()[0] as Element;
      fireEvent.pointerDown(visivel, { button: 0, pointerId: 1, clientX: 50, clientY: 0 });
      fireEvent.pointerMove(visivel, { pointerId: 1, clientX: 150, clientY: 80 });
      fireEvent.pointerUp(visivel, { pointerId: 1, clientX: 150, clientY: 80 });
      fireEvent.doubleClick(visivel);
      fireEvent.keyDown(window, { key: "Delete" });
      expect(screen.queryByRole("textbox", { name: "Texto solto" })).not.toBeInTheDocument();
      expect(camada().querySelector(".contorno-da-selecao")).toBeNull();
      expect(gravar).not.toHaveBeenCalled();

      // Com uma ferramenta na mão, arrastar em cima do traço desenha outro, em vez de mover.
      fireEvent.click(screen.getByRole("button", { name: "Desenhar" }));
      arrastar([
        [50, 0],
        [90, 60],
      ]);
      expect(tracosNaTela()).toHaveLength(3);
      expect(pontosSalvos("a")).toEqual([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ]);
    });

    it("com a barra fechada o desenho não ganha área de toque nem depois de ter sido selecionado", () => {
      abrirEmSelecionar();
      fireEvent.pointerDown(toque("a"), { button: 0, pointerId: 1, clientX: 50, clientY: 0 });
      fireEvent.pointerUp(toque("a"), { pointerId: 1, clientX: 50, clientY: 0 });
      expect(contorno()).not.toBeNull();

      fireEvent.click(ferramenta("Fechar a barra de desenho"));

      expect(toques()).toHaveLength(0);
      expect(contorno()).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Desenhar" }));
      fireEvent.click(ferramenta("Selecionar"));
      expect(contorno()).toBeNull();
    });
  });

  it("com uma ferramenta na mão, a página do artefato e da prévia fica sem o mouse (o CSS é lido do arquivo)", () => {
    const regras = regrasDoCss();
    for (const alvo of [".corpo-do-artefato-html", ".quadro-da-previa"]) {
      const regra = regras.find(({ seletores }) =>
        seletores.includes(`.react-flow:has(.camada-de-desenho-ativa) ${alvo}`),
      );
      expect(regra?.corpo, alvo).toMatch(/pointer-events:\s*none/);
    }
  });
});
