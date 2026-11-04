import { act, fireEvent, render, screen } from "@testing-library/react";
import { type NodeProps, ReactFlowProvider } from "@xyflow/react";

import { type AcoesDoCanvas, ProvedorDoCanvas, type ValorDoCanvas } from "../../shared/canvas/contexto";
import type { DadosDaPrevia, NoPrevia as TipoDoNo } from "../../shared/canvas/nos";
import { ENDERECO_INVALIDO, NoPrevia } from "./NoPrevia";

function acoesDoCanvas(): AcoesDoCanvas {
  return {
    abrirTerminal: vi.fn(),
    fecharTerminal: vi.fn(),
    limparBixinhos: vi.fn(),
    orquestradorCriado: vi.fn(),
    descartarRascunho: vi.fn(),
    recarregar: vi.fn(async () => undefined),
    abrirPrevia: vi.fn(),
    navegarPrevia: vi.fn(),
    minimizarOuRestaurarPrevia: vi.fn(),
    fecharPrevia: vi.fn(),
  };
}

function valorDoCanvas(acoes: AcoesDoCanvas): ValorDoCanvas {
  return {
    orquestradores: new Map(),
    conversas: new Map(),
    conexoes: new Map(),
    sinais: new Map(),
    bixinhosLimpos: new Map(),
    servidor: { conectado: true, caiuEm: null, voltouEm: null, reiniciou: false, memoria: null },
    acoes,
  };
}

/** As props que o React Flow passa ao nó. */
function propsDoNo(dados: Partial<DadosDaPrevia> = {}, alteracoes: Partial<NodeProps<TipoDoNo>> = {}): NodeProps<TipoDoNo> {
  return {
    id: "previa:p1",
    type: "previa",
    data: { previaId: "p1", url: "http://localhost:5173", orquestradorId: "o1", minimizada: false, alturaAberta: 520, ...dados },
    selected: false,
    selectable: true,
    draggable: true,
    deletable: true,
    isConnectable: false,
    dragging: false,
    zIndex: 0,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    width: 720,
    height: 520,
    ...alteracoes,
  };
}

function Previa({ valor, no }: { valor: ValorDoCanvas; no: NodeProps<TipoDoNo> }) {
  return (
    <ReactFlowProvider>
      <ProvedorDoCanvas valor={valor}>
        <NoPrevia {...no} />
      </ProvedorDoCanvas>
    </ReactFlowProvider>
  );
}

function renderizar(dados: Partial<DadosDaPrevia> = {}, alteracoes: Partial<NodeProps<TipoDoNo>> = {}) {
  const acoes = acoesDoCanvas();
  const valor = valorDoCanvas(acoes);
  const tela = render(<Previa valor={valor} no={propsDoNo(dados, alteracoes)} />);
  return { acoes, valor, tela };
}

function quadro(): HTMLIFrameElement {
  const iframe = document.querySelector("iframe");
  if (iframe === null) {
    throw new Error("iframe da prévia não encontrado");
  }
  return iframe;
}

