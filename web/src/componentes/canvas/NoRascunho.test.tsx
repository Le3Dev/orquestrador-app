import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type NodeProps, ReactFlowProvider } from "@xyflow/react";

import { api } from "../../shared/api/cliente";
import type { ResumoDoOrquestrador } from "../../shared/api/tipos";
import { ProvedorDoCanvas, type ValorDoCanvas } from "../../shared/canvas/contexto";
import type { NoRascunho as TipoDoNo } from "../../shared/canvas/nos";
import { NoRascunho } from "./NoRascunho";

const PROPS: NodeProps<TipoDoNo> = {
  id: "rascunho:1",
  type: "rascunho",
  data: {},
  selected: false,
  selectable: true,
  draggable: true,
  deletable: true,
  isConnectable: false,
  dragging: false,
  zIndex: 0,
  positionAbsoluteX: 0,
  positionAbsoluteY: 0,
  width: 760,
  height: 720,
};

function abrir() {
  const acoes = {
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
  const valor = {
    orquestradores: new Map(),
    conversas: new Map(),
    conexoes: new Map(),
    sinais: new Map(),
    bixinhosLimpos: new Map(),
    servidor: { conectado: true, caiuEm: null, voltouEm: null, reiniciou: false, memoria: null },
    acoes,
  } as unknown as ValorDoCanvas;
  render(
    <ReactFlowProvider>
      <ProvedorDoCanvas valor={valor}>
        <NoRascunho {...PROPS} />
      </ProvedorDoCanvas>
    </ReactFlowProvider>,
  );
  return acoes;
}

describe("NoRascunho", () => {
  beforeEach(() => {
    vi.spyOn(api, "listarPastas").mockResolvedValue({ raiz: "/p", pastas: [{ nome: "app", caminho: "/p/app" }] });
    vi.spyOn(api, "listarPredefinicoes").mockResolvedValue([]);
    vi.spyOn(api, "lerEsforcoHerdado").mockResolvedValue({ orquestrador: null, subagentes: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("escolher o projeto dá o nome, e cria com as instruções personalizadas digitadas", async () => {
    const criado = { id: "novo" } as ResumoDoOrquestrador;
    const criar = vi.spyOn(api, "criarOrquestrador").mockResolvedValue(criado);
    const acoes = abrir();

    const pasta = screen.getByRole("combobox", { name: "Pasta de trabalho" });
    await screen.findByRole("option", { name: "app" });
    fireEvent.change(pasta, { target: { value: "/p/app" } });
    expect(screen.getByRole("textbox", { name: "Nome" })).toHaveValue("app");

    fireEvent.change(screen.getByRole("textbox", { name: "Instruções personalizadas (opcional)" }), {
      target: { value: "Seja breve." },
    });
    expect(screen.getByRole("button", { name: "Pré-visualizar prompt final" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /iniciar orquestrador/ }));

    await waitFor(() =>
      expect(criar).toHaveBeenCalledWith(
        expect.objectContaining({ nome: "app", pastaDeTrabalho: "/p/app", instrucoesPersonalizadas: "Seja breve." }),
      ),
    );
    await waitFor(() => expect(acoes.orquestradorCriado).toHaveBeenCalledWith("rascunho:1", criado));
  });

  it("\"procurar…\" abre a janela para escolher uma pasta do computador", async () => {
    vi.spyOn(api, "navegarPastas").mockReturnValue(new Promise(() => undefined));
    abrir();

    fireEvent.click(screen.getByRole("button", { name: "procurar…" }));

    expect(await screen.findByRole("dialog", { name: "Escolher pasta do computador" })).toBeInTheDocument();
  });
});
