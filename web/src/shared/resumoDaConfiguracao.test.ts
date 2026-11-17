import { describe, expect, it } from "vitest";

import type { DadosDaConfiguracao } from "./api/tipos";
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

  describe("motores", () => {
    it("a configuração sem os campos dos motores (servidor antigo) vale Claude Code, sem reserva", () => {
      const antiga: DadosDaConfiguracao = {
        modeloDoOrquestrador: "opus",
        esforcoDoOrquestrador: "padrao",
        modeloDosSubagentes: "opus",
        esforcoDosSubagentes: "padrao",
        quantidadeDeSubagentes: { modo: "automatica", limite: 3 },
        nivelDePermissao: "leitura",
        permitirCommitEPush: false,
        permitirArtefatosOnline: false,
        instrucoesPersonalizadas: "",
      };

      expect(resumoDaConfiguracao(antiga)).toBe("Somente leitura, Opus (esforço automático) com até 3 subagentes Opus.");
    });

    it("mostra o motor no lugar do modelo quando não é o Claude Code, sem falar de esforço", () => {
      expect(
        resumoDaConfiguracao({
          ...CONFIGURACAO_PADRAO_DO_ORQUESTRADOR,
          motorDoOrquestrador: "codex",
          modeloDoOrquestrador: "padrao",
          motorDosSubagentes: "copilot",
          modeloDosSubagentes: "padrao",
        }),
      ).toBe("Somente leitura, Codex com até 3 subagentes GitHub Copilot CLI.");
    });

    it("com um modelo escolhido, ele vem junto do motor", () => {
      expect(
        resumoDaConfiguracao({
          ...CONFIGURACAO_PADRAO_DO_ORQUESTRADOR,
          motorDoOrquestrador: "codex",
          modeloDoOrquestrador: "gpt-5",
        }),
      ).toBe("Somente leitura, Codex (gpt-5) com até 3 subagentes Opus.");
    });

    it("cada papel no seu motor: o Claude Code mantém modelo e esforço, o outro mostra só o motor", () => {
      expect(
        resumoDaConfiguracao({
          ...CONFIGURACAO_PADRAO_DO_ORQUESTRADOR,
          esforcoDoOrquestrador: "alto",
          motorDosSubagentes: "codex",
          modeloDosSubagentes: "padrao",
        }),
      ).toBe("Somente leitura, Opus (esforço alto) com até 3 subagentes Codex.");
    });

    it("lista a reserva na ordem, e o navegador do agente, no fim", () => {
      expect(
        resumoDaConfiguracao({
          ...CONFIGURACAO_PADRAO_DO_ORQUESTRADOR,
          ordemDeReserva: ["codex", "copilot"],
          permitirArtefatosOnline: true,
          navegadorDoAgente: true,
        }),
      ).toBe(
        "Somente leitura, Opus (esforço automático) com até 3 subagentes Opus. Reserva: Codex, GitHub Copilot CLI. Artefatos online ligados. Navegador do agente ligado.",
      );
    });
  });
});
