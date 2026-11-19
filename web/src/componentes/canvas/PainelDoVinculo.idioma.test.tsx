import { fireEvent, render, screen } from "@testing-library/react";

import type { VinculoDto } from "../../shared/api/tipos";
import { definirIdioma } from "../../shared/idioma/idioma";
import { PainelDoVinculo } from "./PainelDoVinculo";

const VINCULO: VinculoDto = {
  id: "v1",
  orquestradorAId: "a",
  orquestradorBId: "b",
  notas: "agreed",
  criadoEm: "2026-01-01T00:00:00Z",
  atualizadoEm: "2026-01-01T00:00:00Z",
};

function renderizar() {
  render(
    <PainelDoVinculo
      vinculo={VINCULO}
      a={{ id: "a", nome: "Api", projeto: "server" }}
      b={{ id: "b", nome: "Web", projeto: "client" }}
      aoFechar={vi.fn()}
      aoSalvarNotas={vi.fn(async () => undefined)}
      aoEnviarMensagem={vi.fn(async () => undefined)}
      aoDesfazer={vi.fn(async () => undefined)}
    />,
  );
}

describe("PainelDoVinculo: idioma", () => {
  beforeEach(() => definirIdioma("en"));
  afterEach(() => definirIdioma("pt-BR"));

  it("o título, os campos e os botões ficam em inglês", () => {
    renderizar();

    expect(screen.getByRole("heading", { name: "Link: Api ↔ Web" })).toBeInTheDocument();
    expect(screen.getByText("Api (server) and Web (client) share these notes.")).toBeInTheDocument();
    expect(screen.getByText("Shared notes")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Agreements between the two orchestrators/)).toHaveValue("agreed");
    expect(screen.getByRole("button", { name: "Save notes" })).toBeDisabled();
    expect(screen.getByText("Send message")).toBeInTheDocument();
    expect(screen.getByLabelText("From")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Goes to Web's queue, on behalf of Api…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Salvar notas" })).not.toBeInTheDocument();
  });

  it("pede confirmação em inglês ao desfazer o vínculo", () => {
    renderizar();

    fireEvent.click(screen.getByRole("button", { name: "Remove link" }));

    expect(screen.getByText("Remove this link? Its notes will be lost.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
  });
});
