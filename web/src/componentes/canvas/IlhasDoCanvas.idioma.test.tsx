import { render, screen } from "@testing-library/react";

import type { JanelaDaCota, LeituraDeMemoria } from "../../shared/api/tipos";
import { definirIdioma } from "../../shared/idioma/idioma";
import { IlhaDaDireita, NotificacoesDoCanvas } from "./IlhasDoCanvas";

vi.mock("@xyflow/react", () => ({
  useReactFlow: () => ({ zoomIn: vi.fn(), zoomOut: vi.fn() }),
  useStore: (seletor: (estado: unknown) => unknown) => seletor({ transform: [0, 0, 1], minZoom: 0.1, maxZoom: 2 }),
}));

const GB = 1024 ** 3;
function memoria(livreGb: number): LeituraDeMemoria {
  return {
    totalBytes: 16 * GB,
    livreBytes: livreGb * GB,
    servidorBytes: 0,
    agentesBytes: 0,
    porOrquestrador: {},
    lidaEm: "2026-11-10T12:00:00Z",
  };
}

describe("Ilhas do canvas: idioma", () => {
  beforeEach(() => definirIdioma("en"));
  afterEach(() => definirIdioma("pt-BR"));

  it("a ilha da direita descreve a cota, a memória e os botões em inglês", () => {
    const cota: JanelaDaCota[] = [
      { nome: "7 dias", utilizacao: 0.38, renovaEm: null, situacao: "allowed" },
      { nome: "5 horas", utilizacao: 0.42, renovaEm: null, situacao: "allowed" },
    ];
    render(
      <IlhaDaDireita
        aoBuscar={vi.fn()}
        trabalhando={2}
        memoria={memoria(8)}
        cota={cota}
        aoAlternarConfiguracoes={vi.fn()}
        configuracoesAbertas={false}
        abaAberta={null}
      />,
    );

    expect(screen.getByRole("group", { name: "Search, status and settings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Search (Ctrl+K)" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "2 working now" })).toBeInTheDocument();
    expect(screen.getByTestId("indicador-de-uso")).toHaveAccessibleName(
      "Claude usage: week 38%; 5 h session 42%. Open Settings, Account",
    );
    expect(screen.getByTestId("anel-de-memoria")).toHaveAccessibleName(
      "Computer memory: 50% in use. Open Settings, System",
    );
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Configurações" })).not.toBeInTheDocument();
  });

  it("a notificação de memória baixa aparece em inglês", () => {
    render(<NotificacoesDoCanvas memoria={memoria(1.2)} cota={null} aoVerSistema={vi.fn()} pedidosEmAndamento={0} />);

    expect(screen.getByRole("region", { name: "Notifications" })).toBeInTheDocument();
    expect(screen.getByText(/Low memory: new requests/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View System" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Got it: memory" })).toBeInTheDocument();
  });
});
