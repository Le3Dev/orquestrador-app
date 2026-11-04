import {
  CONFIGURACAO_PADRAO_DO_ORQUESTRADOR,
  nomeComVersao,
  PREFERENCIAS_PADRAO_DO_CHAT,
  rotuloDoEsforco,
  versaoDoModeloUsado,
} from "./modelos";

/**
 * Cópia dos campos da predefinição "economico" — a fonte é
 * `src/orquestracao/PredefinicaoDeConfiguracao.ts` (constante `ECONOMICO`),
 * que a web não importa. Se a predefinição mudar, mude aqui também.
 */
const CAMPOS_DO_MODO_ECONOMICO = {
  modeloDoOrquestrador: "opus",
  esforcoDoOrquestrador: "medio",
  modeloDosSubagentes: "sonnet",
  esforcoDosSubagentes: "medio",
  quantidadeDeSubagentes: { modo: "automatica", limite: 1 },
  permitirTrabalhoDireto: true,
  proporPlanoEmPedidosGrandes: false,
} as const;

describe("padrões", () => {
  it("o Orquestrador novo nasce no Modo econômico, com permissão de leitura e sem commit/push", () => {
    expect(CONFIGURACAO_PADRAO_DO_ORQUESTRADOR).toEqual({
      ...CAMPOS_DO_MODO_ECONOMICO,
      nivelDePermissao: "leitura",
      permitirCommitEPush: false,
    });
  });

  it("o chat começa em Sonnet com esforço médio", () => {
    expect(PREFERENCIAS_PADRAO_DO_CHAT).toEqual({ modelo: "sonnet", esforco: "medio" });
  });
});

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
  });
});
