import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { api } from "../../shared/api/cliente";
import type { DadosDoSubagentePronto } from "../../shared/api/tipos";
import { PainelDeSubagentes } from "./PainelDeSubagentes";

describe("PainelDeSubagentes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const revisor: DadosDoSubagentePronto = {
    nome: "revisor",
    descricao: "Revisa código.",
    prompt: "Aponte bugs.",
    modelo: "sonnet",
  };
  const testador: DadosDoSubagentePronto = {
    nome: "testador",
    descricao: "Escreve testes.",
    prompt: "Rode npm test.",
    modelo: "herdar",
  };

  async function abrir(subagentesProntos: DadosDoSubagentePronto[] = [revisor, testador]) {
    vi.spyOn(api, "lerPreferencias").mockResolvedValue({ instrucoesPadrao: "Use pt-BR.", subagentesProntos });
    const aoFechar = vi.fn();
    const aoSalvar = vi.fn();
    render(<PainelDeSubagentes aoFechar={aoFechar} aoSalvar={aoSalvar} />);
    await screen.findByRole("heading", { name: "Subagentes prontos" });
    await waitFor(() => expect(screen.queryByText("carregando…")).not.toBeInTheDocument());
    return { aoFechar, aoSalvar };
  }

  const lista = () => screen.getByRole("list", { name: "Lista de subagentes" });
  const item = (nome: string | RegExp) => within(lista()).getByRole("button", { name: nome });
  const campo = (rotulo: string) => screen.getByRole("textbox", { name: rotulo });
  const salvar = () => screen.getByRole("button", { name: "Salvar" });

  it("lista os salvos, abre o primeiro e troca o escolhido ao clicar", async () => {
    await abrir();

    expect(within(lista()).getAllByRole("button")).toHaveLength(2);
    expect(item(/revisor/)).toHaveAttribute("aria-pressed", "true");
    expect(item(/revisor/)).toHaveTextContent("sonnet");
    expect(campo("Nome")).toHaveValue("revisor");
    expect(screen.getByRole("combobox", { name: "Modelo" })).toHaveValue("sonnet");

    fireEvent.click(item(/testador/));

    expect(item(/testador/)).toHaveAttribute("aria-pressed", "true");
    expect(item(/revisor/)).toHaveAttribute("aria-pressed", "false");
    expect(campo("Nome")).toHaveValue("testador");
    expect(campo("Quando usar")).toHaveValue("Escreve testes.");
    expect(salvar()).toBeDisabled();
  });

  it("cada campo tem a sua dica", async () => {
    await abrir();

    for (const rotulo of ["Nome", "Modelo", "Quando usar", "Prompt"]) {
      expect(screen.getByRole("button", { name: `O que é ${rotulo}` })).toBeInTheDocument();
    }
  });

  it("cria um novo, normaliza o nome e salva só a lista de subagentes", async () => {
    const alterar = vi
      .spyOn(api, "alterarPreferencias")
      .mockResolvedValue({ instrucoesPadrao: "Use pt-BR.", subagentesProntos: [] });
    const { aoFechar, aoSalvar } = await abrir([revisor]);

    fireEvent.click(screen.getByRole("button", { name: "+ Novo subagente" }));
    expect(item(/sem-nome/)).toHaveAttribute("aria-pressed", "true");
    expect(campo("Nome")).toHaveFocus();
    expect(salvar()).toBeDisabled();

    fireEvent.change(campo("Nome"), { target: { value: "Testador de Ação" } });
    expect(campo("Nome")).toHaveValue("testador-de-acao");
    fireEvent.change(screen.getByRole("combobox", { name: "Modelo" }), { target: { value: "haiku" } });
    fireEvent.change(campo("Quando usar"), { target: { value: "Rodar testes." } });
    fireEvent.change(campo("Prompt"), { target: { value: "Rode npm test." } });
    fireEvent.click(salvar());

    await waitFor(() => expect(aoFechar).toHaveBeenCalled());
    expect(alterar).toHaveBeenCalledWith({
      subagentesProntos: [
        revisor,
        { nome: "testador-de-acao", descricao: "Rodar testes.", prompt: "Rode npm test.", modelo: "haiku" },
      ],
    });
    expect(aoSalvar).toHaveBeenCalled();
  });

  it("editar habilita salvar; nome repetido ou campo vazio desabilitam e explicam", async () => {
    await abrir();

    fireEvent.change(campo("Quando usar"), { target: { value: "Revisa o diff." } });
    expect(salvar()).toBeEnabled();

    fireEvent.change(campo("Nome"), { target: { value: "testador" } });
    expect(salvar()).toBeDisabled();
    expect(screen.getByText(/já existe um "testador"/)).toBeInTheDocument();

    fireEvent.change(campo("Nome"), { target: { value: "revisor" } });
    fireEvent.change(campo("Prompt"), { target: { value: "   " } });
    expect(salvar()).toBeDisabled();
    expect(screen.getByText(/escreva o prompt/)).toBeInTheDocument();
  });

  it("remover tira o escolhido e passa para o vizinho; sem nenhum, mostra o estado vazio", async () => {
    await abrir();

    fireEvent.click(screen.getByRole("button", { name: "Remover" }));
    expect(within(lista()).getAllByRole("button")).toHaveLength(1);
    expect(campo("Nome")).toHaveValue("testador");

    fireEvent.click(screen.getByRole("button", { name: "Remover" }));
    expect(screen.getByText("Nenhum subagente pronto")).toBeInTheDocument();
    expect(salvar()).toBeEnabled();
    expect(screen.getByRole("button", { name: "+ Novo subagente" })).toBeEnabled();
  });

  it("sem nenhum salvo, explica e deixa criar", async () => {
    await abrir([]);

    expect(screen.getByText("Nenhum subagente pronto")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "+ Novo subagente" }));
    expect(campo("Nome")).toHaveValue("");
  });

  it("com 30, não deixa criar outro e mostra 30 / 30", async () => {
    await abrir(Array.from({ length: 30 }, (_, i) => ({ ...revisor, nome: `r${i}` })));

    expect(screen.getByRole("button", { name: "+ Novo subagente" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "+ Novo subagente" })).toHaveAccessibleDescription("Limite de 30 atingido.");
    expect(screen.getByText("30 / 30")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remover" }));
    expect(screen.getByRole("button", { name: "+ Novo subagente" })).toBeEnabled();
    expect(screen.queryByText("Limite de 30 atingido.")).not.toBeInTheDocument();
    expect(screen.getByText("29 / 30")).toBeInTheDocument();
  });

  it("o contador do prompt acompanha o texto e fica vermelho ao passar do limite", async () => {
    await abrir();

    expect(screen.getByText("12 / 4.000")).toHaveClass("text-muted");
    fireEvent.change(campo("Prompt"), { target: { value: "x".repeat(4_001) } });

    expect(screen.getByText("4.001 / 4.000")).toHaveClass("text-error");
    expect(campo("Prompt")).toHaveAttribute("aria-invalid", "true");
    expect(salvar()).toBeDisabled();
  });

  it("Esc e Cancelar fecham sem salvar", async () => {
    const alterar = vi.spyOn(api, "alterarPreferencias");
    const { aoFechar } = await abrir();

    fireEvent.change(campo("Quando usar"), { target: { value: "Outra." } });
    fireEvent.keyDown(campo("Quando usar"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(aoFechar).toHaveBeenCalledTimes(2);
    expect(alterar).not.toHaveBeenCalled();
  });

  it("Esc de fora do painel, ou já tratado, não fecha nem perde a edição", async () => {
    const { aoFechar } = await abrir();
    const fora = document.createElement("textarea");
    document.body.append(fora);

    fireEvent.change(campo("Quando usar"), { target: { value: "Outra." } });
    fireEvent.keyDown(fora, { key: "Escape" });
    const tratado = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    tratado.preventDefault();
    campo("Quando usar").dispatchEvent(tratado);

    expect(aoFechar).not.toHaveBeenCalled();
    expect(campo("Quando usar")).toHaveValue("Outra.");
    fora.remove();
  });

  it("mostra o erro do servidor e continua aberto", async () => {
    vi.spyOn(api, "alterarPreferencias").mockRejectedValue(new Error('O nome "executor" é reservado; escolha outro.'));
    const { aoFechar } = await abrir();

    fireEvent.change(campo("Nome"), { target: { value: "executor" } });
    fireEvent.click(salvar());

    expect(await screen.findByText(/"executor" é reservado/)).toBeInTheDocument();
    expect(aoFechar).not.toHaveBeenCalled();
  });

  it("sem servidor, mostra o erro da leitura", async () => {
    vi.spyOn(api, "lerPreferencias").mockRejectedValue(new Error("Servidor fora do ar."));
    render(<PainelDeSubagentes aoFechar={vi.fn()} aoSalvar={vi.fn()} />);

    expect(await screen.findByText("Servidor fora do ar.")).toBeInTheDocument();
    expect(salvar()).toBeDisabled();
  });
});
