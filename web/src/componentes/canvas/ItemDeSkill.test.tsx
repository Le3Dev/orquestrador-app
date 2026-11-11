import { act, fireEvent, render, screen, within } from "@testing-library/react";

import { ItemDeSkill } from "./ItemDeSkill";

const DESCRICAO_LONGA =
  "Use this skill whenever the user wants to create, read, edit, or manipulate Word documents (.docx). Also use when extracting or reorganizing content from .docx files.";

function montar(extras: Partial<Parameters<typeof ItemDeSkill>[0]> = {}) {
  return render(
    <ul>
      <ItemDeSkill
        nome="docx"
        nomeCompleto="anthropic-skills:docx"
        descricao={DESCRICAO_LONGA}
        origem="Da sua conta Claude, só leitura"
        {...extras}
      />
    </ul>,
  );
}

describe("ItemDeSkill", () => {
  it("fechada, é uma linha compacta: o nome amigável e só a primeira frase da descrição, sem o prefixo", () => {
    montar();

    const botao = screen.getByRole("button", { name: /^docx/ });
    expect(botao).toHaveAttribute("aria-expanded", "false");
    expect(botao).not.toHaveAttribute("aria-controls");
    expect(within(botao).getByText("docx")).toBeInTheDocument();
    expect(within(botao).getByText("Create, read, edit, or manipulate Word documents (.docx).")).toBeInTheDocument();
    expect(screen.queryByText("anthropic-skills:docx")).not.toBeInTheDocument();
    expect(screen.queryByText(/Also use when extracting/)).not.toBeInTheDocument();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("o clique abre a descrição inteira, o nome completo com Copiar e a origem, e outro clique fecha", () => {
    montar();
    const botao = screen.getByRole("button", { name: /^docx/ });

    fireEvent.click(botao);

    expect(botao).toHaveAttribute("aria-expanded", "true");
    const aberta = screen.getByRole("region", { name: /^docx/ });
    expect(botao).toHaveAttribute("aria-controls", aberta.id);
    expect(within(aberta).getByText(DESCRICAO_LONGA)).toBeInTheDocument();
    expect(within(aberta).getByText("anthropic-skills:docx")).toBeInTheDocument();
    expect(within(aberta).getByRole("button", { name: "Copiar" })).toBeInTheDocument();
    expect(within(aberta).getByText("Da sua conta Claude, só leitura")).toBeInTheDocument();

    fireEvent.click(botao);

    expect(botao).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("o teclado funciona porque a linha é um button nativo, focável por Tab: Enter e Espaço viram clique no navegador", () => {
    montar();
    const botao = screen.getByRole("button", { name: /^docx/ });

    // O jsdom não transforma Enter e Espaço em clique (o navegador faz, só em button nativo); aqui se garante o
    // que torna isso verdade: elemento button, do tipo button, no fluxo do Tab e que recebe foco.
    expect(botao.tagName).toBe("BUTTON");
    expect(botao).toHaveAttribute("type", "button");
    expect(botao).not.toHaveAttribute("tabindex", "-1");
    botao.focus();
    expect(botao).toHaveFocus();

    // O clique que o navegador dispara por Enter ou Espaço alterna, e o foco fica na linha.
    fireEvent.click(botao);
    expect(botao).toHaveAttribute("aria-expanded", "true");
    expect(botao).toHaveFocus();
    fireEvent.click(botao);
    expect(botao).toHaveAttribute("aria-expanded", "false");
    expect(botao).toHaveFocus();
  });

  it("sem descrição, a linha diz isso e o corpo aberto traz só o nome completo e a origem", () => {
    montar({ descricao: "" });

    expect(screen.getByText("Sem descrição.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^docx/ }));

    const aberta = screen.getByRole("region");
    expect(within(aberta).queryByText("Sem descrição.")).not.toBeInTheDocument();
    expect(within(aberta).getByText("anthropic-skills:docx")).toBeInTheDocument();
  });

  it("Copiar põe o nome completo na área de transferência e confirma com Copiado", async () => {
    const escrever = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText: escrever }, configurable: true });
    try {
      montar();
      fireEvent.click(screen.getByRole("button", { name: /^docx/ }));

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Copiar" }));
      });

      expect(escrever).toHaveBeenCalledWith("anthropic-skills:docx");
      expect(screen.getByRole("button", { name: "Copiado" })).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("Nome copiado");
    } finally {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("com a busca, o nome casado ganha destaque; se só a descrição casa, a linha mostra o trecho com a palavra em destaque", () => {
    const { rerender } = montar({ termo: "DOC" });
    const nome = screen.getByText("doc", { selector: "mark" });
    expect(nome.parentElement).toHaveTextContent("docx");

    rerender(
      <ul>
        <ItemDeSkill
          nome="xlsx"
          nomeCompleto="anthropic-skills:xlsx"
          descricao="Use this skill any time a spreadsheet file is the primary input or output, for tabelas e planilhas."
          origem="Da sua conta Claude, só leitura"
          termo="planilhas"
        />
      </ul>,
    );

    const achado = screen.getByText("planilhas", { selector: "mark" });
    expect(achado.parentElement).toHaveClass("mk-skill-resumo");
    expect(achado.parentElement?.textContent?.startsWith("…")).toBe(true);
  });
});
