import { describe, expect, it } from "vitest";

import { ehMotor, MOTOR_PADRAO, MOTORES, rotuloDoMotor } from "./Motor";

describe("Motor", () => {
  it("são três: Claude Code, Codex e GitHub Copilot CLI, e o Claude Code é o padrão", () => {
    expect(MOTORES).toEqual(["claude-code", "codex", "copilot"]);
    expect(MOTOR_PADRAO).toBe("claude-code");
  });

  it.each([
    ["claude-code", "Claude Code"],
    ["codex", "Codex"],
    ["copilot", "GitHub Copilot CLI"],
  ] as const)("o rótulo de %s é %s", (motor, rotulo) => {
    expect(rotuloDoMotor(motor)).toBe(rotulo);
  });

  it.each(MOTORES)("reconhece %s", (motor) => {
    expect(ehMotor(motor)).toBe(true);
  });

  it.each(["", "Codex", "claude", "gemini", null, undefined, 3, {}])("não reconhece %j", (valor) => {
    expect(ehMotor(valor)).toBe(false);
  });
});
