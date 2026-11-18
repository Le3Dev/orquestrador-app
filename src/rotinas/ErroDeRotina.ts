export type MotivoDoErroDeRotina = "dados_invalidos" | "nao_encontrado" | "conflito";

/**
 * Violação de uma regra das Rotinas. O `motivo` é o que a camada HTTP usa para
 * escolher o status da resposta (400, 404 ou 409); a mensagem já vem pronta
 * para o usuário ler.
 */
export class ErroDeRotina extends Error {
  constructor(
    public readonly motivo: MotivoDoErroDeRotina,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ErroDeRotina";
  }
}

export const MENSAGEM_DE_ROTINA_NAO_ENCONTRADA = "Rotina não encontrada.";
export const MENSAGEM_DE_EXECUCAO_NAO_ENCONTRADA = "Execução não encontrada.";

/** 20000 -> "20.000", sem depender do ICU do Node. */
export function formatarMilhares(numero: number): string {
  return String(numero).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Corta o texto no limite, deixando "…" no fim quando cortou. */
export function resumirTexto(texto: string, limite: number): string {
  return texto.length <= limite ? texto : `${texto.slice(0, limite - 1)}…`;
}
