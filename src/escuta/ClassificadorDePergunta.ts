import type { DadosDoUso } from "../orquestracao/UsoDeTokens";

/** O que o classificador precisa para decidir se um trecho ouvido é uma pergunta. */
export interface PedidoAoClassificador {
  /** O trecho da transcrição que a regra local marcou, já aparado. */
  trecho: string;
  /** A transcrição recente da mesma fala, já aparada; nulo quando não veio. */
  contexto: string | null;
  /** A instrução fixa da classificação (prompt de sistema). */
  instrucoes: string;
}

export type ResultadoDoClassificador =
  /** `texto` é a resposta crua do modelo (o JSON da classificação, talvez com envoltório). */
  | { sucesso: true; texto: string; uso: DadosDoUso }
  /** `motivo` já vem pronto para o usuário ler. */
  | { sucesso: false; motivo: string };

/**
 * Porta: uma chamada curta a um modelo, sem ferramentas, que diz se o trecho
 * ouvido traz uma pergunta ou um pedido a responder. Com o sinal abortado,
 * encerra a chamada e resolve sem sucesso (não rejeita).
 */
export interface ClassificadorDePergunta {
  classificar(pedido: PedidoAoClassificador, sinal: AbortSignal): Promise<ResultadoDoClassificador>;
}
