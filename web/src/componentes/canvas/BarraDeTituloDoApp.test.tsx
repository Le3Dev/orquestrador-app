import { render, screen, within } from "@testing-library/react";

import { BarraDeTituloDoApp } from "./BarraDeTituloDoApp";

describe("BarraDeTituloDoApp", () => {
  const janelaComPonte = window as unknown as { electron?: unknown };

  afterEach(() => {
    delete janelaComPonte.electron;
  });

  const renderizar = () =>
    render(
      <BarraDeTituloDoApp
        trabalhando={2}
        bixinhosAtivos={0}
        cota={[{ nome: "5 horas", utilizacao: 0.3, renovaEm: null, situacao: "allowed" }]}
        memoria={null}
      />,
    );

  it("mostra o nome do app à esquerda e, à direita, o status colado aos botões da janela", () => {
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
    renderizar();
    const barra = screen.getByTestId("barra-de-titulo");

    expect(barra).toHaveClass("barra-de-titulo");
    expect(barra.firstElementChild).toHaveTextContent("Orquestrador de Agentes");
    const status = within(barra).getByTestId("status-do-canvas");
    expect(status).toHaveTextContent("2 trabalhando");
    expect(status).toHaveTextContent("5 horas");
    // Clicável/balão: fora da região de arraste da janela.
    expect(status).toHaveClass("no-drag");

    // Direita: status e, logo depois dele, os botões ─ ☐ ✕ do app.
    const direita = barra.lastElementChild;
    expect(direita).toHaveClass("direita-da-barra-de-titulo");
    const controles = within(barra).getByRole("group", { name: "Controles da janela" });
    expect(direita?.firstElementChild).toBe(status);
    expect(status.nextElementSibling).toBe(controles);
    expect(within(controles).getAllByRole("button").map((botao) => botao.getAttribute("aria-label"))).toEqual([
      "Minimizar",
      "Maximizar",
      "Fechar",
    ]);
  });

  it("no navegador (sem a ponte), não desenha botões de janela", () => {
    renderizar();
    expect(within(screen.getByTestId("barra-de-titulo")).queryByRole("button")).not.toBeInTheDocument();
  });
});
