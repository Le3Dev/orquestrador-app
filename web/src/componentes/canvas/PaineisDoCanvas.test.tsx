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

describe("RotinasDoCanvas (painel e aprovações pendentes)", () => {
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

  /**
   * Quem monta o canvas decide quando o painel está aberto (um painel da barra por vez), abre-o pelo item
   * "Rotinas" do menu `+ Novo` e mostra o selo das aprovações. Aqui, um botão e um `output` fazem esse papel.
   */
  function Canvas({ aberturaInicial = false }: { aberturaInicial?: boolean }) {
    const [aberto, setAberto] = useState(aberturaInicial);
    const [aguardando, setAguardando] = useState<number | null>(null);
    return (
      <>
        <button type="button" onClick={() => setAberto(true)}>
          Abrir o painel (teste)
        </button>
        <output data-testid="aguardando-aprovacao">{aguardando ?? "nada informado"}</output>
        <RotinasDoCanvas
          servidorConectado
          orquestradores={ORQUESTRADORES}
          aberto={aberto}
          aoAbrir={() => setAberto(true)}
          aoFechar={() => setAberto(false)}
          aoMudarAguardandoAprovacao={setAguardando}
          criarFonte={() => null}
        />
      </>
    );
  }

  const abrirPainel = () => fireEvent.click(screen.getByRole("button", { name: "Abrir o painel (teste)" }));

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

  it("informa quantas execuções aguardam aprovação, com o painel fechado, e não desenha botão nem selo", async () => {
    vi.spyOn(apiDasRotinas, "listar").mockResolvedValue([
      rotina("r1", aguardando("e1", "r1")),
      rotina("r2", aguardando("e2", "r2")),
      rotina("r3"),
    ]);

    await montar();

    await waitFor(() => expect(screen.getByTestId("aguardando-aprovacao")).toHaveTextContent("2"));
    // O botão solto e o selo dele deixaram de existir aqui: quem mostra o número é o menu `+ Novo`.
    expect(screen.queryByRole("button", { name: /Rotinas/ })).not.toBeInTheDocument();
    expect(screen.queryByTestId("selo-das-rotinas")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Rotinas" })).not.toBeInTheDocument();
  });

  it("sem execuções aguardando, informa zero", async () => {
    vi.spyOn(apiDasRotinas, "listar").mockResolvedValue([rotina("r1")]);

    await montar();

    await waitFor(() => expect(screen.getByTestId("aguardando-aprovacao")).toHaveTextContent("0"));
    expect(screen.queryByRole("button", { name: /Rotinas/ })).not.toBeInTheDocument();
  });

  it("o painel abre quando quem monta pede; o X e o Esc fecham", async () => {
    vi.spyOn(apiDasRotinas, "listar").mockResolvedValue([rotina("r1")]);
    await montar();
    expect(screen.queryByRole("region", { name: "Rotinas" })).not.toBeInTheDocument();

    abrirPainel();
    expect(await screen.findByRole("region", { name: "Rotinas" })).toBeInTheDocument();
    expect(await screen.findByRole("list", { name: "Lista de rotinas" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Fechar rotinas" }));
    expect(screen.queryByRole("region", { name: "Rotinas" })).not.toBeInTheDocument();

    abrirPainel();
    expect(await screen.findByRole("region", { name: "Rotinas" })).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Rotinas" })).not.toBeInTheDocument();
  });

  it("o número informado acompanha as aprovações com o painel fechado e com ele aberto", async () => {
    vi.spyOn(apiDasRotinas, "listar").mockResolvedValue([rotina("r1", aguardando("e1", "r1"))]);
    await montar();
    await waitFor(() => expect(screen.getByTestId("aguardando-aprovacao")).toHaveTextContent("1"));

    abrirPainel();
    await screen.findByRole("region", { name: "Rotinas" });

    expect(screen.getByTestId("aguardando-aprovacao")).toHaveTextContent("1");
  });

  it("o cartão de aprovação aparece no painel aberto, com Aprovar e Recusar", async () => {
    vi.spyOn(apiDasRotinas, "listar").mockResolvedValue([rotina("r1", aguardando("e1", "r1"))]);
    const aprovar = vi.spyOn(apiDasRotinas, "aprovar").mockResolvedValue({ ...aguardando("e1", "r1"), situacao: "em_andamento" });
    await montar(true);

    expect(await screen.findByTestId("cartao-de-aprovacao")).toHaveTextContent("A rotina “Rotina r1” aguarda sua aprovação");
    fireEvent.click(screen.getByRole("button", { name: "Aprovar" }));

    await waitFor(() => expect(aprovar).toHaveBeenCalledWith("e1"));
    // A aprovação devolveu a execução em andamento: o cartão sai e o número informado volta a zero.
    await waitFor(() => expect(screen.queryByTestId("cartao-de-aprovacao")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("aguardando-aprovacao")).toHaveTextContent("0"));
  });

  it("com a rota fora do ar (404), o painel diz 'Rotinas indisponíveis' e nenhuma aprovação é informada", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(apiDasRotinas, "listar").mockRejectedValue(new ErroDaApi("O servidor respondeu com erro 404.", 404));
    try {
      await montar();

      abrirPainel();

      const aviso = await screen.findByText("Rotinas indisponíveis");
      expect(aviso.closest("[role=alert]")).toHaveTextContent("O servidor respondeu com erro 404.");
      expect(screen.getByTestId("aguardando-aprovacao")).toHaveTextContent("0");
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
