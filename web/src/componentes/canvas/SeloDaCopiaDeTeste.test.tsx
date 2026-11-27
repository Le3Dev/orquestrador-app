import { render, screen, within } from "@testing-library/react";

import { IlhaDoNome } from "./IlhasDoCanvas";
import { SeloDaCopiaDeTeste } from "./SeloDaCopiaDeTeste";

vi.mock("@xyflow/react", () => ({
  useReactFlow: () => ({ zoomIn: vi.fn(), zoomOut: vi.fn() }),
  useStore: (seletor: (estado: unknown) => unknown) => seletor({ transform: [0, 0, 1], minZoom: 0.1, maxZoom: 2 }),
}));

const janelaComPonte = window as unknown as { electron?: unknown };

describe("SeloDaCopiaDeTeste", () => {
  afterEach(() => {
    delete janelaComPonte.electron;
  });

  it("sem a ponte, no app instalado (copiaDeTeste null) ou com o nome vazio, não desenha nada", () => {
    const { container, rerender } = render(<SeloDaCopiaDeTeste />);
    expect(container).toBeEmptyDOMElement();

    janelaComPonte.electron = { desktop: true, copiaDeTeste: null };
    rerender(<SeloDaCopiaDeTeste key="instalado" />);
    expect(container).toBeEmptyDOMElement();

    janelaComPonte.electron = { desktop: true, copiaDeTeste: "   " };
    rerender(<SeloDaCopiaDeTeste key="vazio" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("na cópia de teste, mostra o selo com a branch na ilha do nome do app", () => {
    janelaComPonte.electron = { desktop: true, copiaDeTeste: "feature/atualizar-pelo-botao-no-mac" };
    render(
      <IlhaDoNome
        aoCriar={vi.fn()}
        aoCriarNota={vi.fn()}
        aoCriarPrevia={vi.fn()}
        aoBuscar={vi.fn()}
        aoAbrirConfiguracoes={vi.fn()}
        orquestradores={[]}
        erroDosOrquestradores={null}
        noCanvas={new Set<string>()}
        aoEscolherOrquestrador={vi.fn()}
        subagentes={[]}
        aoAbrirSubagentes={vi.fn()}
        aoAbrirRotinas={vi.fn()}
        rotinasAguardandoAprovacao={0}
        skills={[]}
        erroDasSkills={null}
        aoAbrirSkills={vi.fn()}
        aoExplorarMarketplace={vi.fn()}
      />,
    );

    const selo = within(screen.getByTestId("ilha-do-nome")).getByTestId("selo-da-copia-de-teste");
    expect(selo).toHaveTextContent("Cópia de teste: feature/atualizar-pelo-botao-no-mac");
    expect(selo).toHaveAttribute("title", expect.stringContaining("Não é o app instalado."));
  });
});
