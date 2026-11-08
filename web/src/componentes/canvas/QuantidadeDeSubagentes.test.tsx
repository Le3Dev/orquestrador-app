import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

import type { DadosDaQuantidade } from "../../shared/api/tipos";
import { QuantidadeDeSubagentes } from "./QuantidadeDeSubagentes";

function Controlado({ inicial, aoMudar }: { inicial: DadosDaQuantidade; aoMudar?: (q: DadosDaQuantidade) => void }) {
  const [valor, setValor] = useState(inicial);
  return (
    <QuantidadeDeSubagentes
      valor={valor}
      aoMudar={(novo) => {
        aoMudar?.(novo);
        setValor(novo);
      }}
    />
  );
}

describe("QuantidadeDeSubagentes", () => {
  it("mostra os dois modos com descrição e o rótulo Máximo na automática", () => {
    render(<Controlado inicial={{ modo: "automatica", limite: 3 }} />);

    expect(screen.getByRole("radiogroup", { name: "Quantidade de subagentes" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Automática/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Fixa/ })).not.toBeChecked();
    expect(screen.getByText("Ele decide, até o máximo")).toBeInTheDocument();
    expect(screen.getByText("Sempre essa quantidade")).toBeInTheDocument();
    expect(screen.getByLabelText("Máximo")).toHaveValue(3);
  });

  it("trocar o modo mantém o limite e troca o rótulo para Quantidade", () => {
    const aoMudar = vi.fn();
    render(<Controlado inicial={{ modo: "automatica", limite: 5 }} aoMudar={aoMudar} />);

    fireEvent.click(screen.getByRole("radio", { name: /Fixa/ }));

    expect(aoMudar).toHaveBeenLastCalledWith({ modo: "fixa", limite: 5 });
    expect(screen.getByLabelText("Quantidade")).toHaveValue(5);
    expect(screen.queryByLabelText("Máximo")).not.toBeInTheDocument();
  });

  it("os botões somam e subtraem e travam em 1 e 10", () => {
    const aoMudar = vi.fn();
    render(<Controlado inicial={{ modo: "fixa", limite: 2 }} aoMudar={aoMudar} />);
    const menos = screen.getByRole("button", { name: "Diminuir" });
    const mais = screen.getByRole("button", { name: "Aumentar" });

    fireEvent.click(menos);
    expect(aoMudar).toHaveBeenLastCalledWith({ modo: "fixa", limite: 1 });
    expect(menos).toBeDisabled();

    for (let i = 0; i < 12; i++) {
      fireEvent.click(mais);
    }
    expect(aoMudar).toHaveBeenLastCalledWith({ modo: "fixa", limite: 10 });
    expect(mais).toBeDisabled();
    expect(menos).toBeEnabled();
  });

  it("o campo numérico aceita digitar e limita entre 1 e 10", () => {
    const aoMudar = vi.fn();
    render(<Controlado inicial={{ modo: "automatica", limite: 3 }} aoMudar={aoMudar} />);
    const campo = screen.getByLabelText("Máximo");

    fireEvent.change(campo, { target: { value: "7" } });
    expect(aoMudar).toHaveBeenLastCalledWith({ modo: "automatica", limite: 7 });

    fireEvent.change(campo, { target: { value: "99" } });
    expect(aoMudar).toHaveBeenLastCalledWith({ modo: "automatica", limite: 10 });

    fireEvent.change(campo, { target: { value: "0" } });
    expect(aoMudar).toHaveBeenLastCalledWith({ modo: "automatica", limite: 1 });
  });
});
