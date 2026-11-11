import type { InventarioDoPlugin } from "../../shared/api/tipos";
import {
  acharNoTexto,
  contar,
  iniciaisDe,
  linhaCurta,
  linkDaFonte,
  motivosDeConfirmacao,
  nomeAmigavel,
  precisaDeConfirmacao,
  resumoDoInventario,
} from "./dadosDoPlugin";

function inventario(extras: Partial<InventarioDoPlugin> = {}): InventarioDoPlugin {
  return { skills: [], subagentes: 0, servidoresMcp: 0, hooks: 0, verificado: true, temBin: false, ...extras };
}

describe("iniciaisDe", () => {
  it("usa a primeira letra de cada uma das duas primeiras palavras, ou as duas primeiras letras", () => {
    expect(iniciaisDe("frontend-design")).toBe("FD");
    expect(iniciaisDe("anthropic-skills:pdf")).toBe("AS");
    expect(iniciaisDe("context7")).toBe("CO");
    expect(iniciaisDe("a")).toBe("A");
  });
});

describe("linkDaFonte", () => {
  it("aceita URL, github.com/dono/repo e dono/repo, e rotula o GitHub", () => {
    expect(linkDaFonte("https://github.com/apollographql/skills")).toEqual({
      url: "https://github.com/apollographql/skills",
      rotulo: "Ver no GitHub",
    });
    expect(linkDaFonte("github.com/apollographql/skills")).toEqual({
      url: "https://github.com/apollographql/skills",
      rotulo: "Ver no GitHub",
    });
    expect(linkDaFonte("apollographql/skills")?.url).toBe("https://github.com/apollographql/skills");
    expect(linkDaFonte("https://gitlab.com/equipe/plugin")).toEqual({ url: "https://gitlab.com/equipe/plugin", rotulo: "Ver o código" });
  });

  it("o que não parece endereço (vazio, caminho local) não vira link", () => {
    expect(linkDaFonte(null)).toBeNull();
    expect(linkDaFonte("  ")).toBeNull();
    expect(linkDaFonte("/Users/alguem/plugin")).toBeNull();
    expect(linkDaFonte("javascript:alert(1)")).toBeNull();
  });
});

describe("contar e resumoDoInventario", () => {
  it("usa o singular só para 1 e formata em pt-BR", () => {
    expect(contar(1, "skill", "skills")).toBe("1 skill");
    expect(contar(0, "skill", "skills")).toBe("0 skills");
    expect(contar(1200, "skill", "skills")).toBe("1.200 skills");
  });

  it("resume skills e subagentes, e cita os servidores MCP só quando há", () => {
    expect(resumoDoInventario(inventario({ skills: [{ nome: "a", descricao: "" }], subagentes: 2, hooks: 1 }))).toBe(
      "1 skill · 2 subagentes",
    );
    expect(resumoDoInventario(inventario({ subagentes: 1, servidoresMcp: 1 }))).toBe(
      "0 skills · 1 subagente · 1 servidor MCP",
    );
  });
});

describe("precisaDeConfirmacao e motivosDeConfirmacao", () => {
  it("um plugin limpo (sem hook, sem bin, verificado) liga direto e não tem motivo", () => {
    expect(precisaDeConfirmacao(inventario())).toBe(false);
    expect(motivosDeConfirmacao(inventario())).toEqual([]);
  });

  it("cada motivo sozinho já pede confirmação: hooks, pasta bin e inventário não verificado", () => {
    expect(precisaDeConfirmacao(inventario({ hooks: 1 }))).toBe(true);
    expect(precisaDeConfirmacao(inventario({ temBin: true }))).toBe(true);
    expect(precisaDeConfirmacao(inventario({ verificado: false }))).toBe(true);
  });

  it("lista só os motivos que valem, em linguagem de gente", () => {
    expect(motivosDeConfirmacao(inventario({ hooks: 2 })).map((motivo) => motivo.titulo)).toEqual([
      "Roda comandos sozinho ao abrir sessões (2 hooks)",
    ]);
    expect(motivosDeConfirmacao(inventario({ hooks: 1 }))[0]?.titulo).toBe("Roda comandos sozinho ao abrir sessões (1 hook)");
    expect(motivosDeConfirmacao(inventario({ temBin: true })).map((motivo) => motivo.chave)).toEqual(["bin"]);
    expect(motivosDeConfirmacao(inventario({ verificado: false })).map((motivo) => motivo.titulo)).toEqual([
      "Não conseguimos ler tudo o que vem nele",
    ]);
    expect(motivosDeConfirmacao(inventario({ hooks: 2, temBin: true, verificado: false })).map((motivo) => motivo.chave)).toEqual([
      "hooks",
      "bin",
      "naoVerificado",
    ]);
    expect(motivosDeConfirmacao(inventario({ temBin: true }))[0]?.titulo).toBe(
      "Traz programas próprios que o terminal dos agentes pode chamar (pasta bin)",
    );
  });
});

