import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { api } from "../../shared/api/cliente";
import type { AcaoDoApp, ResumoDoOrquestrador } from "../../shared/api/tipos";
import { AVISO_DO_LIMITE_DE_ORQUESTRADORES } from "../../shared/canvas/limiteDeTerminais";
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
    instrucoesAtivas: null,
  };
}

function renderizar(acao: Partial<AcaoDoApp> = {}, temVagaPara = vi.fn<(id: string | null) => boolean>(() => true)) {
  const aoAbrirTerminal = vi.fn();
  const aoAtualizarOrquestradores = vi.fn().mockResolvedValue(undefined);
  render(
    <CartaoDeAcao
      acao={{ tipo: "abrir_orquestrador", projeto: "painel", pasta: "C:\\Projetos\\Painel", pedido: null, ...acao }}
      aoAbrirTerminal={aoAbrirTerminal}
      temVagaPara={temVagaPara}
      aoAtualizarOrquestradores={aoAtualizarOrquestradores}
    />,
  );
  return { aoAbrirTerminal, aoAtualizarOrquestradores, temVagaPara };
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

  it("sem vaga no canvas, não cria nem envia o pedido e mostra o aviso do limite", async () => {
    vi.spyOn(api, "listarOrquestradores").mockResolvedValue([]);
    const criar = vi.spyOn(api, "criarOrquestrador");
    const enviar = vi.spyOn(api, "enviarMensagem");
    const { aoAbrirTerminal, temVagaPara } = renderizar(
      { pedido: "rode os testes" },
      vi.fn<(id: string | null) => boolean>(() => false),
    );

    fireEvent.click(screen.getByRole("button", { name: "abrir" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      AVISO_DO_LIMITE_DE_ORQUESTRADORES,
    );
    expect(temVagaPara).toHaveBeenCalledWith(null);
    expect(criar).not.toHaveBeenCalled();
    expect(enviar).not.toHaveBeenCalled();
    expect(aoAbrirTerminal).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "tentar de novo" })).toBeInTheDocument();
  });

  it("com o orquestrador da pasta já aberto (canvas cheio), só foca nele", async () => {
    vi.spyOn(api, "listarOrquestradores").mockResolvedValue([orquestrador("o1", "C:\\Projetos\\Painel")]);
    const criar = vi.spyOn(api, "criarOrquestrador");
    // Canvas cheio: só o que já está aberto cabe.
    const { aoAbrirTerminal, temVagaPara } = renderizar({}, vi.fn<(id: string | null) => boolean>((id) => id === "o1"));

    fireEvent.click(screen.getByRole("button", { name: "abrir" }));

    await screen.findByRole("button", { name: "aberto ✓" });
    expect(temVagaPara).toHaveBeenCalledWith("o1");
    expect(aoAbrirTerminal).toHaveBeenCalledWith("o1");
    expect(criar).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("com dois na mesma pasta, reaproveita o usado mais recentemente", async () => {
    const antigo = {
      ...orquestrador("o1", "C:\\Projetos\\Painel"),
      criadoEm: "2026-11-01T12:00:00Z",
      ultimoTurno: { texto: "x", situacao: "concluido" as const, iniciadoEm: "2026-11-02T12:00:00Z" },
    };
    const recente = { ...orquestrador("o2", "C:\\Projetos\\Painel"), criadoEm: "2026-11-03T12:00:00Z" };
    vi.spyOn(api, "listarOrquestradores").mockResolvedValue([antigo, recente]);
    const criar = vi.spyOn(api, "criarOrquestrador");
    const { aoAbrirTerminal } = renderizar();

    fireEvent.click(screen.getByRole("button", { name: "abrir" }));

    await screen.findByRole("button", { name: "aberto ✓" });
    expect(aoAbrirTerminal).toHaveBeenCalledWith("o2");
    expect(criar).not.toHaveBeenCalled();
  });

  it("ação antiga, sem o campo novo, reaproveita o da pasta como antes", async () => {
    vi.spyOn(api, "listarOrquestradores").mockResolvedValue([orquestrador("o1", "C:\\Projetos\\Painel")]);
    const criar = vi.spyOn(api, "criarOrquestrador");
    const { aoAbrirTerminal } = renderizar({ novo: undefined });

    expect(screen.getByText("Abrir orquestrador em painel")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "abrir" }));

    await screen.findByRole("button", { name: "aberto ✓" });
    expect(aoAbrirTerminal).toHaveBeenCalledWith("o1");
    expect(criar).not.toHaveBeenCalled();
  });

  describe("com novo", () => {
    it("mostra o título e o botão de criar", () => {
      vi.spyOn(api, "listarOrquestradores").mockResolvedValue([]);
      renderizar({ novo: true });

      expect(screen.getByText("Novo orquestrador em painel")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "criar" })).toBeInTheDocument();
    });

    it("cria mesmo com um orquestrador na pasta, com nome único; clicar de novo só reabre", async () => {
      const existente = { ...orquestrador("o1", "C:\\Projetos\\Painel"), nome: "Painel" };
      const listar = vi.spyOn(api, "listarOrquestradores").mockResolvedValue([existente]);
      const criado = orquestrador("o2", "C:\\Projetos\\Painel");
      const criar = vi.spyOn(api, "criarOrquestrador").mockResolvedValue(criado);
      const { aoAbrirTerminal, aoAtualizarOrquestradores, temVagaPara } = renderizar({ novo: true });

      fireEvent.click(screen.getByRole("button", { name: "criar" }));
      expect(screen.getByRole("button", { name: "criando…" })).toBeDisabled();

      const feito = await screen.findByRole("button", { name: "aberto ✓" });
      expect(temVagaPara).toHaveBeenCalledWith(null);
      expect(criar).toHaveBeenCalledWith({
        nome: "painel 2",
        pastaDeTrabalho: "C:\\Projetos\\Painel",
        ...CONFIGURACAO_PADRAO_DO_ORQUESTRADOR,
      });
      expect(aoAtualizarOrquestradores).toHaveBeenCalledWith(criado);
      expect(aoAbrirTerminal).toHaveBeenCalledWith("o2");

      fireEvent.click(feito);
      expect(aoAbrirTerminal).toHaveBeenCalledTimes(2);
      expect(aoAbrirTerminal).toHaveBeenLastCalledWith("o2");
      expect(listar).toHaveBeenCalledTimes(1);
      expect(criar).toHaveBeenCalledTimes(1);
    });

    it("usa o primeiro número livre quando o nome 2 já existe na pasta", async () => {
      vi.spyOn(api, "listarOrquestradores").mockResolvedValue([
        { ...orquestrador("o1", "C:\\Projetos\\Painel"), nome: "painel" },
        { ...orquestrador("o2", "c:/projetos/painel"), nome: "PAINEL 2" },
        // Mesmo nome em outra pasta não conta.
        { ...orquestrador("o3", "C:\\Projetos\\Outro"), nome: "painel 3" },
      ]);
      const criar = vi.spyOn(api, "criarOrquestrador").mockResolvedValue(orquestrador("o4", "C:\\Projetos\\Painel"));
      renderizar({ novo: true });

      fireEvent.click(screen.getByRole("button", { name: "criar" }));

      await screen.findByRole("button", { name: "aberto ✓" });
      expect(criar).toHaveBeenCalledWith(expect.objectContaining({ nome: "painel 3" }));
    });

    it("sem vaga no canvas, não cria e mostra o aviso do limite", async () => {
      vi.spyOn(api, "listarOrquestradores").mockResolvedValue([orquestrador("o1", "C:\\Projetos\\Painel")]);
      const criar = vi.spyOn(api, "criarOrquestrador");
      // Só o que já está aberto cabe: mesmo assim o modo novo não o reaproveita.
      const { aoAbrirTerminal, temVagaPara } = renderizar(
        { novo: true },
        vi.fn<(id: string | null) => boolean>((id) => id === "o1"),
      );

      fireEvent.click(screen.getByRole("button", { name: "criar" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(AVISO_DO_LIMITE_DE_ORQUESTRADORES);
      expect(temVagaPara).toHaveBeenCalledWith(null);
      expect(criar).not.toHaveBeenCalled();
      expect(aoAbrirTerminal).not.toHaveBeenCalled();
    });
  });
});
