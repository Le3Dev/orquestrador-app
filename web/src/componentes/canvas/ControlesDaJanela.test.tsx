import { act, fireEvent, render, screen } from "@testing-library/react";

import { rodandoNoDesktop } from "../../shared/ponteDoDesktop";
import { ControlesDaJanela } from "./ControlesDaJanela";

type AoMudar = (maximizada: boolean) => void;

describe("ControlesDaJanela", () => {
  const janelaComPonte = window as unknown as { electron?: unknown };

  afterEach(() => {
    delete janelaComPonte.electron;
  });

  const instalarPonte = (maximizadaAoAbrir = false) => {
    const ouvintes: AoMudar[] = [];
    const cancelar = vi.fn();
    const janela = {
      minimizar: vi.fn().mockResolvedValue(undefined),
      maximizar: vi.fn().mockResolvedValue(undefined),
      fechar: vi.fn().mockResolvedValue(undefined),
      estaMaximizada: vi.fn().mockResolvedValue(maximizadaAoAbrir),
      aoMudarMaximizada: vi.fn((callback: AoMudar) => {
        ouvintes.push(callback);
        return cancelar;
      }),
    };
    janelaComPonte.electron = { desktop: true, janela };
    const avisar = (maximizada: boolean) => act(() => ouvintes.forEach((ouvinte) => ouvinte(maximizada)));
    return { janela, cancelar, avisar };
  };

  it("fora do desktop não renderiza nada", () => {
    const { container } = render(<ControlesDaJanela />);
    expect(rodandoNoDesktop()).toBe(false);
    expect(container).toBeEmptyDOMElement();
  });

  it("minimiza, maximiza e fecha pela ponte; os botões têm dica e ficam fora do arraste", async () => {
    const { janela } = instalarPonte();
    render(<ControlesDaJanela />);
    expect(await screen.findByRole("button", { name: "Maximizar" })).toHaveAttribute("title", "Maximizar");

    expect(screen.getByRole("group", { name: "Controles da janela" })).toHaveClass("no-drag");
    fireEvent.click(screen.getByRole("button", { name: "Minimizar" }));
    fireEvent.click(screen.getByRole("button", { name: "Maximizar" }));
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));

    expect(janela.minimizar).toHaveBeenCalledTimes(1);
    expect(janela.maximizar).toHaveBeenCalledTimes(1);
    expect(janela.fechar).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Fechar" })).toHaveClass("botao-da-janela-fechar");
  });

  it("troca para Restaurar quando a janela abre maximizada e acompanha os avisos do app", async () => {
    const { avisar } = instalarPonte(true);
    render(<ControlesDaJanela />);
    expect(await screen.findByRole("button", { name: "Restaurar" })).toHaveAttribute("title", "Restaurar");

    avisar(false);
    expect(screen.getByRole("button", { name: "Maximizar" })).toBeInTheDocument();

    avisar(true);
    expect(screen.getByRole("button", { name: "Restaurar" })).toBeInTheDocument();
  });

  it("cancela a inscrição ao sair da tela", async () => {
    const { cancelar } = instalarPonte();
    const { unmount } = render(<ControlesDaJanela />);
    await screen.findByRole("button", { name: "Maximizar" });

    unmount();
    expect(cancelar).toHaveBeenCalledTimes(1);
  });
});
