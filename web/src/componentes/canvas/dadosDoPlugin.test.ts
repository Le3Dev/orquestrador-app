import type { InventarioDoPlugin } from "../../shared/api/tipos";
import { contar, iniciaisDe, linkDaFonte, motivosDeConfirmacao, precisaDeConfirmacao, resumoDoInventario } from "./dadosDoPlugin";

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
