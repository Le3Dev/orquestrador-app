import Stripe from 'stripe';

/** Ponto unico de acesso ao Stripe (camada anticorrupcao). Unico lugar que usa o SDK. */
export interface FachadaDoStripe {
  /** Valida a assinatura do webhook e devolve o evento. Lanca erro se invalida. */
  construirEvento(corpo: string, cabecalhoDeAssinatura: string): Promise<Stripe.Event>;
  buscarAssinatura(idDaAssinatura: string): Promise<Stripe.Subscription>;
  /** null se a sessao nao existe. */
  buscarSessao(idDaSessao: string): Promise<Stripe.Checkout.Session | null>;
}

/** Versao da API do Stripe fixada (a mesma dos tipos do SDK instalado). */
export const VERSAO_DA_API_DO_STRIPE = '2026-10-28.endive';

export class FachadaDoStripeSdk implements FachadaDoStripe {
  private readonly stripe: Stripe;
  private readonly provedorDeCripto = Stripe.createSubtleCryptoProvider();

  constructor(
    chaveSecreta: string,
    private readonly segredoDoWebhook: string,
  ) {
    this.stripe = new Stripe(chaveSecreta, {
      apiVersion: VERSAO_DA_API_DO_STRIPE,
      httpClient: Stripe.createFetchHttpClient(),
    });
  }

  construirEvento(corpo: string, cabecalhoDeAssinatura: string): Promise<Stripe.Event> {
    return this.stripe.webhooks.constructEventAsync(
      corpo,
      cabecalhoDeAssinatura,
      this.segredoDoWebhook,
      undefined,
      this.provedorDeCripto,
    );
  }

  buscarAssinatura(idDaAssinatura: string): Promise<Stripe.Subscription> {
    return this.stripe.subscriptions.retrieve(idDaAssinatura);
  }

  async buscarSessao(idDaSessao: string): Promise<Stripe.Checkout.Session | null> {
    try {
      return await this.stripe.checkout.sessions.retrieve(idDaSessao);
    } catch (erro) {
      if (erro instanceof Stripe.errors.StripeInvalidRequestError && erro.code === 'resource_missing') {
        return null;
      }
      throw erro;
    }
  }
}