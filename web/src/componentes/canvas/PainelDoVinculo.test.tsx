import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { VinculoDto } from "../../shared/api/tipos";
import { PainelDoVinculo } from "./PainelDoVinculo";

const VINCULO: VinculoDto = {
  id: "v1",
  orquestradorAId: "a",
  orquestradorBId: "b",
  notas: "combinado",
  criadoEm: "2026-01-01T00:00:00Z",
  atualizadoEm: "2026-01-01T00:00:00Z",
};

function renderizar(sobrescritas: Partial<Parameters<typeof PainelDoVinculo>[0]> = {}) {
  const props = {
    vinculo: VINCULO,
    a: { id: "a", nome: "Api", projeto: "servidor" },
    b: { id: "b", nome: "Web", projeto: "cliente" },
    aoFechar: vi.fn(),
    aoSalvarNotas: vi.fn(async () => undefined),
    aoEnviarMensagem: vi.fn(async () => undefined),
    aoDesfazer: vi.fn(async () => undefined),
    ...sobrescritas,
  };
  render(<PainelDoVinculo {...props} />);
  return props;
}

describe("PainelDoVinculo", () => {
  it("mostra as notas e só habilita Salvar depois de editar", async () => {
    const props = renderizar();
    const notas = screen.getByPlaceholderText(/Combinados entre/);
    expect(notas).toHaveValue("combinado");
    const salvar = screen.getByRole("button", { name: "Salvar notas" });
    expect(salvar).toBeDisabled();

    fireEvent.change(notas, { target: { value: "novo texto" } });
    fireEvent.click(salvar);

    await waitFor(() => expect(props.aoSalvarNotas).toHaveBeenCalledWith("novo texto"));
    expect(await screen.findByText("Notas salvas.")).toBeInTheDocument();
  });

  it("envia a mensagem de quem foi escolhido em 'De' e limpa a caixa", async () => {
    const props = renderizar();

    fireEvent.change(screen.getByLabelText("De"), { target: { value: "b" } });
    fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: "  oi, Api  " } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    await waitFor(() => expect(props.aoEnviarMensagem).toHaveBeenCalledWith("b", "oi, Api"));
    await waitFor(() => expect(screen.getByLabelText("Mensagem")).toHaveValue(""));
  });

  it("não envia mensagem em branco", () => {
    renderizar();

    fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: "   " } });

    expect(screen.getByRole("button", { name: "Enviar" })).toBeDisabled();
  });

  it("desfazer pede confirmação; cancelar não desfaz", () => {
    const props = renderizar();

    fireEvent.click(screen.getByRole("button", { name: "Desfazer vínculo" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(props.aoDesfazer).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Desfazer vínculo" })).toBeInTheDocument();
  });

  it("confirmar desfaz o vínculo e fecha o painel", async () => {
    const props = renderizar();

    fireEvent.click(screen.getByRole("button", { name: "Desfazer vínculo" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(props.aoDesfazer).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(props.aoFechar).toHaveBeenCalled());
  });

  it("mostra o erro do servidor ao salvar", async () => {
    renderizar({ aoSalvarNotas: vi.fn(async () => Promise.reject(new Error("Notas longas demais."))) });

    fireEvent.change(screen.getByPlaceholderText(/Combinados entre/), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar notas" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Notas longas demais.");
  });

  it("Esc fecha o painel", () => {
    const props = renderizar();

    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(props.aoFechar).toHaveBeenCalled();
  });
});
