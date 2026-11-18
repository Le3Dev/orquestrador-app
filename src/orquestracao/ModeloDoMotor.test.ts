import { describe, expect, it } from "vitest";

import { ErroDeOrquestracao } from "./ErroDeOrquestracao";
import { MODELOS_CLAUDE } from "./ModeloClaude";
import {
  comoModeloClaude,
  ehModeloDoMotor,
  MODELO_PADRAO_DO_CLI,
  modeloDoMotorValido,
  modeloPadraoDoMotor,
} from "./ModeloDoMotor";

describe("ModeloDoMotor", () => {
  describe("claude-code", () => {
    it.each(MODELOS_CLAUDE)("aceita %s, um valor de ModeloClaude", (modelo) => {
      expect(ehModeloDoMotor("claude-code", modelo)).toBe(true);
      expect(modeloDoMotorValido("claude-code", modelo)).toBe(modelo);
    });

    it.each([MODELO_PADRAO_DO_CLI, "gpt-5", "Opus", "claude-opus-4", "", null, 3])("recusa %j", (valor) => {
      expect(ehModeloDoMotor("claude-code", valor)).toBe(false);
      expect(() => modeloDoMotorValido("claude-code", valor)).toThrow("Modelo inválido. Use opus, sonnet ou haiku.");
    });
  });

  describe.each(["codex", "copilot"] as const)("%s", (motor) => {
    it("aceita 'padrao' (o modelo do próprio CLI) e ids de modelo", () => {
      for (const modelo of [MODELO_PADRAO_DO_CLI, "gpt-5.1-codex", "claude-sonnet-4.5", "o3_mini", "provedor:modelo", "a", "m".repeat(64)]) {
        expect(ehModeloDoMotor(motor, modelo)).toBe(true);
        expect(modeloDoMotorValido(motor, modelo)).toBe(modelo);
      }
    });

    it.each(["", " ", "gpt 5", "gpt-5;rm", "modelo/com/barra", "$(cmd)", "-- flag", "ç", "m".repeat(65), null, undefined, 5])(
      "recusa %j com dados_invalidos",
      (valor) => {
        expect(ehModeloDoMotor(motor, valor)).toBe(false);
        expect(() => modeloDoMotorValido(motor, valor)).toThrow(ErroDeOrquestracao);
      },
    );
  });

  it("a mensagem de um motor novo diz qual é o motor e o que vale", () => {
    expect(() => modeloDoMotorValido("codex", "gpt 5")).toThrow(/Codex/);
    expect(() => modeloDoMotorValido("copilot", "gpt 5")).toThrow(/GitHub Copilot CLI/);
    try {
      modeloDoMotorValido("codex", "gpt 5");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroDeOrquestracao);
      expect((erro as ErroDeOrquestracao).motivo).toBe("dados_invalidos");
      expect((erro as ErroDeOrquestracao).message).toContain(MODELO_PADRAO_DO_CLI);
    }
  });

  describe("modeloPadraoDoMotor", () => {
    it("no Claude Code, o de sempre de cada papel", () => {
      expect(modeloPadraoDoMotor("claude-code", "orquestrador")).toBe("opus");
      expect(modeloPadraoDoMotor("claude-code", "subagentes")).toBe("sonnet");
    });

    it("nos outros motores, o do próprio CLI, nos dois papéis", () => {
      for (const motor of ["codex", "copilot"] as const) {
        expect(modeloPadraoDoMotor(motor, "orquestrador")).toBe(MODELO_PADRAO_DO_CLI);
        expect(modeloPadraoDoMotor(motor, "subagentes")).toBe(MODELO_PADRAO_DO_CLI);
      }
    });
  });

  describe("comoModeloClaude", () => {
    it("devolve o apelido do Claude como veio", () => {
      expect(comoModeloClaude("opus")).toBe("opus");
      expect(comoModeloClaude("haiku", "opus")).toBe("haiku");
    });

    it("um modelo que não é do Claude cai na reserva (sonnet, ou a informada): nunca vai um id estranho ao --model", () => {
      expect(comoModeloClaude("gpt-5")).toBe("sonnet");
      expect(comoModeloClaude(MODELO_PADRAO_DO_CLI, "opus")).toBe("opus");
    });
  });
});
