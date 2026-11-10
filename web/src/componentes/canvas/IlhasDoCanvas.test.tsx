import { fireEvent, render, screen, within } from "@testing-library/react";

import type { JanelaDaCota, LeituraDeMemoria } from "../../shared/api/tipos";
import { IlhaDaDireita, IlhaDeFerramentas, IlhaDoNome, NotificacoesDoCanvas } from "./IlhasDoCanvas";

// O zoom da ilha vertical: a câmera do React Flow, observada.
const camera = vi.hoisted(() => ({ zoom: 1, zoomIn: vi.fn(), zoomOut: vi.fn() }));
vi.mock("@xyflow/react", () => ({
  useReactFlow: () => ({ zoomIn: camera.zoomIn, zoomOut: camera.zoomOut }),
  useStore: (seletor: (estado: unknown) => unknown) =>
    seletor({ transform: [0, 0, camera.zoom], minZoom: 0.1, maxZoom: 2 }),
}));

const janelaComPonte = window as unknown as { electron?: unknown };

const GB = 1024 ** 3;
function memoria(livreGb: number, totalGb = 16): LeituraDeMemoria {
  return {
    totalBytes: totalGb * GB,
    livreBytes: livreGb * GB,
    servidorBytes: 0,
    agentesBytes: 0,
    porOrquestrador: {},
    lidaEm: "2026-11-10T12:00:00Z",
  };
}

describe("IlhaDoNome", () => {
  it("tem o ícone e o nome do app, um divisor e o botão Novo com o menu", () => {
    const comuns = {
      aoCriar: vi.fn(),
      aoCriarNota: vi.fn(),
      aoCriarPrevia: vi.fn(),
      aoAbrirModelos: vi.fn(),
      aoBuscar: vi.fn(),
      aoAbrirConfiguracoes: vi.fn(),
      orquestradores: [],
      erroDosOrquestradores: null,
      noCanvas: new Set<string>(),
      aoEscolherOrquestrador: vi.fn(),
      subagentes: [],
      aoAbrirSubagentes: vi.fn(),
    };
    render(<IlhaDoNome {...comuns} />);

    const ilha = screen.getByTestId("ilha-do-nome");
    expect(ilha).toHaveClass("ilha");
    expect(within(ilha).getByRole("heading", { name: "Orquestrador de Agentes" })).toBeInTheDocument();
    expect(ilha.querySelector(".divisor-da-ilha")).not.toBeNull();
    // Não arrasta nem move o canvas por baixo.
    expect(ilha).toHaveClass("nodrag", "nopan", "nowheel");

    fireEvent.click(within(ilha).getByRole("button", { name: "Novo" }));
    fireEvent.click(within(ilha).getByRole("menuitem", { name: "Nota" }));
    expect(comuns.aoCriarNota).toHaveBeenCalledTimes(1);
  });
});

