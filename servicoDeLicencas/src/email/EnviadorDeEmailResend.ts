import type { EnviadorDeEmail, MensagemDeEmail } from './EnviadorDeEmail';

/** Adaptador Resend via fetch. Sem chave de API, apenas registra no log (sem o conteudo). */
export class EnviadorDeEmailResend implements EnviadorDeEmail {
  constructor(
    private readonly chaveDaApi: string | undefined,
    private readonly remetente: string,
    private readonly buscar: typeof fetch = fetch,
  ) {}

  async enviar(mensagem: MensagemDeEmail): Promise<void> {
    if (!this.chaveDaApi) {
      console.log(`[email] RESEND_API_KEY ausente; e-mail não enviado. Assunto: "${mensagem.assunto}"`);
      return;
    }
    const resposta = await this.buscar('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.chaveDaApi}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: this.remetente,
        to: [mensagem.para],
        subject: mensagem.assunto,
        text: mensagem.texto,
      }),
    });
    if (!resposta.ok) {
      throw new Error(`Falha ao enviar e-mail pelo Resend (HTTP ${resposta.status}).`);
    }
  }
}