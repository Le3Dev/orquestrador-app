import { describe, expect, it } from 'vitest';
import { mascararEmail } from '../src/email/mensagemDaChave';
import { EnviadorDeEmailResend } from '../src/email/EnviadorDeEmailResend';
import { DIA, URL_DA_LANDING, assinaturaStripe, eventoStripe, montarCenario, sessaoStripe } from './apoio';

describe('webhook do Stripe', () => {
  it('assinatura inválida → 400', async () => {
    const c = await montarCenario();
    const r = await c.webhook(eventoStripe('evt_1', 'invoice.paid', {}), 'falsa');
    expect(r.status).toBe(400);
    expect(((await r.json()) as { motivo: string }).motivo).toBe('assinatura-invalida');
    expect((await c.webhook('{}', null)).status).toBe(400);
  });

  it('checkout.session.completed cria a licença e envia o e-mail com a chave', async () => {
    const c = await montarCenario();
    const chave = await c.comprar();
    expect(c.repositorio.todas()).toHaveLength(1);
    expect(c.emails.enviados).toHaveLength(1);
    const email = c.emails.enviados[0];
    expect(email?.para).toBe('leandro@vaccinar.com.br');
    expect(email?.texto).toContain(chave);
    expect(email?.texto).toContain('https://download.exemplo.com');
    expect(email?.texto).toContain('https://portal.exemplo.com');
  });

  it('plano anual é identificado pelo id do preço e pagaAte vem dos itens', async () => {
    const c = await montarCenario();
    const fim = c.relogio.agora + 365 * DIA;
    c.fachada.assinaturas.set('sub_1', assinaturaStripe({ preco: 'price_anual', fimDoPeriodo: fim }));
    await c.webhook(eventoStripe('evt_1', 'checkout.session.completed', sessaoStripe()));
    const licenca = c.repositorio.todas()[0];
    expect(licenca?.plano).toBe('anual');
    expect(licenca?.pagaAte).toBe(Math.floor(fim / 1000) * 1000);
  });

  it('webhook repetido é ignorado (uma licença, um e-mail)', async () => {
    const c = await montarCenario();
    await c.comprar();
    const corpo = eventoStripe('evt_compra', 'checkout.session.completed', sessaoStripe());
    const r = await c.webhook(corpo);
    expect(((await r.json()) as { resultado: string }).resultado).toBe('repetido');
    expect(c.repositorio.todas()).toHaveLength(1);
    expect(c.emails.enviados).toHaveLength(1);
  });

  it('falha no e-mail não falha a compra', async () => {
    const c = await montarCenario();
    c.emails.enviar = async () => {
      throw new Error('resend fora do ar');
    };
    await c.comprar();
    expect(c.repositorio.todas()).toHaveLength(1);
  });

  it('subscription.updated renova pagaAte; invoice.payment_failed marca atrasada; invoice.paid reativa', async () => {
    const c = await montarCenario();
    await c.comprar();
    const novoFim = c.relogio.agora + 60 * DIA;
    const renovada = assinaturaStripe({ fimDoPeriodo: novoFim });
    await c.webhook(eventoStripe('evt_up', 'customer.subscription.updated', renovada));
    expect(c.repositorio.todas()[0]?.pagaAte).toBe(Math.floor(novoFim / 1000) * 1000);

    c.fachada.assinaturas.set('sub_1', assinaturaStripe({ fimDoPeriodo: novoFim }));
    const fatura = { parent: { subscription_details: { subscription: 'sub_1' } } };
    await c.webhook(eventoStripe('evt_pf', 'invoice.payment_failed', fatura));
    expect(c.repositorio.todas()[0]?.situacao).toBe('atrasada');
    await c.webhook(eventoStripe('evt_ip', 'invoice.paid', fatura));
    expect(c.repositorio.todas()[0]?.situacao).toBe('ativa');
  });

  it('eventos de assinatura sem licença e preço desconhecido são ignorados', async () => {
    const c = await montarCenario();
    const r = await c.webhook(eventoStripe('evt_x', 'customer.subscription.updated', assinaturaStripe({ preco: 'price_outro', fimDoPeriodo: c.relogio.agora })));
    expect(r.status).toBe(200);
    expect(c.repositorio.todas()).toHaveLength(0);
  });
});

