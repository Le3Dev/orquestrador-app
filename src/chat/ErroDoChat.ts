export type MotivoDoErroDoChat =
  | "dados_invalidos"
  | "em_andamento"
  | "sem_resposta_em_andamento"
  /** Pausar uma resposta que já está pausada. */
  | "ja_pausada"
  /** Continuar uma resposta que não está pausada. */
  | "sem_pausa"
  /** Não há processo para congelar (ainda não abriu, já terminou, ou Windows). */
  | "pausa_indisponivel";

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
