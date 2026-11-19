import { act, createRef } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";

import { definirIdioma } from "../../shared/idioma/idioma";
import type { FonteDaPaleta } from "../../shared/paletaDeComandos";
import { type ControleDaPaleta, PaletaDeComandos } from "./PaletaDeComandos";

const fonte = (): FonteDaPaleta => ({
  podeOrganizar: true,
  podeAbrirAjustes: false,
  atualizacao: null,
  orquestradores: [{ id: "o1", nome: "Sales dashboard", nomeDaPasta: "painel-app", situacao: "trabalhando" }],
  abertos: new Set(["o1"]),
  notas: [{ notaId: "n1", titulo: "", texto: "" }],
  artefatos: [],
  conversas: new Map(),
});

describe("PaletaDeComandos: idioma", () => {
  beforeEach(() => definirIdioma("en"));
  afterEach(() => definirIdioma("pt-BR"));

  it("o campo, os grupos, as ações e os itens ficam em inglês", () => {
    const controle = createRef<ControleDaPaleta>();
    render(<PaletaDeComandos lerFonte={fonte} aoExecutar={vi.fn()} controle={controle} />);
    act(() => controle.current?.abrir());

    expect(screen.getByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Search actions, orchestrators, notes, artifacts and requests" }),
    ).toBeInTheDocument();

    const lista = screen.getByRole("listbox", { name: "Results" });
    expect(within(lista).getByText("Actions")).toBeInTheDocument();
    expect(within(lista).getByText("Orchestrators")).toBeInTheDocument();
    expect(within(lista).getByText("New orchestrator")).toBeInTheDocument();
    expect(within(lista).getByText("Fit everything")).toBeInTheDocument();
    expect(within(lista).getByText("Untitled note")).toBeInTheDocument();
    expect(within(lista).getByText("painel-app · working · on canvas")).toBeInTheDocument();
    expect(within(lista).queryByText("Novo orquestrador")).not.toBeInTheDocument();
  });

  it("busca pelo termo em inglês e mostra a mensagem de nada encontrado", () => {
    const controle = createRef<ControleDaPaleta>();
    render(<PaletaDeComandos lerFonte={fonte} aoExecutar={vi.fn()} controle={controle} />);
    act(() => controle.current?.abrir());
    const campo = screen.getByRole("combobox");

    fireEvent.change(campo, { target: { value: "zoom" } });
    expect(screen.getByText("Zoom 100%")).toBeInTheDocument();

    fireEvent.change(campo, { target: { value: "xyzxyz" } });
    expect(screen.getByText("Nothing found.")).toBeInTheDocument();
  });
});
