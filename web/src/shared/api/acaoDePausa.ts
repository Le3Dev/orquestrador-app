/**
 * Ação sugerida pelo chat para pausar o pedido em andamento de um
 * Orquestrador, ou tirá-lo da pausa. Ele vem pelo nome e pela pasta de
 * trabalho, já conferidos pelo servidor; o estado é conferido de novo no clique.
 */
export interface AcaoDePausaDoOrquestrador {
  tipo: "pausar_orquestrador" | "continuar_orquestrador";
  orquestrador: { nome: string; pasta: string };
}

export function ehAcaoDePausaDoOrquestrador(acao: { tipo: string }): acao is AcaoDePausaDoOrquestrador {
  return acao.tipo === "pausar_orquestrador" || acao.tipo === "continuar_orquestrador";
}
