import { act, fireEvent, render, screen, within } from "@testing-library/react";

import { BarraDeTituloDoApp } from "./BarraDeTituloDoApp";

describe("BarraDeTituloDoApp", () => {
  const janelaComPonte = window as unknown as { electron?: unknown };

  afterEach(() => {
    delete janelaComPonte.electron;
  });

  /** A ponte do app desktop; `abrirAjustes` e a atualização só quando o teste passa. */
  function ponteDoDesktop(abrirAjustes?: () => Promise<void>, atualizacao?: unknown) {
    janelaComPonte.electron = {
      desktop: true,
      janela: {
        minimizar: vi.fn(),
        maximizar: vi.fn(),
        fechar: vi.fn(),
        estaMaximizada: vi.fn().mockResolvedValue(false),
        aoMudarMaximizada: vi.fn(() => () => undefined),
      },
      ...(abrirAjustes === undefined ? {} : { configuracao: { obter: vi.fn(), abrirAjustes } }),
      ...(atualizacao === undefined ? {} : { atualizacao }),
    };
  }

  const renderizar = (aoBuscar = vi.fn()) => {
    render(
      <BarraDeTituloDoApp
        trabalhando={2}
        bixinhosAtivos={0}
        cota={[{ nome: "5 horas", utilizacao: 0.3, renovaEm: null, situacao: "allowed" }]}
        memoria={null}
        aoBuscar={aoBuscar}
        pedidosEmAndamento={2}
      />,
    );
    return { aoBuscar, barra: screen.getByTestId("barra-de-titulo") };
  };

  const campoDeBusca = () => screen.getByRole("button", { name: "Buscar ou executar (Ctrl+K)" });

  it("mostra o nome do app à esquerda e, à direita, o status colado ao ⚙ e aos botões da janela", () => {
    ponteDoDesktop(vi.fn().mockResolvedValue(undefined));
    const { barra } = renderizar();

    expect(barra).toHaveClass("barra-de-titulo");
    expect(barra.firstElementChild).toHaveTextContent("Orquestrador de Agentes");
    const status = within(barra).getByTestId("status-do-canvas");
    expect(status).toHaveTextContent("2 trabalhando");
    expect(status).toHaveTextContent("5 horas");
    // Clicável/balão: fora da região de arraste da janela.
    expect(status).toHaveClass("no-drag");

    // Direita: status e, logo depois dele, o ⚙ e os botões ─ ☐ ✕ do app.
    const direita = barra.querySelector(".direita-da-barra-de-titulo");
    expect(direita).toBe(barra.lastElementChild);
    const controles = within(barra).getByRole("group", { name: "Controles da janela" });
    const configuracoes = within(barra).getByRole("button", { name: "Configurações" });
    expect(direita?.firstElementChild).toBe(status);
    const botoes = status.nextElementSibling;
    expect(botoes).toHaveClass("botoes-da-barra-de-titulo");
    // O ⚙ vai numa âncora (o painel abre ancorado nele), também fora do arraste.
    expect(botoes?.firstElementChild).toBe(configuracoes.parentElement);
    expect(configuracoes.parentElement).toHaveClass("ancora-do-menu", "no-drag");
    expect(botoes?.lastElementChild).toBe(controles);
    expect(within(controles).getAllByRole("button").map((botao) => botao.getAttribute("aria-label"))).toEqual([
      "Minimizar",
      "Maximizar",
      "Fechar",
    ]);
  });

  it("a busca fica entre o nome e o status, com cara de campo, o atalho e no-drag; clicar abre a paleta", () => {
    ponteDoDesktop();
    const { aoBuscar, barra } = renderizar();
    const busca = campoDeBusca();

    // Centro da barra: o vão em volta da busca continua arrastando a janela.
    expect(busca.parentElement).toHaveClass("centro-da-barra-de-titulo");
    expect(busca.parentElement).not.toHaveClass("no-drag");
    expect(busca.parentElement?.previousElementSibling).toBe(barra.firstElementChild);
    expect(busca.parentElement?.nextElementSibling).toHaveClass("direita-da-barra-de-titulo");
    expect(busca).toHaveClass("campo-de-busca-da-barra", "no-drag");
    expect(busca).toHaveAttribute("aria-keyshortcuts", "Control+K");
    expect(busca).toHaveTextContent("Buscar ou executar…");
    expect(busca.querySelector("kbd")).toHaveTextContent("Ctrl+K");
    expect(busca.querySelector(".icone-da-busca")).toHaveTextContent("⌕");

    fireEvent.click(busca);

    expect(aoBuscar).toHaveBeenCalledTimes(1);
  });

  const botaoDeConfiguracoes = () => screen.getByRole("button", { name: "Configurações" });

  it("o ⚙ (só ícone, no-drag) abre o painel Configurações: seção Tela e \"Pastas e Claude Code…\", que abre os Ajustes", () => {
    const abrirAjustes = vi.fn().mockResolvedValue(undefined);
    ponteDoDesktop(abrirAjustes);
    renderizar();

    expect(botaoDeConfiguracoes()).toHaveTextContent("⚙");
    expect(botaoDeConfiguracoes()).toHaveAttribute("title", "Configurações: tela, pastas e Claude Code");
    expect(botaoDeConfiguracoes()).toHaveClass("no-drag");
    expect(botaoDeConfiguracoes()).toHaveAttribute("aria-haspopup", "menu");
    fireEvent.click(botaoDeConfiguracoes());

    const painel = screen.getByRole("menu", { name: "Configurações" });
    expect(painel).toHaveClass("painel-de-configuracoes-direita", "no-drag");
    expect(within(painel).getByRole("group", { name: "Tela" })).toBeInTheDocument();
    expect(within(painel).getByRole("menuitemcheckbox", { name: /Chat fixo à esquerda/ })).toHaveFocus();
    expect(abrirAjustes).not.toHaveBeenCalled();

    fireEvent.click(within(painel).getByRole("menuitem", { name: "Pastas e Claude Code…" }));

    expect(abrirAjustes).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("Esc fecha o painel e devolve o foco ao ⚙", () => {
    ponteDoDesktop(vi.fn().mockResolvedValue(undefined));
    renderizar();
    fireEvent.click(botaoDeConfiguracoes());

    fireEvent.keyDown(screen.getByRole("menuitemcheckbox", { name: /Chat fixo à esquerda/ }), { key: "Escape" });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(botaoDeConfiguracoes()).toHaveFocus();
  });

  it("mostra a mensagem quando os ajustes não abrem, e o ✕ dela fecha", async () => {
    ponteDoDesktop(vi.fn().mockRejectedValue(new Error("janela ocupada")));
    renderizar();

    fireEvent.click(botaoDeConfiguracoes());
    fireEvent.click(screen.getByRole("menuitem", { name: "Pastas e Claude Code…" }));

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("Não foi possível abrir os ajustes de pastas: janela ocupada");
    expect(alerta.parentElement).toHaveClass("erro-da-barra-de-titulo", "no-drag");
    fireEvent.click(within(alerta).getByTitle("Fechar aviso"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("sem a API dos Ajustes, o ⚙ continua (preferências da tela), mas sem \"Pastas e Claude Code…\"", () => {
    ponteDoDesktop();
    renderizar();

    fireEvent.click(botaoDeConfiguracoes());

    // Os dois da Tela e a Autorrecuperação dos orquestradores.
    expect(screen.getAllByRole("menuitemcheckbox")).toHaveLength(3);
    expect(screen.queryByRole("menuitem", { name: /Pastas e Claude Code/ })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Controles da janela" })).toBeInTheDocument();
  });

  it("com uma atualização pronta, a pílula fica à direita, antes do status, fora do arraste", async () => {
    const pronta = { situacao: "pronta", versaoAtual: "0.2.0", versaoNova: "0.2.1", progresso: null, mensagemDeErro: null };
    ponteDoDesktop(undefined, {
      obter: vi.fn().mockResolvedValue(pronta),
      verificar: vi.fn().mockResolvedValue(pronta),
      instalarAgora: vi.fn().mockResolvedValue(undefined),
      aoMudar: vi.fn(() => () => undefined),
    });
    const { barra } = renderizar();

    const pilula = await within(barra).findByRole("button", { name: "Atualização pronta (v0.2.1)" });
    const direita = barra.querySelector(".direita-da-barra-de-titulo");
    expect(direita?.firstElementChild).toBe(pilula.parentElement);
    expect(pilula.parentElement).toHaveClass("no-drag");
    expect(pilula.parentElement?.nextElementSibling).toBe(within(barra).getByTestId("status-do-canvas"));

    // Os pedidos em andamento (2) chegam ao aviso: reiniciar pede confirmação.
    fireEvent.click(pilula);
    fireEvent.click(screen.getByRole("button", { name: "Reiniciar agora" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Há 2 pedidos em andamento");
  });

  describe("modo invisível", () => {
    function ponteComModoInvisivel() {
      let ouvinte: ((ativo: boolean) => void) | null = null;
      const modoInvisivel = {
        entrar: vi.fn().mockResolvedValue(undefined),
        sair: vi.fn().mockResolvedValue(undefined),
        capturarMouse: vi.fn().mockResolvedValue(undefined),
        capturarTela: vi.fn(),
        aoMudar: vi.fn((callback: (ativo: boolean) => void) => {
          ouvinte = callback;
          return () => undefined;
        }),
      };
      janelaComPonte.electron = {
        desktop: true,
        janela: {
          minimizar: vi.fn(),
          maximizar: vi.fn(),
          fechar: vi.fn(),
          estaMaximizada: vi.fn().mockResolvedValue(false),
          aoMudarMaximizada: vi.fn(() => () => undefined),
        },
        modoInvisivel,
      };
      return { modoInvisivel, avisar: (ativo: boolean) => act(() => ouvinte?.(ativo)) };
    }

    it("a barra não tem o botão 👁 (fica no chat rápido); ativo, fica escondida e sem indicador", () => {
      const { avisar } = ponteComModoInvisivel();
      renderizar();

      expect(screen.queryByRole("button", { name: "Modo invisível" })).not.toBeInTheDocument();

      avisar(true);
      expect(screen.queryByText("Tela sendo vista")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Voltar ao modo normal" })).not.toBeInTheDocument();
      expect(screen.getByTestId("barra-de-titulo")).toHaveClass("barra-de-titulo-invisivel");

      avisar(false);
      expect(screen.getByTestId("barra-de-titulo")).not.toHaveClass("barra-de-titulo-invisivel");
      expect(screen.queryByRole("button", { name: "Modo invisível" })).not.toBeInTheDocument();
    });

    it("ativo, o mouse sobre a barra não captura os cliques (ela é escondida)", () => {
      const { modoInvisivel, avisar } = ponteComModoInvisivel();
      const { barra } = renderizar();
      avisar(true);
      modoInvisivel.capturarMouse.mockClear();

      fireEvent.mouseEnter(barra);
      fireEvent.mouseLeave(barra);
      expect(modoInvisivel.capturarMouse).not.toHaveBeenCalled();
    });
  });

  it("no Mac, deixa as bolinhas nativas à esquerda e não desenha os botões ─ ☐ ✕", () => {
    ponteDoDesktop(vi.fn().mockResolvedValue(undefined));
    (janelaComPonte.electron as { plataforma?: string }).plataforma = "darwin";
    const { barra } = renderizar();

    expect(barra.style.paddingLeft).toBe("80px");
    expect(within(barra).queryByRole("group", { name: "Controles da janela" })).not.toBeInTheDocument();
    expect(barra.querySelector(".separador-da-barra-de-titulo")).toBeNull();
    // O ⚙ continua.
    expect(within(barra).getByRole("button", { name: "Configurações" })).toBeInTheDocument();
  });

  it("no Windows, a barra não reserva espaço à esquerda", () => {
    ponteDoDesktop();
    (janelaComPonte.electron as { plataforma?: string }).plataforma = "win32";
    const { barra } = renderizar();

    expect(barra.style.paddingLeft).toBe("");
    expect(within(barra).getByRole("group", { name: "Controles da janela" })).toBeInTheDocument();
  });

  it("sem a ponte, não desenha botões de janela; ficam a busca, os medidores do status (abrem o uso) e o ⚙", () => {
    const { barra } = renderizar();

    expect(within(barra).getAllByRole("button")).toEqual([
      campoDeBusca(),
      screen.getByRole("button", { name: "Cota de 5 horas: 30%" }),
      screen.getByTestId("resumo-do-status"),
      botaoDeConfiguracoes(),
    ]);
  });
});
