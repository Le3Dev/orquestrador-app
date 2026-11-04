/**
 * Família de modelo do Claude escolhida para um papel na orquestração.
 *
 * Guarda o apelido (`fable`, `opus`, `sonnet`, `haiku`) e não o ID completo: o
 * Claude Code resolve o apelido para a versão vigente, e assim o histórico
 * salvo não fica preso a um modelo que um dia será aposentado. `fable` (Fable
 * 5.1) é aceito pelo Claude Code desde a v2.1.257.
 */
export const MODELOS_CLAUDE = ["fable", "opus", "sonnet", "haiku"] as const;

export type ModeloClaude = (typeof MODELOS_CLAUDE)[number];

export function ehModeloClaude(valor: unknown): valor is ModeloClaude {
  return typeof valor === "string" && (MODELOS_CLAUDE as readonly string[]).includes(valor);
}
