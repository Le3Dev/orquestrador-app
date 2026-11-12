export interface MensagemDeEmail {
  readonly para: string;
  readonly assunto: string;
  readonly texto: string;
}

/** Porta de envio de e-mail. */
export interface EnviadorDeEmail {
  enviar(mensagem: MensagemDeEmail): Promise<void>;
}