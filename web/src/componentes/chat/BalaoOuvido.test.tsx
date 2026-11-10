import { render, screen, within } from "@testing-library/react";

import { BalaoOuvido } from "./BalaoOuvido";

const INICIO_MS = Date.parse("2026-11-04T12:00:00Z");

describe("BalaoOuvido", () => {
  it("fechado: a mensagem sua com a marca \"ouvido\", o texto e a hora do fim", () => {
    render(
      <BalaoOuvido id="e1" texto="Bom dia a todos." inicioMs={INICIO_MS} fimMs={INICIO_MS + 4_000} pergunta={false} aberto={false} />,
    );

    const balao = screen.getByTestId("trecho-ouvido");
    expect(balao).toHaveClass("mensagem-do-usuario", "mensagem-ouvida");
    expect(balao).not.toHaveClass("mensagem-ouvida-provisoria");
    expect(balao).toHaveAttribute("data-enunciado", "e1");
    expect(balao).not.toHaveAttribute("aria-live");
    expect(balao).toHaveTextContent("Bom dia a todos.");
    expect(within(balao).getByText("ouvido")).toHaveClass("marca-ouvida");
    expect(within(balao).queryByText("ouvindo")).not.toBeInTheDocument();
    expect(within(balao).queryByRole("img")).not.toBeInTheDocument();
    expect(balao.querySelector(".ouvido-parcial")).toBeNull();
    expect(balao.querySelector("time.hora-da-mensagem")).toHaveAttribute(
      "dateTime",
      new Date(INICIO_MS + 4_000).toISOString(),
    );
  });

  it("fechado com pergunta: a marca \"pergunta\" ao lado do \"ouvido\"", () => {
    render(
      <BalaoOuvido id="e2" texto="Qual o prazo?" inicioMs={INICIO_MS} fimMs={INICIO_MS + 1_000} pergunta aberto={false} />,
    );

    const balao = screen.getByTestId("trecho-ouvido");
    expect(within(balao).getByText("ouvido")).toBeInTheDocument();
    expect(within(balao).getByRole("img", { name: "Pergunta detectada na escuta" })).toHaveTextContent("pergunta");
  });

  it("aberto: a marca \"ouvindo\", a borda tracejada, o confirmado normal e o parcial apagado no fim", () => {
    render(
      <BalaoOuvido id="e3" texto="vamos falar do" parcial=" orçamento de " inicioMs={INICIO_MS} pergunta={false} aberto />,
    );

    const balao = screen.getByTestId("trecho-provisorio");
    expect(balao).toHaveClass("mensagem-do-usuario", "mensagem-ouvida", "mensagem-ouvida-provisoria");
    expect(balao).toHaveAttribute("aria-live", "polite");
    expect(balao).toHaveAttribute("data-enunciado", "e3");
    expect(within(balao).getByText("ouvindo")).toHaveClass("marca-ouvida");
    expect(within(balao).getByText("vamos falar do")).toHaveClass("ouvido-confirmado");
    expect(within(balao).getByText("orçamento de")).toHaveClass("ouvido-parcial");
    expect(balao).toHaveTextContent("vamos falar do orçamento de");
    // Sem o fim, a hora é a do início.
    expect(balao.querySelector("time.hora-da-mensagem")).toHaveAttribute("dateTime", new Date(INICIO_MS).toISOString());
  });

  it("ao fechar, é o mesmo elemento: o texto cresce no lugar e só a marca e a borda mudam", () => {
    const { rerender } = render(
      <BalaoOuvido id="e4" texto="vamos" parcial="falar" inicioMs={INICIO_MS} pergunta={false} aberto />,
    );
    const aberto = screen.getByTestId("trecho-provisorio");

    rerender(
      <BalaoOuvido id="e4" texto="vamos falar do orçamento?" inicioMs={INICIO_MS} fimMs={INICIO_MS + 3_000} pergunta aberto={false} />,
    );
    const fechado = screen.getByTestId("trecho-ouvido");
    expect(fechado).toBe(aberto);
    expect(fechado).not.toHaveClass("mensagem-ouvida-provisoria");
    expect(fechado).toHaveTextContent("vamos falar do orçamento?");
    expect(within(fechado).getByText("ouvido")).toBeInTheDocument();
    expect(within(fechado).getByRole("img", { name: "Pergunta detectada na escuta" })).toBeInTheDocument();
    expect(fechado.querySelector(".ouvido-parcial")).toBeNull();
  });

  it("fechado ignora o parcial", () => {
    render(
      <BalaoOuvido id="e5" texto="frase" parcial="sobra" inicioMs={INICIO_MS} fimMs={INICIO_MS} pergunta={false} aberto={false} />,
    );
    expect(screen.getByTestId("trecho-ouvido")).not.toHaveTextContent("sobra");
  });
});
