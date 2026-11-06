export type MotivoDoErroDeArtefato = "dados_invalidos" | "nao_encontrado";

/**
 * Violação de uma regra dos Artefatos. O `motivo` é o que a camada HTTP usa
 * para escolher o status da resposta; a mensagem já vem pronta para o usuário.
 */
export class ErroDeArtefato extends Error {
  constructor(
    public readonly motivo: MotivoDoErroDeArtefato,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ErroDeArtefato";
  }
}

export const MENSAGEM_DE_ARTEFATO_NAO_ENCONTRADO = "Artefato não encontrado.";
export const MENSAGEM_DE_VERSAO_NAO_ENCONTRADA = "Versão não encontrada.";
export const MENSAGEM_DE_TITULO_INVALIDO = "Título inválido.";
