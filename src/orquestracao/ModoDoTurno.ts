/**
 * Como o Orquestrador atende um pedido:
 * - `execucao`: faz o trabalho com as permissões da configuração;
 * - `planejamento`: só investiga (somente leitura) e entrega um Plano para o usuário decidir.
 */
export const MODOS_DO_TURNO = ["execucao", "planejamento"] as const;

export type ModoDoTurno = (typeof MODOS_DO_TURNO)[number];

/** O que o usuário decidiu sobre o Plano de um turno de planejamento. */
export type DecisaoDoPlano = "pendente" | "aprovado" | "descartado";
