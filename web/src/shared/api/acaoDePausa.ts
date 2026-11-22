/**
 * Ação sugerida pelo chat para pausar o pedido em andamento de um
 * Orquestrador, ou tirá-lo da pausa. Ele vem pelo `id`, já conferido pelo
 * servidor; nome e pasta vão para leitura, porque podem se repetir. O estado
 * é conferido de novo no clique.
 */
export interface AcaoDePausaDoOrquestrador {
  tipo: "pausar_orquestrador" | "continuar_orquestrador";
  /** Sem `id` só nas mensagens gravadas antes dele: aí vale o nome exato e único na pasta. */
  orquestrador: { id?: string; nome: string; pasta: string };
}

export function ehAcaoDePausaDoOrquestrador(acao: { tipo: string }): acao is AcaoDePausaDoOrquestrador {
  return acao.tipo === "pausar_orquestrador" || acao.tipo === "continuar_orquestrador";
}
