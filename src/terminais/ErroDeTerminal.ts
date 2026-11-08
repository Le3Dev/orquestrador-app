export type MotivoDoErroDeTerminal = "dados_invalidos" | "nao_encontrado" | "limite_atingido";

/**
 * Violação de uma regra dos terminais. O `motivo` é o que a camada HTTP usa
 * para escolher o status; a mensagem já vem pronta para o usuário ler.
 */
export class ErroDeTerminal extends Error {
  constructor(
    public readonly motivo: MotivoDoErroDeTerminal,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ErroDeTerminal";
  }
}

export const MENSAGEM_DE_TERMINAL_NAO_ENCONTRADO = "Terminal não encontrado. Ele pode ter sido fechado.";
