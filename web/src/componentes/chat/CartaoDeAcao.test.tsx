import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { api } from "../../shared/api/cliente";
import type { AcaoDoApp, ResumoDoOrquestrador } from "../../shared/api/tipos";
import { CONFIGURACAO_PADRAO_DO_ORQUESTRADOR } from "../../shared/modelos";
import { CartaoDeAcao } from "./CartaoDeAcao";

function orquestrador(id: string, pasta: string): ResumoDoOrquestrador {
  return {
    id,
    nome: id,
    pastaDeTrabalho: pasta,
    nomeDaPasta: id,
    situacao: "ocioso",
    configuracao: CONFIGURACAO_PADRAO_DO_ORQUESTRADOR,
    criadoEm: "2026-11-04T12:00:00Z",
    totalDeTurnos: 0,
    ultimoTurno: null,
    worktree: null,
  };
}

function renderizar(acao: Partial<AcaoDoApp> = {}) {
  const aoAbrirTerminal = vi.fn();
  const aoAtualizarOrquestradores = vi.fn().mockResolvedValue(undefined);
  render(
    <CartaoDeAcao
      acao={{ tipo: "abrir_orquestrador", projeto: "painel", pasta: "C:\\Projetos\\Painel", pedido: null, ...acao }}
      aoAbrirTerminal={aoAbrirTerminal}
      aoAtualizarOrquestradores={aoAtualizarOrquestradores}
    />,
  );
  return { aoAbrirTerminal, aoAtualizarOrquestradores };
}

describe("CartaoDeAcao", () => {
  afterEach(() => vi.restoreAllMocks());

  it("não faz nada antes do clique", () => {
    const listar = vi.spyOn(api, "listarOrquestradores").mockResolvedValue([]);
    renderizar();

    expect(screen.getByText("Abrir orquestrador em painel")).toBeInTheDocument();
    expect(listar).not.toHaveBeenCalled();
  });

  it("com um orquestrador na mesma pasta (barras e maiúsculas diferentes), só abre o terminal", async () => {
    vi.spyOn(api, "listarOrquestradores").mockResolvedValue([orquestrador("o1", "c:/projetos/painel/")]);
    const criar = vi.spyOn(api, "criarOrquestrador");
    const { aoAbrirTerminal } = renderizar();

    fireEvent.click(screen.getByRole("button", { name: "abrir" }));

    expect(await screen.findByRole("button", { name: "aberto ✓" })).toBeInTheDocument();
    expect(aoAbrirTerminal).toHaveBeenCalledWith("o1");
    expect(criar).not.toHaveBeenCalled();
  });

  it("sem orquestrador na pasta, cria com a configuração padrão, atualiza a lista e abre", async () => {
    vi.spyOn(api, "listarOrquestradores").mockResolvedValue([orquestrador("o1", "C:\\Projetos\\Outro")]);
    const novo = orquestrador("o2", "C:\\Projetos\\Painel");
    const criar = vi.spyOn(api, "criarOrquestrador").mockResolvedValue(novo);
    const enviar = vi.spyOn(api, "enviarMensagem");
    const { aoAbrirTerminal, aoAtualizarOrquestradores } = renderizar();

    fireEvent.click(screen.getByRole("button", { name: "abrir" }));

    await screen.findByRole("button", { name: "aberto ✓" });
    expect(criar).toHaveBeenCalledWith({
      nome: "painel",
      pastaDeTrabalho: "C:\\Projetos\\Painel",
      ...CONFIGURACAO_PADRAO_DO_ORQUESTRADOR,
    });
    expect(aoAtualizarOrquestradores).toHaveBeenCalledWith(novo);
    expect(aoAbrirTerminal).toHaveBeenCalledWith("o2");
    expect(enviar).not.toHaveBeenCalled();
  });

  it("com pedido, envia o pedido ao orquestrador; clicar de novo só reabre, sem duplicar", async () => {
    const listar = vi.spyOn(api, "listarOrquestradores").mockResolvedValue([]);
    const criar = vi.spyOn(api, "criarOrquestrador").mockResolvedValue(orquestrador("o3", "C:\\Projetos\\Painel"));
    const enviar = vi.spyOn(api, "enviarMensagem").mockResolvedValue({ turnoId: "t1" });
    const { aoAbrirTerminal } = renderizar({ pedido: "rode os testes" });

    expect(screen.getByText("pedido: rode os testes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "abrir" }));
    const feito = await screen.findByRole("button", { name: "aberto ✓" });
    expect(enviar).toHaveBeenCalledWith("o3", "rode os testes");

    fireEvent.click(feito);
    expect(aoAbrirTerminal).toHaveBeenCalledTimes(2);
    expect(listar).toHaveBeenCalledTimes(1);
    expect(criar).toHaveBeenCalledTimes(1);
    expect(enviar).toHaveBeenCalledTimes(1);
  });

  it("erro mostra a mensagem e permite tentar de novo", async () => {
    vi.spyOn(api, "listarOrquestradores")
      .mockRejectedValueOnce(new Error("Não foi possível falar com o servidor."))
      .mockResolvedValueOnce([orquestrador("o1", "C:\\Projetos\\Painel")]);
    const { aoAbrirTerminal } = renderizar();

    fireEvent.click(screen.getByRole("button", { name: "abrir" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível falar com o servidor.");

    fireEvent.click(screen.getByRole("button", { name: "tentar de novo" }));
    await waitFor(() => expect(aoAbrirTerminal).toHaveBeenCalledWith("o1"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
