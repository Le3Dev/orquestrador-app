export type MotivoDoErroDeNota = "dados_invalidos" | "nao_encontrada";

/**
 * Violação de uma regra das Notas. O `motivo` é o que a camada HTTP usa para
 * escolher o status da resposta; a mensagem já vem pronta para o usuário ler.
 */
export class ErroDeNota extends Error {
  constructor(
    public readonly motivo: MotivoDoErroDeNota,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ErroDeNota";
  }
}
