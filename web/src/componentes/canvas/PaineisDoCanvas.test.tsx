import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";

import { ErroDaApi } from "../../shared/api/cliente";
import { apiDasRotinas, type DadosDaExecucao, type ResumoDaRotina } from "../../shared/api/rotinas";
import type { JanelaDaCota, LeituraDeMemoria } from "../../shared/api/tipos";
import type { PonteDasRotinas } from "../../shared/hooks/useRotinasNoDesktop";
import { ErroDoCanvas, RotinasDoCanvas, StatusDoCanvas } from "./PaineisDoCanvas";

describe("StatusDoCanvas (conteúdo da aba Sistema)", () => {
  const GB = 1024 ** 3;
  const cota: JanelaDaCota[] = [
    { nome: "5 horas", utilizacao: 0.42, renovaEm: null, situacao: "allowed" },
    { nome: "7 dias", utilizacao: 0.85, renovaEm: null, situacao: "allowed" },
  ];
  const memoria = (livreGb: number): LeituraDeMemoria => ({
    totalBytes: 32 * GB,
    livreBytes: livreGb * GB,
    servidorBytes: 0,
    agentesBytes: 0,
    porOrquestrador: {},
    lidaEm: "2026-11-04T12:00:00Z",
  });

  it("mostra rótulo completo e curto de cada cota, e o resumo com o resto no balão", () => {
    render(<StatusDoCanvas trabalhando={0} bixinhosAtivos={2} cota={cota} memoria={memoria(16)} />);
    const status = screen.getByTestId("status-do-canvas");

    expect(status).toHaveClass("status-do-sistema");
    expect(status).toHaveTextContent("todos ociosos");
    expect([...status.querySelectorAll(".rotulo-curto")].map((rotulo) => rotulo.textContent)).toEqual(["5h", "7d"]);
    const resumo = screen.getByTestId("resumo-do-status");
    // O medidor resumido é o do uso mais alto (7 dias, 85%); o resto vai no balão.
    expect(resumo).toHaveTextContent("7d");
    expect(resumo).toHaveTextContent("85%");
    expect(resumo).toHaveClass("text-error");
    expect(resumo.getAttribute("title")).toContain("2 agentes ativos");
    expect(resumo.getAttribute("title")).toContain("5 horas: 42%");
    expect(resumo.getAttribute("title")).toContain("RAM: Livre");
  });

  it("mostra quem trabalha, a RAM livre e não carrega o aviso de memória (que é uma notificação)", () => {
    render(<StatusDoCanvas trabalhando={1} bixinhosAtivos={0} cota={null} memoria={memoria(2.5)} />);

    expect(screen.getByTestId("status-do-canvas")).toHaveTextContent("1 trabalhando");
    expect(screen.getByText(/livres/)).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("sem cota, memória nem agentes ativos, não há resumo", () => {
    render(<StatusDoCanvas trabalhando={0} bixinhosAtivos={0} cota={null} memoria={null} />);
    expect(screen.queryByTestId("resumo-do-status")).not.toBeInTheDocument();
  });
});

describe("ErroDoCanvas", () => {
  it("mostra o erro e fecha", () => {
    const aoFechar = vi.fn();
    render(<ErroDoCanvas erro="Não foi possível criar a nota: servidor fora." aoFechar={aoFechar} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível criar a nota: servidor fora.");
    fireEvent.click(screen.getByRole("button", { name: "Fechar aviso" }));
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });
});

describe("RotinasDoCanvas (botão Rotinas e painel)", () => {
  const ORQUESTRADORES = [{ id: "o1", nome: "Backend" }];

  function rotina(id: string, execucaoAtiva: DadosDaExecucao | null = null): ResumoDaRotina {
    return {
      id,
      nome: `Rotina ${id}`,
      ativa: true,
      gatilho: { tipo: "diario", hora: "09:00" },
      etapas: [{ tipo: "aprovacao", mensagem: "Posso seguir?" }],
      aoPerder: "pular",
      criadaEm: "2026-11-05T12:00:00Z",
      ultimaExecucaoEm: null,
      proximaExecucaoEm: null,
      execucaoAtiva,
    };
  }

  function aguardando(id: string, rotinaId: string): DadosDaExecucao {
    return {
      id,
      rotinaId,
      rotinaNome: `Rotina ${rotinaId}`,
      origem: "agendada",
      situacao: "aguardando_aprovacao",
      etapaAtual: 0,
      etapas: [{ tipo: "aprovacao", mensagem: "Posso seguir?" }],
      resultados: [],
      iniciadaEm: "2026-11-17T12:00:00Z",
      encerradaEm: null,
      motivo: null,
      pendencia: { tipo: "aprovacao", mensagem: "Posso seguir?" },
    };
  }

  /** Quem monta o canvas decide quando o painel está aberto (um painel da barra por vez). */
  function Canvas({ aberturaInicial = false }: { aberturaInicial?: boolean }) {
    const [aberto, setAberto] = useState(aberturaInicial);
    return (
      <RotinasDoCanvas
        servidorConectado
        orquestradores={ORQUESTRADORES}
        aberto={aberto}
        aoAbrir={() => setAberto(true)}
        aoFechar={() => setAberto(false)}
        criarFonte={() => null}
      />
    );
  }

  async function montar(aberturaInicial = false) {
    await act(async () => {
      render(<Canvas aberturaInicial={aberturaInicial} />);
    });
  }

  beforeEach(() => {
    vi.spyOn(apiDasRotinas, "listarExecucoes").mockResolvedValue([]);
  });

  afterEach(() => {
    delete (window as unknown as { electron?: unknown }).electron;
    vi.restoreAllMocks();
  });

  it("o selo do botão conta as execuções aguardando aprovação, com o painel fechado", async () => {
    vi.spyOn(apiDasRotinas, "listar").mockResolvedValue([
      rotina("r1", aguardando("e1", "r1")),
      rotina("r2", aguardando("e2", "r2")),
      rotina("r3"),
    ]);

    await montar();

    const botao = await screen.findByRole("button", { name: "Rotinas, 2 aguardando aprovação" });
    expect(screen.getByTestId("selo-das-rotinas")).toHaveTextContent("2");
    expect(botao).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region", { name: "Rotinas" })).not.toBeInTheDocument();
  });

  it("sem execuções aguardando, o botão fica sem selo", async () => {
    vi.spyOn(apiDasRotinas, "listar").mockResolvedValue([rotina("r1")]);

    await montar();

    expect(screen.getByRole("button", { name: "Rotinas" })).toBeInTheDocument();
    expect(screen.queryByTestId("selo-das-rotinas")).not.toBeInTheDocument();
  });

  it("o botão abre e fecha o painel; o Esc também fecha", async () => {
    vi.spyOn(apiDasRotinas, "listar").mockResolvedValue([rotina("r1")]);
    await montar();

    fireEvent.click(screen.getByRole("button", { name: "Rotinas" }));
    expect(await screen.findByRole("region", { name: "Rotinas" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rotinas" })).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByRole("list", { name: "Lista de rotinas" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Rotinas" }));
    expect(screen.queryByRole("region", { name: "Rotinas" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Rotinas" }));
    expect(await screen.findByRole("region", { name: "Rotinas" })).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Rotinas" })).not.toBeInTheDocument();
  });

  it("o cartão de aprovação aparece no painel aberto, com Aprovar e Recusar", async () => {
    vi.spyOn(apiDasRotinas, "listar").mockResolvedValue([rotina("r1", aguardando("e1", "r1"))]);
    const aprovar = vi.spyOn(apiDasRotinas, "aprovar").mockResolvedValue({ ...aguardando("e1", "r1"), situacao: "em_andamento" });
    await montar(true);

    expect(await screen.findByTestId("cartao-de-aprovacao")).toHaveTextContent("A rotina “Rotina r1” aguarda sua aprovação");
    fireEvent.click(screen.getByRole("button", { name: "Aprovar" }));

    await waitFor(() => expect(aprovar).toHaveBeenCalledWith("e1"));
    // A aprovação devolveu a execução em andamento: o cartão e o selo saem.
    await waitFor(() => expect(screen.queryByTestId("cartao-de-aprovacao")).not.toBeInTheDocument());
    expect(screen.queryByTestId("selo-das-rotinas")).not.toBeInTheDocument();
  });

  it("com a rota fora do ar (404), o botão segue de pé e o painel diz 'Rotinas indisponíveis'", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(apiDasRotinas, "listar").mockRejectedValue(new ErroDaApi("O servidor respondeu com erro 404.", 404));
    try {
      await montar();

      fireEvent.click(screen.getByRole("button", { name: "Rotinas" }));

      const aviso = await screen.findByText("Rotinas indisponíveis");
      expect(aviso.closest("[role=alert]")).toHaveTextContent("O servidor respondeu com erro 404.");
      expect(screen.queryByTestId("selo-das-rotinas")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("no app desktop, informa as rotinas ativas e as pendências, e o clique na notificação abre o painel", async () => {
    vi.spyOn(apiDasRotinas, "listar").mockResolvedValue([rotina("r1", aguardando("e1", "r1")), rotina("r2")]);
    const informarSituacao = vi.fn<PonteDasRotinas["informarSituacao"]>(() => Promise.resolve());
    let pedirPainel: () => void = () => undefined;
    (window as unknown as { electron: { desktop: boolean; rotinas: PonteDasRotinas } }).electron = {
      desktop: true,
      rotinas: {
        informarSituacao,
        aoPedirPainel: (callback) => {
          pedirPainel = callback;
          return () => undefined;
        },
      },
    };

    await montar();

    await waitFor(() =>
      expect(informarSituacao).toHaveBeenCalledWith({
        ativas: 2,
        aguardandoAprovacao: 1,
        pendentes: [{ id: "e1", rotina: "Rotina r1" }],
      }),
    );
    expect(screen.queryByRole("region", { name: "Rotinas" })).not.toBeInTheDocument();

    act(() => pedirPainel());

    expect(await screen.findByRole("region", { name: "Rotinas" })).toBeInTheDocument();
  });
});
