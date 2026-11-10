import { describe, expect, it } from "vitest";

import { resumoDaConfiguracao } from "./resumoDaConfiguracao";
import { CONFIGURACAO_PADRAO_DO_ORQUESTRADOR } from "./modelos";

describe("resumoDaConfiguracao", () => {
  it("resume permissão, modelos e subagentes, sem falar de artefatos online com a opção desligada", () => {
    expect(resumoDaConfiguracao(CONFIGURACAO_PADRAO_DO_ORQUESTRADOR)).toBe(
      "Somente leitura, Opus (esforço automático) com até 3 subagentes Opus.",
    );
  });

  it("com a publicação de artefatos online ligada, avisa no fim", () => {
    expect(resumoDaConfiguracao({ ...CONFIGURACAO_PADRAO_DO_ORQUESTRADOR, permitirArtefatosOnline: true })).toBe(
      "Somente leitura, Opus (esforço automático) com até 3 subagentes Opus. Artefatos online ligados.",
    );
  });
});
