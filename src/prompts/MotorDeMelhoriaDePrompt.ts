import type { DadosDoUso } from "../orquestracao/UsoDeTokens";

/** O que o motor precisa para reescrever um pedido. */
export interface PedidoAoMotorDeMelhoria {
  /** O pedido do usuário, já aparado. */
  texto: string;
  /** A instrução fixa da reescrita (prompt de sistema). */
  instrucoes: string;
}

export type ResultadoDoMotorDeMelhoria =
  | { sucesso: true; texto: string; uso: DadosDoUso }
  /** `motivo` já vem pronto para o usuário ler. */
  | { sucesso: false; motivo: string };

/**
 * Porta: uma chamada curta a um modelo, sem ferramentas, que devolve o pedido
 * reescrito e o consumo. Com o sinal abortado, encerra a chamada e resolve sem
 * sucesso.
 */
export interface MotorDeMelhoriaDePrompt {
  melhorar(pedido: PedidoAoMotorDeMelhoria, sinal: AbortSignal): Promise<ResultadoDoMotorDeMelhoria>;
}
