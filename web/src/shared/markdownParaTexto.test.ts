import { markdownParaTexto } from "./markdownParaTexto";

describe("markdownParaTexto", () => {
  it("negrito, itálico, riscado e código em linha ficam só com o texto", () => {
    expect(markdownParaTexto("Isto é **forte**, _suave_, *outro*, ~~velho~~ e `codigo`.")).toBe(
      "Isto é forte, suave, outro, velho e codigo.",
    );
  });

  it("títulos perdem o # e parágrafos ficam separados por linha em branco", () => {
    expect(markdownParaTexto("# Título\n\nPrimeiro.\n\n### Seção\n\nSegundo.")).toBe("Título\n\nPrimeiro.\n\nSeção\n\nSegundo.");
  });

  it("listas com marcador viram \"• \", ordenadas mantêm os números e as aninhadas ficam recuadas", () => {
    expect(markdownParaTexto("- a\n- b\n  - b1\n  - b2\n- c")).toBe("• a\n• b\n  • b1\n  • b2\n• c");
    expect(markdownParaTexto("1. um\n2. dois\n3. três")).toBe("1. um\n2. dois\n3. três");
    expect(markdownParaTexto("3) c\n4) d")).toBe("3. c\n4. d");
  });

  it("tarefas viram o item de checklist da nota", () => {
    expect(markdownParaTexto("- [x] feito\n- [ ] falta")).toBe("[x] feito\n[ ] falta");
  });

  it("links viram \"texto (url)\"; quando o texto é a própria url, só a url", () => {
    expect(markdownParaTexto("Veja [a doc](https://exemplo.com/doc) agora.")).toBe("Veja a doc (https://exemplo.com/doc) agora.");
    expect(markdownParaTexto("Abra https://exemplo.com e <https://outro.com>.")).toBe("Abra https://exemplo.com e https://outro.com.");
    expect(markdownParaTexto("![logo](https://exemplo.com/l.png)")).toBe("logo (https://exemplo.com/l.png)");
  });

  it("blocos de código ficam sem as cercas, com o conteúdo intacto", () => {
    const resposta = "Rode:\n\n```bash\nnpm run **build**\n  # recuo\n```\n\nPronto.";
    expect(markdownParaTexto(resposta)).toBe("Rode:\n\nnpm run **build**\n  # recuo\n\nPronto.");
    expect(markdownParaTexto("~~~\nsem linguagem\n~~~")).toBe("sem linguagem");
  });

  it("tabelas viram linhas com as colunas separadas por \" | \", sem a linha de traços", () => {
    const tabela = "| Nome | Qtd |\n|:-----|----:|\n| **pão** | 2 |\n| leite | 1 |";
    expect(markdownParaTexto(tabela)).toBe("Nome | Qtd\npão | 2\nleite | 1");
  });

  it("citações perdem o > e a linha horizontal vira um traço desenhado", () => {
    expect(markdownParaTexto("> dito\n> em duas linhas\n\n---\n\nfim")).toBe("dito\nem duas linhas\n\n────────\n\nfim");
  });

  it("texto sem marcação não muda, e vazio continua vazio", () => {
    expect(markdownParaTexto("Só um texto, com acentos: ação.")).toBe("Só um texto, com acentos: ação.");
    expect(markdownParaTexto("")).toBe("");
    expect(markdownParaTexto("  \n ")).toBe("");
  });

  it("uma resposta completa fica legível de ponta a ponta", () => {
    const resposta = [
      "## Resultado",
      "",
      "O **build** passou. Detalhes:",
      "",
      "1. lint: `ok`",
      "2. testes: [relatório](https://ex.com/r)",
      "",
      "| Etapa | Tempo |",
      "|---|---|",
      "| lint | 3s |",
      "",
      "```ts",
      "const a = 1;",
      "```",
    ].join("\n");
    expect(markdownParaTexto(resposta)).toBe(
      [
        "Resultado",
        "",
        "O build passou. Detalhes:",
        "",
        "1. lint: ok",
        "2. testes: relatório (https://ex.com/r)",
        "",
        "Etapa | Tempo",
        "lint | 3s",
        "",
        "const a = 1;",
      ].join("\n"),
    );
  });
});
