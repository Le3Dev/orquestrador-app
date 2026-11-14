export type MotivoDoErroDeVinculo = "dados_invalidos" | "nao_encontrado" | "ja_vinculados";

/**
 * Violação de uma regra dos Vínculos. O `motivo` é o que a camada HTTP usa
 * para escolher o status da resposta; a mensagem já vem pronta para o usuário.
 */
export class ErroDeVinculo extends Error {
  constructor(
    public readonly motivo: MotivoDoErroDeVinculo,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ErroDeVinculo";
  }
}
