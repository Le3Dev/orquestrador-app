export type MotivoDeRecusa =
  | 'chave-invalida'
  | 'assinatura-inativa'
  | 'limite-de-maquinas'
  | 'maquina-nao-ativada';

const MENSAGENS: Record<MotivoDeRecusa, string> = {
  'chave-invalida': 'Chave de licença inválida. Confira se digitou a chave exatamente como recebida por e-mail.',
  'assinatura-inativa': 'A assinatura desta licença não está ativa. Renove pelo portal do cliente para continuar usando.',
  'limite-de-maquinas':
    'Esta licença já está ativada no número máximo de computadores. Desative-a em outro computador e tente novamente.',
  'maquina-nao-ativada': 'Este computador não está ativado para esta licença. Ative-o novamente.',
};

/** Recusa de negocio (vira HTTP 403). */
export class ErroDeLicenca extends Error {
  readonly motivo: MotivoDeRecusa;

  constructor(motivo: MotivoDeRecusa) {
    super(MENSAGENS[motivo]);
    this.name = 'ErroDeLicenca';
    this.motivo = motivo;
  }
}