import { fireEvent, render, screen, within } from "@testing-library/react";

import type { EscutaNaTela, SituacaoDaEscuta } from "../../shared/escuta/useEscuta";
import { IndicadorDaEscuta } from "./IndicadorDaEscuta";

interface Extras {
  progressoDoDownload?: number | null;
  download?: EscutaNaTela["download"];
  motor?: EscutaNaTela["motor"];
  erro?: string | null;
  automatico?: boolean;
  preferenciasDaTela?: EscutaNaTela["preferenciasDaTela"];
}

const PREFERENCIAS: EscutaNaTela["preferenciasDaTela"] = {
  idioma: "portuguese",
  prioridadeDoMotor: "velocidade",
  aparencia: { tamanhoDaFonte: 14, opacidade: 0.92, compacto: false },
};

function renderizar(situacao: SituacaoDaEscuta, extras: Extras = {}) {
  const acoes = {
    pausar: vi.fn(),
    retomar: vi.fn(),
    alternarAutomatico: vi.fn(),
    mudarIdioma: vi.fn(),
    mudarPrioridadeDoMotor: vi.fn(),
  };
  render(
    <div>
      <p>fora</p>
      <IndicadorDaEscuta
        situacao={situacao}
        progressoDoDownload={extras.progressoDoDownload ?? null}
        download={extras.download ?? null}
        motor={extras.motor ?? null}
        erro={extras.erro ?? null}
        automatico={extras.automatico ?? true}
        preferenciasDaTela={extras.preferenciasDaTela ?? PREFERENCIAS}
        {...acoes}
      />
    </div>,
  );
  return { ...acoes, indicador: screen.queryByTestId("indicador-da-escuta") };
}

const selo = () => screen.getByRole("button", { name: "Controles da escuta" });
const menu = () => screen.queryByRole("group", { name: "Controles da escuta" });

