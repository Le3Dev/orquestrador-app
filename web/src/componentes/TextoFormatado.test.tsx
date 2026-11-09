import { act, fireEvent, render, screen, within } from "@testing-library/react";

import { TextoFormatado } from "./TextoFormatado";

const analises = vi.hoisted(() => ({ total: 0 }));

// Conta as análises de Markdown sem mudar o que o react-markdown produz.
vi.mock("react-markdown", async (importOriginal) => {
  const original = await importOriginal<typeof import("react-markdown")>();
  return {
    ...original,
    default: (opcoes: Parameters<typeof original.default>[0]) => {
      analises.total += 1;
      return original.default(opcoes);
    },
  };
});

beforeEach(() => {
  analises.total = 0;
});

function textos(elementos: Element[]): string[] {
  return elementos.map((elemento) => elemento.textContent ?? "");
}

function codigoDe(celulas: HTMLElement[]): (string | undefined)[] {
  return celulas.map((celula) => celula.querySelector("code")?.textContent ?? undefined);
}

describe("TextoFormatado", () => {
  it("tabela GFM da resposta vira <table> de verdade, e não um parágrafo com pipes", () => {
    const { container } = render(
      <TextoFormatado
        className="markdown-terminal"
        texto={[
          "Variáveis do pipeline:",
          "",
          "| Variável | Valor | Secreta |",
          "|---|---|---|",
          "| `PUBLIC_BASE_URL` | `https://exemplo.com:8091` | não |",
          "| `NOVOFORMS_SERVICE_TOKEN` | gerar com `openssl rand -hex 32`. Tem que ser igual ao da **produção** | sim |",
        ].join("\n")}
      />,
    );

    const tabela = screen.getByRole("table");
    expect(tabela.parentElement).toHaveClass("markdown-tabela");
    expect(textos(within(tabela).getAllByRole("columnheader"))).toEqual(["Variável", "Valor", "Secreta"]);

    const corpo = Array.from(tabela.querySelectorAll("tbody tr"), (linha) => Array.from(linha.querySelectorAll("td")));
    expect(corpo.map(textos)).toEqual([
      ["PUBLIC_BASE_URL", "https://exemplo.com:8091", "não"],
      [
        "NOVOFORMS_SERVICE_TOKEN",
        "gerar com openssl rand -hex 32. Tem que ser igual ao da produção",
        "sim",
      ],
    ]);
    expect(corpo.map(codigoDe)).toEqual([
      ["PUBLIC_BASE_URL", "https://exemplo.com:8091", undefined],
      ["NOVOFORMS_SERVICE_TOKEN", "openssl rand -hex 32", undefined],
    ]);
    expect(tabela.querySelector("td strong")).toHaveTextContent("produção");
    expect(container.textContent).not.toContain("|---|");
  });

  it("respeita o alinhamento da linha separadora e aceita linhas sem pipes nas pontas", () => {
    render(<TextoFormatado texto={["Esquerda | Centro | Direita | Livre", ":--- | :---: | ---: | ---", "a | b | c | d"].join("\n")} />);

    const alinhamentos = (papel: "columnheader" | "cell") =>
      screen.getAllByRole(papel).map((celula) => celula.style.textAlign);
    expect(alinhamentos("columnheader")).toEqual(["left", "center", "right", ""]);
    expect(alinhamentos("cell")).toEqual(["left", "center", "right", ""]);
  });

  it("pipe escapado fica dentro da célula, inclusive em código inline", () => {
    render(<TextoFormatado texto={["| Comando | Efeito |", "|---|---|", "| `ls \\| wc -l` | conta \\| soma |"].join("\n")} />);

    const celulas = screen.getAllByRole("cell");
    expect(textos(celulas)).toEqual(["ls | wc -l", "conta | soma"]);
    expect(codigoDe(celulas)).toEqual(["ls | wc -l", undefined]);
  });

  it("pipes dentro de bloco de código continuam sendo código", () => {
    const { container } = render(
      <TextoFormatado texto={["```", "| a | b |", "|---|---|", "| 1 | 2 |", "```"].join("\n")} />,
    );

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(container.querySelector("pre code")?.textContent).toBe("| a | b |\n|---|---|\n| 1 | 2 |\n");
  });

  it("pipes soltos, sem linha separadora válida, continuam parágrafo", () => {
    const { container } = render(
      <TextoFormatado texto={["ida | volta | ida", "", "| a | b |", "|---|", "| 1 | 2 |"].join("\n")} />,
    );

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(textos(Array.from(container.querySelectorAll("p")))).toEqual([
      "ida | volta | ida",
      "| a | b |\n|---|\n| 1 | 2 |",
    ]);
  });

  it("HTML escrito numa célula não vira elemento da página", () => {
    const { container } = render(<TextoFormatado texto={["| a | b |", "|---|---|", "| <b>x</b> | <img src=x> |"].join("\n")} />);

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(container.querySelector("b, img")).toBeNull();
  });

  it("til simples não risca o texto; til duplo, sim", () => {
    const { container } = render(<TextoFormatado texto="leva 10~20 min, ~~não~~ mais" />);

    expect(textos(Array.from(container.querySelectorAll("del")))).toEqual(["não"]);
  });

  it("links abrem em outra aba, sem dar acesso à página", () => {
    render(<TextoFormatado texto="veja a [documentação](https://exemplo.dev/doc)" />);

    const link = screen.getByRole("link", { name: "documentação" });
    expect(link).toHaveAttribute("href", "https://exemplo.dev/doc");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  describe("botão de copiar do bloco de código", () => {
    let writeText: ReturnType<typeof vi.fn<(texto: string) => Promise<void>>>;

    beforeEach(() => {
      writeText = vi.fn<(texto: string) => Promise<void>>(async () => undefined);
      Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    });

    afterEach(() => {
      vi.useRealTimers();
      Reflect.deleteProperty(navigator, "clipboard");
    });

    it("só o bloco ganha botão; código inline, não", () => {
      const { container } = render(
        <TextoFormatado texto={["rode `npm test` antes:", "", "```sh", "npm run build", "```"].join("\n")} />,
      );

      const botoes = screen.getAllByRole("button", { name: "copiar" });
      expect(botoes).toHaveLength(1);
      expect(botoes[0]?.closest(".bloco-de-codigo")?.querySelector("pre")).toHaveTextContent("npm run build");
      expect(container.querySelector("p code")?.closest(".bloco-de-codigo")).toBeNull();
    });

    it("a faixa do bloco mostra a linguagem da cerca (sem ela, \"código\") e o botão fica nela, fora do código", () => {
      const { container } = render(
        <TextoFormatado texto={["```ts", "const a = 1;", "```", "", "```", "texto solto", "```"].join("\n")} />,
      );

      const faixas = Array.from(container.querySelectorAll(".bloco-de-codigo > .faixa-do-codigo"));
      expect(faixas.map((faixa) => faixa.querySelector(".linguagem-do-codigo")?.textContent)).toEqual(["ts", "código"]);
      expect(faixas.map((faixa) => faixa.querySelector("button")?.textContent)).toEqual(["copiar", "copiar"]);
      expect(container.querySelector("pre button")).toBeNull();
    });

    it("sem bloco de código, nenhum botão", () => {
      render(<TextoFormatado texto="só `inline` aqui" />);

      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });

    it("copia o texto exato do bloco e mostra copiado por um instante", async () => {
      vi.useFakeTimers();
      render(
        <TextoFormatado
          texto={["```ts", "const a = `x`;", "  if (a) { return 1; }", "", "fim | <b>", "```"].join("\n")}
        />,
      );

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "copiar" }));
      });

      expect(writeText).toHaveBeenCalledTimes(1);
      expect(writeText).toHaveBeenCalledWith("const a = `x`;\n  if (a) { return 1; }\n\nfim | <b>");
      const botao = screen.getByRole("button", { name: "copiado" });
      expect(botao).toHaveAttribute("data-estado", "copiado");

      act(() => {
        vi.advanceTimersByTime(1500);
      });
      expect(screen.getByRole("button", { name: "copiar" })).toHaveAttribute("data-estado", "pronto");
    });

    it("se a cópia falha, avisa que não copiou e depois volta", async () => {
      vi.useFakeTimers();
      writeText.mockRejectedValueOnce(new Error("sem permissão"));
      render(<TextoFormatado texto={["```", "segredo", "```"].join("\n")} />);

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "copiar" }));
      });

      expect(screen.getByRole("button", { name: "não copiou" })).toHaveAttribute("data-estado", "falhou");
      act(() => {
        vi.advanceTimersByTime(1500);
      });
      expect(screen.getByRole("button", { name: "copiar" })).toBeInTheDocument();
    });

    it("sem a API da área de transferência, também avisa que não copiou", async () => {
      Reflect.deleteProperty(navigator, "clipboard");
      render(<TextoFormatado texto={["```", "x", "```"].join("\n")} />);

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "copiar" }));
      });

      expect(screen.getByRole("button", { name: "não copiou" })).toBeInTheDocument();
    });
  });

  it("com as mesmas props não re-analisa o Markdown; com texto novo, sim", () => {
    const { rerender } = render(<TextoFormatado texto="**primeira** resposta" className="markdown-terminal" />);
    expect(analises.total).toBe(1);

    rerender(<TextoFormatado texto="**primeira** resposta" className="markdown-terminal" />);
    rerender(<TextoFormatado texto="**primeira** resposta" className="markdown-terminal" />);
    expect(analises.total).toBe(1);

    rerender(<TextoFormatado texto="**segunda** resposta" className="markdown-terminal" />);
    expect(analises.total).toBe(2);
    expect(screen.getByText("segunda").tagName).toBe("STRONG");
  });
});
