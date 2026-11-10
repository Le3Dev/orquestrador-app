import { fireEvent, render, screen, within } from "@testing-library/react";

import { FaixaDaEscuta } from "./FaixaDaEscuta";

type PropsDaFaixa = Parameters<typeof FaixaDaEscuta>[0];

function props(alteracoes: Partial<PropsDaFaixa> = {}): PropsDaFaixa {
  return {
    automatico: true,
    alternarAutomatico: vi.fn(),
    ultimaPergunta: null,
    preferenciasDaTela: {
      idioma: "portuguese",
      prioridadeDoMotor: "velocidade",
      aparencia: { tamanhoDaFonte: 14, opacidade: 0.92, compacto: false },
    },
    mudarIdioma: vi.fn(),
    mudarPrioridadeDoMotor: vi.fn(),
    ...alteracoes,
  };
}

describe("FaixaDaEscuta", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("é uma linha enxuta: sem transcrição, download nem erro (ficam no painel)", () => {
    render(<FaixaDaEscuta {...props()} />);
    const faixa = screen.getByTestId("faixa-da-escuta");
    expect(faixa).toHaveAttribute("role", "group");
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a chave Automático reflete o estado e alterna", () => {
    const alternarAutomatico = vi.fn();
    const { rerender } = render(<FaixaDaEscuta {...props({ alternarAutomatico })} />);

    const chave = screen.getByRole("switch", { name: "Automático" });
    expect(chave).toHaveAttribute("aria-checked", "true");
    fireEvent.click(chave);
    expect(alternarAutomatico).toHaveBeenCalledTimes(1);

    rerender(<FaixaDaEscuta {...props({ alternarAutomatico, automatico: false })} />);
    expect(screen.getByRole("switch", { name: "Automático" })).toHaveAttribute("aria-checked", "false");
  });

  it("mostra a última pergunta detectada, inteira no title", () => {
    render(<FaixaDaEscuta {...props({ ultimaPergunta: "Como inverter uma lista ligada?" })} />);
    expect(screen.getByText("Como inverter uma lista ligada?", { exact: false })).toHaveAttribute(
      "title",
      "Como inverter uma lista ligada?",
    );
  });

  it("sem última pergunta, nada dela", () => {
    render(<FaixaDaEscuta {...props()} />);
    expect(screen.queryByText("última pergunta")).not.toBeInTheDocument();
  });

  describe("ajustes", () => {
    const botao = () => screen.getByRole("button", { name: "Ajustes da escuta" });
    const menu = () => screen.queryByRole("group", { name: "Ajustes da escuta" });

    it("o ⚙ abre e fecha o menu, com aria-expanded", () => {
      render(<FaixaDaEscuta {...props()} />);
      expect(botao()).toHaveAttribute("aria-expanded", "false");
      expect(menu()).not.toBeInTheDocument();

      fireEvent.click(botao());
      expect(botao()).toHaveAttribute("aria-expanded", "true");
      expect(menu()).toBeInTheDocument();
      expect(botao()).toHaveAttribute("aria-controls", menu()?.id);

      fireEvent.click(botao());
      expect(menu()).not.toBeInTheDocument();
    });

    it("mostra o idioma e a prioridade escolhidos", () => {
      render(
        <FaixaDaEscuta
          {...props({
            preferenciasDaTela: {
              idioma: "automatico",
              prioridadeDoMotor: "precisao",
              aparencia: { tamanhoDaFonte: 14, opacidade: 0.92, compacto: false },
            },
          })}
        />,
      );
      fireEvent.click(botao());
      const ajustes = menu() as HTMLElement;

      expect(within(ajustes).getByRole("radio", { name: "Automático" })).toBeChecked();
      expect(within(ajustes).getByRole("radio", { name: "Português" })).not.toBeChecked();
      expect(within(ajustes).getByRole("radio", { name: "Precisão" })).toBeChecked();
      expect(within(ajustes).getByRole("radio", { name: "Velocidade" })).not.toBeChecked();
    });

    it("trocar o idioma e a prioridade chama a escuta", () => {
      const mudarIdioma = vi.fn();
      const mudarPrioridadeDoMotor = vi.fn();
      render(<FaixaDaEscuta {...props({ mudarIdioma, mudarPrioridadeDoMotor })} />);
      fireEvent.click(botao());

      fireEvent.click(screen.getByRole("radio", { name: "Automático" }));
      expect(mudarIdioma).toHaveBeenCalledWith("automatico");

      fireEvent.click(screen.getByRole("radio", { name: "Precisão" }));
      expect(mudarPrioridadeDoMotor).toHaveBeenCalledWith("precisao");
    });

    it("Esc fecha e devolve o foco ao ⚙", () => {
      render(<FaixaDaEscuta {...props()} />);
      fireEvent.click(botao());
      const radio = screen.getByRole("radio", { name: "Português" });
      radio.focus();

      fireEvent.keyDown(radio, { key: "Escape" });
      expect(menu()).not.toBeInTheDocument();
      expect(botao()).toHaveFocus();
    });

    it("clicar fora fecha; clicar dentro, não", () => {
      render(
        <div>
          <p>fora</p>
          <FaixaDaEscuta {...props()} />
        </div>,
      );
      fireEvent.click(botao());

      fireEvent.pointerDown(screen.getByRole("radio", { name: "Precisão" }));
      expect(menu()).toBeInTheDocument();

      fireEvent.pointerDown(screen.getByText("fora"));
      expect(menu()).not.toBeInTheDocument();
    });
  });
});
