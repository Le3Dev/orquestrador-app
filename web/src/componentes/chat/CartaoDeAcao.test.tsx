import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { api, ErroDaApi } from "../../shared/api/cliente";
import type { AcaoDeAbrirOrquestrador, ResumoDoOrquestrador } from "../../shared/api/tipos";
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

/** Trabalhando desde agora há pouco, no pedido dado. */
function trabalhando(id: string, pasta: string, texto = "rodar os testes"): ResumoDoOrquestrador {
  return {
    ...orquestrador(id, pasta),
    situacao: "trabalhando",
    ultimoTurno: { texto, situacao: "em_andamento", iniciadoEm: new Date(Date.now() - 12 * 60_000).toISOString() },
  };
}

function renderizar(
  acao: Partial<AcaoDeAbrirOrquestrador> = {},
  temVagaPara = vi.fn<(id: string | null) => boolean>(() => true),
  orquestradores: ResumoDoOrquestrador[] = [],
) {
  const aoAbrirTerminal = vi.fn();
  const aoAtualizarOrquestradores = vi.fn().mockResolvedValue(undefined);
  render(
    <CartaoDeAcao
      acao={{ tipo: "abrir_orquestrador", projeto: "painel", pasta: "C:\\Projetos\\Painel", pedido: null, ...acao }}
      aoAbrirTerminal={aoAbrirTerminal}
      temVagaPara={temVagaPara}
      aoAtualizarOrquestradores={aoAtualizarOrquestradores}
      orquestradores={orquestradores}
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

  describe("estado dos orquestradores", () => {
    const PASTA = "C:\\Projetos\\Painel";

    it("prefere um ocioso da pasta a um ocupado usado mais recentemente", async () => {
      const ocioso = { ...orquestrador("o1", PASTA), criadoEm: "2026-11-01T12:00:00Z" };
      const ocupado = trabalhando("o2", PASTA);
      vi.spyOn(api, "listarOrquestradores").mockResolvedValue([ocioso, ocupado]);
      const enviar = vi.spyOn(api, "enviarMensagem").mockResolvedValue({ turnoId: "t1" });
      const { aoAbrirTerminal } = renderizar({ pedido: "revisar o login" }, undefined, [ocioso, ocupado]);

      expect(screen.getByTestId("estado-do-escolhido")).toHaveTextContent("o1: ocioso");
      fireEvent.click(screen.getByRole("button", { name: "abrir" }));

      await screen.findByRole("button", { name: "aberto ✓" });
      expect(aoAbrirTerminal).toHaveBeenCalledWith("o1");
      expect(enviar).toHaveBeenCalledWith("o1", "revisar o login");
    });

    it("escolhe pelo nome da ação quando ele existe na pasta; um nome de fora vira a escolha normal", async () => {
      const antigo = { ...orquestrador("o1", PASTA), criadoEm: "2026-11-01T12:00:00Z" };
      const recente = { ...orquestrador("o2", PASTA), criadoEm: "2026-11-03T12:00:00Z" };
      const deFora = orquestrador("o3", "C:\\Projetos\\Outro");
      vi.spyOn(api, "listarOrquestradores").mockResolvedValue([antigo, recente, deFora]);
      const { aoAbrirTerminal } = renderizar({ orquestrador: "O1" }, undefined, [antigo, recente, deFora]);

      expect(screen.getByTestId("estado-do-escolhido")).toHaveTextContent("o1: ocioso");
      fireEvent.click(screen.getByRole("button", { name: "abrir" }));
      await screen.findByRole("button", { name: "aberto ✓" });
      expect(aoAbrirTerminal).toHaveBeenCalledWith("o1");
    });

    it("nome de outra pasta não vale: fica com o mais recente da pasta", () => {
      const antigo = { ...orquestrador("o1", PASTA), criadoEm: "2026-11-01T12:00:00Z" };
      const recente = { ...orquestrador("o2", PASTA), criadoEm: "2026-11-03T12:00:00Z" };
      renderizar({ orquestrador: "o3" }, undefined, [antigo, recente, orquestrador("o3", "C:\\Projetos\\Outro")]);

      expect(screen.getByTestId("estado-do-escolhido")).toHaveTextContent("o2: ocioso");
    });

    it("ocioso com worktree mostra alterações sem commit", () => {
      const comWorktree = {
        ...orquestrador("o1", PASTA),
        worktree: { branch: "orquestrador/o1", caminho: "C:\\dados\\worktrees\\o1", ativo: false },
      };
      renderizar({}, undefined, [comWorktree]);

      expect(screen.getByTestId("estado-do-escolhido")).toHaveTextContent("o1: ocioso · alterações sem commit");
    });

    it("ocupado com pedido: mostra o estado e troca o botão por colocar na fila e criar outro", () => {
      const ocupado = {
        ...trabalhando("o1", PASTA, "corrigir memória"),
        fila: [{ id: "f1", texto: "x", modo: "execucao" as const, enfileiradoEm: "2026-11-04T12:00:00Z" }],
      };
      const listar = vi.spyOn(api, "listarOrquestradores");
      renderizar({ pedido: "rode os testes" }, undefined, [ocupado]);

      const estado = screen.getByTestId("estado-do-escolhido");
      expect(estado).toHaveTextContent(/o1: trabalhando há 12min \d{2}s em “corrigir memória” · 1 na fila/);
      expect(screen.getByRole("button", { name: "Colocar na fila" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Criar outro" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "abrir" })).not.toBeInTheDocument();
      expect(listar).not.toHaveBeenCalled();
    });

    it("plano pendente conta como ocupado", () => {
      renderizar({ pedido: "rode os testes" }, undefined, [{ ...orquestrador("o1", PASTA), planoPendente: true }]);

      expect(screen.getByTestId("estado-do-escolhido")).toHaveTextContent("o1: aguardando aprovação do plano");
      expect(screen.getByRole("button", { name: "Colocar na fila" })).toBeInTheDocument();
    });

    it("ocupado sem pedido: só abre o terminal dele, como antes", async () => {
      const ocupado = trabalhando("o1", PASTA);
      vi.spyOn(api, "listarOrquestradores").mockResolvedValue([ocupado]);
      const { aoAbrirTerminal } = renderizar({}, undefined, [ocupado]);

      fireEvent.click(screen.getByRole("button", { name: "abrir" }));

      await screen.findByRole("button", { name: "aberto ✓" });
      expect(aoAbrirTerminal).toHaveBeenCalledWith("o1");
    });

    it("colocar na fila abre o terminal e guarda o pedido na fila dele, sem enviar", async () => {
      const ocupado = trabalhando("o1", PASTA);
      vi.spyOn(api, "listarOrquestradores").mockResolvedValue([ocupado]);
      const enfileirar = vi.spyOn(api, "enfileirarPedido").mockResolvedValue({ pedidoId: "p1" });
      const enviar = vi.spyOn(api, "enviarMensagem");
      const { aoAbrirTerminal, temVagaPara } = renderizar({ pedido: "rode os testes" }, undefined, [ocupado]);

      fireEvent.click(screen.getByRole("button", { name: "Colocar na fila" }));

      const feito = await screen.findByRole("button", { name: "na fila ✓" });
      expect(temVagaPara).toHaveBeenCalledWith("o1");
      expect(aoAbrirTerminal).toHaveBeenCalledWith("o1");
      expect(enfileirar).toHaveBeenCalledWith("o1", "rode os testes");
      expect(enviar).not.toHaveBeenCalled();

      fireEvent.click(feito);
      expect(aoAbrirTerminal).toHaveBeenCalledTimes(2);
      expect(enfileirar).toHaveBeenCalledTimes(1);
    });

    it("fila cheia (409) mostra a mensagem clara e mantém as duas opções", async () => {
      const ocupado = trabalhando("o1", PASTA);
      vi.spyOn(api, "listarOrquestradores").mockResolvedValue([ocupado]);
      vi.spyOn(api, "enfileirarPedido").mockRejectedValue(new ErroDaApi('A fila de "o1" está cheia (máximo 10 pedidos).', 409));
      renderizar({ pedido: "rode os testes" }, undefined, [ocupado]);

      fireEvent.click(screen.getByRole("button", { name: "Colocar na fila" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        'A fila de "o1" está cheia (máximo 10 pedidos). Crie outro orquestrador ou espere a fila andar.',
      );
      expect(screen.getByRole("button", { name: "Criar outro" })).toBeInTheDocument();
    });

    it("fila já cheia na lista do servidor: avisa sem abrir nem enfileirar", async () => {
      const fila = Array.from({ length: 10 }, (_, indice) => ({
        id: `f${indice}`,
        texto: "x",
        modo: "execucao" as const,
        enfileiradoEm: "2026-11-04T12:00:00Z",
      }));
      const cheio = { ...trabalhando("o1", PASTA), fila };
      vi.spyOn(api, "listarOrquestradores").mockResolvedValue([cheio]);
      const enfileirar = vi.spyOn(api, "enfileirarPedido");
      const { aoAbrirTerminal } = renderizar({ pedido: "rode os testes" }, undefined, [cheio]);

      fireEvent.click(screen.getByRole("button", { name: "Colocar na fila" }));

      expect(await screen.findByRole("alert")).toHaveTextContent('A fila de "o1" está cheia');
      expect(enfileirar).not.toHaveBeenCalled();
      expect(aoAbrirTerminal).not.toHaveBeenCalled();
    });

    it("criar outro cria um novo com nome livre na pasta e envia o pedido a ele", async () => {
      const ocupado = { ...trabalhando("o1", PASTA), nome: "painel" };
      vi.spyOn(api, "listarOrquestradores").mockResolvedValue([ocupado]);
      const criado = orquestrador("o2", PASTA);
      const criar = vi.spyOn(api, "criarOrquestrador").mockResolvedValue(criado);
      const enviar = vi.spyOn(api, "enviarMensagem").mockResolvedValue({ turnoId: "t1" });
      const { aoAbrirTerminal, aoAtualizarOrquestradores, temVagaPara } = renderizar(
        { pedido: "rode os testes" },
        undefined,
        [ocupado],
      );

      fireEvent.click(screen.getByRole("button", { name: "Criar outro" }));

      await screen.findByRole("button", { name: "aberto ✓" });
      expect(temVagaPara).toHaveBeenCalledWith(null);
      expect(criar).toHaveBeenCalledWith(expect.objectContaining({ nome: "painel 2", pastaDeTrabalho: PASTA }));
      expect(aoAtualizarOrquestradores).toHaveBeenCalledWith(criado);
      expect(aoAbrirTerminal).toHaveBeenCalledWith("o2");
      expect(enviar).toHaveBeenCalledWith("o2", "rode os testes");
    });

    it("criar outro usa o nome da função e mostra qual seria", async () => {
      const ocupado = trabalhando("o1", PASTA);
      vi.spyOn(api, "listarOrquestradores").mockResolvedValue([ocupado]);
      const criar = vi.spyOn(api, "criarOrquestrador").mockResolvedValue(orquestrador("o2", PASTA));
      vi.spyOn(api, "enviarMensagem").mockResolvedValue({ turnoId: "t1" });
      renderizar({ pedido: "abrir o PR", nome: "PR de integração" }, undefined, [ocupado]);

      expect(screen.getByTestId("nome-sugerido")).toHaveTextContent("se criar outro: PR de integração");
      fireEvent.click(screen.getByRole("button", { name: "Criar outro" }));

      await screen.findByRole("button", { name: "aberto ✓" });
      expect(criar).toHaveBeenCalledWith(expect.objectContaining({ nome: "PR de integração" }));
    });

    it("reaproveitando um existente, ignora o nome sugerido", async () => {
      const existente = orquestrador("o1", PASTA);
      vi.spyOn(api, "listarOrquestradores").mockResolvedValue([existente]);
      const criar = vi.spyOn(api, "criarOrquestrador");
      const { aoAbrirTerminal } = renderizar({ nome: "Vídeo de venda" }, undefined, [existente]);

      expect(screen.queryByTestId("nome-sugerido")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "abrir" }));

      await screen.findByRole("button", { name: "aberto ✓" });
      expect(aoAbrirTerminal).toHaveBeenCalledWith("o1");
      expect(criar).not.toHaveBeenCalled();
    });

    it("criar outro respeita o limite de terminais do canvas", async () => {
      const ocupado = trabalhando("o1", PASTA);
      vi.spyOn(api, "listarOrquestradores").mockResolvedValue([ocupado]);
      const criar = vi.spyOn(api, "criarOrquestrador");
      renderizar({ pedido: "rode os testes" }, vi.fn<(id: string | null) => boolean>((id) => id === "o1"), [ocupado]);

      fireEvent.click(screen.getByRole("button", { name: "Criar outro" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(AVISO_DO_LIMITE_DE_ORQUESTRADORES);
      expect(criar).not.toHaveBeenCalled();
    });

    it("decide com o dado vivo no clique: ocupado agora, oferece fila ou outro em vez de enviar", async () => {
      const livreNaTela = orquestrador("o1", PASTA);
      vi.spyOn(api, "listarOrquestradores").mockResolvedValue([trabalhando("o1", PASTA)]);
      const enviar = vi.spyOn(api, "enviarMensagem");
      const { aoAbrirTerminal } = renderizar({ pedido: "rode os testes" }, undefined, [livreNaTela]);

      fireEvent.click(screen.getByRole("button", { name: "abrir" }));

      expect(await screen.findByRole("button", { name: "Colocar na fila" })).toBeInTheDocument();
      expect(screen.getByTestId("estado-do-escolhido")).toHaveTextContent("o1: trabalhando há");
      expect(enviar).not.toHaveBeenCalled();
      expect(aoAbrirTerminal).not.toHaveBeenCalled();
    });

    it("colocar na fila de quem ficou livre envia direto, sem enfileirar", async () => {
      vi.spyOn(api, "listarOrquestradores").mockResolvedValue([orquestrador("o1", PASTA)]);
      const enfileirar = vi.spyOn(api, "enfileirarPedido");
      const enviar = vi.spyOn(api, "enviarMensagem").mockResolvedValue({ turnoId: "t1" });
      renderizar({ pedido: "rode os testes" }, undefined, [trabalhando("o1", PASTA)]);

      fireEvent.click(screen.getByRole("button", { name: "Colocar na fila" }));

      await screen.findByRole("button", { name: "aberto ✓" });
      expect(enviar).toHaveBeenCalledWith("o1", "rode os testes");
      expect(enfileirar).not.toHaveBeenCalled();
    });
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

    it("cria com o nome da função sugerido pelo Claude e o mostra antes do clique", async () => {
      vi.spyOn(api, "listarOrquestradores").mockResolvedValue([]);
      const criar = vi.spyOn(api, "criarOrquestrador").mockResolvedValue(orquestrador("o1", "C:\\Projetos\\Painel"));
      renderizar({ novo: true, nome: "Correção da memória" });

      expect(screen.getByTestId("nome-sugerido")).toHaveTextContent("nome: Correção da memória");
      fireEvent.click(screen.getByRole("button", { name: "criar" }));

      await screen.findByRole("button", { name: "aberto ✓" });
      expect(criar).toHaveBeenCalledWith(expect.objectContaining({ nome: "Correção da memória" }));
    });

    it("com o nome da função já usado na pasta, desambigua com 2", async () => {
      const existente = { ...orquestrador("o1", "C:\\Projetos\\Painel"), nome: "correção da memória" };
      vi.spyOn(api, "listarOrquestradores").mockResolvedValue([existente]);
      const criar = vi.spyOn(api, "criarOrquestrador").mockResolvedValue(orquestrador("o2", "C:\\Projetos\\Painel"));
      renderizar({ novo: true, nome: "Correção da memória" }, undefined, [existente]);

      expect(screen.getByTestId("nome-sugerido")).toHaveTextContent("nome: Correção da memória 2");
      fireEvent.click(screen.getByRole("button", { name: "criar" }));

      await screen.findByRole("button", { name: "aberto ✓" });
      expect(criar).toHaveBeenCalledWith(expect.objectContaining({ nome: "Correção da memória 2" }));
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
