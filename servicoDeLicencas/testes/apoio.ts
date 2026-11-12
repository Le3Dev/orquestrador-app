import type Stripe from 'stripe';
import type { EnviadorDeEmail, MensagemDeEmail } from '../src/email/EnviadorDeEmail';
import { criarManipulador } from '../src/http/roteador';
import { EmissorDeTokens } from '../src/licencas/EmissorDeTokens';
import { CARENCIA_DE_PAGAMENTO_EM_MS } from '../src/licencas/Licenca';
import { RepositorioDeEventosEmMemoria, RepositorioDeLicencasEmMemoria } from '../src/licencas/RepositorioEmMemoria';
import { ServicoDeLicencas } from '../src/licencas/ServicoDeLicencas';
import { AdaptadorDeEventosDoStripe } from '../src/stripe/AdaptadorDeEventosDoStripe';
import type { FachadaDoStripe } from '../src/stripe/FachadaDoStripe';
import { ServicoDeCobranca } from '../src/stripe/ServicoDeCobranca';

export const DIA = 24 * 60 * 60 * 1000;
export const AGORA_INICIAL = Date.UTC(2026, 10, 12, 12, 0, 0);
export const MAQUINA_A = 'a'.repeat(64);
export const MAQUINA_B = 'b'.repeat(64);
export const URL_DA_LANDING = 'https://landing.exemplo.com.br';
export const ASSINATURA_VALIDA = 'assinatura-valida';

function paraPem(rotulo: string, der: ArrayBuffer): string {
  const base64 = btoa(String.fromCharCode(...new Uint8Array(der)));
  return `-----BEGIN ${rotulo}-----\n${base64}\n-----END ${rotulo}-----`;
}

export async function gerarParDeChaves(): Promise<{ privadaPem: string; publica: CryptoKey }> {
  const par = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const der = (await crypto.subtle.exportKey('pkcs8', par.privateKey)) as ArrayBuffer;
  return { privadaPem: paraPem('PRIVATE KEY', der), publica: par.publicKey };
}

export class EnviadorDeEmailFalso implements EnviadorDeEmail {
  readonly enviados: MensagemDeEmail[] = [];
  async enviar(mensagem: MensagemDeEmail): Promise<void> {
    this.enviados.push(mensagem);
  }
}

export class FachadaFalsa implements FachadaDoStripe {
  readonly assinaturas = new Map<string, Stripe.Subscription>();
  readonly sessoes = new Map<string, Stripe.Checkout.Session>();

  async construirEvento(corpo: string, cabecalho: string): Promise<Stripe.Event> {
    if (cabecalho !== ASSINATURA_VALIDA) throw new Error('assinatura inválida');
    return JSON.parse(corpo) as Stripe.Event;
  }
  async buscarAssinatura(id: string): Promise<Stripe.Subscription> {
    const assinatura = this.assinaturas.get(id);
    if (!assinatura) throw new Error(`assinatura ${id} inexistente`);
    return assinatura;
  }
  async buscarSessao(id: string): Promise<Stripe.Checkout.Session | null> {
    return this.sessoes.get(id) ?? null;
  }
}

export function assinaturaStripe(args: {
  id?: string;
  preco?: string;
  status?: string;
  fimDoPeriodo: number; // epoch ms
}): Stripe.Subscription {
  return {
    id: args.id ?? 'sub_1',
    customer: 'cus_1',
    status: args.status ?? 'active',
    items: {
      data: [{ price: { id: args.preco ?? 'price_mensal' }, current_period_end: Math.floor(args.fimDoPeriodo / 1000) }],
    },
  } as unknown as Stripe.Subscription;
}

export function sessaoStripe(parcial: Record<string, unknown> = {}): Stripe.Checkout.Session {
  return {
    id: 'cs_1',
    mode: 'subscription',
    status: 'complete',
    payment_status: 'paid',
    subscription: 'sub_1',
    customer_details: { email: 'leandro@vaccinar.com.br' },
    ...parcial,
  } as unknown as Stripe.Checkout.Session;
}

export function eventoStripe(id: string, type: string, objeto: unknown): string {
  return JSON.stringify({ id, type, data: { object: objeto } });
}

export async function montarCenario(opcoes: { maximo?: number } = {}) {
  const { privadaPem, publica } = await gerarParDeChaves();
  const relogio = { agora: AGORA_INICIAL };
  const repositorio = new RepositorioDeLicencasEmMemoria();
  const eventos = new RepositorioDeEventosEmMemoria();
  const emails = new EnviadorDeEmailFalso();
  const fachada = new FachadaFalsa();
  const licencas = new ServicoDeLicencas({
    repositorio,
    emissor: await EmissorDeTokens.aPartirDoPem(privadaPem, CARENCIA_DE_PAGAMENTO_EM_MS),
    enviadorDeEmail: emails,
    maximoDeMaquinas: opcoes.maximo ?? 1,
    urlDeDownload: 'https://download.exemplo.com',
    urlDoPortal: 'https://portal.exemplo.com',
    agora: () => relogio.agora,
  });
  const cobranca = new ServicoDeCobranca({
    fachada,
    adaptador: new AdaptadorDeEventosDoStripe(fachada, { mensal: 'price_mensal', anual: 'price_anual' }),
    licencas,
    eventos,
    agora: () => relogio.agora,
  });
  const manipulador = criarManipulador({ licencas, cobranca, urlDaLanding: URL_DA_LANDING });

  /** Cria uma licenca via webhook de compra e devolve a chave. */
  async function comprar(fimDoPeriodo = relogio.agora + 30 * DIA, status = 'active'): Promise<string> {
    fachada.assinaturas.set('sub_1', assinaturaStripe({ fimDoPeriodo, status }));
    const resposta = await webhook(eventoStripe('evt_compra', 'checkout.session.completed', sessaoStripe()));
    if (resposta.status !== 200) throw new Error('compra falhou no cenário');
    const licenca = await repositorio.buscarPorIdDaAssinatura('sub_1');
    if (!licenca) throw new Error('licença não criada');
    return licenca.chave.valor;
  }

  function webhook(corpo: string, assinatura: string | null = ASSINATURA_VALIDA): Promise<Response> {
    const headers: Record<string, string> = {};
    if (assinatura) headers['Stripe-Signature'] = assinatura;
    return manipulador(new Request('https://x/v1/webhooks/stripe', { method: 'POST', body: corpo, headers }));
  }

  function chamar(caminho: string, corpo: unknown): Promise<Response> {
    return manipulador(
      new Request(`https://x${caminho}`, { method: 'POST', body: JSON.stringify(corpo), headers: { 'Content-Type': 'application/json' } }),
    );
  }

  return { relogio, repositorio, emails, fachada, publica, manipulador, comprar, webhook, chamar };
}

export function lerToken(token: string): { cabecalho: unknown; carga: Record<string, unknown> } {
  const [c, p] = token.split('.');
  const decodificar = (s: string | undefined): unknown =>
    JSON.parse(atob((s ?? '').replace(/-/g, '+').replace(/_/g, '/')));
  return { cabecalho: decodificar(c), carga: decodificar(p) as Record<string, unknown> };
}

export async function assinaturaConfere(token: string, publica: CryptoKey): Promise<boolean> {
  const [c, p, s] = token.split('.');
  const bytes = Uint8Array.from(atob((s ?? '').replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - ((s ?? '').length % 4)) % 4)), (x) =>
    x.charCodeAt(0),
  );
  return crypto.subtle.verify({ name: 'Ed25519' }, publica, bytes, new TextEncoder().encode(`${c}.${p}`));
}