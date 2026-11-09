export type MotivoDoErroDeEscuta = "dados_invalidos" | "falha_do_motor" | "cancelada";

/**
 * Falha ao classificar um trecho da escuta. O `motivo` é o que a camada HTTP
 * usa para escolher o status da resposta; a mensagem já vem pronta para o
 * usuário ler.
 */
export class ErroDeEscuta extends Error {
  constructor(
    public readonly motivo: MotivoDoErroDeEscuta,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ErroDeEscuta";
  }
}
