import { fireEvent, render, screen } from "@testing-library/react";

import type { SituacaoDaEscuta } from "../../shared/escuta/useEscuta";
import { IndicadorDaEscuta } from "./IndicadorDaEscuta";

function renderizar(situacao: SituacaoDaEscuta, extras: { progressoDoDownload?: number | null; erro?: string | null } = {}) {
  const pausar = vi.fn();
  const retomar = vi.fn();
  render(
    <IndicadorDaEscuta
      situacao={situacao}
      progressoDoDownload={extras.progressoDoDownload ?? null}
      erro={extras.erro ?? null}
      pausar={pausar}
      retomar={retomar}
    />,
  );
  return { pausar, retomar, indicador: screen.queryByTestId("indicador-da-escuta") };
}

describe("IndicadorDaEscuta", () => {
  it.each(["indisponivel", "desligada", "aguardando-aviso"] as const)("não aparece em %s", (situacao) => {
    const { indicador } = renderizar(situacao);
    expect(indicador).toBeNull();
  });

  it("escutando: ponto pulsando, rótulo e o botão pausar (não pressionado)", () => {
    const { indicador, pausar, retomar } = renderizar("escutando");

    expect(indicador).toHaveClass("indicador-da-escuta-escutando");
    expect(indicador).toHaveAttribute("title", expect.stringContaining("Escutando"));
    expect(screen.getByText("escutando")).toHaveAttribute("aria-live", "polite");
    expect(indicador?.querySelector(".ponto-da-escuta")).toHaveAttribute("aria-hidden", "true");

    const botao = screen.getByRole("button", { name: "Pausar a escuta" });
    expect(botao).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(botao);
    expect(pausar).toHaveBeenCalledTimes(1);
    expect(retomar).not.toHaveBeenCalled();
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

  it("baixando o modelo: mostra a porcentagem, sem o botão de pausar", () => {
    renderizar("baixando-modelo", { progressoDoDownload: 42.4 });
    expect(screen.getByText("baixando o modelo 42%")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pausar a escuta" })).not.toBeInTheDocument();
  });

  it("baixando sem progresso conhecido: reticências", () => {
    renderizar("baixando-modelo");
    expect(screen.getByText("baixando o modelo…")).toBeInTheDocument();
  });

  it("erro: estado de erro com o motivo no title e o botão de tentar de novo", () => {
    const { indicador, retomar } = renderizar("erro", { erro: "sem áudio do sistema" });

    expect(indicador).toHaveClass("indicador-da-escuta-erro");
    expect(indicador).toHaveAttribute("title", "A escuta parou: sem áudio do sistema");
    expect(screen.getByText("escuta com erro")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tentar escutar de novo" }));
    expect(retomar).toHaveBeenCalledTimes(1);
  });

  it("iniciando: rótulo próprio, sem botão", () => {
    renderizar("iniciando");
    expect(screen.getByText("iniciando…")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
