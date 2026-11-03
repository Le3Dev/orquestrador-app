import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { api } from "../../shared/api/cliente";
import type { DadosDoSubagentePronto } from "../../shared/api/tipos";
import { PainelDePreferencias } from "./PainelDePreferencias";

describe("PainelDePreferencias", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const revisor: DadosDoSubagentePronto = {
    nome: "revisor",
    descricao: "Revisa código.",
    prompt: "Aponte bugs.",
    modelo: "sonnet",
  };

  async function abrir(instrucoesPadrao = "", subagentesProntos: DadosDoSubagentePronto[] = []) {
    vi.spyOn(api, "lerPreferencias").mockResolvedValue({ instrucoesPadrao, subagentesProntos });
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

  it("salva as instruções padrão, avisa a página e fecha", async () => {
    const alterar = vi
      .spyOn(api, "alterarPreferencias")
      .mockResolvedValue({ instrucoesPadrao: "Use pt-BR.", subagentesProntos: [] });
    const { aoFechar, aoSalvar, campo } = await abrir();

    fireEvent.change(campo, { target: { value: "Use pt-BR." } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(aoFechar).toHaveBeenCalled());
    expect(alterar).toHaveBeenCalledWith({ instrucoesPadrao: "Use pt-BR.", subagentesProntos: [] });
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

  describe("subagentes prontos", () => {
    it("lista os salvos e só habilita salvar quando algum muda", async () => {
      await abrir("", [revisor]);

      const cartao = screen.getByRole("listitem", { name: "Subagente pronto 1" });
      expect(within(cartao).getByRole("textbox", { name: "Nome" })).toHaveValue("revisor");
      expect(within(cartao).getByRole("combobox", { name: "Modelo" })).toHaveValue("sonnet");
      expect(screen.getByRole("button", { name: "Salvar" })).toBeDisabled();

      fireEvent.change(within(cartao).getByRole("textbox", { name: "Quando usar" }), { target: { value: "Outra." } });
      expect(screen.getByRole("button", { name: "Salvar" })).toBeEnabled();
    });

    it("adiciona, ajusta o nome para o formato aceito e salva a lista inteira", async () => {
      const alterar = vi
        .spyOn(api, "alterarPreferencias")
        .mockResolvedValue({ instrucoesPadrao: "", subagentesProntos: [] });
      await abrir("", [revisor]);

      fireEvent.click(screen.getByRole("button", { name: "+ Adicionar subagente pronto" }));
      const novo = screen.getByRole("listitem", { name: "Subagente pronto 2" });
      fireEvent.change(within(novo).getByRole("textbox", { name: "Nome" }), { target: { value: "Testador de Ação" } });
      fireEvent.change(within(novo).getByRole("textbox", { name: "Quando usar" }), { target: { value: "Rodar testes." } });
      fireEvent.change(within(novo).getByRole("textbox", { name: "Prompt" }), { target: { value: "Rode npm test." } });
      fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

      await waitFor(() => expect(alterar).toHaveBeenCalled());
      expect(alterar).toHaveBeenCalledWith({
        instrucoesPadrao: "",
        subagentesProntos: [
          revisor,
          { nome: "testador-de-acao", descricao: "Rodar testes.", prompt: "Rode npm test.", modelo: "herdar" },
        ],
      });
    });

    it("remover tira da lista; com 10, não deixa adicionar outro", async () => {
      const dez = Array.from({ length: 10 }, (_, i) => ({ ...revisor, nome: `r${i}` }));
      await abrir("", dez);

      expect(screen.getByRole("button", { name: "+ Adicionar subagente pronto" })).toBeDisabled();
      fireEvent.click(within(screen.getByRole("listitem", { name: "Subagente pronto 1" })).getByRole("button", { name: "Remover" }));
      expect(screen.getAllByRole("listitem")).toHaveLength(9);
      expect(screen.getByRole("button", { name: "+ Adicionar subagente pronto" })).toBeEnabled();
    });
  });
});
