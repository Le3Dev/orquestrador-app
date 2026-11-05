import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";

import type { ModoDoTurno } from "../../shared/api/tipos";
import type { ImagemAnexada } from "../../shared/imagens";
import { PromptDoTerminal } from "./PromptDoTerminal";

interface Opcoes {
  modo?: ModoDoTurno;
  trabalhando?: boolean;
  desconectado?: boolean;
  imagens?: readonly ImagemAnexada[];
  limpezaAceita?: boolean;
}

const IMAGEM: ImagemAnexada = {
  id: "i1",
  nome: "tela.png",
  tipoDeMidia: "image/png",
  tamanhoEmBytes: 10,
  base64: "AAAA",
  previa: "data:image/png;base64,AAAA",
};

function renderizar({
  modo = "execucao",
  trabalhando = false,
  desconectado = false,
  imagens = [],
  limpezaAceita = true,
}: Opcoes = {}) {
  const aoAlternarModo = vi.fn();
  const aoEnviar = vi.fn(async () => true);
  const aoLimparConversa = vi.fn(async () => limpezaAceita);
  render(
    <PromptDoTerminal
      desconectado={desconectado}
      trabalhando={trabalhando}
      cancelando={false}
      modo={modo}
      aoAlternarModo={aoAlternarModo}
      campo={createRef<HTMLTextAreaElement>()}
      imagens={imagens}
      aoAnexar={vi.fn()}
      aoRemoverImagem={vi.fn()}
      aoEnviar={aoEnviar}
      aoLimparConversa={aoLimparConversa}
      aoCancelar={vi.fn()}
    />,
  );
  return {
    aoAlternarModo,
    aoEnviar,
    aoLimparConversa,
    campo: screen.getByRole("textbox", { name: "Mensagem para o orquestrador" }),
  };
}

function digitarEEnviar(campo: HTMLElement, texto: string): void {
  fireEvent.change(campo, { target: { value: texto } });
  fireEvent.keyDown(campo, { key: "Enter" });
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
    const { aoAlternarModo } = renderizar({ modo: "planejamento" });
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

  describe("/clear", () => {
    it("Enter limpa a conversa em vez de enviar o pedido e esvazia o campo", async () => {
      const { aoEnviar, aoLimparConversa, campo } = renderizar();

      digitarEEnviar(campo, " /Clear ");

      await waitFor(() => expect(campo).toHaveValue(""));
      expect(aoLimparConversa).toHaveBeenCalledTimes(1);
      expect(aoEnviar).not.toHaveBeenCalled();
    });

    it("se o servidor recusar, o comando fica no campo", async () => {
      const { aoLimparConversa, campo } = renderizar({ limpezaAceita: false });

      digitarEEnviar(campo, "/clear");

      await waitFor(() => expect(aoLimparConversa).toHaveBeenCalledTimes(1));
      expect(campo).toHaveValue("/clear");
    });

    it("durante um pedido, não faz nada e a dica avisa que está indisponível", () => {
      const { aoEnviar, aoLimparConversa, campo } = renderizar({ trabalhando: true });

      digitarEEnviar(campo, "/clear");

      expect(aoLimparConversa).not.toHaveBeenCalled();
      expect(aoEnviar).not.toHaveBeenCalled();
      expect(screen.getByRole("status")).toHaveTextContent("/clear — indisponível durante um pedido · esc cancela");
      expect(campo).toHaveValue("/clear");
    });

    it("desconectado, fica bloqueado como o envio", () => {
      const { aoLimparConversa, campo } = renderizar({ desconectado: true });

      digitarEEnviar(campo, "/clear");

      expect(aoLimparConversa).not.toHaveBeenCalled();
    });

    it("com imagens anexadas, limpa a conversa sem enviar as imagens", async () => {
      const { aoEnviar, aoLimparConversa, campo } = renderizar({ imagens: [IMAGEM] });

      digitarEEnviar(campo, "/clear");

      await waitFor(() => expect(aoLimparConversa).toHaveBeenCalledTimes(1));
      expect(aoEnviar).not.toHaveBeenCalled();
      expect(screen.getByRole("img", { name: "tela.png" })).toBeInTheDocument();
    });

    it("/clear com mais texto vai como pedido comum", async () => {
      const { aoEnviar, aoLimparConversa, campo } = renderizar();

      digitarEEnviar(campo, "/clear algo");

      await waitFor(() => expect(aoEnviar).toHaveBeenCalledWith("/clear algo"));
      expect(aoLimparConversa).not.toHaveBeenCalled();
    });

    it("mostra a dica enquanto o texto é o começo do comando e o Tab completa", () => {
      const { campo } = renderizar();

      fireEvent.change(campo, { target: { value: "/cl" } });
      expect(screen.getByRole("status")).toHaveTextContent("/clear — começar uma conversa nova · tab completa");

      const seguiuPadrao = fireEvent.keyDown(campo, { key: "Tab" });
      expect(seguiuPadrao).toBe(false);
      expect(campo).toHaveValue("/clear");
      expect(screen.getByRole("status")).toHaveTextContent("/clear — começar uma conversa nova · enter");

      fireEvent.change(campo, { target: { value: "/x" } });
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
  });

  describe("pedido grande", () => {
    const grande = "Refatore o módulo de pedidos:\n- separar o domínio\n- criar o repositório\n- migrar as rotas";

    it("em execução, sugere planejar antes sem bloquear o envio", async () => {
      const { aoEnviar, campo } = renderizar();

      fireEvent.change(campo, { target: { value: grande } });
      expect(screen.getByRole("status")).toHaveTextContent("pedido grande? shift+tab para planejar antes");

      fireEvent.keyDown(campo, { key: "Enter" });
      await waitFor(() => expect(aoEnviar).toHaveBeenCalledWith(grande));
    });

    it("no plan mode e em pedidos curtos, não sugere nada", () => {
      const { campo } = renderizar({ modo: "planejamento" });

      fireEvent.change(campo, { target: { value: grande } });
      expect(screen.queryByRole("status")).not.toBeInTheDocument();

      fireEvent.change(campo, { target: { value: "corrija o bug" } });
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
  });
});
