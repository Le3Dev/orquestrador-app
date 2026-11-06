import { createRef } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { api } from "../../shared/api/cliente";
import type { PreferenciasDoChat } from "../../shared/api/tipos";
import { SeletorDeModelo } from "./SeletorDeModelo";

function renderizar(preferencias: PreferenciasDoChat = { modelo: "opus", esforco: "alto" }, modeloUsado: string | null = null) {
  const aoAlterar = vi.fn();
  const aoFalhar = vi.fn();
  const campo = createRef<HTMLTextAreaElement>();
  render(
    <>
      <textarea ref={campo} aria-label="campo" />
      <SeletorDeModelo
        preferencias={preferencias}
        modeloUsado={modeloUsado}
        desabilitado={false}
        campo={campo}
        aoAlterar={aoAlterar}
        aoFalhar={aoFalhar}
      />
    </>,
  );
  return { aoAlterar, aoFalhar, campo };
}

function botao() {
  return screen.getByRole("button", { name: /^Modelo:/ });
}

describe("SeletorDeModelo", () => {
  afterEach(() => vi.restoreAllMocks());

  it("mostra modelo, versão e esforço; abre a lista com descrições e ✓ no escolhido", () => {
    renderizar();

    expect(botao()).toHaveTextContent("Opus 5.5Alto");
    expect(botao()).toHaveAttribute("aria-haspopup", "menu");
    fireEvent.click(botao());

    const menu = screen.getByRole("menu", { name: "Modelo do chat" });
    const itens = within(menu).getAllByRole("menuitemradio");
    expect(itens.map((item) => item.textContent?.replace("✓", ""))).toEqual([
      "Fable 5.1Para seus desafios mais difíceis",
      "Opus 5.5Para trabalhos complexos e tarefas do dia a dia",
      "Sonnet 5.5Mais eficiente para tarefas mais simples",
      "Haiku 5.5Mais rápido para respostas rápidas",
    ]);
    expect(itens[1]).toHaveAttribute("aria-checked", "true");
    expect(itens[1]).toHaveTextContent("✓");
    expect(itens[0]).toHaveAttribute("aria-checked", "false");
  });

  it("escolher um modelo chama o PATCH e devolve o foco ao campo", async () => {
    const alterar = vi.spyOn(api, "alterarPreferenciasDoChat").mockResolvedValue({ modelo: "fable", esforco: "alto" });
    const { aoAlterar, campo } = renderizar();

    fireEvent.click(botao());
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Fable 5\.1/ }));

    expect(alterar).toHaveBeenCalledWith({ modelo: "fable" });
    await waitFor(() => expect(aoAlterar).toHaveBeenCalledWith({ modelo: "fable", esforco: "alto" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(campo.current).toHaveFocus();
  });

  it("o submenu de esforço lista os níveis com ✓ e escolher chama o PATCH", async () => {
    const alterar = vi.spyOn(api, "alterarPreferenciasDoChat").mockResolvedValue({ modelo: "opus", esforco: "maximo" });
    const { aoAlterar } = renderizar();

    fireEvent.click(botao());
    fireEvent.click(screen.getByRole("menuitem", { name: /Esforço/ }));
    const submenu = screen.getByRole("menu", { name: "Esforço" });
    const niveis = within(submenu).getAllByRole("menuitemradio");
    expect(niveis.map((nivel) => nivel.textContent?.replace("✓", ""))).toEqual([
      "Padrão",
      "Baixo",
      "Médio",
      "Alto",
      "Extra alto",
      "Máximo",
    ]);
    expect(within(submenu).getByRole("menuitemradio", { name: /Alto/, checked: true })).toHaveTextContent("Alto");

    fireEvent.click(within(submenu).getByRole("menuitemradio", { name: /Máximo/ }));
    expect(alterar).toHaveBeenCalledWith({ esforco: "maximo" });
    await waitFor(() => expect(aoAlterar).toHaveBeenCalled());
  });

  it("Esc e clique fora fecham o menu", () => {
    const { campo } = renderizar();

    fireEvent.click(botao());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(campo.current).toHaveFocus();

    fireEvent.click(botao());
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("o rótulo usa a versão do modelo da última resposta, se for da mesma família", () => {
    renderizar({ modelo: "opus", esforco: "padrao" }, "claude-opus-5-6");
    expect(botao()).toHaveTextContent("Opus 5.6Padrão");
  });

  it("falha ao gravar avisa com a mensagem", async () => {
    vi.spyOn(api, "alterarPreferenciasDoChat").mockRejectedValue(new Error("fora do ar"));
    const { aoFalhar } = renderizar();

    fireEvent.click(botao());
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Haiku/ }));

    await waitFor(() => expect(aoFalhar).toHaveBeenCalledWith("Não foi possível trocar o modelo: fora do ar"));
  });
});
