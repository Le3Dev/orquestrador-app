import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { api } from "../../shared/api/cliente";
import type { DadosDoSubagentePronto } from "../../shared/api/tipos";
import { PainelDeInstrucoesGerais } from "./PainelDeInstrucoesGerais";

describe("PainelDeInstrucoesGerais", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const revisor: DadosDoSubagentePronto = {
    nome: "revisor",
    descricao: "Revisa código.",
    prompt: "Aponte bugs.",
    modelo: "sonnet",
  };

  async function abrir(instrucoesPadrao = "") {
    vi.spyOn(api, "lerPreferencias").mockResolvedValue({ instrucoesPadrao, subagentesProntos: [revisor] });
    const aoFechar = vi.fn();
    const aoSalvar = vi.fn();
    render(<PainelDeInstrucoesGerais aoFechar={aoFechar} aoSalvar={aoSalvar} />);
    const campo = await screen.findByRole("textbox", { name: "Instruções gerais" });
    return { aoFechar, aoSalvar, campo };
  }

  it("carrega as instruções gerais salvas e só habilita salvar quando algo muda", async () => {
    const { campo } = await abrir("Responda curto.");

    expect(campo).toHaveValue("Responda curto.");
    expect(screen.getByRole("button", { name: "O que é Instruções gerais" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar" })).toBeDisabled();
    fireEvent.change(campo, { target: { value: "Responda em tópicos." } });
    expect(screen.getByRole("button", { name: "Salvar" })).toBeEnabled();
  });

  it("salva só as instruções gerais (os subagentes ficam como estão), avisa a página e fecha", async () => {
    const alterar = vi
      .spyOn(api, "alterarPreferencias")
      .mockResolvedValue({ instrucoesPadrao: "Use pt-BR.", subagentesProntos: [revisor] });
    const { aoFechar, aoSalvar, campo } = await abrir();

    fireEvent.change(campo, { target: { value: "Use pt-BR." } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(aoFechar).toHaveBeenCalled());
    expect(alterar).toHaveBeenCalledWith({ instrucoesPadrao: "Use pt-BR." });
    expect(aoSalvar).toHaveBeenCalled();
  });

  it("mostra o erro do servidor e continua aberto", async () => {
    vi.spyOn(api, "alterarPreferencias").mockRejectedValue(new Error("As instruções gerais devem ter até 4000 caracteres."));
    const { aoFechar, campo } = await abrir();

    fireEvent.change(campo, { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(await screen.findByText(/devem ter até 4000 caracteres/)).toBeInTheDocument();
    expect(aoFechar).not.toHaveBeenCalled();
  });

  it("cancelar e Esc fecham sem salvar", async () => {
    const alterar = vi.spyOn(api, "alterarPreferencias");
    const { aoFechar, campo } = await abrir();

    fireEvent.change(campo, { target: { value: "rascunho" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    fireEvent.keyDown(campo, { key: "Escape" });

    expect(aoFechar).toHaveBeenCalledTimes(2);
    expect(alterar).not.toHaveBeenCalled();
  });

  it("Esc de fora do painel não fecha", async () => {
    const { aoFechar, campo } = await abrir();
    const fora = document.createElement("input");
    document.body.append(fora);

    fireEvent.change(campo, { target: { value: "rascunho" } });
    fireEvent.keyDown(fora, { key: "Escape" });

    expect(aoFechar).not.toHaveBeenCalled();
    expect(campo).toHaveValue("rascunho");
    fora.remove();
  });
});
