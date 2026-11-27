import type { MensagemParaVinculado, NotasParaVinculo } from "../vinculos/BlocosDeVinculo";

/** Um vínculo visto do lado de um Orquestrador: com quem e as notas compartilhadas. */
export interface VinculoDoOrquestrador {
  vinculoId: string;
  parceiroId: string;
  notas: string;
}

/**
 * O que a orquestração precisa dos Vínculos (porta, para não depender do
 * serviço deles: ele, por sua vez, entrega mensagens pela orquestração).
 */
export interface VinculosDoOrquestrador {
  doOrquestrador(orquestradorId: string): readonly VinculoDoOrquestrador[];
  /**
   * Executa os blocos que o Orquestrador escreveu no fim da resposta: entrega
   * as mensagens e troca as notas. `origemDoTurno` é de quem veio o pedido do
   * turno (nulo: do usuário), para contar os saltos. Devolve um aviso por
   * bloco que não valeu; nunca rejeita por causa de um bloco.
   */
  processarBlocos(
    remetenteId: string,
    blocos: { mensagens: readonly MensagemParaVinculado[]; notas: readonly NotasParaVinculo[] },
    origemDoTurno: { saltos: number } | null,
  ): Promise<string[]>;
  /**
   * Devolve a resposta final de um turno de consulta a quem consultou (natureza
   * "resposta_da_consulta"). Mesmo contrato de `processarBlocos`: devolve avisos
   * e nunca rejeita (o vínculo pode ter sido desfeito).
   */
  devolverRespostaDaConsulta(
    remetenteId: string,
    destinoId: string,
    texto: string,
    origemDoTurno: { saltos: number },
  ): Promise<string[]>;
  /** Desfaz os vínculos do Orquestrador removido. */
  removerDoOrquestrador(orquestradorId: string): Promise<void>;
}
