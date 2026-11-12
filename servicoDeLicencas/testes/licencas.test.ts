import { describe, expect, it } from 'vitest';
import { ChaveDeLicenca } from '../src/licencas/ChaveDeLicenca';
import { CARENCIA_DE_PAGAMENTO_EM_MS } from '../src/licencas/Licenca';
import { DIA, MAQUINA_A, MAQUINA_B, assinaturaConfere, lerToken, montarCenario } from './apoio';

interface Corpo {
  token?: string;
  ok?: boolean;
  motivo?: string;
  erro?: string;
}

async function corpoDe(resposta: Response): Promise<Corpo> {
  return (await resposta.json()) as Corpo;
}

const maquina = (id: string) => ({ id, nome: `PC ${id.slice(0, 1)}` });

describe('ChaveDeLicenca', () => {
  it('gera no formato ORQ-XXXX-XXXX-XXXX-XXXX sem caracteres ambíguos', () => {
    for (let i = 0; i < 50; i++) {
      const chave = ChaveDeLicenca.gerar().valor;
      expect(chave).toMatch(/^ORQ(-[A-HJ-NP-Z2-9]{4}){4}$/);
      expect(ChaveDeLicenca.interpretar(chave.toLowerCase())?.valor).toBe(chave);
    }
  });
});

