import { nomeComVersao, rotuloDoEsforco, versaoDoModeloUsado } from "./modelos";

describe("modelos do chat", () => {
  it("lê a versão do identificador do modelo, só da mesma família", () => {
    expect(versaoDoModeloUsado("claude-opus-5-5", "opus")).toBe("5.5");
    expect(versaoDoModeloUsado("claude-haiku-4-5-20251001", "haiku")).toBe("4.5");
    expect(versaoDoModeloUsado("claude-opus-4-20250514", "opus")).toBe("4");
    expect(versaoDoModeloUsado("claude-sonnet-5-5", "opus")).toBeNull();
    expect(versaoDoModeloUsado(null, "opus")).toBeNull();
  });

  it("monta o nome com a versão usada ou a da tabela", () => {
    expect(nomeComVersao("opus", "claude-opus-5-6")).toBe("Opus 5.6");
    expect(nomeComVersao("opus", "claude-sonnet-5-6")).toBe("Opus 5.5");
    expect(nomeComVersao("fable", null)).toBe("Fable 5.1");
  });

  it("rotula os esforços", () => {
    expect(rotuloDoEsforco("padrao")).toBe("Padrão");
    expect(rotuloDoEsforco("extra_alto")).toBe("Extra alto");
    expect(rotuloDoEsforco("ultracode")).toBe("Ultracode");
  });
});
