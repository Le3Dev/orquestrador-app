import path from "node:path";

import { describe, expect, it } from "vitest";

import { lerConfiguracao, modoDeAcesso } from "./Configuracao";

const pastaDoApp = path.resolve(__dirname, "..", "..");
const CHAVE = "a1".repeat(32);

describe("lerConfiguracao", () => {
  it("usa os padrões quando o ambiente está vazio", () => {
    const configuracao = lerConfiguracao({});
    expect(configuracao.porta).toBe(3200);
    expect(configuracao.pastaDeDados).toBe(path.join(pastaDoApp, "dados"));
    expect(configuracao.pastaRaizDosProjetos).toBe(path.resolve(pastaDoApp, ".."));
    expect(configuracao.pastaDaTela).toBe(path.join(pastaDoApp, "web", "dist"));
    expect(configuracao.chaveDeAcesso).toBeNull();
    expect(configuracao.permitirNavegador).toBe(false);
    expect(configuracao.urlDeDownload).toBeNull();
  });

  it("lê PASTA_DA_TELA, relativa à pasta do app ou absoluta", () => {
    expect(lerConfiguracao({ PASTA_DA_TELA: "tela" }).pastaDaTela).toBe(path.join(pastaDoApp, "tela"));
    const absoluta = path.resolve(pastaDoApp, "..", "outra-tela");
    expect(lerConfiguracao({ PASTA_DA_TELA: absoluta }).pastaDaTela).toBe(absoluta);
  });

  it("aceita a chave de acesso em hexadecimal", () => {
    expect(lerConfiguracao({ ORQUESTRADOR_CHAVE_DE_ACESSO: CHAVE }).chaveDeAcesso).toBe(CHAVE);
    expect(lerConfiguracao({ ORQUESTRADOR_CHAVE_DE_ACESSO: "F".repeat(32) }).chaveDeAcesso).toBe("F".repeat(32));
  });

  it.each(["abc", "f".repeat(31), "z".repeat(64), `${"a".repeat(63)} `])(
    "recusa a chave fora do formato sem mostrá-la (%s)",
    (chave) => {
      expect(() => lerConfiguracao({ ORQUESTRADOR_CHAVE_DE_ACESSO: chave })).toThrow(
        /ORQUESTRADOR_CHAVE_DE_ACESSO inválida/,
      );
      try {
        lerConfiguracao({ ORQUESTRADOR_CHAVE_DE_ACESSO: chave });
      } catch (erro) {
        expect((erro as Error).message).not.toContain(chave);
      }
    },
  );

  it("liga a liberação do navegador só com \"1\"", () => {
    expect(lerConfiguracao({ ORQUESTRADOR_PERMITIR_NAVEGADOR: "1" }).permitirNavegador).toBe(true);
    expect(lerConfiguracao({ ORQUESTRADOR_PERMITIR_NAVEGADOR: "true" }).permitirNavegador).toBe(false);
    expect(lerConfiguracao({ ORQUESTRADOR_PERMITIR_NAVEGADOR: "0" }).permitirNavegador).toBe(false);
  });

  it("aceita URL de download http(s)", () => {
    expect(lerConfiguracao({ ORQUESTRADOR_URL_DE_DOWNLOAD: "https://exemplo.com/app" }).urlDeDownload).toBe(
      "https://exemplo.com/app",
    );
  });

  it.each(["ftp://exemplo.com/app", "javascript:alert(1)", "não é url"])("recusa URL de download inválida (%s)", (url) => {
    expect(() => lerConfiguracao({ ORQUESTRADOR_URL_DE_DOWNLOAD: url })).toThrow(/ORQUESTRADOR_URL_DE_DOWNLOAD inválida/);
  });

  it("recusa PORTA inválida", () => {
    expect(() => lerConfiguracao({ PORTA: "abc" })).toThrow(/PORTA inválida/);
  });
});

describe("modoDeAcesso", () => {
  it("sem chave e sem liberação: recusado", () => {
    expect(modoDeAcesso({ chaveDeAcesso: null, permitirNavegador: false })).toBe("recusado");
  });

  it("com chave: aplicativo", () => {
    expect(modoDeAcesso({ chaveDeAcesso: CHAVE, permitirNavegador: false })).toBe("aplicativo");
  });

  it("com liberação: navegador, mesmo havendo chave", () => {
    expect(modoDeAcesso({ chaveDeAcesso: null, permitirNavegador: true })).toBe("navegador");
    expect(modoDeAcesso({ chaveDeAcesso: CHAVE, permitirNavegador: true })).toBe("navegador");
  });
});
