/**
 * Família de modelo do Claude escolhida para um papel na orquestração.
 *
 * Guarda o apelido (`opus`, `sonnet`, `haiku`) e não o ID completo: o Claude
 * Code resolve o apelido para a versão vigente, e assim o histórico salvo não
 * fica preso a um modelo que um dia será aposentado.
 */
export const MODELOS_CLAUDE = ["opus", "sonnet", "haiku"] as const;

export type ModeloClaude = (typeof MODELOS_CLAUDE)[number];

export function ehModeloClaude(valor: unknown): valor is ModeloClaude {
  return typeof valor === "string" && (MODELOS_CLAUDE as readonly string[]).includes(valor);
}