describe("NoPrevia", () => {
  it("a barra tem endereço, recarregar, abrir no navegador, dica, minimizar e fechar", () => {
    const { acoes } = renderizar();

    expect(screen.getByRole("textbox", { name: "Endereço da prévia" })).toHaveValue("http://localhost:5173");
    expect(screen.getByRole("button", { name: "Recarregar a página" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "O que é a prévia" })).toBeInTheDocument();
    expect(screen.getByRole("tooltip")).toHaveTextContent("Alguns sites não aceitam abrir dentro de outra página");

    fireEvent.click(screen.getByRole("button", { name: "Minimizar a prévia" }));
    fireEvent.click(screen.getByRole("button", { name: "Fechar a prévia" }));
    expect(acoes.minimizarOuRestaurarPrevia).toHaveBeenCalledWith("p1");
    expect(acoes.fecharPrevia).toHaveBeenCalledWith("p1");
  });

  it("abrir no navegador é um link para o endereço, numa aba nova e sem acesso de volta à tela", () => {
    renderizar();
    const link = screen.getByRole("link", { name: "Abrir no navegador" });

    expect(link).toHaveAttribute("href", "http://localhost:5173");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("o iframe recebe credentialless e sandbox antes do endereço, e deixa rolar e clicar dentro dele", () => {
    const raiz = document.createElement("div");
    document.body.append(raiz);
    const atributos: string[] = [];
    const observador = new MutationObserver((registros) => {
      for (const registro of registros) {
        if (registro.target instanceof HTMLIFrameElement && registro.attributeName !== null) {
          atributos.push(registro.attributeName);
        }
      }
    });
    observador.observe(raiz, { attributes: true, subtree: true });

    const acoes = acoesDoCanvas();
    render(<Previa valor={valorDoCanvas(acoes)} no={propsDoNo()} />, { container: raiz });
    for (const registro of observador.takeRecords()) {
      if (registro.target instanceof HTMLIFrameElement && registro.attributeName !== null) {
        atributos.push(registro.attributeName);
      }
    }
    observador.disconnect();

    const iframe = quadro();
    expect(iframe).toHaveAttribute("credentialless", "");
    expect(iframe).toHaveAttribute("src", "http://localhost:5173");
    expect(atributos.indexOf("credentialless")).toBeGreaterThanOrEqual(0);
    expect(atributos.indexOf("credentialless")).toBeLessThan(atributos.indexOf("src"));
    expect(atributos.indexOf("sandbox")).toBeGreaterThanOrEqual(0);
    expect(atributos.indexOf("sandbox")).toBeLessThan(atributos.indexOf("src"));
    expect(iframe).toHaveClass("nodrag", "nowheel");
    raiz.remove();
  });

  it("o site roda scripts e formulários, mas não navega a janela de cima", () => {
    renderizar();

    const permissoes = (quadro().getAttribute("sandbox") ?? "").split(" ");
    expect(permissoes).toEqual(expect.arrayContaining(["allow-scripts", "allow-same-origin", "allow-forms", "allow-popups"]));
    expect(permissoes.some((permissao) => permissao.startsWith("allow-top-navigation"))).toBe(false);
  });

  it("Enter no endereço normaliza o que foi digitado e navega; endereço que não é http(s) é recusado", () => {
    const { acoes } = renderizar();
    const campo = screen.getByRole("textbox", { name: "Endereço da prévia" });

    fireEvent.change(campo, { target: { value: "localhost:3000/app" } });
    fireEvent.keyDown(campo, { key: "Enter" });
    expect(acoes.navegarPrevia).toHaveBeenCalledWith("p1", "http://localhost:3000/app");
    expect(campo).toHaveValue("http://localhost:3000/app");

    fireEvent.change(campo, { target: { value: "javascript:alert(1)" } });
    fireEvent.keyDown(campo, { key: "Enter" });
    expect(acoes.navegarPrevia).toHaveBeenCalledTimes(1);
    expect(campo).toHaveAttribute("aria-invalid", "true");
    expect(campo).toHaveAttribute("title", ENDERECO_INVALIDO);

    fireEvent.keyDown(campo, { key: "Escape" });
    expect(campo).toHaveValue("http://localhost:5173");
    expect(campo).toHaveAttribute("aria-invalid", "false");
  });

  it("recarregar recria o iframe; mover o nó não recarrega", () => {
    const acoes = acoesDoCanvas();
    const valor = valorDoCanvas(acoes);
    const { rerender } = render(<Previa valor={valor} no={propsDoNo()} />);
    const original = quadro();

    // Arraste: o React Flow re-renderiza o nó com outra posição e `dragging`.
    rerender(<Previa valor={valor} no={propsDoNo({}, { dragging: true, positionAbsoluteX: 40, positionAbsoluteY: 30 })} />);
    rerender(<Previa valor={valor} no={propsDoNo({}, { dragging: false, positionAbsoluteX: 40, positionAbsoluteY: 30, width: 800 })} />);
    expect(quadro()).toBe(original);

    fireEvent.click(screen.getByRole("button", { name: "Recarregar a página" }));
    const recriado = quadro();
    expect(recriado).not.toBe(original);
    expect(recriado).toHaveAttribute("credentialless", "");
    expect(recriado).toHaveAttribute("src", "http://localhost:5173");
  });

  it("Enter no mesmo endereço recarrega a página", () => {
    renderizar();
    const original = quadro();

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Endereço da prévia" }), { key: "Enter" });

    expect(quadro()).not.toBe(original);
  });

  it("navegar por fora troca o endereço do iframe e do campo", () => {
    const acoes = acoesDoCanvas();
    const valor = valorDoCanvas(acoes);
    const { rerender } = render(<Previa valor={valor} no={propsDoNo()} />);

    rerender(<Previa valor={valor} no={propsDoNo({ url: "http://localhost:3000" })} />);

    expect(quadro()).toHaveAttribute("src", "http://localhost:3000");
    expect(screen.getByRole("textbox", { name: "Endereço da prévia" })).toHaveValue("http://localhost:3000");
  });

  it("sem endereço: explica o que fazer, foca o campo e não tem iframe nem link", async () => {
    renderizar({ url: "", orquestradorId: null }, { selected: true });
    await act(async () => undefined);

    expect(screen.getByText(/Digite acima o endereço do servidor de desenvolvimento/)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Endereço da prévia" })).toHaveFocus();
    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.queryByRole("link", { name: "Abrir no navegador" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recarregar a página" })).toBeDisabled();
  });

  it("minimizada, o site fica carregado e só some da vista", () => {
    renderizar({ minimizada: true });

    expect(quadro().closest(".corpo-da-previa")).toHaveAttribute("hidden");
    expect(screen.getByRole("button", { name: "Restaurar a prévia" })).toBeInTheDocument();
  });
});
