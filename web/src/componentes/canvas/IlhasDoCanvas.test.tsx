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
      aoAlternarSkills: vi.fn(),
      skillsAbertas: false,
    };
    render(<IlhaDoNome {...comuns} />);

    const ilha = screen.getByTestId("ilha-do-nome");
    expect(ilha).toHaveClass("ilha");
    expect(within(ilha).getByRole("heading", { name: "Orquestrador de Agentes" })).toBeInTheDocument();
    expect(ilha.querySelector(".divisor-da-ilha")).not.toBeNull();
    // Não arrasta nem move o canvas por baixo.
    expect(ilha).toHaveClass("nodrag", "nopan", "nowheel");
    // O fundo arrasta a janela (Electron); o botão Novo (com o menu e o submenu) não.
    expect(ilha).toHaveClass("ilha-arrasta");
    expect(within(ilha).getByRole("button", { name: "Novo" }).closest(".ancora-do-menu-novo")).toHaveClass("no-drag");

    fireEvent.click(within(ilha).getByRole("button", { name: "Novo" }));
    fireEvent.click(within(ilha).getByRole("menuitem", { name: "Nota" }));
    expect(comuns.aoCriarNota).toHaveBeenCalledTimes(1);
  });

  it("tem o botão das Skills do Claude Code, que não arrasta a janela, mostra se o painel está aberto e o alterna", () => {
    const aoAlternarSkills = vi.fn();
    const propriedades = {
      aoCriar: vi.fn(),
      aoCriarNota: vi.fn(),
      aoCriarPrevia: vi.fn(),
      aoBuscar: vi.fn(),
      aoAbrirConfiguracoes: vi.fn(),
      orquestradores: [],
      erroDosOrquestradores: null,
      noCanvas: new Set<string>(),
      aoEscolherOrquestrador: vi.fn(),
      subagentes: [],
      aoAbrirSubagentes: vi.fn(),
      aoAlternarSkills,
    };
    const { rerender } = render(<IlhaDoNome {...propriedades} skillsAbertas={false} />);

    const botao = screen.getByRole("button", { name: "Skills do Claude Code" });
    expect(botao).toHaveClass("botao-da-ilha", "no-drag");
    expect(botao).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(botao);
    expect(aoAlternarSkills).toHaveBeenCalledTimes(1);

    rerender(<IlhaDoNome {...propriedades} skillsAbertas />);
    expect(screen.getByRole("button", { name: "Skills do Claude Code" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("IlhaDaDireita", () => {
  afterEach(() => {
    delete janelaComPonte.electron;
  });

  function montar(extras: Partial<Parameters<typeof IlhaDaDireita>[0]> = {}) {
    const aoBuscar = vi.fn();
    const aoAlternarConfiguracoes = vi.fn();
    render(
      <IlhaDaDireita
        aoBuscar={aoBuscar}
        trabalhando={0}
        memoria={memoria(10)}
        cota={null}
        aoAlternarConfiguracoes={aoAlternarConfiguracoes}
        configuracoesAbertas={false}
        abaAberta={null}
        {...extras}
      />,
    );
    return { aoBuscar, aoAlternarConfiguracoes };
  }

  it("tem, nesta ordem, a lupa, o indicador de uso, o anel de memória e a engrenagem; sem ninguém trabalhando, não há contador", () => {
    montar();

    const ilha = screen.getByRole("group", { name: "Busca, status e configurações" });
    expect(within(ilha).getAllByRole("button").map((botao) => botao.getAttribute("aria-label"))).toEqual([
      "Buscar (Ctrl+K)",
      "Uso do Claude: sem leitura ainda. Abrir Configurações, Conta",
      "Memória do computador: 38% em uso. Abrir Configurações, Sistema",
      "Configurações",
    ]);
    expect(screen.queryByTestId("contador-trabalhando")).not.toBeInTheDocument();
  });

  it("o fundo da ilha arrasta a janela e todos os controles dela são no-drag", () => {
    montar({ trabalhando: 2 });

    const ilha = screen.getByRole("group", { name: "Busca, status e configurações" });
    expect(ilha).toHaveClass("ilha-arrasta");
    for (const botao of within(ilha).getAllByRole("button")) expect(botao).toHaveClass("no-drag");
    expect(screen.getByTestId("contador-trabalhando")).toHaveClass("no-drag");
  });

  it("sem controlesDaJanela (Mac e navegador), a ilha não tem ─ ☐ ✕", () => {
    montar();

    expect(screen.queryByRole("group", { name: "Controles da janela" })).not.toBeInTheDocument();
  });

  it("com controlesDaJanela (Windows e Linux desktop), ─ ☐ ✕ ficam no fim, depois de um divisor, e agem na janela", async () => {
    const janela = {
      minimizar: vi.fn().mockResolvedValue(undefined),
      maximizar: vi.fn().mockResolvedValue(undefined),
      fechar: vi.fn().mockResolvedValue(undefined),
      estaMaximizada: vi.fn().mockResolvedValue(true),
      aoMudarMaximizada: vi.fn(() => () => undefined),
    };
    janelaComPonte.electron = { desktop: true, plataforma: "win32", janela };
    montar({ controlesDaJanela: true });

    const ilha = screen.getByRole("group", { name: "Busca, status e configurações" });
    const controles = within(ilha).getByRole("group", { name: "Controles da janela" });
    expect(ilha.lastElementChild).toBe(controles);
    expect(controles.previousElementSibling).toHaveClass("divisor-da-ilha");
    expect(controles).toHaveClass("no-drag");
    expect(within(controles).getAllByRole("button").map((botao) => botao.getAttribute("aria-label"))).toEqual([
      "Minimizar",
      expect.stringMatching(/Maximizar|Restaurar/),
      "Fechar",
    ]);
    // Mantém o estado de maximizada: a janela abriu maximizada, o ícone é o de restaurar.
    expect(await within(controles).findByRole("button", { name: "Restaurar" })).toBeInTheDocument();

    fireEvent.click(within(controles).getByRole("button", { name: "Minimizar" }));
    fireEvent.click(within(controles).getByRole("button", { name: "Fechar" }));
    expect(janela.minimizar).toHaveBeenCalledTimes(1);
    expect(janela.fechar).toHaveBeenCalledTimes(1);
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
        cota={null}
        aoAlternarConfiguracoes={vi.fn()}
        configuracoesAbertas={false}
        abaAberta={null}
      />,
    );
    expect(screen.getByTestId("anel-de-memoria")).toHaveClass("anel-da-ilha-baixa");
    expect(screen.getByTestId("anel-de-memoria")).toHaveTextContent("Memória baixa");
    // A % em uso fica no rótulo e na dica (o anel só desenha o arco).
    expect(screen.getByTestId("anel-de-memoria")).toHaveAttribute(
      "aria-label",
      "Memória do computador: 93% em uso, memória baixa. Abrir Configurações, Sistema",
    );
    unmount();

    render(
      <IlhaDaDireita
        aoBuscar={vi.fn()}
        trabalhando={0}
        memoria={memoria(0.4)}
        cota={null}
        aoAlternarConfiguracoes={vi.fn()}
        configuracoesAbertas={false}
        abaAberta={null}
      />,
    );
    expect(screen.getByTestId("anel-de-memoria")).toHaveClass("anel-da-ilha-critica");
    expect(screen.getByTestId("anel-de-memoria")).toHaveTextContent("Memória crítica");
  });

  it("com a memória normal, o anel não tem texto ao lado", () => {
    montar({ memoria: memoria(10) });

    expect(screen.getByTestId("anel-de-memoria")).toHaveClass("anel-da-ilha-normal");
    expect(screen.getByTestId("anel-de-memoria")).toHaveTextContent("");
  });

  it("sem leitura de memória, o anel continua e diz isso", () => {
    montar({ memoria: null });

    expect(screen.getByTestId("anel-de-memoria")).toHaveAccessibleName(
      "Memória do computador: sem leitura ainda. Abrir Configurações, Sistema",
    );
  });

  describe("indicador de uso da cota", () => {
    const AGORA = new Date("2026-11-10T12:00:00Z");
    const emMinutos = (minutos: number) => new Date(AGORA.getTime() + minutos * 60_000).toISOString();
    const janela = (nome: string, utilizacao: number, extras: Partial<JanelaDaCota> = {}): JanelaDaCota => ({
      nome,
      utilizacao,
      renovaEm: null,
      situacao: "allowed",
      ...extras,
    });
    const propsSemCota = {
      aoBuscar: vi.fn(),
      trabalhando: 0,
      memoria: memoria(10),
      aoAlternarConfiguracoes: vi.fn(),
      configuracoesAbertas: false,
      abaAberta: null,
    };

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(AGORA);
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    /** O arco desenhado do anel de uso; nulo se há só a trilha. */
    const arco = (indicador: HTMLElement) => indicador.querySelector<SVGCircleElement>(".anel-de-uso .arco-do-anel");
    /** O comprimento do traço do arco, em fração (0 a 1) da circunferência. */
    const fracaoDoArco = (indicador: HTMLElement) => {
      const [traco = "0", total = "1"] = (arco(indicador)?.getAttribute("stroke-dasharray") ?? "0 1").split(" ");
      return Number(traco) / Number(total);
    };
    const numeroDoAnel = (indicador: HTMLElement) => indicador.querySelector(".valor-do-anel")?.textContent;

    it("sem leitura (cota nula ou vazia): número \"–\", só a trilha, sem texto de alerta e a frase diz isso", () => {
      const { unmount } = render(<IlhaDaDireita {...propsSemCota} cota={null} />);
      const indicador = screen.getByTestId("indicador-de-uso");
      const frase = "Uso do Claude: sem leitura ainda. Abrir Configurações, Conta";
      expect(indicador).toHaveAttribute("aria-label", frase);
      expect(indicador).toHaveAttribute("title", frase);
      expect(indicador).toHaveClass("anel-da-ilha-normal");
      expect(numeroDoAnel(indicador)).toBe("–");
      expect(indicador.querySelector(".anel-de-uso .trilha-do-anel")).not.toBeNull();
      expect(arco(indicador)).toBeNull();
      expect(indicador).toHaveTextContent("–");
      unmount();

      montar({ cota: [] });
      expect(screen.getByTestId("indicador-de-uso")).toHaveAccessibleName(frase);
      expect(numeroDoAnel(screen.getByTestId("indicador-de-uso"))).toBe("–");
      expect(arco(screen.getByTestId("indicador-de-uso"))).toBeNull();
    });

    it("o anel mostra a semana: arco com a utilização, número inteiro no meio e o rótulo com a renovação", () => {
      montar({ cota: [janela("7 dias", 0.38, { renovaEm: emMinutos(6 * 24 * 60) })] });

      const indicador = screen.getByTestId("indicador-de-uso");
      expect(indicador).toHaveClass("anel-da-ilha-normal");
      expect(numeroDoAnel(indicador)).toBe("38");
      expect(fracaoDoArco(indicador)).toBeCloseTo(0.38, 5);
      // De um dia em diante a renovação sai como data e hora (o formato do resto do app).
      const frase = /^Uso do Claude: semana 38%, renova em \d{2}\/\d{2}, \d{2}:\d{2}\. Abrir Configurações, Conta$/;
      expect(indicador.getAttribute("aria-label")).toMatch(frase);
      expect(indicador.getAttribute("title")).toMatch(frase);
      // Nada de barras nem de rótulo 5h ou 7d.
      expect(indicador.querySelector(".trilha-de-uso, .linha-de-uso")).toBeNull();
      expect(indicador).not.toHaveTextContent(/5h|7d/);
    });

    it("o número é o percentual arredondado, de 0 a 100", () => {
      const { unmount } = render(<IlhaDaDireita {...propsSemCota} cota={[janela("7 dias", 0.376)]} />);
      expect(numeroDoAnel(screen.getByTestId("indicador-de-uso"))).toBe("38");
      unmount();

      const cheio = render(<IlhaDaDireita {...propsSemCota} cota={[janela("7 dias", 1.3)]} />);
      expect(numeroDoAnel(screen.getByTestId("indicador-de-uso"))).toBe("100");
      expect(fracaoDoArco(screen.getByTestId("indicador-de-uso"))).toBeCloseTo(1, 5);
      cheio.unmount();

      montar({ cota: [janela("7 dias", 0)] });
      expect(numeroDoAnel(screen.getByTestId("indicador-de-uso"))).toBe("0");
      expect(arco(screen.getByTestId("indicador-de-uso"))).toBeNull();
    });

    it("com semana geral e por modelo, o anel usa a geral e o rótulo traz as outras, separadas por ponto e vírgula", () => {
      montar({
        cota: [janela("7 dias (Opus)", 0.55), janela("7 dias", 0.3, { renovaEm: emMinutos(3 * 60) })],
      });

      const indicador = screen.getByTestId("indicador-de-uso");
      expect(numeroDoAnel(indicador)).toBe("30");
      expect(indicador).toHaveAccessibleName("Uso do Claude: semana 30%, renova em 3 h; semana (Opus) 55%. Abrir Configurações, Conta");
    });

    it("sem a semana geral, o anel usa a semanal de maior utilização", () => {
      montar({ cota: [janela("7 dias (Sonnet)", 0.2), janela("7 dias (Opus)", 0.55)] });

      const indicador = screen.getByTestId("indicador-de-uso");
      expect(numeroDoAnel(indicador)).toBe("55");
      expect(indicador).toHaveAccessibleName("Uso do Claude: semana (Opus) 55%; semana (Sonnet) 20%. Abrir Configurações, Conta");
    });

    it("sem semanal, o anel usa a de maior utilização entre as que vierem", () => {
      montar({ cota: [janela("30 dias", 0.1), janela("90 dias", 0.45)] });

      const indicador = screen.getByTestId("indicador-de-uso");
      expect(numeroDoAnel(indicador)).toBe("45");
      expect(indicador).toHaveAccessibleName("Uso do Claude: 90 dias 45%; 30 dias 10%. Abrir Configurações, Conta");
    });

    it("a janela de 5 horas nunca tem desenho próprio: só entra no rótulo e no alerta", () => {
      montar({ cota: [janela("5 horas", 0.42), janela("7 dias", 0.18)] });

      const indicador = screen.getByTestId("indicador-de-uso");
      expect(numeroDoAnel(indicador)).toBe("18");
      expect(fracaoDoArco(indicador)).toBeCloseTo(0.18, 5);
      expect(indicador).not.toHaveTextContent(/5h/);
      expect(indicador).toHaveAccessibleName("Uso do Claude: semana 18%; sessão de 5 h 42%. Abrir Configurações, Conta");
    });

    it("só com a janela de 5 horas, o anel fica sem leitura, mas o rótulo e o alerta contam", () => {
      montar({ cota: [janela("5 horas", 0.97)] });

      const indicador = screen.getByTestId("indicador-de-uso");
      expect(numeroDoAnel(indicador)).toBe("–");
      expect(arco(indicador)).toBeNull();
      expect(indicador).toHaveClass("anel-da-ilha-critica");
      expect(indicador).toHaveTextContent("Cota no limite");
      expect(indicador).toHaveAccessibleName("Uso do Claude: sessão de 5 h 97%. Cota no limite. Abrir Configurações, Conta");
    });

    it("abaixo de 80% o anel é normal e o botão não tem texto de alerta", () => {
      montar({ cota: [janela("7 dias", 0.38)] });

      const indicador = screen.getByTestId("indicador-de-uso");
      expect(indicador.querySelector(".anel-de-uso")).toHaveClass("anel-de-uso-normal");
      expect(indicador).not.toHaveTextContent(/Cota/);
    });

    it("a partir de 80% o anel fica âmbar e o botão ganha o texto Cota alta", () => {
      montar({ cota: [janela("7 dias", 0.85)] });

      const indicador = screen.getByTestId("indicador-de-uso");
      expect(indicador).toHaveClass("anel-da-ilha-alta");
      expect(indicador.querySelector(".anel-de-uso")).toHaveClass("anel-de-uso-alta");
      expect(indicador).toHaveTextContent("Cota alta");
      expect(indicador).toHaveAccessibleName("Uso do Claude: semana 85%. Cota alta. Abrir Configurações, Conta");
    });

    it("a partir de 95% ou com a situação rejected, o anel fica vermelho e o botão diz Cota no limite", () => {
      const { unmount } = render(<IlhaDaDireita {...propsSemCota} cota={[janela("7 dias", 0.97)]} />);
      let indicador = screen.getByTestId("indicador-de-uso");
      expect(indicador).toHaveClass("anel-da-ilha-critica");
      expect(indicador).toHaveTextContent("Cota no limite");
      expect(indicador.querySelector(".anel-de-uso")).toHaveClass("anel-de-uso-critica");
      unmount();

      montar({ cota: [janela("7 dias", 0.6, { situacao: "rejected" })] });
      indicador = screen.getByTestId("indicador-de-uso");
      expect(indicador).toHaveClass("anel-da-ilha-critica");
      expect(indicador).toHaveTextContent("Cota no limite");
      expect(indicador.querySelector(".anel-de-uso")).toHaveClass("anel-de-uso-critica");
    });

    it("o anel tem a cor da janela mostrada, e o botão e o texto seguem a pior janela", () => {
      montar({ cota: [janela("7 dias", 0.2), janela("7 dias (Opus)", 0.9)] });

      const indicador = screen.getByTestId("indicador-de-uso");
      expect(numeroDoAnel(indicador)).toBe("20");
      expect(indicador.querySelector(".anel-de-uso")).toHaveClass("anel-de-uso-normal");
      expect(indicador).toHaveClass("anel-da-ilha-alta");
      expect(indicador).toHaveTextContent("Cota alta");
    });

    it("o clique abre as Configurações na aba Conta", () => {
      const { aoAlternarConfiguracoes } = montar({ cota: [janela("7 dias", 0.42)] });

      fireEvent.click(screen.getByTestId("indicador-de-uso"));

      expect(aoAlternarConfiguracoes).toHaveBeenCalledWith("conta");
    });

    it("aria-pressed fica ativo só com a aba Conta aberta, e a engrenagem não fica junto", () => {
      montar({ configuracoesAbertas: true, abaAberta: "conta" });

      expect(screen.getByTestId("indicador-de-uso")).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByTestId("anel-de-memoria")).toHaveAttribute("aria-pressed", "false");
      expect(screen.getByRole("button", { name: "Configurações" })).toHaveAttribute("aria-pressed", "false");
    });

    it("com as Configurações fechadas ou em outra aba, o indicador de uso não fica pressionado", () => {
      montar({ configuracoesAbertas: true, abaAberta: "sistema" });

      expect(screen.getByTestId("indicador-de-uso")).toHaveAttribute("aria-pressed", "false");
    });
  });

  it("aria-pressed marca só o botão da aba aberta: o anel no Sistema, a engrenagem nas outras", () => {
    const { unmount } = render(
      <IlhaDaDireita
        aoBuscar={vi.fn()}
        trabalhando={0}
        memoria={memoria(10)}
        cota={null}
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
        cota={null}
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

    // 66 de topo + altura da pilha (0 no jsdom) + 8 de respiro.
    expect(aoMedirTopoLivre).toHaveBeenLastCalledWith(74);

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
