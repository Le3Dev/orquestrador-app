export type MotivoDoErroDeMelhoriaDePrompt = "dados_invalidos" | "falha_do_motor" | "cancelada";

/**
 * Falha ao melhorar um pedido. O `motivo` é o que a camada HTTP usa para
 * escolher o status da resposta; a mensagem já vem pronta para o usuário ler.
 */
export class ErroDeMelhoriaDePrompt extends Error {
  constructor(
    public readonly motivo: MotivoDoErroDeMelhoriaDePrompt,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ErroDeMelhoriaDePrompt";
  }
}
