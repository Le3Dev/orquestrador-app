export type MotivoDoErro =
  | "dados_invalidos"
  | "nao_encontrado"
  | "turno_em_andamento"
  | "sem_turno_em_andamento";

/**
 * Violação de uma regra do domínio. O `motivo` é o que a camada HTTP usa para
 * escolher o status da resposta; a mensagem já vem pronta para o usuário ler.
 */
export class ErroDeOrquestracao extends Error {
  constructor(
    public readonly motivo: MotivoDoErro,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ErroDeOrquestracao";
  }
}
