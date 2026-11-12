import type { Plano } from './Plano';

export type SituacaoDaAssinatura = 'ativa' | 'em-teste' | 'atrasada' | 'cancelada' | 'expirada';

/** Objeto de valor: retrato da assinatura, na linguagem do dominio (sem tipos do Stripe). */
export interface DadosDaAssinatura {
  readonly idDaAssinatura: string;
  readonly idDoCliente: string;
  readonly plano: Plano;
  readonly situacao: SituacaoDaAssinatura;
  /** Fim do periodo pago, em epoch ms. */
  readonly pagaAte: number;
}