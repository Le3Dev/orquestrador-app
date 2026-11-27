import { describe, expect, it } from "vitest";

import { ehMotor, MOTOR_PADRAO, MOTORES, rotuloDoMotor } from "./Motor";

describe("Motor", () => {
  it("são quatro: Claude Code, Codex, GitHub Copilot CLI e Gemini CLI, e o Claude Code é o padrão", () => {
    expect(MOTORES).toEqual(["claude-code", "codex", "copilot", "gemini"]);
    expect(MOTOR_PADRAO).toBe("claude-code");
  });

  it.each([
    ["claude-code", "Claude Code"],
    ["codex", "Codex"],
    ["copilot", "GitHub Copilot CLI"],
    ["gemini", "Gemini CLI"],
  ] as const)("o rótulo de %s é %s", (motor, rotulo) => {
    expect(rotuloDoMotor(motor)).toBe(rotulo);
  });

  it.each(MOTORES)("reconhece %s", (motor) => {
    expect(ehMotor(motor)).toBe(true);
  });

  it.each(["", "Codex", "claude", "grok", null, undefined, 3, {}])("não reconhece %j", (valor) => {
    expect(ehMotor(valor)).toBe(false);
  });
});
