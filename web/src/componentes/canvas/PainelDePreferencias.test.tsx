import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { api } from "../../shared/api/cliente";
import { PainelDePreferencias } from "./PainelDePreferencias";

describe("PainelDePreferencias", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function abrir(instrucoesPadrao = "") {
    vi.spyOn(api, "lerPreferencias").mockResolvedValue({ instrucoesPadrao });
    const aoFechar = vi.fn();
    const aoSalvar = vi.fn();
    render(<PainelDePreferencias aoFechar={aoFechar} aoSalvar={aoSalvar} />);
    const campo = await screen.findByRole("textbox", { name: "Instruções padrão" });
    return { aoFechar, aoSalvar, campo };
  }

  it("carrega as instruções padrão salvas e só habilita salvar quando algo muda", async () => {
    const { campo } = await abrir("Responda curto.");

    expect(campo).toHaveValue("Responda curto.");
    expect(screen.getByRole("button", { name: "Salvar" })).toBeDisabled();
    fireEvent.change(campo, { target: { value: "Responda em tópicos." } });
    expect(screen.getByRole("button", { name: "Salvar" })).toBeEnabled();
  });

  it("salva só as instruções padrão, avisa a página e fecha", async () => {
    const alterar = vi.spyOn(api, "alterarPreferencias").mockResolvedValue({ instrucoesPadrao: "Use pt-BR." });
    const { aoFechar, aoSalvar, campo } = await abrir();

    fireEvent.change(campo, { target: { value: "Use pt-BR." } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(aoFechar).toHaveBeenCalled());
    expect(alterar).toHaveBeenCalledWith({ instrucoesPadrao: "Use pt-BR." });
    expect(aoSalvar).toHaveBeenCalled();
  });

  it("mostra o erro do servidor e continua aberto", async () => {
    vi.spyOn(api, "alterarPreferencias").mockRejectedValue(new Error("As instruções padrão devem ter até 4000 caracteres."));
    const { aoFechar, campo } = await abrir();

    fireEvent.change(campo, { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(await screen.findByText(/devem ter até 4000 caracteres/)).toBeInTheDocument();
    expect(aoFechar).not.toHaveBeenCalled();
  });

  it("cancelar fecha sem salvar", async () => {
    const alterar = vi.spyOn(api, "alterarPreferencias");
    const { aoFechar, campo } = await abrir();

    fireEvent.change(campo, { target: { value: "rascunho" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(aoFechar).toHaveBeenCalled();
    expect(alterar).not.toHaveBeenCalled();
  });
});
