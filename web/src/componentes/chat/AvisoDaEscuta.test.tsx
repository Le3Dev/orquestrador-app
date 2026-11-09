import { fireEvent, render, screen } from "@testing-library/react";

import { AvisoDaEscuta } from "./AvisoDaEscuta";

function renderizar() {
  const aoConfirmar = vi.fn();
  const aoRecusar = vi.fn();
  render(<AvisoDaEscuta aoConfirmar={aoConfirmar} aoRecusar={aoRecusar} />);
  return { aoConfirmar, aoRecusar, dialogo: screen.getByRole("dialog", { name: "Escutar o áudio do computador?" }) };
}

describe("AvisoDaEscuta", () => {
  it("explica a escuta em poucas linhas e recebe o foco sem ligar nada", () => {
    const { dialogo, aoConfirmar } = renderizar();

    expect(dialogo).toHaveFocus();
    expect(dialogo).toHaveTextContent("transcrito aqui mesmo, no seu computador, e não é gravado");
    expect(dialogo).toHaveTextContent("últimos 2 min de texto");
    expect(dialogo).toHaveTextContent("Claude (Haiku)");
    expect(dialogo).toHaveTextContent("com o print da tela");
    expect(dialogo).toHaveTextContent("Com alterações autorizadas, ela vai para o campo");
    expect(dialogo).toHaveTextContent("pausar no indicador");
    expect(dialogo).toHaveTextContent("desligar o automático");
    expect(aoConfirmar).not.toHaveBeenCalled();
  });

  it("\"Começar a escutar\" confirma", () => {
    const { aoConfirmar, aoRecusar } = renderizar();
    fireEvent.click(screen.getByRole("button", { name: "Começar a escutar" }));
    expect(aoConfirmar).toHaveBeenCalledTimes(1);
    expect(aoRecusar).not.toHaveBeenCalled();
  });

  it("\"Agora não\" e o Esc recusam", () => {
    const { aoConfirmar, aoRecusar, dialogo } = renderizar();
    fireEvent.click(screen.getByRole("button", { name: "Agora não" }));
    fireEvent.keyDown(dialogo, { key: "Escape" });
    expect(aoRecusar).toHaveBeenCalledTimes(2);
    expect(aoConfirmar).not.toHaveBeenCalled();
  });
});
