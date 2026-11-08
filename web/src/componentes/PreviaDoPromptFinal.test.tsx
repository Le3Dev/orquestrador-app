import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { api } from "../shared/api/cliente";
import type { DadosDaConfiguracao } from "../shared/api/tipos";
import { PreviaDoPromptFinal } from "./PreviaDoPromptFinal";

const configuracao: DadosDaConfiguracao = {
  modeloDoOrquestrador: "haiku",
  esforcoDoOrquestrador: "padrao",
  modeloDosSubagentes: "haiku",
  esforcoDosSubagentes: "padrao",
  quantidadeDeSubagentes: { modo: "automatica", limite: 2 },
  nivelDePermissao: "leitura",
  permitirCommitEPush: false,
  instrucoesPersonalizadas: "Comece com PIRULITO.",
};

describe("PreviaDoPromptFinal", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("só pede a prévia ao abrir e mostra a mensagem, o system prompt e a origem das instruções", async () => {
    const previa = vi.spyOn(api, "previaDoPrompt").mockResolvedValue({
      instrucoesIniciais: "Você é o ORQUESTRADOR desta conversa.",
      mensagem: "<configuracao-do-pedido>\n<instrucoes-do-usuario>\nComece com PIRULITO.\n</instrucoes-do-usuario>\n</configuracao-do-pedido>",
      origemDasInstrucoes: "orquestrador",
    });
    render(<PreviaDoPromptFinal configuracao={configuracao} pastaDeTrabalho="/projetos/painel" />);
    expect(previa).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Pré-visualizar prompt final" }));

    expect(await screen.findByText(/valem as instruções deste orquestrador/)).toBeInTheDocument();
    expect(previa).toHaveBeenCalledWith(configuracao, "/projetos/painel");
    expect(screen.getByText(/Comece com PIRULITO\./)).toBeInTheDocument();
    expect(screen.getByText("Você é o ORQUESTRADOR desta conversa.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Esconder prompt final" })).toHaveAttribute("aria-expanded", "true");
  });

  it("sem instruções, diz que o pedido vai como antes", async () => {
    vi.spyOn(api, "previaDoPrompt").mockResolvedValue({
      instrucoesIniciais: "x",
      mensagem: "y",
      origemDasInstrucoes: null,
    });
    render(<PreviaDoPromptFinal configuracao={{ ...configuracao, instrucoesPersonalizadas: "" }} />);

    fireEvent.click(screen.getByRole("button", { name: "Pré-visualizar prompt final" }));

    expect(await screen.findByText(/o pedido vai exatamente como antes/)).toBeInTheDocument();
  });

  it("mostra o erro do servidor", async () => {
    vi.spyOn(api, "previaDoPrompt").mockRejectedValue(new Error("A pasta fica fora da raiz."));
    render(<PreviaDoPromptFinal configuracao={configuracao} />);

    fireEvent.click(screen.getByRole("button", { name: "Pré-visualizar prompt final" }));

    await waitFor(() => expect(screen.getByText("A pasta fica fora da raiz.")).toBeInTheDocument());
  });
});
