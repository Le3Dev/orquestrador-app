import type { RepositorioDeEventosProcessados } from '../licencas/RepositorioDeLicencas';
import type { ServicoDeLicencas } from '../licencas/ServicoDeLicencas';
import type { Plano } from '../licencas/Plano';
import { mascararEmail } from '../email/mensagemDaChave';
import type { AdaptadorDeEventosDoStripe } from './AdaptadorDeEventosDoStripe';
import type { FachadaDoStripe } from './FachadaDoStripe';

export class ErroDeAssinaturaDoWebhook extends Error {
  constructor() {
    super('Assinatura do webhook inválida.');
    this.name = 'ErroDeAssinaturaDoWebhook';
  }
}

export type ResultadoDaSessao =
  | { tipo: 'pronta'; chave: string; plano: Plano; email: string }
  | { tipo: 'pendente' }
  | { tipo: 'nao-encontrada' };

export interface DependenciasDoServicoDeCobranca {
  readonly fachada: FachadaDoStripe;
  readonly adaptador: AdaptadorDeEventosDoStripe;
  readonly licencas: ServicoDeLicencas;
  readonly eventos: RepositorioDeEventosProcessados;
  readonly agora: () => number;
}

export class ServicoDeCobranca {
  constructor(private readonly d: DependenciasDoServicoDeCobranca) {}

  async tratarWebhook(corpo: string, cabecalho: string | null): Promise<'processado' | 'repetido'> {
    if (!cabecalho) throw new ErroDeAssinaturaDoWebhook();
    let evento;
    try {
      evento = await this.d.fachada.construirEvento(corpo, cabecalho);
    } catch {
      throw new ErroDeAssinaturaDoWebhook();
    }
    if (await this.d.eventos.jaProcessado(evento.id)) return 'repetido';

    const notificacao = await this.d.adaptador.converterEvento(evento);
    if (notificacao) {
      await this.d.licencas.sincronizarAssinatura(notificacao.assinatura, notificacao.email);
    }
    // Registrado so apos o sucesso: se falhar, o Stripe reenvia e a criacao e idempotente.
    await this.d.eventos.registrar(evento.id, this.d.agora());
    return 'processado';
  }

  async consultarSessao(idDaSessao: string): Promise<ResultadoDaSessao> {
    const bruta = await this.d.fachada.buscarSessao(idDaSessao);
    if (!bruta) return { tipo: 'nao-encontrada' };
    const sessao = this.d.adaptador.converterSessao(bruta);
    if (!sessao.paga || !sessao.idDaAssinatura) return { tipo: 'pendente' };

    let licenca = await this.d.licencas.buscarPorIdDaAssinatura(sessao.idDaAssinatura);
    if (!licenca) {
      // O webhook ainda nao chegou: cria agora (idempotente pelo id da assinatura).
      const assinatura = this.d.adaptador.converterAssinatura(
        await this.d.fachada.buscarAssinatura(sessao.idDaAssinatura),
      );
      if (!assinatura) throw new Error('Assinatura comprada com preço desconhecido.');
      const resultado = await this.d.licencas.sincronizarAssinatura(assinatura, sessao.email);
      licenca = resultado?.licenca ?? null;
    }
    if (!licenca) return { tipo: 'pendente' };
    return { tipo: 'pronta', chave: licenca.chave.valor, plano: licenca.plano, email: mascararEmail(licenca.email) };
  }
}