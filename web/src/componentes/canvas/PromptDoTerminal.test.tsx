import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";

import type { ModoDoTurno } from "../../shared/api/tipos";
import { PromptDoTerminal } from "./PromptDoTerminal";

function renderizar(modo: ModoDoTurno = "execucao") {
  const aoAlternarModo = vi.fn();
  const aoEnviar = vi.fn(async () => true);
  render(
    <PromptDoTerminal
      desconectado={false}
      trabalhando={false}
      cancelando={false}
      modo={modo}
      aoAlternarModo={aoAlternarModo}
      campo={createRef<HTMLTextAreaElement>()}
      imagens={[]}
      aoAnexar={vi.fn()}
      aoRemoverImagem={vi.fn()}
      aoEnviar={aoEnviar}
      aoCancelar={vi.fn()}
    />,
  );
  return { aoAlternarModo, aoEnviar, campo: screen.getByRole("textbox", { name: "Mensagem para o orquestrador" }) };
}

describe("PromptDoTerminal", () => {
  it("Shift+Tab alterna o modo sem enviar nem tirar o foco do campo", () => {
    const { aoAlternarModo, aoEnviar, campo } = renderizar();
    fireEvent.change(campo, { target: { value: "planeje a migração" } });

    const seguiuPadrao = fireEvent.keyDown(campo, { key: "Tab", shiftKey: true });

    expect(seguiuPadrao).toBe(false);
    expect(aoAlternarModo).toHaveBeenCalledTimes(1);
    expect(aoEnviar).not.toHaveBeenCalled();
  });

  it("o selo mostra o modo e também alterna ao clicar", () => {
    const { aoAlternarModo } = renderizar("planejamento");
    const selo = screen.getByRole("button", { name: /plan mode ligado/ });

    expect(selo).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("textbox")).toHaveAttribute(
      "placeholder",
      "descreva o que planejar — nada é alterado até você aprovar",
    );

    fireEvent.click(selo);
    expect(aoAlternarModo).toHaveBeenCalledTimes(1);
  });

  it("em execução, o selo fica desligado", () => {
    renderizar();

    expect(screen.getByRole("button", { name: /› execução/ })).toHaveAttribute("aria-pressed", "false");
  });
});