describe("nomeAmigavel", () => {
  it("tira o prefixo do plugin quando ele é mesmo o plugin da skill", () => {
    expect(nomeAmigavel({ nome: "anthropic-skills:docx", plugin: "anthropic-skills" })).toBe("docx");
    expect(nomeAmigavel({ nome: "cowork-plugin-management:create-cowork-plugin", plugin: "cowork-plugin-management" })).toBe(
      "create-cowork-plugin",
    );
  });

  it("deixa como está a skill sem plugin, ou com um ':' que não é o prefixo do plugin", () => {
    expect(nomeAmigavel({ nome: "context7-mcp", plugin: null })).toBe("context7-mcp");
    expect(nomeAmigavel({ nome: "revisar:pr", plugin: null })).toBe("revisar:pr");
    expect(nomeAmigavel({ nome: "outro:docx", plugin: "anthropic-skills" })).toBe("outro:docx");
    expect(nomeAmigavel({ nome: "anthropic-skills:", plugin: "anthropic-skills" })).toBe("anthropic-skills:");
  });
});

describe("linhaCurta", () => {
  it("tira a abertura de boilerplate e fica na primeira frase, com a inicial maiúscula", () => {
    expect(
      linhaCurta(
        "docx",
        "Use this skill whenever the user wants to create, read, edit, or manipulate Word documents (.docx). Also use when extracting content.",
      ),
    ).toBe("Create, read, edit, or manipulate Word documents (.docx).");
  });

  it("tira o 'nome (' do começo", () => {
    expect(linhaCurta("docs", "docs (editable docs people share and comment on): making one")).toBe(
      "Editable docs people share and comment on): making one",
    );
  });

  it("não corta num ponto sem espaço depois (.docx, Next.js) e devolve o texto quando nada casa", () => {
    expect(linhaCurta("x", "Edita arquivos .docx e projetos Next.js sem pontuação final")).toBe(
      "Edita arquivos .docx e projetos Next.js sem pontuação final",
    );
    expect(linhaCurta("x", "  Lê, cria\n e edita PDFs  ")).toBe("Lê, cria e edita PDFs");
  });

  it("limita o tamanho da linha", () => {
    expect(linhaCurta("x", "a".repeat(400)).length).toBeLessThanOrEqual(170);
  });
});

describe("acharNoTexto", () => {
  it("acha o termo sem ligar para acento nem caixa, e devolve o texto partido em volta dele", () => {
    expect(acharNoTexto("Revisão do código", "REVISAO")).toEqual({ antes: "", achado: "Revisão", depois: " do código" });
  });

  it("corta o que vem antes do achado na margem, com reticências", () => {
    const trecho = acharNoTexto("uma descrição longa que só no final fala de planilhas", "planilhas", 10);
    expect(trecho).toEqual({ antes: "…l fala de ", achado: "planilhas", depois: "" });
  });

  it("devolve nulo sem termo ou quando não acha", () => {
    expect(acharNoTexto("abc", "")).toBeNull();
    expect(acharNoTexto("abc", "  ")).toBeNull();
    expect(acharNoTexto("abc", "z")).toBeNull();
  });
});