describe('ativar / validar / desativar', () => {
  it('ativa com chave válida e emite token assinado com o payload certo', async () => {
    const c = await montarCenario();
    const chave = await c.comprar();
    const resposta = await c.chamar('/v1/licencas/ativar', { chave, maquina: maquina(MAQUINA_A) });
    expect(resposta.status).toBe(200);
    const { token } = await corpoDe(resposta);
    expect(token).toBeDefined();
    expect(token).not.toContain('=');
    expect(await assinaturaConfere(token ?? '', c.publica)).toBe(true);

    const { cabecalho, carga } = lerToken(token ?? '');
    const licenca = await c.repositorio.buscarPorChave(ChaveDeLicenca.reconstituir(chave));
    expect(cabecalho).toEqual({ alg: 'EdDSA', typ: 'JWT' });
    expect(carga).toEqual({
      v: 1,
      licenca: licenca?.id,
      maquina: MAQUINA_A,
      plano: 'mensal',
      pagaAte: licenca?.pagaAte,
      emitidoEm: c.relogio.agora,
      expiraEm: c.relogio.agora + 7 * DIA,
    });
    expect(carga.licenca).not.toBe(chave);
  });

  it('token adulterado não confere com a chave pública', async () => {
    const c = await montarCenario();
    const chave = await c.comprar();
    const { token } = await corpoDe(await c.chamar('/v1/licencas/ativar', { chave, maquina: maquina(MAQUINA_A) }));
    const [h, , s] = (token ?? '').split('.');
    const outraCarga = btoa(JSON.stringify({ v: 1 })).replace(/=+$/, '');
    expect(await assinaturaConfere(`${h}.${outraCarga}.${s}`, c.publica)).toBe(false);
  });

  it('expiraEm usa pagaAte + carência quando for menor que 7 dias', async () => {
    const c = await montarCenario();
    const fim = c.relogio.agora + 2 * DIA;
    const chave = await c.comprar(fim);
    const { token } = await corpoDe(await c.chamar('/v1/licencas/ativar', { chave, maquina: maquina(MAQUINA_A) }));
    expect(lerToken(token ?? '').carga.expiraEm).toBe(Math.floor(fim / 1000) * 1000 + CARENCIA_DE_PAGAMENTO_EM_MS);
  });

  it('é idempotente para a mesma máquina', async () => {
    const c = await montarCenario();
    const chave = await c.comprar();
    expect((await c.chamar('/v1/licencas/ativar', { chave, maquina: maquina(MAQUINA_A) })).status).toBe(200);
    c.relogio.agora += 1000;
    const segunda = await c.chamar('/v1/licencas/ativar', { chave, maquina: maquina(MAQUINA_A) });
    expect(segunda.status).toBe(200);
    expect((await c.repositorio.todas()[0])?.maquinas).toHaveLength(1);
  });

  it('recusa segunda máquina com limite 1 e libera após desativar', async () => {
    const c = await montarCenario();
    const chave = await c.comprar();
    await c.chamar('/v1/licencas/ativar', { chave, maquina: maquina(MAQUINA_A) });
    const recusada = await c.chamar('/v1/licencas/ativar', { chave, maquina: maquina(MAQUINA_B) });
    expect(recusada.status).toBe(403);
    expect((await corpoDe(recusada)).motivo).toBe('limite-de-maquinas');

    const desativada = await c.chamar('/v1/licencas/desativar', { chave, maquina: { id: MAQUINA_A } });
    expect(await corpoDe(desativada)).toEqual({ ok: true });
    expect((await c.chamar('/v1/licencas/desativar', { chave, maquina: { id: MAQUINA_A } })).status).toBe(200);

    expect((await c.chamar('/v1/licencas/ativar', { chave, maquina: maquina(MAQUINA_B) })).status).toBe(200);
  });

  it('respeita MAXIMO_DE_MAQUINAS maior que 1', async () => {
    const c = await montarCenario({ maximo: 2 });
    const chave = await c.comprar();
    expect((await c.chamar('/v1/licencas/ativar', { chave, maquina: maquina(MAQUINA_A) })).status).toBe(200);
    expect((await c.chamar('/v1/licencas/ativar', { chave, maquina: maquina(MAQUINA_B) })).status).toBe(200);
  });

  it('validar: máquina não ativada e chave inválida', async () => {
    const c = await montarCenario();
    const chave = await c.comprar();
    const naoAtivada = await c.chamar('/v1/licencas/validar', { chave, maquina: { id: MAQUINA_A } });
    expect(naoAtivada.status).toBe(403);
    expect((await corpoDe(naoAtivada)).motivo).toBe('maquina-nao-ativada');

    const invalida = await c.chamar('/v1/licencas/validar', { chave: 'ORQ-AAAA-AAAA-AAAA-AAAA', maquina: { id: MAQUINA_A } });
    expect((await corpoDe(invalida)).motivo).toBe('chave-invalida');
    const desativar = await c.chamar('/v1/licencas/desativar', { chave: 'lixo', maquina: { id: MAQUINA_A } });
    expect(desativar.status).toBe(403);
  });

  it('validar devolve token novo para máquina ativada', async () => {
    const c = await montarCenario();
    const chave = await c.comprar();
    await c.chamar('/v1/licencas/ativar', { chave, maquina: maquina(MAQUINA_A) });
    c.relogio.agora += DIA;
    const { token } = await corpoDe(await c.chamar('/v1/licencas/validar', { chave, maquina: { id: MAQUINA_A } }));
    expect(lerToken(token ?? '').carga.emitidoEm).toBe(c.relogio.agora);
  });

  it('pedido malformado retorna 400 pedido-invalido', async () => {
    const c = await montarCenario();
    const r1 = await c.chamar('/v1/licencas/ativar', { chave: 'x', maquina: { id: 'curto', nome: 'PC' } });
    expect(r1.status).toBe(400);
    expect((await corpoDe(r1)).motivo).toBe('pedido-invalido');
    const r2 = await c.chamar('/v1/licencas/ativar', { chave: 'x', maquina: { id: MAQUINA_A, nome: 'n'.repeat(81) } });
    expect(r2.status).toBe(400);
  });

  it('assinatura cancelada → assinatura-inativa', async () => {
    const c = await montarCenario();
    const chave = await c.comprar();
    await c.webhook(JSON.stringify({ id: 'evt_del', type: 'customer.subscription.deleted', data: { object: c.fachada.assinaturas.get('sub_1') } }));
    const r = await c.chamar('/v1/licencas/ativar', { chave, maquina: maquina(MAQUINA_A) });
    expect(r.status).toBe(403);
    expect((await corpoDe(r)).motivo).toBe('assinatura-inativa');
  });

  it('pagamento atrasado: aceita dentro da carência e recusa fora dela', async () => {
    const c = await montarCenario();
    const fim = c.relogio.agora + DIA;
    const chave = await c.comprar(fim, 'past_due');
    const licenca = c.repositorio.todas()[0];
    expect(licenca?.situacao).toBe('atrasada');

    c.relogio.agora = (licenca?.pagaAte ?? 0) + 2 * DIA;
    expect((await c.chamar('/v1/licencas/ativar', { chave, maquina: maquina(MAQUINA_A) })).status).toBe(200);

    c.relogio.agora = (licenca?.pagaAte ?? 0) + CARENCIA_DE_PAGAMENTO_EM_MS + 1000;
    const fora = await c.chamar('/v1/licencas/validar', { chave, maquina: { id: MAQUINA_A } });
    expect(fora.status).toBe(403);
    expect((await corpoDe(fora)).motivo).toBe('assinatura-inativa');
  });
});