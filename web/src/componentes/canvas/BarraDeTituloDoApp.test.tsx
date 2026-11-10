import { act, fireEvent, render, screen, within } from "@testing-library/react";

import { BarraDeTituloDoApp } from "./BarraDeTituloDoApp";

describe("BarraDeTituloDoApp", () => {
  const janelaComPonte = window as unknown as { electron?: unknown };

  afterEach(() => {
    delete janelaComPonte.electron;
  });

  /** A ponte do app desktop. */
  function ponteDoDesktop() {
    janelaComPonte.electron = {
      desktop: true,
      janela: {
        minimizar: vi.fn(),
        maximizar: vi.fn(),
        fechar: vi.fn(),
        estaMaximizada: vi.fn().mockResolvedValue(false),
        aoMudarMaximizada: vi.fn(() => () => undefined),
      },
    };
  }

  const renderizar = () => {
    render(<BarraDeTituloDoApp />);
    return { barra: screen.getByTestId("barra-de-titulo") };
  };

  it("é só a faixa de arrastar com os botões ─ ☐ ✕ à direita: sem nome, busca, status nem configurações", () => {
    ponteDoDesktop();
    const { barra } = renderizar();

    expect(barra).toHaveClass("barra-de-titulo");
    expect(barra).not.toHaveTextContent("Orquestrador de Agentes");
    expect(within(barra).queryByRole("button", { name: /Buscar/ })).not.toBeInTheDocument();
    expect(within(barra).queryByRole("button", { name: "Configurações" })).not.toBeInTheDocument();
    expect(within(barra).queryByTestId("status-do-canvas")).not.toBeInTheDocument();

    // O vão arrasta a janela; à direita, só os controles da janela.
    expect(barra.firstElementChild).toHaveClass("vao-da-barra-de-titulo");
    expect(barra.lastElementChild).toHaveClass("botoes-da-barra-de-titulo");
    const controles = within(barra).getByRole("group", { name: "Controles da janela" });
    expect(barra.lastElementChild).toContainElement(controles);
    expect(within(controles).getAllByRole("button").map((botao) => botao.getAttribute("aria-label"))).toEqual([
      "Minimizar",
      "Maximizar",
      "Fechar",
    ]);
  });

  describe("modo invisível", () => {
    function ponteComModoInvisivel() {
      let ouvinte: ((ativo: boolean) => void) | null = null;
      const modoInvisivel = {
        entrar: vi.fn().mockResolvedValue(undefined),
        sair: vi.fn().mockResolvedValue(undefined),
        capturarMouse: vi.fn().mockResolvedValue(undefined),
        capturarTela: vi.fn(),
        capturarAgora: vi.fn(),
        aoCapturarQuadro: vi.fn(() => () => undefined),
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
    ponteDoDesktop();
    (janelaComPonte.electron as { plataforma?: string }).plataforma = "darwin";
    const { barra } = renderizar();

    expect(barra.style.paddingLeft).toBe("80px");
    expect(within(barra).queryByRole("group", { name: "Controles da janela" })).not.toBeInTheDocument();
    expect(within(barra).queryAllByRole("button")).toHaveLength(0);
  });

  it("no Windows, a barra não reserva espaço à esquerda", () => {
    ponteDoDesktop();
    (janelaComPonte.electron as { plataforma?: string }).plataforma = "win32";
    const { barra } = renderizar();

    expect(barra.style.paddingLeft).toBe("");
    expect(within(barra).getByRole("group", { name: "Controles da janela" })).toBeInTheDocument();
  });
});
