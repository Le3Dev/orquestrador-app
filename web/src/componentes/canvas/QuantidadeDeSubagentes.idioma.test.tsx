import { fireEvent, render, screen } from "@testing-library/react";

import { definirIdioma } from "../../shared/idioma/idioma";
import { QuantidadeDeSubagentes } from "./QuantidadeDeSubagentes";

describe("QuantidadeDeSubagentes: idioma", () => {
  beforeEach(() => {
    localStorage.clear();
    definirIdioma("en");
  });
  afterEach(() => {
    definirIdioma("pt-BR");
    localStorage.clear();
  });

  it("em inglês, os modos, o rótulo do número e os botões ficam traduzidos", () => {
    const aoMudar = vi.fn();
    render(<QuantidadeDeSubagentes valor={{ modo: "automatica", limite: 3 }} aoMudar={aoMudar} />);

    expect(screen.getByRole("radiogroup", { name: "Number of subagents" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Automatic/ })).toBeChecked();
    expect(screen.getByText("It decides, up to the maximum")).toBeInTheDocument();
    expect(screen.getByText("Maximum")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Increase" }));
    expect(aoMudar).toHaveBeenCalledWith({ modo: "automatica", limite: 4 });
    fireEvent.click(screen.getByRole("radio", { name: /Fixed/ }));
    expect(aoMudar).toHaveBeenCalledWith({ modo: "fixa", limite: 3 });
    expect(screen.queryByText("Máximo")).not.toBeInTheDocument();
  });
});
