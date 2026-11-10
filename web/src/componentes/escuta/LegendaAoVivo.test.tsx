import { fireEvent, render, screen } from "@testing-library/react";

import { LegendaAoVivo } from "./LegendaAoVivo";
import type { TrechoDaLegenda } from "./tipos";

function trecho(id: string, texto: string, pergunta = false): TrechoDaLegenda {
  return { id, texto, inicioMs: 0, fimMs: 1000, pergunta };
}

interface Medidas {
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
}

/** O jsdom não faz layout: as medidas da rolagem vêm deste objeto. */
function simularRolagem(elemento: HTMLElement, medidas: Medidas): Medidas {
  Object.defineProperty(elemento, "scrollHeight", { configurable: true, get: () => medidas.scrollHeight });
  Object.defineProperty(elemento, "clientHeight", { configurable: true, get: () => medidas.clientHeight });
  Object.defineProperty(elemento, "scrollTop", {
    configurable: true,
    get: () => medidas.scrollTop,
    set: (valor: number) => {
      medidas.scrollTop = Math.min(valor, medidas.scrollHeight - medidas.clientHeight);
    },
  });
  return medidas;
}

describe("LegendaAoVivo", () => {
  it("confirmados no tom normal e o parcial apagado no fim", () => {
    render(
      <LegendaAoVivo confirmados={[trecho("1", "Bom dia a todos.")]} parcial="vamos começar" tamanhoDaFonte={14} />,
    );

    const confirmado = screen.getByText("Bom dia a todos.");
    expect(confirmado).not.toHaveClass("legenda-parcial");
    expect(screen.getByTestId("legenda-confirmada")).toContainElement(confirmado);

    const parcial = screen.getByText("vamos começar");
    expect(parcial).toHaveClass("legenda-parcial");
    expect(screen.getByTestId("legenda-confirmada")).not.toContainElement(parcial);
  });

  it("aria-live só na parte confirmada", () => {
    render(<LegendaAoVivo confirmados={[trecho("1", "Primeiro.")]} parcial="provisório" tamanhoDaFonte={14} />);

    const regiao = screen.getByTestId("legenda-confirmada");
    expect(regiao).toHaveAttribute("aria-live", "polite");
    expect(screen.getByTestId("legenda-parcial").closest("[aria-live]")).toBeNull();
  });

  it("a pergunta aparece destacada, com a marca e anunciada", () => {
    render(
      <LegendaAoVivo
        confirmados={[trecho("1", "Certo."), trecho("2", "Como você lida com prazos?", true)]}
        parcial={null}
        tamanhoDaFonte={14}
      />,
    );

    const pergunta = screen.getByLabelText("Pergunta detectada: Como você lida com prazos?");
    expect(pergunta).toHaveClass("legenda-pergunta");
    expect(pergunta).toHaveTextContent("pergunta");
    expect(screen.getByTestId("legenda-confirmada")).toContainElement(pergunta);
    expect(screen.getByText("Certo.")).not.toHaveClass("legenda-pergunta");
  });

  it("sem nada falado, mostra o texto vazio", () => {
    render(<LegendaAoVivo confirmados={[]} parcial={null} tamanhoDaFonte={14} />);
    expect(screen.getByText("A legenda aparece aqui assim que alguém falar.")).toBeInTheDocument();
  });

  it("aplica o tamanho da fonte", () => {
    const { container } = render(<LegendaAoVivo confirmados={[]} parcial="oi" tamanhoDaFonte={18} />);
    expect(container.querySelector(".legenda-ao-vivo")).toHaveStyle({ fontSize: "18px" });
  });

  it("segue o fim; rolando para cima pausa e mostra o ao vivo, que volta ao fim e some", () => {
    const { rerender } = render(<LegendaAoVivo confirmados={[trecho("1", "Um.")]} parcial={null} tamanhoDaFonte={14} />);
    const rolagem = screen.getByTestId("rolagem-da-legenda");
    const medidas = simularRolagem(rolagem, { scrollHeight: 400, clientHeight: 100, scrollTop: 0 });

    // Chega texto novo: a legenda vai ao fim sozinha.
    rerender(<LegendaAoVivo confirmados={[trecho("1", "Um.")]} parcial="dois" tamanhoDaFonte={14} />);
    expect(medidas.scrollTop).toBe(300);
    expect(screen.queryByRole("button", { name: "ao vivo" })).not.toBeInTheDocument();

    // Dentro da tolerância ainda conta como fim.
    medidas.scrollTop = 280;
    fireEvent.scroll(rolagem);
    expect(screen.queryByRole("button", { name: "ao vivo" })).not.toBeInTheDocument();

    // A pessoa rola para cima: a rolagem automática pausa.
    medidas.scrollTop = 120;
    fireEvent.scroll(rolagem);
    const aoVivo = screen.getByRole("button", { name: "ao vivo" });

    medidas.scrollHeight = 600;
    rerender(<LegendaAoVivo confirmados={[trecho("1", "Um."), trecho("2", "Dois.")]} parcial="três" tamanhoDaFonte={14} />);
    expect(medidas.scrollTop).toBe(120);

    // "↓ ao vivo" volta ao fim e retoma.
    fireEvent.click(aoVivo);
    expect(medidas.scrollTop).toBe(500);
    expect(screen.queryByRole("button", { name: "ao vivo" })).not.toBeInTheDocument();

    medidas.scrollHeight = 700;
    rerender(
      <LegendaAoVivo
        confirmados={[trecho("1", "Um."), trecho("2", "Dois."), trecho("3", "Três.")]}
        parcial={null}
        tamanhoDaFonte={14}
      />,
    );
    expect(medidas.scrollTop).toBe(600);
  });
});
