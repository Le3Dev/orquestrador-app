import { fireEvent, render, screen, within } from "@testing-library/react";

import type { ResumoDoOrquestrador } from "../../shared/api/tipos";
import { definirIdioma } from "../../shared/idioma/idioma";
import { MenuNovo } from "./MenuNovo";

const ORQUESTRADOR = {
  id: "o1",
  nome: "Bakery site",
  nomeDaPasta: "pasta-o1",
  situacao: "trabalhando",
} as ResumoDoOrquestrador;

function montar(rotinasAguardandoAprovacao = 0) {
  render(
    <MenuNovo
      aoCriar={vi.fn()}
      aoCriarNota={vi.fn()}
      aoCriarPrevia={vi.fn()}
      aoCriarShell={vi.fn()}
      aoBuscar={vi.fn()}
      aoAbrirConfiguracoes={vi.fn()}
      orquestradores={[ORQUESTRADOR]}
      erroDosOrquestradores={null}
      noCanvas={new Set(["o1"])}
      aoEscolherOrquestrador={vi.fn()}
      subagentes={[]}
      aoAbrirSubagentes={vi.fn()}
      aoAbrirRotinas={vi.fn()}
      rotinasAguardandoAprovacao={rotinasAguardandoAprovacao}
      skills={[]}
      erroDasSkills={null}
      aoAbrirSkills={vi.fn()}
      aoExplorarMarketplace={vi.fn()}
    />,
  );
}

describe("MenuNovo: idioma", () => {
  beforeEach(() => definirIdioma("en"));
  afterEach(() => definirIdioma("pt-BR"));

  it("o botão, os itens e os submenus ficam em inglês", () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: "New" }));

    const menu = screen.getByRole("menu", { name: "New" });
    for (const nome of ["New orchestrator", "Note", "Terminal", "Preview", "Routines", "Search", "Settings"]) {
      expect(within(menu).getByRole("menuitem", { name: new RegExp(`^${nome}`) })).toBeInTheDocument();
    }
    expect(within(menu).queryByRole("menuitem", { name: /Novo orquestrador/ })).not.toBeInTheDocument();

    fireEvent.click(within(menu).getByRole("menuitem", { name: /^Orchestrators/ }));
    const submenu = screen.getByRole("menu", { name: "Orchestrators" });
    expect(within(submenu).getByText("1 orchestrator, 1 working")).toBeInTheDocument();
    expect(within(submenu).getByRole("menuitem", { name: "Bakery site, working, folder pasta-o1, open on the canvas" })).toBeInTheDocument();
    expect(within(submenu).getByText("Choosing one takes you to its window on the canvas.")).toBeInTheDocument();
  });

  it("com rotinas aguardando aprovação, o rótulo do botão diz quantas em inglês", () => {
    montar(2);

    expect(screen.getByRole("button", { name: "New, 2 routines awaiting approval" })).toBeInTheDocument();
  });
});
