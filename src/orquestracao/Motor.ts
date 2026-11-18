/**
 * Quem de fato executa um papel da orquestração: o Claude Code, o Codex ou o
 * GitHub Copilot CLI. Cada motor é um CLI com o próprio login e a própria
 * sessão de conversa. Objeto de valor: o nome do motor é o próprio valor.
 *
 * O Claude Code é o motor original e o padrão: tudo o que foi gravado antes de
 * existirem os outros motores valeu para ele.
 */
export const MOTORES = ["claude-code", "codex", "copilot"] as const;

export type Motor = (typeof MOTORES)[number];

export const MOTOR_PADRAO: Motor = "claude-code";

const ROTULOS: Readonly<Record<Motor, string>> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  copilot: "GitHub Copilot CLI",
};

export function ehMotor(valor: unknown): valor is Motor {
  return typeof valor === "string" && (MOTORES as readonly string[]).includes(valor);
}

/** O nome do motor como o usuário o conhece: "Claude Code", "Codex", "GitHub Copilot CLI". */
export function rotuloDoMotor(motor: Motor): string {
  return ROTULOS[motor];
}
