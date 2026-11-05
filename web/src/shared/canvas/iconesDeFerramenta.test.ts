import { iconeDaFerramenta, ROTULO_DO_ICONE } from "./iconesDeFerramenta";

describe("iconeDaFerramenta", () => {
  it.each([
    ["Read", "lupa"],
    ["Grep", "lupa"],
    ["Glob", "lupa"],
    ["LS", "lupa"],
    ["Edit", "lapis"],
    ["Write", "lapis"],
    ["MultiEdit", "lapis"],
    ["NotebookEdit", "lapis"],
    ["Bash", "engrenagem"],
    ["PowerShell", "engrenagem"],
    ["BashOutput", "engrenagem"],
    ["KillShell", "engrenagem"],
    ["WebSearch", "globo"],
    ["WebFetch", "globo"],
  ])("%s → %s", (ferramenta, icone) => {
    expect(iconeDaFerramenta(ferramenta)).toBe(icone);
  });

  it("não diferencia maiúsculas", () => {
    expect(iconeDaFerramenta("read")).toBe("lupa");
    expect(iconeDaFerramenta("WEBFETCH")).toBe("globo");
    expect(iconeDaFerramenta("powershell")).toBe("engrenagem");
    expect(iconeDaFerramenta("multiEDIT")).toBe("lapis");
  });

  it("ferramenta desconhecida, de MCP ou nenhuma: sem ícone", () => {
    expect(iconeDaFerramenta("Task")).toBeNull();
    expect(iconeDaFerramenta("mcp__github__read_file")).toBeNull();
    expect(iconeDaFerramenta("constructor")).toBeNull();
    expect(iconeDaFerramenta("")).toBeNull();
    expect(iconeDaFerramenta(null)).toBeNull();
  });

  it("cada ícone tem a dica do que o Subagente está fazendo", () => {
    expect(ROTULO_DO_ICONE).toEqual({
      lupa: "lendo",
      lapis: "editando",
      engrenagem: "rodando comando",
      globo: "pesquisando na web",
    });
  });
});
