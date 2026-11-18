import { ModoDoPedido } from "./EtapaDaRotina";

/** O que uma etapa de pedido manda para um Orquestrador. */
export interface PedidoDaRotina {
  orquestradorId: string;
  texto: string;
  modo: ModoDoPedido;
}

/** Como um pedido terminou do ponto de vista da Rotina. */
export type ResultadoDoPedidoDaRotina =
  /** O turno terminou; `resposta` é o que o Orquestrador respondeu. */
  | { situacao: "concluido"; resposta: string }
  /** O Orquestrador montou um plano e espera aprovação: a Rotina para até o usuário decidir. */
  | { situacao: "plano_para_aprovacao"; plano: string }
  | { situacao: "falhou" | "cancelado"; motivo: string };

/**
 * Porta: como a Rotina conversa com os Orquestradores. Quem implementa é a
 * camada de composição, ligando ao serviço de orquestração; a Rotina não
 * conhece turnos, filas nem motores.
 *
 * Se o Orquestrador estiver ocupado, o pedido entra na fila dele; a promessa
 * só resolve quando o turno termina. O `sinal` aborta a espera (a Rotina foi
 * cancelada ou o app está fechando).
 */
export interface ExecutorDePedidos {
  executar(pedido: PedidoDaRotina, sinal: AbortSignal): Promise<ResultadoDoPedidoDaRotina>;
  /** O plano que o último pedido deixou pendente foi aprovado: o Orquestrador segue com ele. */
  aprovarPlano(orquestradorId: string, sinal: AbortSignal): Promise<ResultadoDoPedidoDaRotina>;
  /** O plano que ficou pendente foi recusado (ou a execução cancelada): o Orquestrador o descarta. */
  descartarPlano(orquestradorId: string): Promise<void>;
  orquestradorExiste(orquestradorId: string): Promise<boolean>;
}
