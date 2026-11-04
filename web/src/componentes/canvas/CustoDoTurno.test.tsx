import { fireEvent, render, screen, within } from "@testing-library/react";

import type { DadosDoConsumoDoTurno } from "../../shared/api/tipos";
import { CustoDoTurno } from "./CustoDoTurno";

const consumo: DadosDoConsumoDoTurno = {
  // Índice do principal: 20.000 + 1,25 × 40.000 + 0,1 × 600.000 + 5 × 3.000 = 145.000
  principal: { entrada: 20_000, criacaoDeCache: 40_000, leituraDeCache: 600_000, saida: 3_000 },
  // Índice dos subagentes: 10.000 + 1,25 × 8.000 + 0,1 × 500.000 + 5 × 4.000 = 90.000
  subagentes: { entrada: 10_000, criacaoDeCache: 8_000, leituraDeCache: 500_000, saida: 4_000 },
  subagentesMedidos: 2,
  parcial: false,
  indiceDeCusto: 235_000,
  modeloDoPrincipal: "claude-opus-5-5",
};

/** O Intl separa número e unidade com espaço inseparável. */
function celulas(linha: HTMLElement): string[] {
  return Array.from(linha.querySelectorAll("th, td"), (celula) => (celula.textContent ?? "").replace(/\s/g, " "));
}

describe("CustoDoTurno", () => {
  it("mostra a linha com o índice, fechada", () => {
    render(<CustoDoTurno consumo={consumo} />);
    const linha = screen.getByRole("button", { name: /≈ custo do turno · índice 235\smil$/ });

    expect(linha).toHaveAttribute("aria-expanded", "false");
    expect(linha).toHaveAttribute("title", expect.stringContaining("não é preço"));
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("acrescenta \"parcial\" quando o pedido foi cancelado ou falhou", () => {
    render(<CustoDoTurno consumo={{ ...consumo, parcial: true }} />);

    expect(screen.getByRole("button", { name: /índice 235\smil · parcial$/ })).toHaveAttribute(
      "title",
      expect.stringContaining("cancelado ou falhou"),
    );
  });

  it("abre e fecha a tabela por trecho, com os valores compactos", () => {
    render(<CustoDoTurno consumo={consumo} />);
    const linha = screen.getByRole("button", { name: /custo do turno/ });

    fireEvent.click(linha);
    expect(linha).toHaveAttribute("aria-expanded", "true");
    const tabela = screen.getByRole("table");
    expect(linha).toHaveAttribute("aria-controls", tabela.id);

    const [cabecalho, principal, subagentes, total] = within(tabela).getAllByRole("row");
    expect(within(cabecalho!).getAllByRole("columnheader").map((celula) => celula.textContent)).toEqual([
      "Trecho",
      "Entrada",
      "Criação de cache",
      "Leitura de cache",
      "Saída",
      "Índice",
    ]);
    expect(celulas(principal!)).toEqual(["Principal", "20 mil", "40 mil", "600 mil", "3 mil", "145 mil"]);
    expect(celulas(subagentes!)).toEqual(["Subagentes (2)", "10 mil", "8 mil", "500 mil", "4 mil", "90 mil"]);
    expect(celulas(total!)).toEqual(["Total", "30 mil", "48 mil", "1,1 mi", "7 mil", "235 mil"]);

    fireEvent.click(linha);
    expect(linha).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
