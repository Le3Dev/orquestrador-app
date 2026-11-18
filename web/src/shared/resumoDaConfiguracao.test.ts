import { describe, expect, it } from "vitest";

import { resumoDaConfiguracao } from "./resumoDaConfiguracao";
import { CONFIGURACAO_PADRAO_DO_ORQUESTRADOR } from "./modelos";

describe("resumoDaConfiguracao", () => {
  it("resume permissão, modelos e subagentes, sem falar de artefatos online com a opção desligada", () => {
    expect(resumoDaConfiguracao(CONFIGURACAO_PADRAO_DO_ORQUESTRADOR)).toBe(
      "Somente leitura, Sonnet (esforço médio) com até 3 subagentes Sonnet (esforço médio).",
    );
  });

  it("só fala do contexto quando o estendido está escolhido", () => {
    expect(resumoDaConfiguracao({ ...CONFIGURACAO_PADRAO_DO_ORQUESTRADOR, tetoDeContexto: "estendido" })).toMatch(
      / Contexto estendido \(1 milhão\)\.$/,
    );
  });

  it("com a publicação de artefatos online ligada, avisa no fim", () => {
    expect(resumoDaConfiguracao({ ...CONFIGURACAO_PADRAO_DO_ORQUESTRADOR, permitirArtefatosOnline: true })).toBe(
      "Somente leitura, Sonnet (esforço médio) com até 3 subagentes Sonnet (esforço médio). Artefatos online ligados.",
    );
  });
});
