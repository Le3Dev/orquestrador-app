import { act, createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";

import type { FonteDaPaleta, ItemDaPaleta } from "../../shared/paletaDeComandos";
import { type ControleDaPaleta, PaletaDeComandos } from "./PaletaDeComandos";

function fonte(): FonteDaPaleta {
  return {
    podeOrganizar: true,
    orquestradores: [
      { id: "o1", nome: "Painel de vendas", nomeDaPasta: "painel-app", situacao: "trabalhando" },
      { id: "o2", nome: "Relatórios", nomeDaPasta: "relatorios", situacao: "ocioso" },
    ],
    abertos: new Set(["o1"]),
    notas: [{ notaId: "n1", titulo: "Compras", texto: "pão" }],
    conversas: new Map([
      ["o1", { turnos: [{ id: "t1", texto: "Corrija a exportação para Excel", iniciadoEm: "2026-11-01T10:00:00Z" }] }],
    ]),
  };
}

function renderizar() {
  const lerFonte = vi.fn(fonte);
  const aoExecutar = vi.fn<(item: ItemDaPaleta) => void>();
  const controle = createRef<ControleDaPaleta>();
  render(
    <>
      <input aria-label="Campo de fora" />
      <PaletaDeComandos lerFonte={lerFonte} aoExecutar={aoExecutar} controle={controle} />
    </>,
  );
  return { lerFonte, aoExecutar, controle };
}

const ctrlK = (alvo: Window | HTMLElement = window) => fireEvent.keyDown(alvo, { key: "k", code: "KeyK", ctrlKey: true });
const campoDaBusca = () => screen.getByRole("combobox", { name: "Buscar ações, orquestradores, notas e pedidos" });
const executado = (aoExecutar: ReturnType<typeof renderizar>["aoExecutar"]) => aoExecutar.mock.calls[0]?.[0];

describe("PaletaDeComandos", () => {
  it("fechada, não mostra nada; Ctrl+K abre com o foco na busca, mesmo de dentro de um campo de texto", () => {
    const { lerFonte } = renderizar();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(lerFonte).not.toHaveBeenCalled();

    const fora = screen.getByRole("textbox", { name: "Campo de fora" });
    fora.focus();
    ctrlK(fora);

    const dialogo = screen.getByRole("dialog", { name: "Paleta de comandos" });
    expect(dialogo).toHaveAttribute("aria-modal", "true");
    expect(campoDaBusca()).toHaveFocus();
    expect(lerFonte).toHaveBeenCalledTimes(1);
    // Sem texto: ações e orquestradores primeiro, agrupados por tipo.
    expect(screen.getAllByRole("group").map((grupo) => grupo.firstElementChild?.textContent)).toEqual([
      "Ações",
      "Orquestradores",
      "Notas",
      "Pedidos",
    ]);
    expect(screen.getAllByRole("option")[0]).toHaveTextContent("Novo orquestrador");
  });

  it("↑/↓ navegam (com volta ao início e ao fim) e Enter executa o item selecionado e fecha", () => {
    const { aoExecutar } = renderizar();
    ctrlK();
    const campo = campoDaBusca();
    const opcoes = screen.getAllByRole("option");
    expect(opcoes[0]).toHaveAttribute("aria-selected", "true");
    expect(campo).toHaveAttribute("aria-activedescendant", opcoes[0]?.id);

    fireEvent.keyDown(campo, { key: "ArrowDown" });
    fireEvent.keyDown(campo, { key: "ArrowDown" });
    fireEvent.keyDown(campo, { key: "ArrowUp" });
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    expect(campo).toHaveAttribute("aria-activedescendant", opcoes[1]?.id);

    // Do primeiro, ↑ vai para o último.
    fireEvent.keyDown(campo, { key: "ArrowUp" });
    fireEvent.keyDown(campo, { key: "ArrowUp" });
    expect(screen.getAllByRole("option").at(-1)).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(campo, { key: "ArrowDown" });
    fireEvent.keyDown(campo, { key: "ArrowDown" });

    fireEvent.keyDown(campo, { key: "Enter" });

    expect(aoExecutar).toHaveBeenCalledTimes(1);
    expect(executado(aoExecutar)).toMatchObject({ tipo: "acao", acao: "nova-nota" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("digitar filtra (sem acento) e Enter executa o primeiro resultado", () => {
    const { aoExecutar } = renderizar();
    ctrlK();

    fireEvent.change(campoDaBusca(), { target: { value: "exportacao" } });

    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option")).toHaveTextContent("Corrija a exportação para Excel");
    expect(screen.getByRole("option")).toHaveTextContent("Painel de vendas");
    fireEvent.keyDown(campoDaBusca(), { key: "Enter" });
    expect(executado(aoExecutar)).toMatchObject({ tipo: "pedido", orquestradorId: "o1", turnoId: "t1" });
  });

  it("sem resultado, avisa e Enter não executa nada", () => {
    const { aoExecutar } = renderizar();
    ctrlK();

    fireEvent.change(campoDaBusca(), { target: { value: "xyz inexistente" } });

    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Nada encontrado.");
    expect(campoDaBusca()).not.toHaveAttribute("aria-activedescendant");
    fireEvent.keyDown(campoDaBusca(), { key: "Enter" });
    expect(aoExecutar).not.toHaveBeenCalled();
  });

  it("passar o mouse seleciona e clicar executa", () => {
    const { aoExecutar } = renderizar();
    ctrlK();
    const relatorios = screen.getAllByRole("option").find((opcao) => opcao.textContent?.includes("Relatórios"));
    if (relatorios === undefined) {
      throw new Error("Relatórios não está na lista");
    }

    fireEvent.mouseMove(relatorios);
    expect(relatorios).toHaveAttribute("aria-selected", "true");
    fireEvent.click(relatorios);

    expect(executado(aoExecutar)).toMatchObject({ tipo: "orquestrador", orquestradorId: "o2" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Esc fecha sem executar e devolve o foco para onde estava", () => {
    const { aoExecutar } = renderizar();
    const fora = screen.getByRole("textbox", { name: "Campo de fora" });
    fora.focus();
    ctrlK(fora);

    fireEvent.keyDown(campoDaBusca(), { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(aoExecutar).not.toHaveBeenCalled();
    expect(fora).toHaveFocus();
  });

  it("clique fora da caixa fecha; clique dentro dela não", () => {
    const { aoExecutar } = renderizar();
    ctrlK();

    fireEvent.mouseDown(campoDaBusca());
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId("fundo-da-paleta"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(aoExecutar).not.toHaveBeenCalled();
  });

  it("Ctrl+K com a paleta aberta fecha; o controle (botão Buscar) também abre", () => {
    const { controle, lerFonte } = renderizar();
    ctrlK();

    ctrlK(campoDaBusca());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    act(() => controle.current?.abrir());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // Lê de novo ao abrir: a lista sai sempre atualizada.
    expect(lerFonte).toHaveBeenCalledTimes(2);
  });

  it("Ctrl com outra tecla ou com Shift não abre", () => {
    renderizar();

    fireEvent.keyDown(window, { key: "j", code: "KeyJ", ctrlKey: true });
    fireEvent.keyDown(window, { key: "K", code: "KeyK", ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(window, { key: "k", code: "KeyK" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