describe("IlhaDaDireita", () => {
  function montar(extras: Partial<Parameters<typeof IlhaDaDireita>[0]> = {}) {
    const aoBuscar = vi.fn();
    const aoAlternarConfiguracoes = vi.fn();
    render(
      <IlhaDaDireita
        aoBuscar={aoBuscar}
        trabalhando={0}
        memoria={memoria(10)}
        aoAlternarConfiguracoes={aoAlternarConfiguracoes}
        configuracoesAbertas={false}
        abaAberta={null}
        {...extras}
      />,
    );
    return { aoBuscar, aoAlternarConfiguracoes };
  }

  it("tem, nesta ordem, a lupa, o anel de memória e a engrenagem; sem ninguém trabalhando, não há contador", () => {
    montar();

    const ilha = screen.getByRole("group", { name: "Busca, status e configurações" });
    expect(within(ilha).getAllByRole("button").map((botao) => botao.getAttribute("aria-label"))).toEqual([
      "Buscar (Ctrl+K)",
      "Memória do computador: 38% em uso. Abrir Configurações, Sistema",
      "Configurações",
    ]);
    expect(screen.queryByTestId("contador-trabalhando")).not.toBeInTheDocument();
  });

  it("a lupa abre a paleta (Ctrl+K) e a engrenagem abre as Configurações na aba padrão", () => {
    const { aoBuscar, aoAlternarConfiguracoes } = montar();

    const lupa = screen.getByRole("button", { name: "Buscar (Ctrl+K)" });
    expect(lupa).toHaveAttribute("aria-keyshortcuts", "Control+K");
    fireEvent.click(lupa);
    expect(aoBuscar).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Configurações" }));
    expect(aoAlternarConfiguracoes).toHaveBeenCalledWith();
  });

  it("o anel de memória abre as Configurações na aba Sistema", () => {
    const { aoAlternarConfiguracoes } = montar();

    fireEvent.click(screen.getByTestId("anel-de-memoria"));

    expect(aoAlternarConfiguracoes).toHaveBeenCalledWith("sistema");
  });

  it("o contador mostra quantos orquestradores trabalham", () => {
    montar({ trabalhando: 3 });

    const contador = screen.getByTestId("contador-trabalhando");
    expect(contador).toHaveTextContent("3");
    expect(contador).toHaveAttribute("aria-label", "3 trabalhando agora");
    expect(contador).toHaveAttribute("role", "status");
  });

  it("o anel muda de cor e ganha o texto quando a memória fica baixa ou crítica", () => {
    const { unmount } = render(
      <IlhaDaDireita
        aoBuscar={vi.fn()}
        trabalhando={0}
        memoria={memoria(1.2)}
        aoAlternarConfiguracoes={vi.fn()}
        configuracoesAbertas={false}
        abaAberta={null}
      />,
    );
    expect(screen.getByTestId("anel-de-memoria")).toHaveClass("anel-da-ilha-baixa");
    expect(screen.getByTestId("anel-de-memoria")).toHaveTextContent("Memória baixa");
    unmount();

    render(
      <IlhaDaDireita
        aoBuscar={vi.fn()}
        trabalhando={0}
        memoria={memoria(0.4)}
        aoAlternarConfiguracoes={vi.fn()}
        configuracoesAbertas={false}
        abaAberta={null}
      />,
    );
    expect(screen.getByTestId("anel-de-memoria")).toHaveClass("anel-da-ilha-critica");
    expect(screen.getByTestId("anel-de-memoria")).toHaveTextContent("Memória crítica");
  });

  it("sem leitura de memória, o anel continua e diz isso", () => {
    montar({ memoria: null });

    expect(screen.getByTestId("anel-de-memoria")).toHaveAccessibleName(
      "Memória do computador: sem leitura ainda. Abrir Configurações, Sistema",
    );
  });

  it("aria-pressed marca só o botão da aba aberta: o anel no Sistema, a engrenagem nas outras", () => {
    const { unmount } = render(
      <IlhaDaDireita
        aoBuscar={vi.fn()}
        trabalhando={0}
        memoria={memoria(10)}
        aoAlternarConfiguracoes={vi.fn()}
        configuracoesAbertas
        abaAberta="sistema"
      />,
    );
    expect(screen.getByTestId("anel-de-memoria")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Configurações" })).toHaveAttribute("aria-pressed", "false");
    unmount();

    render(
      <IlhaDaDireita
        aoBuscar={vi.fn()}
        trabalhando={0}
        memoria={memoria(10)}
        aoAlternarConfiguracoes={vi.fn()}
        configuracoesAbertas
        abaAberta={null}
      />,
    );
    expect(screen.getByTestId("anel-de-memoria")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Configurações" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("IlhaDeFerramentas", () => {
  beforeEach(() => {
    camera.zoom = 1;
    camera.zoomIn.mockClear();
    camera.zoomOut.mockClear();
  });

  function montar(extras: Partial<Parameters<typeof IlhaDeFerramentas>[0]> = {}) {
    const chamadas = { aoEnquadrar: vi.fn(), aoOrganizar: vi.fn(), aoAlternarDesenho: vi.fn() };
    render(<IlhaDeFerramentas {...chamadas} podeOrganizar desenhoAberto={false} {...extras} />);
    return chamadas;
  }

  it("tem, nesta ordem, aproximar, afastar, ajustar, organizar e a caneta", () => {
    montar();

    const ilha = screen.getByRole("group", { name: "Ferramentas do canvas" });
    expect(ilha).toHaveClass("nodrag", "nopan", "nowheel");
    expect(within(ilha).getAllByRole("button").map((botao) => botao.getAttribute("aria-label"))).toEqual([
      "Aproximar",
      "Afastar",
      "Ajustar à tela",
      "Organizar janelas",
      "Desenhar",
    ]);
  });

  it("aproximar e afastar mexem no zoom do canvas; ajustar e organizar chamam as funções de hoje", () => {
    const chamadas = montar();

    fireEvent.click(screen.getByRole("button", { name: "Aproximar" }));
    fireEvent.click(screen.getByRole("button", { name: "Afastar" }));
    fireEvent.click(screen.getByRole("button", { name: "Ajustar à tela" }));
    fireEvent.click(screen.getByRole("button", { name: "Organizar janelas" }));

    expect(camera.zoomIn).toHaveBeenCalledTimes(1);
    expect(camera.zoomOut).toHaveBeenCalledTimes(1);
    expect(chamadas.aoEnquadrar).toHaveBeenCalledTimes(1);
    expect(chamadas.aoOrganizar).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Organizar janelas" })).toHaveAttribute(
      "title",
      "Organizar: terminais lado a lado; notas e artefatos à direita",
    );
  });

  it("organizar fica desabilitado com uma janela só, e o zoom desabilita nos limites", () => {
    camera.zoom = 2;
    montar({ podeOrganizar: false });
    expect(screen.getByRole("button", { name: "Organizar janelas" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Aproximar" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Afastar" })).toBeEnabled();
  });

  it("a caneta usa aria-pressed e alterna a barra de desenho", () => {
    const chamadas = montar({ desenhoAberto: true });

    const caneta = screen.getByRole("button", { name: "Desenhar" });
    expect(caneta).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(caneta);
    expect(chamadas.aoAlternarDesenho).toHaveBeenCalledTimes(1);
  });
});

describe("NotificacoesDoCanvas", () => {
  afterEach(() => {
    delete janelaComPonte.electron;
  });

  const cotaAlta: JanelaDaCota[] = [
    { nome: "7 dias", utilizacao: 0.85, renovaEm: null, situacao: "allowed" },
    { nome: "5 horas", utilizacao: 0.3, renovaEm: null, situacao: "allowed" },
  ];

  function montar(memoriaLida: LeituraDeMemoria | null, cota: JanelaDaCota[] | null = null, pedidos = 0) {
    const aoVerSistema = vi.fn();
    const propriedades = { cota, aoVerSistema, pedidosEmAndamento: pedidos };
    const resultado = render(<NotificacoesDoCanvas memoria={memoriaLida} {...propriedades} />);
    return {
      aoVerSistema,
      atualizar: (nova: LeituraDeMemoria | null, novaCota: JanelaDaCota[] | null = cota) =>
        resultado.rerender(<NotificacoesDoCanvas memoria={nova} {...propriedades} cota={novaCota} />),
    };
  }
  const entendi = () => screen.getByRole("button", { name: /^Entendi/ });

  it("memória normal e cota baixa: nada na tela", () => {
    montar(memoria(10), [{ nome: "5 horas", utilizacao: 0.3, renovaEm: null, situacao: "allowed" }]);

    expect(screen.queryByRole("region", { name: "Notificações" })).not.toBeInTheDocument();
  });

  it("memória baixa: aviso com o texto de hoje, Ver Sistema e Entendi, num alerta que não é crítico", () => {
    montar(memoria(1.2));

    const regiao = screen.getByRole("region", { name: "Notificações" });
    const aviso = within(regiao).getByRole("status");
    expect(aviso).toHaveTextContent(
      "Memória baixa: novos pedidos (sobretudo com Opus nos subagentes) podem deixar o computador lento.",
    );
    expect(within(aviso).getByRole("button", { name: "Ver Sistema" })).toBeInTheDocument();
    expect(within(aviso).getByRole("button", { name: "Entendi: memória" })).toBeInTheDocument();
    expect(aviso).toHaveClass("notificacao-baixa");
  });

  it("informa o topo livre abaixo da pilha (para o painel de Configurações descer) e o libera ao sumir", () => {
    const aoMedirTopoLivre = vi.fn();
    const propriedades = { cota: null, aoVerSistema: vi.fn(), pedidosEmAndamento: 0, aoMedirTopoLivre };
    const { rerender } = render(<NotificacoesDoCanvas memoria={memoria(0.4)} {...propriedades} />);

    // 72 de topo + altura da pilha (0 no jsdom) + 8 de respiro.
    expect(aoMedirTopoLivre).toHaveBeenLastCalledWith(80);

    rerender(<NotificacoesDoCanvas memoria={memoria(10)} {...propriedades} />);
    expect(aoMedirTopoLivre).toHaveBeenLastCalledWith(null);
  });

  it("memória crítica: alerta com o texto de hoje, e Ver Sistema abre as Configurações na aba Sistema", () => {
    const { aoVerSistema } = montar(memoria(0.4));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Memória quase esgotada: espere os pedidos em andamento terminarem, feche programas ou use Haiku/Sonnet nos subagentes.",
    );
    expect(screen.getByRole("alert")).toHaveClass("notificacao-critica");

    fireEvent.click(screen.getByRole("button", { name: "Ver Sistema" }));

    expect(aoVerSistema).toHaveBeenCalledTimes(1);
  });

  it("fica até o Entendi, que o fecha; o Ver Sistema não o fecha", () => {
    const { aoVerSistema } = montar(memoria(0.4));

    fireEvent.click(screen.getByRole("button", { name: "Ver Sistema" }));
    expect(aoVerSistema).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toBeInTheDocument();

    fireEvent.click(entendi());

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("dispensado no nível baixo, volta se a memória ficar crítica", () => {
    const { atualizar } = montar(memoria(1.2));
    fireEvent.click(entendi());
    expect(screen.queryByText(/Memória baixa/)).not.toBeInTheDocument();

    atualizar(memoria(0.4));

    expect(screen.getByText(/Memória quase esgotada/)).toBeInTheDocument();
  });

  it("dispensado no crítico, não reaparece ao melhorar só para baixa", () => {
    const { atualizar } = montar(memoria(0.4));
    fireEvent.click(entendi());

    atualizar(memoria(1.2));

    expect(screen.queryByRole("region", { name: "Notificações" })).not.toBeInTheDocument();
  });

  it("depois de normalizar, volta a avisar se apertar de novo", () => {
    const { atualizar } = montar(memoria(0.4));
    fireEvent.click(entendi());

    atualizar(memoria(8));
    atualizar(memoria(0.4));

    expect(screen.getByText(/Memória quase esgotada/)).toBeInTheDocument();
  });

  it("cota acima do limite de aviso: uma notificação só da janela alta, com Ver Sistema e Entendi", () => {
    const { aoVerSistema } = montar(memoria(10), cotaAlta);

    const aviso = screen.getByRole("status");
    expect(aviso).toHaveTextContent("Cota (7 dias) em 85%.");
    expect(aviso).toHaveTextContent("Passou do limite de aviso (80%).");
    expect(aviso).toHaveClass("notificacao-cota");
    expect(screen.queryByText(/5 horas/)).not.toBeInTheDocument();
    fireEvent.click(within(aviso).getByRole("button", { name: "Ver Sistema" }));
    expect(aoVerSistema).toHaveBeenCalledTimes(1);

    fireEvent.click(within(aviso).getByRole("button", { name: "Entendi: cota 7 dias" }));
    expect(screen.queryByRole("region", { name: "Notificações" })).not.toBeInTheDocument();
  });

  it("memória e cota se empilham, a memória em cima", () => {
    montar(memoria(0.4), cotaAlta);

    const avisos = screen.getByRole("region", { name: "Notificações" }).querySelectorAll(".notificacao");
    expect([...avisos].map((aviso) => aviso.className)).toEqual([
      "notificacao notificacao-critica",
      "notificacao notificacao-cota",
    ]);
  });

  it("a cota dispensada volta se cair abaixo do limite e passar de novo", () => {
    const { atualizar } = montar(memoria(10), cotaAlta);
    fireEvent.click(screen.getByRole("button", { name: "Entendi: cota 7 dias" }));

    atualizar(memoria(10), [{ nome: "7 dias", utilizacao: 0.5, renovaEm: null, situacao: "allowed" }]);
    atualizar(memoria(10), cotaAlta);

    expect(screen.getByText(/Cota \(7 dias\) em 85%/)).toBeInTheDocument();
  });

  it("com a atualização pronta, o aviso entra na pilha e reiniciar com pedidos em andamento pede confirmação", async () => {
    const pronta = { situacao: "pronta", versaoAtual: "0.2.0", versaoNova: "0.2.1", progresso: null, mensagemDeErro: null };
    janelaComPonte.electron = {
      desktop: true,
      atualizacao: {
        obter: vi.fn().mockResolvedValue(pronta),
        verificar: vi.fn().mockResolvedValue(pronta),
        instalarAgora: vi.fn().mockResolvedValue(undefined),
        aoMudar: vi.fn(() => () => undefined),
      },
    };
    montar(memoria(10), null, 2);

    const regiao = await screen.findByRole("region", { name: "Notificações" });
    const pilula = await within(regiao).findByRole("button", { name: "Atualização pronta (v0.2.1)" });
    fireEvent.click(pilula);
    fireEvent.click(screen.getByRole("button", { name: "Reiniciar agora" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Há 2 pedidos em andamento");
  });
});
