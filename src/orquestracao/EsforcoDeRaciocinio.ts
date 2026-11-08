/**
 * Quanto um agente raciocina antes de responder: níveis mais baixos são mais
 * rápidos e baratos; os mais altos pensam mais a fundo nos problemas difíceis.
 *
 * - `padrao`: não escolhe nada — vale o padrão do modelo ou o que o usuário
 *   já configurou no próprio Claude Code;
 * - `baixo`, `medio`, `alto`, `extra_alto`, `maximo`: do mais leve ao mais
 *   profundo;
 * - `ultracode`: o extra alto mais workflows dinâmicos, em que o agente
 *   coordena por conta própria vários agentes em segundo plano. Vale só para
 *   quem conversa com o usuário (o Orquestrador e o chat), nunca para os
 *   Subagentes.
 *
 * Nem todo modelo oferece todos os níveis; quem resolve isso é o motor de
 * agentes, que roda o nível mais alto disponível até o escolhido.
 */
export const ESFORCOS_DE_RACIOCINIO = ["padrao", "baixo", "medio", "alto", "extra_alto", "maximo", "ultracode"] as const;

export type EsforcoDeRaciocinio = (typeof ESFORCOS_DE_RACIOCINIO)[number];

export const ESFORCO_PADRAO: EsforcoDeRaciocinio = "padrao";

export function ehEsforcoDeRaciocinio(valor: unknown): valor is EsforcoDeRaciocinio {
  return typeof valor === "string" && (ESFORCOS_DE_RACIOCINIO as readonly string[]).includes(valor);
}

/** Esforço que só o Orquestrador e o chat aceitam. */
export const ESFORCO_ULTRACODE = "ultracode" satisfies EsforcoDeRaciocinio;

export const ULTRACODE_NOS_SUBAGENTES =
  'O esforço "ultracode" vale só para o orquestrador e o chat. Escolha outro esforço para os subagentes.';

/** Se o esforço pode ser o dos Subagentes: todos, menos o `ultracode`. */
export function serveParaSubagentes(esforco: EsforcoDeRaciocinio): boolean {
  return esforco !== ESFORCO_ULTRACODE;
}
