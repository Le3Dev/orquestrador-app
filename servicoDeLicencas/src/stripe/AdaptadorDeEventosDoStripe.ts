import type Stripe from 'stripe';
import type { DadosDaAssinatura, SituacaoDaAssinatura } from '../licencas/DadosDaAssinatura';
import type { Plano } from '../licencas/Plano';
import type { FachadaDoStripe } from './FachadaDoStripe';

/** Evento de cobranca na linguagem do dominio. */
export interface NotificacaoDeAssinatura {
  readonly idDoEvento: string;
  readonly assinatura: DadosDaAssinatura;
  /** Presente so na compra concluida: autoriza criar a licenca. */
  readonly email: string | null;
}

export interface SessaoDeCompra {
  readonly paga: boolean;
  readonly idDaAssinatura: string | null;
  readonly email: string | null;
}

export interface PrecosDosPlanos {
  readonly mensal: string;
  readonly anual: string;
}

type ReferenciaStripe = string | { id: string } | null | undefined;

function idDe(referencia: ReferenciaStripe): string | null {
  if (!referencia) return null;
  return typeof referencia === 'string' ? referencia : referencia.id;
}

const SITUACOES: Record<string, SituacaoDaAssinatura> = {
  active: 'ativa',
  trialing: 'em-teste',
  past_due: 'atrasada',
  unpaid: 'atrasada',
  canceled: 'cancelada',
  incomplete_expired: 'cancelada',
  incomplete: 'expirada',
  paused: 'expirada',
};

/** Converte tipos do Stripe para o dominio. */
export class AdaptadorDeEventosDoStripe {
  constructor(
    private readonly fachada: FachadaDoStripe,
    private readonly precos: PrecosDosPlanos,
  ) {}

  /** null = evento irrelevante para licencas (ignorar). */
  async converterEvento(evento: Stripe.Event): Promise<NotificacaoDeAssinatura | null> {
    switch (evento.type) {
      case 'checkout.session.completed': {
        const sessao = evento.data.object;
        const idDaAssinatura = idDe(sessao.subscription);
        if (sessao.mode !== 'subscription' || sessao.payment_status === 'unpaid' || !idDaAssinatura) return null;
        const email = sessao.customer_details?.email ?? sessao.customer_email;
        if (!email) throw new Error('Sessão de compra sem e-mail do cliente.');
        const assinatura = this.converterAssinatura(await this.fachada.buscarAssinatura(idDaAssinatura));
        if (!assinatura) throw new Error('Assinatura comprada com preço desconhecido (confira PRECO_MENSAL_ID e PRECO_ANUAL_ID).');
        return { idDoEvento: evento.id, assinatura, email };
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const assinatura = this.converterAssinatura(evento.data.object);
        return assinatura ? { idDoEvento: evento.id, assinatura, email: null } : null;
      }
      case 'customer.subscription.deleted': {
        const assinatura = this.converterAssinatura(evento.data.object);
        return assinatura
          ? { idDoEvento: evento.id, assinatura: { ...assinatura, situacao: 'cancelada' }, email: null }
          : null;
      }
      case 'invoice.paid':
      case 'invoice.payment_failed': {
        const idDaAssinatura = idDe(evento.data.object.parent?.subscription_details?.subscription);
        if (!idDaAssinatura) return null;
        const atual = this.converterAssinatura(await this.fachada.buscarAssinatura(idDaAssinatura));
        if (!atual) return null;
        const falhou = evento.type === 'invoice.payment_failed';
        const assinatura: DadosDaAssinatura =
          falhou && (atual.situacao === 'ativa' || atual.situacao === 'em-teste')
            ? { ...atual, situacao: 'atrasada' }
            : atual;
        return { idDoEvento: evento.id, assinatura, email: null };
      }
      default:
        return null;
    }
  }

  converterSessao(sessao: Stripe.Checkout.Session): SessaoDeCompra {
    const idDaAssinatura = idDe(sessao.subscription);
    const confirmada = sessao.status === 'complete' && sessao.payment_status !== 'unpaid';
    return {
      paga: sessao.mode === 'subscription' && confirmada && idDaAssinatura !== null,
      idDaAssinatura,
      email: sessao.customer_details?.email ?? sessao.customer_email ?? null,
    };
  }

  /**
   * No Stripe atual o fim do periodo fica nos itens (`items.data[].current_period_end`),
   * nao mais na Subscription. Usa o maior valor entre os itens.
   * null se o preco nao corresponde a nenhum plano.
   */
  converterAssinatura(s: Stripe.Subscription): DadosDaAssinatura | null {
    const itens = s.items.data;
    const plano = this.planoDoPreco(itens[0]?.price.id);
    if (!plano) return null;
    const fimDoPeriodo = Math.max(0, ...itens.map((i) => i.current_period_end));
    return {
      idDaAssinatura: s.id,
      idDoCliente: idDe(s.customer) ?? '',
      plano,
      situacao: SITUACOES[s.status] ?? 'expirada',
      pagaAte: fimDoPeriodo * 1000,
    };
  }

  private planoDoPreco(idDoPreco: string | undefined): Plano | null {
    if (idDoPreco === this.precos.mensal) return 'mensal';
    if (idDoPreco === this.precos.anual) return 'anual';
    return null;
  }
}