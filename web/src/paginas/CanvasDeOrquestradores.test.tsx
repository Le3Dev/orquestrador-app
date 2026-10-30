import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { api } from "../shared/api/cliente";
import type { DadosDaNota } from "../shared/api/tipos";
import { lerLayout } from "../shared/canvas/layout";
import { CanvasDeOrquestradores } from "./CanvasDeOrquestradores";

// O canvas sem servidor: nenhum orquestrador, conectado e sem conversas.
const simulados = vi.hoisted(() => ({
  orquestradores: { orquestradores: [], erro: null, recarregar: async () => undefined },
  servidor: { conectado: true, caiuEm: null, voltouEm: null, reiniciou: false, memoria: null },
  conversas: { conversas: new Map(), conexoes: new Map(), sinais: new Map() },
}));

vi.mock("../shared/hooks/useOrquestradores", () => ({ useOrquestradores: () => simulados.orquestradores }));
vi.mock("../shared/hooks/useServidor", () => ({ useServidor: () => simulados.servidor }));
vi.mock("../shared/hooks/useConversas", () => ({ useConversas: () => simulados.conversas }));

/** O jsdom não mede nada: o React Flow só precisa que o observador exista. */
class ObservadorDeTamanhoFalso {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function nota(id: string, alteracoes: Partial<DadosDaNota> = {}): DadosDaNota {
  return {
    id,
    titulo: "Nova nota",
    texto: "",
    criadaEm: "2026-10-30T12:00:00Z",
    atualizadaEm: "2026-10-30T12:00:00Z",
    ...alteracoes,
  };
}

describe("CanvasDeOrquestradores · notas", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ObservadorDeTamanhoFalso);
    // O aviso do React Flow sobre o contêiner sem tamanho (o jsdom não tem layout).
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("\"+ notas\" chama o POST, cria o nó com o foco no texto e guarda a nota no layout", async () => {
    vi.spyOn(api, "listarNotas").mockResolvedValue([]);
    const criar = vi.spyOn(api, "criarNota").mockResolvedValue(nota("n1"));
    render(<CanvasDeOrquestradores />);

    fireEvent.click(screen.getByRole("button", { name: "+ notas" }));

    const campo = await screen.findByRole("textbox", { name: "Texto da nota" });
    expect(criar).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(campo).toHaveFocus());
    await waitFor(() => expect(lerLayout().notas.n1).toMatchObject({ minimizada: false }));
  });

  it("ao abrir, mostra as notas do servidor; a que sumiu do servidor sai do layout", async () => {
    localStorage.setItem(
      "orquestrador-agentes:canvas:v1",
      JSON.stringify({
        terminais: {},
        notas: {
          n1: { x: 0, y: 0, largura: 320, altura: 280, minimizada: true },
          apagada: { x: 400, y: 0, largura: 320, altura: 280, minimizada: false },
        },
        viewport: { x: 0, y: 0, zoom: 1 },
      }),
    );
    vi.spyOn(api, "listarNotas").mockResolvedValue([nota("n1", { titulo: "Compras", texto: "pão\nleite" })]);
    render(<CanvasDeOrquestradores />);

    expect(await screen.findByText("Compras")).toBeInTheDocument();
    // Minimizada no layout: só a barra, com a prévia da primeira linha.
    expect(screen.getByTestId("previa-da-nota")).toHaveTextContent("pão");
    expect(screen.queryByRole("textbox", { name: "Texto da nota" })).not.toBeInTheDocument();
    await waitFor(() => expect(Object.keys(lerLayout().notas)).toEqual(["n1"]));
    expect(lerLayout().notas.n1).toMatchObject({ minimizada: true, altura: 280 });
  });
});