describe("IndicadorDaEscuta", () => {
  it.each(["indisponivel", "desligada", "aguardando-aviso"] as const)("não aparece em %s", (situacao) => {
    const { indicador } = renderizar(situacao);
    expect(indicador).toBeNull();
  });

  it("escutando: ponto pulsando, rótulo e o botão pausar (não pressionado)", () => {
    const { indicador, pausar, retomar } = renderizar("escutando");

    expect(indicador).toHaveClass("indicador-da-escuta-escutando");
    expect(selo()).toHaveAttribute("title", expect.stringContaining("Escutando"));
    expect(screen.getByText("escutando")).toHaveAttribute("aria-live", "polite");
    expect(indicador?.querySelector(".ponto-da-escuta")).toHaveAttribute("aria-hidden", "true");

    const botao = screen.getByRole("button", { name: "Pausar a escuta" });
    expect(botao).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(botao);
    expect(pausar).toHaveBeenCalledTimes(1);
    expect(retomar).not.toHaveBeenCalled();
    // Pausar não abre o menu.
    expect(menu()).not.toBeInTheDocument();
  });

  it("pausada: ponto parado, rótulo \"pausada\" e o botão pressionado retoma", () => {
    const { indicador, pausar, retomar } = renderizar("pausada");

    expect(indicador).toHaveClass("indicador-da-escuta-pausada");
    expect(indicador).not.toHaveClass("indicador-da-escuta-escutando");
    expect(screen.getByText("pausada")).toBeInTheDocument();

    const botao = screen.getByRole("button", { name: "Pausar a escuta", pressed: true });
    expect(botao).toHaveAttribute("title", "Retomar a escuta");
    fireEvent.click(botao);
    expect(retomar).toHaveBeenCalledTimes(1);
    expect(pausar).not.toHaveBeenCalled();
  });

  it("baixando o modelo: a porcentagem e o total real, sem o botão de pausar", () => {
    const { indicador } = renderizar("baixando-modelo", {
      progressoDoDownload: 45,
      download: { progresso: 45.4, totalMb: 198.6 },
    });
    expect(screen.getByText("baixando o modelo 45% de 199 MB")).toBeInTheDocument();
    expect(selo()).toHaveAttribute("title", "Baixando o modelo de transcrição (só na primeira vez, 199 MB)");
    expect(indicador).not.toHaveTextContent("250");
    expect(screen.queryByRole("button", { name: "Pausar a escuta" })).not.toBeInTheDocument();
  });

  it("baixando sem o total: só a porcentagem", () => {
    renderizar("baixando-modelo", { download: { progresso: 12, totalMb: null } });
    expect(screen.getByText("baixando o modelo 12%")).toBeInTheDocument();
  });

  it("baixando com só a porcentagem antiga (sem o download novo): ainda mostra o progresso", () => {
    renderizar("baixando-modelo", { progressoDoDownload: 42.4 });
    expect(screen.getByText("baixando o modelo 42%")).toBeInTheDocument();
  });

  it("baixando sem progresso conhecido: reticências", () => {
    renderizar("baixando-modelo");
    expect(screen.getByText("baixando o modelo…")).toBeInTheDocument();
  });

  it.each([
    ["webgpu", "GPU"],
    ["dml", "GPU"],
    ["wasm", "CPU"],
    ["cpu", "CPU"],
  ] as const)("o selo do motor em %s: %s · modelo · precisão, com o modelo inteiro no title", (dispositivo, tipo) => {
    renderizar("escutando", {
      motor: { dispositivo, modelo: "onnx-community/whisper-base", precisao: "q4", nativo: false },
    });
    const seloDoMotor = screen.getByTestId("selo-do-motor");
    expect(seloDoMotor).toHaveTextContent(`${tipo} · base · q4`);
    expect(seloDoMotor).toHaveClass(`selo-do-motor-no-indicador-${tipo.toLowerCase()}`);
    expect(seloDoMotor.getAttribute("title")).toContain("onnx-community/whisper-base");
  });

  it("sem motor, sem selo", () => {
    renderizar("escutando");
    expect(screen.queryByTestId("selo-do-motor")).not.toBeInTheDocument();
  });

  it("erro: estado de erro com o motivo no title e o botão de tentar de novo", () => {
    const { indicador, retomar } = renderizar("erro", { erro: "sem áudio do sistema" });

    expect(indicador).toHaveClass("indicador-da-escuta-erro");
    expect(selo()).toHaveAttribute("title", "A escuta parou: sem áudio do sistema");
    expect(screen.getByText("escuta com erro")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tentar escutar de novo" }));
    expect(retomar).toHaveBeenCalledTimes(1);
  });

  it("iniciando: rótulo próprio, sem pausar nem tentar de novo (só o selo do menu)", () => {
    renderizar("iniciando");
    expect(screen.getByText("iniciando…")).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toEqual([selo()]);
  });

  describe("menu da escuta", () => {
    it("o selo abre e fecha o menu, com aria-expanded e aria-controls", () => {
      renderizar("escutando");
      expect(selo()).toHaveAttribute("aria-expanded", "false");
      expect(selo()).toHaveAttribute("aria-haspopup", "true");
      expect(menu()).not.toBeInTheDocument();

      fireEvent.click(selo());
      expect(selo()).toHaveAttribute("aria-expanded", "true");
      expect(menu()).toBeInTheDocument();
      expect(selo()).toHaveAttribute("aria-controls", menu()?.id);

      fireEvent.click(selo());
      expect(menu()).not.toBeInTheDocument();
    });

    it("mostra o Automático, o idioma e a prioridade escolhidos", () => {
      renderizar("escutando", {
        automatico: false,
        preferenciasDaTela: { ...PREFERENCIAS, idioma: "automatico", prioridadeDoMotor: "precisao" },
      });
      fireEvent.click(selo());
      const controles = within(menu() as HTMLElement);

      expect(controles.getByRole("switch", { name: "Automático" })).toHaveAttribute("aria-checked", "false");
      expect(controles.getByRole("radio", { name: "Automático" })).toBeChecked();
      expect(controles.getByRole("radio", { name: "Português" })).not.toBeChecked();
      expect(controles.getByRole("radio", { name: "Precisão" })).toBeChecked();
      expect(controles.getByRole("radio", { name: "Velocidade" })).not.toBeChecked();
    });

    it("a chave Automático, o idioma e a prioridade chamam as ações da escuta", () => {
      const { alternarAutomatico, mudarIdioma, mudarPrioridadeDoMotor } = renderizar("escutando");
      fireEvent.click(selo());
      const controles = within(menu() as HTMLElement);

      const chave = controles.getByRole("switch", { name: "Automático" });
      expect(chave).toHaveAttribute("aria-checked", "true");
      fireEvent.click(chave);
      expect(alternarAutomatico).toHaveBeenCalledTimes(1);

      fireEvent.click(controles.getByRole("radio", { name: "Automático" }));
      expect(mudarIdioma).toHaveBeenCalledWith("automatico");

      fireEvent.click(controles.getByRole("radio", { name: "Precisão" }));
      expect(mudarPrioridadeDoMotor).toHaveBeenCalledWith("precisao");
    });

    it("Esc fecha, devolve o foco ao selo e não chega a quem está fora", () => {
      const foraDoIndicador = vi.fn();
      document.addEventListener("keydown", foraDoIndicador);
      try {
        renderizar("escutando");
        fireEvent.click(selo());
        const radio = screen.getByRole("radio", { name: "Português" });
        radio.focus();

        fireEvent.keyDown(radio, { key: "Escape" });
        expect(menu()).not.toBeInTheDocument();
        expect(selo()).toHaveFocus();
        expect(foraDoIndicador).not.toHaveBeenCalled();
      } finally {
        document.removeEventListener("keydown", foraDoIndicador);
      }
    });

    it("clicar fora fecha; clicar dentro, não", () => {
      renderizar("escutando");
      fireEvent.click(selo());

      fireEvent.pointerDown(screen.getByRole("radio", { name: "Precisão" }));
      expect(menu()).toBeInTheDocument();

      fireEvent.pointerDown(screen.getByText("fora"));
      expect(menu()).not.toBeInTheDocument();
    });

    it("também abre no erro", () => {
      renderizar("erro", { erro: "parou" });
      fireEvent.click(selo());
      expect(menu()).toBeInTheDocument();
    });
  });
});
