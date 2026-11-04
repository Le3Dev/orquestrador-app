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
  width: 520,
  height: 480,
};

function existente(id: string, pastaDeTrabalho: string, criadoEm: string): ResumoDoOrquestrador {
  return { id, pastaDeTrabalho, criadoEm, nomeDaPasta: pastaDeTrabalho.split("/").at(-1) } as ResumoDoOrquestrador;
}

function abrir(orquestradores: ResumoDoOrquestrador[] = []) {
  const acoes = {
    abrirTerminal: vi.fn(),
    fecharTerminal: vi.fn(),
    limparBixinhos: vi.fn(),
    orquestradorCriado: vi.fn(),
    descartarRascunho: vi.fn(),
    recarregar: vi.fn(async () => undefined),
  };
  const valor: ValorDoCanvas = {
    orquestradores: new Map(orquestradores.map((o) => [o.id, o])),
    conversas: new Map(),
    conexoes: new Map(),
    sinais: new Map(),
    bixinhosLimpos: new Map(),
    servidor: { conectado: true, caiuEm: null, voltouEm: null, reiniciou: false, memoria: null },
    acoes,
  };
  render(
    <ReactFlowProvider>
      <ProvedorDoCanvas valor={valor}>
        <NoRascunho {...PROPS} />
      </ProvedorDoCanvas>
    </ReactFlowProvider>,
  );
  return acoes;
}

const botaoDeComecar = () => screen.getByRole("button", { name: /^começar/ });

describe("NoRascunho", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("começa só pela pasta: a permissão aparece depois e o botão diz por que espera", () => {
    abrir();

    expect(screen.getByText("Em qual pasta o Claude vai trabalhar?")).toBeInTheDocument();
    expect(screen.queryByText("O que o Claude pode fazer nesta pasta?")).not.toBeInTheDocument();
    expect(screen.getByText("Escolha uma pasta primeiro.")).toBeInTheDocument();
    expect(botaoDeComecar()).toBeDisabled();
  });

  it("recentes sem repetir, a mais nova primeiro", () => {
    abrir([
      existente("a", "/p/velho", "2026-10-01T00:00:00Z"),
      existente("b", "/p/novo", "2026-11-01T00:00:00Z"),
      existente("c", "/p/velho", "2026-10-02T00:00:00Z"),
    ]);

    const recentes = screen.getByRole("list", { name: "Pastas recentes" });
    expect([...recentes.querySelectorAll("li")].map((item) => item.textContent)).toEqual([
      expect.stringContaining("novo"),
      expect.stringContaining("velho"),
    ]);
  });

  it("escolher a pasta dá o nome, mostra a permissão e cria com o que foi escolhido", async () => {
    const criado = existente("novo", "/p/meu-app", "2026-11-03T00:00:00Z");
    const criar = vi.spyOn(api, "criarOrquestrador").mockResolvedValue(criado);
    const acoes = abrir([existente("a", "/p/meu-app", "2026-10-01T00:00:00Z")]);

    fireEvent.click(screen.getByRole("button", { name: /meu-app/ }));

    expect(screen.getByRole("textbox", { name: "Nome do orquestrador" })).toHaveValue("meu-app");
    expect(screen.getByRole("radio", { name: /Só olhar e responder/ })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: /Mudar arquivos e rodar comandos/ }));
    fireEvent.click(botaoDeComecar());

    await waitFor(() => expect(acoes.orquestradorCriado).toHaveBeenCalledWith("rascunho:1", criado));
    expect(criar).toHaveBeenCalledWith(
      expect.objectContaining({ nome: "meu-app", pastaDeTrabalho: "/p/meu-app", nivelDePermissao: "edicao_e_comandos" }),
    );
  });

  it("um nome editado à mão não é trocado ao trocar de pasta", () => {
    abrir([existente("a", "/p/um", "2026-10-01T00:00:00Z"), existente("b", "/p/dois", "2026-10-02T00:00:00Z")]);

    fireEvent.click(screen.getByRole("button", { name: /dois/ }));
    expect(botaoDeComecar()).toHaveTextContent("começar em dois");
    fireEvent.change(screen.getByRole("textbox", { name: "Nome do orquestrador" }), { target: { value: "API" } });
    fireEvent.click(screen.getByRole("button", { name: "trocar" }));
    fireEvent.click(screen.getByRole("button", { name: /um/ }));

    expect(screen.getByRole("textbox", { name: "Nome do orquestrador" })).toHaveValue("API");
  });

  it("os ajustes ficam recolhidos e abrem sem repetir a permissão", () => {
    abrir([existente("a", "/p/app", "2026-10-01T00:00:00Z")]);
    fireEvent.click(screen.getByRole("button", { name: /app/ }));

    const ajustar = screen.getByRole("button", { expanded: false });
    fireEvent.click(ajustar);

    expect(ajustar).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("radio", { name: /Só olhar|Só leitura/ })).toHaveLength(1);
  });

  it("sem nome, não começa e diz por quê", () => {
    abrir([existente("a", "/p/app", "2026-10-01T00:00:00Z")]);
    fireEvent.click(screen.getByRole("button", { name: /app/ }));

    fireEvent.change(screen.getByRole("textbox", { name: "Nome do orquestrador" }), { target: { value: "  " } });

    expect(screen.getByText("Dê um nome ao orquestrador.")).toBeInTheDocument();
    expect(botaoDeComecar()).toBeDisabled();
  });
});
