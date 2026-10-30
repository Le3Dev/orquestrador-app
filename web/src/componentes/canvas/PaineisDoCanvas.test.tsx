import { fireEvent, render, screen } from "@testing-library/react";

import { BarraDoCanvas, ErroDoCanvas } from "./PaineisDoCanvas";

describe("BarraDoCanvas", () => {
  it("o \"+ notas\" fica ao lado do \"novo orquestrador\" e cria uma nota a cada clique", () => {
    const aoCriar = vi.fn();
    const aoCriarNota = vi.fn();
    render(<BarraDoCanvas aoCriar={aoCriar} aoCriarNota={aoCriarNota} aoOrganizar={vi.fn()} podeOrganizar={false} />);
    const botao = screen.getByRole("button", { name: "+ notas" });

    expect(botao).toHaveClass("btn", "btn-sm", "btn-cta");
    expect(screen.getByRole("button", { name: "+ Novo orquestrador" }).nextElementSibling).toBe(botao);
    fireEvent.click(botao);
    fireEvent.click(botao);

    expect(aoCriarNota).toHaveBeenCalledTimes(2);
    expect(aoCriar).not.toHaveBeenCalled();
  });
});

describe("ErroDoCanvas", () => {
  it("mostra o erro e fecha", () => {
    const aoFechar = vi.fn();
    render(<ErroDoCanvas erro="Não foi possível criar a nota: servidor fora." aoFechar={aoFechar} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível criar a nota: servidor fora.");
    fireEvent.click(screen.getByRole("button", { name: "✕" }));
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });
});
