import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { DadosDaExecucao } from "../../shared/api/rotinas";
import { CartaoDeAprovacao } from "./CartaoDeAprovacao";

function execucao(alteracoes: Partial<DadosDaExecucao> = {}): DadosDaExecucao {
  return {
    id: "e1",
    rotinaId: "r1",
    rotinaNome: "Relatório da manhã",
    origem: "agendada",
    situacao: "aguardando_aprovacao",
    etapaAtual: 1,
    etapas: [
      { tipo: "pedido", orquestradorId: "o1", texto: "Planeje", modo: "planejamento" },
      { tipo: "aprovacao", mensagem: "Posso publicar?" },
    ],
    resultados: [],
    iniciadaEm: "2026-11-17T12:00:00Z",
    encerradaEm: null,
    motivo: null,
    pendencia: { tipo: "aprovacao", mensagem: "Posso publicar?" },
    ...alteracoes,
  };
}

function montar(dados: DadosDaExecucao = execucao()) {
  const aoAprovar = vi.fn(() => Promise.resolve(dados));
  const aoRecusar = vi.fn(() => Promise.resolve(dados));
  render(<CartaoDeAprovacao execucao={dados} aoAprovar={aoAprovar} aoRecusar={aoRecusar} />);
  return { aoAprovar, aoRecusar };
}

describe("CartaoDeAprovacao", () => {
  it("destaca o nome da rotina e mostra a mensagem da etapa de aprovação", () => {
    montar();

    expect(screen.getByTestId("cartao-de-aprovacao")).toHaveTextContent("A rotina “Relatório da manhã” aguarda sua aprovação");
    expect(screen.getByLabelText("Mensagem da rotina")).toHaveTextContent("Posso publicar?");
    expect(screen.getByText(/etapa 2 de 2/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aprovar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recusar" })).toBeInTheDocument();
  });

  it("mostra o plano quando a espera é de um pedido em planejamento", () => {
    montar(execucao({ pendencia: { tipo: "plano", plano: "1. Ler o código\n2. Escrever os testes" } }));

    expect(screen.getByLabelText("Plano proposto")).toHaveTextContent("1. Ler o código");
    expect(screen.getByLabelText("Plano proposto")).toHaveTextContent("2. Escrever os testes");
    expect(screen.getByText(/O orquestrador propôs este plano/)).toBeInTheDocument();
  });

  it("Aprovar chama a aprovação da execução", async () => {
    const { aoAprovar, aoRecusar } = montar();

    fireEvent.click(screen.getByRole("button", { name: "Aprovar" }));

    await waitFor(() => expect(aoAprovar).toHaveBeenCalledWith("e1"));
    expect(aoRecusar).not.toHaveBeenCalled();
  });

  it("Recusar leva o motivo digitado (ou nada, se ficou em branco)", async () => {
    const { aoRecusar } = montar();

    fireEvent.click(screen.getByRole("button", { name: "Recusar" }));
    await waitFor(() => expect(aoRecusar).toHaveBeenCalledWith("e1", ""));
    await waitFor(() => expect(screen.getByRole("button", { name: "Recusar" })).toBeEnabled());

    fireEvent.change(screen.getByLabelText("Motivo da recusa (opcional)"), { target: { value: "Mexe em arquivos demais" } });
    fireEvent.click(screen.getByRole("button", { name: "Recusar" }));
    await waitFor(() => expect(aoRecusar).toHaveBeenLastCalledWith("e1", "Mexe em arquivos demais"));
  });

  it("mostra a mensagem do servidor quando a decisão falha e deixa tentar de novo", async () => {
    const aoAprovar = vi
      .fn()
      .mockRejectedValueOnce(new Error("Esta execução não aguarda mais aprovação."))
      .mockResolvedValue(execucao());
    render(<CartaoDeAprovacao execucao={execucao()} aoAprovar={aoAprovar} aoRecusar={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Aprovar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Esta execução não aguarda mais aprovação.");
    expect(screen.getByRole("button", { name: "Aprovar" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Aprovar" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("trava os botões enquanto a decisão está a caminho", async () => {
    let concluir: () => void = () => undefined;
    const aoAprovar = vi.fn(() => new Promise<void>((resolver) => (concluir = resolver)));
    render(<CartaoDeAprovacao execucao={execucao()} aoAprovar={aoAprovar} aoRecusar={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Aprovar" }));

    expect(screen.getByRole("button", { name: "Aprovar" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Recusar" })).toBeDisabled();
    concluir();
    await waitFor(() => expect(screen.getByRole("button", { name: "Aprovar" })).toBeEnabled());
  });
});
