export type MotivoDoErroDoChat = "dados_invalidos" | "em_andamento" | "sem_resposta_em_andamento";

/**
 * Violação de uma regra do chat. O `motivo` é o que a camada HTTP usa para
 * escolher o status da resposta; a mensagem já vem pronta para o usuário ler.
 */
export class ErroDoChat extends Error {
  constructor(
    public readonly motivo: MotivoDoErroDoChat,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ErroDoChat";
  }
}
