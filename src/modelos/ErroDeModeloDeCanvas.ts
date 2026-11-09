export type MotivoDoErroDeModeloDeCanvas = "dados_invalidos" | "nao_encontrado" | "limite_atingido";

/**
 * Violação de uma regra dos Modelos de canvas. O `motivo` é o que a camada
 * HTTP usa para escolher o status; a mensagem já vem pronta para o usuário.
 */
export class ErroDeModeloDeCanvas extends Error {
  constructor(
    public readonly motivo: MotivoDoErroDeModeloDeCanvas,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ErroDeModeloDeCanvas";
  }
}
