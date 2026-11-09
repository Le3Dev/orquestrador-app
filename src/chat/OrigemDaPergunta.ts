/**
 * De onde veio a pergunta do usuário quando ela não foi digitada no chat.
 * Objeto de valor:
 *
 * - `escuta`: detectada na transcrição do áudio do computador, com o modo
 *   invisível ligado, e enviada sozinha ao chat.
 *
 * Mensagens digitadas (e as gravadas antes do campo) não têm origem.
 * O nome evita "Origem" solto, que já existe no contexto de artefatos.
 */
export const ORIGENS_DA_PERGUNTA = ["escuta"] as const;

export type OrigemDaPergunta = (typeof ORIGENS_DA_PERGUNTA)[number];

export function ehOrigemDaPergunta(valor: unknown): valor is OrigemDaPergunta {
  return typeof valor === "string" && (ORIGENS_DA_PERGUNTA as readonly string[]).includes(valor);
}
