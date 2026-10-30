/**
 * Quanto um agente raciocina antes de responder: níveis mais baixos são mais
 * rápidos e baratos; os mais altos pensam mais a fundo nos problemas difíceis.
 *
 * - `padrao`: não escolhe nada — vale o padrão do modelo ou o que o usuário
 *   já configurou no próprio Claude Code;
 * - `baixo`, `medio`, `alto`, `extra_alto`, `maximo`: do mais leve ao mais
 *   profundo.
 *
 * Nem todo modelo oferece todos os níveis; quem resolve isso é o motor de
 * agentes, que roda o nível mais alto disponível até o escolhido.
 */
export const ESFORCOS_DE_RACIOCINIO = ["padrao", "baixo", "medio", "alto", "extra_alto", "maximo"] as const;

export type EsforcoDeRaciocinio = (typeof ESFORCOS_DE_RACIOCINIO)[number];

export const ESFORCO_PADRAO: EsforcoDeRaciocinio = "padrao";

export function ehEsforcoDeRaciocinio(valor: unknown): valor is EsforcoDeRaciocinio {
  return typeof valor === "string" && (ESFORCOS_DE_RACIOCINIO as readonly string[]).includes(valor);
}
