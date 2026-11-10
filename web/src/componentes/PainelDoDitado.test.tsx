import { act, fireEvent, render, screen } from "@testing-library/react";

import { TEXTO_DO_SILENCIO } from "../shared/ditado/texto";
import { PainelDoDitado } from "./PainelDoDitado";

type Props = Parameters<typeof PainelDoDitado>[0];

function painel(extra: Partial<Props> = {}): Props {
  return {
    fase: "gravando",
    baixando: null,
    segundosDeAudio: null,
    lerNivel: () => 0.5,
    inserido: false,
    aoConcluir: vi.fn(),
    aoDescartar: vi.fn(),
    ...extra,
  };
}

/** Avança o relógio falso (e os quadros de animação) dentro de um act. */
function avancar(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function barras(): HTMLElement[] {
  return [...screen.getByTestId("onda-do-ditado").children] as HTMLElement[];
}

describe("PainelDoDitado", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("parado e sem texto novo, não aparece", () => {
    const { container } = render(<PainelDoDitado {...painel({ fase: "parado" })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("pedindo o microfone, pede a permissão", () => {
    render(<PainelDoDitado {...painel({ fase: "pedindo-microfone" })} />);
    expect(screen.getByText("Permita o acesso ao microfone")).toBeInTheDocument();
  });

  describe("gravando", () => {
    it("mostra o cronômetro em mm:ss, as dicas dos atalhos e os botões com rótulo", () => {
      const props = painel();
      render(<PainelDoDitado {...props} />);
      expect(screen.getByTestId("cronometro-do-ditado")).toHaveTextContent("00:00");
      expect(screen.getByText("Enter conclui, Esc descarta")).toBeInTheDocument();

      avancar(7_050);
      expect(screen.getByTestId("cronometro-do-ditado")).toHaveTextContent("00:07");
      avancar(58_000); // 65 s no total
      expect(screen.getByTestId("cronometro-do-ditado")).toHaveTextContent("01:05");

      fireEvent.click(screen.getByRole("button", { name: "Concluir" }));
      fireEvent.click(screen.getByRole("button", { name: "Descartar" }));
      expect(props.aoConcluir).toHaveBeenCalledTimes(1);
      expect(props.aoDescartar).toHaveBeenCalledTimes(1);
    });

    it("as barras seguem o nível da voz, com a mais nova à direita", () => {
      let nivel: number | null = 0;
      render(<PainelDoDitado {...painel({ lerNivel: () => nivel })} />);
      avancar(500);
      const todas = barras();
      expect(todas).toHaveLength(28);
      expect(todas.at(-1)).toHaveStyle({ transform: "scaleY(0.080)" });

      nivel = 0.9;
      avancar(200);
      expect(todas.at(-1)).toHaveStyle({ transform: "scaleY(0.900)" });
      // O que veio antes anda para a esquerda: a primeira ainda é silêncio.
      expect(todas[0]).toHaveStyle({ transform: "scaleY(0.080)" });
    });

    it("avisa depois de uns 3 s sem voz e some quando a voz volta", () => {
      let nivel: number | null = 0.01;
      render(<PainelDoDitado {...painel({ lerNivel: () => nivel })} />);
      const aviso = () => screen.getByRole("status");
      expect(aviso()).toBeEmptyDOMElement();

      avancar(2_800);
      expect(screen.queryByText(TEXTO_DO_SILENCIO)).not.toBeInTheDocument();
      avancar(400);
      expect(screen.getByText(TEXTO_DO_SILENCIO)).toBeInTheDocument();
      expect(aviso()).toHaveAttribute("aria-live", "polite");

      nivel = 0.6;
      avancar(100);
      expect(screen.queryByText(TEXTO_DO_SILENCIO)).not.toBeInTheDocument();
    });

    it("voz de vez em quando reinicia a contagem do silêncio", () => {
      let nivel: number | null = 0.01;
      render(<PainelDoDitado {...painel({ lerNivel: () => nivel })} />);
      avancar(2_500);
      nivel = 0.5;
      avancar(100);
      nivel = 0.01;
      avancar(2_500);
      expect(screen.queryByText(TEXTO_DO_SILENCIO)).not.toBeInTheDocument();
      avancar(700);
      expect(screen.getByText(TEXTO_DO_SILENCIO)).toBeInTheDocument();
    });

    it("sem como medir o nível (null), não acusa silêncio", () => {
      render(<PainelDoDitado {...painel({ lerNivel: () => null })} />);
      avancar(10_000);
      expect(screen.queryByText(TEXTO_DO_SILENCIO)).not.toBeInTheDocument();
      expect(screen.getByTestId("cronometro-do-ditado")).toHaveTextContent("00:10");
    });

    it("com movimento reduzido, as barras mostram o mesmo nível, estático", () => {
      vi.stubGlobal("matchMedia", (consulta: string) => ({ matches: consulta.includes("reduce") }));
      let nivel: number | null = 0.7;
      render(<PainelDoDitado {...painel({ lerNivel: () => nivel })} />);
      avancar(300);
      for (const barra of barras()) expect(barra).toHaveStyle({ transform: "scaleY(0.700)" });
      nivel = 0.2;
      // O estático só é redesenhado a cada 250 ms, com o pico desse intervalo: o primeiro ainda leva o 0,7 anterior.
      avancar(800);
      for (const barra of barras()) expect(barra).toHaveStyle({ transform: "scaleY(0.200)" });
    });

    it("ao desmontar (concluir, descartar ou sair), para de ler o microfone e o laço de quadros", () => {
      const lerNivel = vi.fn(() => 0.5);
      const cancelar = vi.spyOn(globalThis, "cancelAnimationFrame");
      const { unmount } = render(<PainelDoDitado {...painel({ lerNivel })} />);
      avancar(500);
      expect(lerNivel).toHaveBeenCalled();

      unmount();
      expect(cancelar).toHaveBeenCalled();
      const leituras = lerNivel.mock.calls.length;
      avancar(5_000);
      expect(lerNivel.mock.calls.length).toBe(leituras);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("sair da fase de gravação também para o laço", () => {
      const lerNivel = vi.fn(() => 0.5);
      const { rerender } = render(<PainelDoDitado {...painel({ lerNivel })} />);
      avancar(300);
      rerender(<PainelDoDitado {...painel({ lerNivel, fase: "transcrevendo" })} />);
      const leituras = lerNivel.mock.calls.length;
      avancar(2_000);
      expect(lerNivel.mock.calls.length).toBe(leituras);
    });
  });

  describe("transcrevendo", () => {
    it("na primeira vez, mostra o progresso do download com a porcentagem", () => {
      const { rerender } = render(<PainelDoDitado {...painel({ fase: "transcrevendo", baixando: 42 })} />);
      expect(screen.getByText("Baixando o modelo de voz")).toBeInTheDocument();
      expect(screen.getByTestId("porcentagem-do-ditado")).toHaveTextContent("42%");
      const barra = screen.getByRole("progressbar", { name: "Download do modelo de voz" });
      expect(barra).toHaveAttribute("aria-valuenow", "42");
      expect(screen.getByText(/só na primeira vez, uns 250 MB/i)).toBeInTheDocument();

      rerender(<PainelDoDitado {...painel({ fase: "transcrevendo", baixando: 87 })} />);
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "87");
    });

    it("depois, mostra quantos segundos de áudio está transcrevendo", () => {
      const { rerender } = render(<PainelDoDitado {...painel({ fase: "transcrevendo" })} />);
      expect(screen.getByText("Preparando o áudio")).toBeInTheDocument();
      rerender(<PainelDoDitado {...painel({ fase: "transcrevendo", segundosDeAudio: 12 })} />);
      expect(screen.getByText("Transcrevendo 12 s de áudio")).toBeInTheDocument();
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    });
  });

  it("no fim, avisa que o texto foi adicionado ao campo", () => {
    render(<PainelDoDitado {...painel({ fase: "parado", inserido: true })} />);
    expect(screen.getByText("Texto adicionado ao campo")).toBeInTheDocument();
  });
});