describe('GET /v1/checkout/sessoes/:id', () => {
  const pedir = (c: Awaited<ReturnType<typeof montarCenario>>, id: string, origem?: string) =>
    c.manipulador(new Request(`https://x/v1/checkout/sessoes/${id}`, { headers: origem ? { Origin: origem } : {} }));

  it('200 com chave, plano e e-mail mascarado (com CORS da landing)', async () => {
    const c = await montarCenario();
    const chave = await c.comprar();
    c.fachada.sessoes.set('cs_1', sessaoStripe());
    const r = await pedir(c, 'cs_1', URL_DA_LANDING);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ chave, plano: 'mensal', email: 'l***@v***.com.br' });
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe(URL_DA_LANDING);
  });

  it('não libera CORS para outra origem', async () => {
    const c = await montarCenario();
    c.fachada.sessoes.set('cs_1', sessaoStripe({ status: 'open', payment_status: 'unpaid' }));
    const r = await pedir(c, 'cs_1', 'https://malicioso.com');
    expect(r.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('cria a licença na hora se o webhook ainda não chegou (sem duplicar depois)', async () => {
    const c = await montarCenario();
    c.fachada.assinaturas.set('sub_1', assinaturaStripe({ fimDoPeriodo: c.relogio.agora + 30 * DIA }));
    c.fachada.sessoes.set('cs_1', sessaoStripe());
    const r = await pedir(c, 'cs_1');
    expect(r.status).toBe(200);
    expect(c.repositorio.todas()).toHaveLength(1);
    await pedir(c, 'cs_1');
    await c.webhook(eventoStripe('evt_1', 'checkout.session.completed', sessaoStripe()));
    expect(c.repositorio.todas()).toHaveLength(1);
  });

  it('202 pendente se não paga e 404 se não existe', async () => {
    const c = await montarCenario();
    c.fachada.sessoes.set('cs_1', sessaoStripe({ status: 'open', payment_status: 'unpaid' }));
    const pendente = await pedir(c, 'cs_1');
    expect(pendente.status).toBe(202);
    expect(await pendente.json()).toEqual({ pendente: true });
    const ausente = await pedir(c, 'cs_nao_existe');
    expect(ausente.status).toBe(404);
    expect(((await ausente.json()) as { motivo: string }).motivo).toBe('sessao-nao-encontrada');
  });

  it('responde o preflight OPTIONS', async () => {
    const c = await montarCenario();
    const r = await c.manipulador(
      new Request('https://x/v1/checkout/sessoes/cs_1', { method: 'OPTIONS', headers: { Origin: URL_DA_LANDING } }),
    );
    expect(r.status).toBe(204);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe(URL_DA_LANDING);
    expect(r.headers.get('Access-Control-Allow-Methods')).toContain('GET');
  });

  it('erro interno vira 500 sem vazar detalhes', async () => {
    const c = await montarCenario();
    c.fachada.buscarSessao = async () => {
      throw new Error('segredo interno');
    };
    const r = await pedir(c, 'cs_1');
    expect(r.status).toBe(500);
    const corpo = (await r.json()) as { motivo: string; erro: string };
    expect(corpo.motivo).toBe('erro-interno');
    expect(corpo.erro).not.toContain('segredo');
  });
});

describe('e-mail', () => {
  it('mascara o e-mail', () => {
    expect(mascararEmail('leandro@vaccinar.com.br')).toBe('l***@v***.com.br');
    expect(mascararEmail('a@b.com')).toBe('a***@b***.com');
  });

  it('Resend: sem chave só registra; com chave faz POST', async () => {
    const chamadas: { url: string; init: RequestInit | undefined }[] = [];
    const falso = (async (url: string, init?: RequestInit) => {
      chamadas.push({ url, init });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const mensagem = { para: 'a@b.com', assunto: 'Oi', texto: 'texto' };
    await new EnviadorDeEmailResend(undefined, 'x@y.com', falso).enviar(mensagem);
    expect(chamadas).toHaveLength(0);
    await new EnviadorDeEmailResend('re_chave', 'x@y.com', falso).enviar(mensagem);
    expect(chamadas[0]?.url).toBe('https://api.resend.com/emails');
  });
});