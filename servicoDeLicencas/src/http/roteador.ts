import { ErroDeLicenca } from '../licencas/ErroDeLicenca';
import type { ServicoDeLicencas } from '../licencas/ServicoDeLicencas';
import { ErroDeAssinaturaDoWebhook, type ServicoDeCobranca } from '../stripe/ServicoDeCobranca';

export interface DependenciasHttp {
  readonly licencas: ServicoDeLicencas;
  readonly cobranca: ServicoDeCobranca;
  readonly urlDaLanding: string;
}

const ID_DE_MAQUINA = /^[0-9a-f]{64}$/;
const ROTA_DA_SESSAO = /^\/v1\/checkout\/sessoes\/([^/]+)$/;

function json(corpo: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extra },
  });
}

function erro(status: number, motivo: string, mensagem: string, extra: Record<string, string> = {}): Response {
  return json({ erro: mensagem, motivo }, status, extra);
}

const pedidoInvalido = (mensagem = 'Pedido inválido. Confira os dados enviados.') =>
  erro(400, 'pedido-invalido', mensagem);

function ehObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

interface PedidoDeLicenca {
  chave: string;
  maquinaId: string;
  maquinaNome: string;
}

/** Valida o corpo; null se invalido (400). */
function lerPedido(corpo: unknown, exigeNome: boolean): PedidoDeLicenca | null {
  if (!ehObjeto(corpo) || typeof corpo.chave !== 'string' || !ehObjeto(corpo.maquina)) return null;
  const { id, nome } = corpo.maquina;
  if (typeof id !== 'string' || !ID_DE_MAQUINA.test(id)) return null;
  if (exigeNome && (typeof nome !== 'string' || nome.length > 80)) return null;
  return { chave: corpo.chave, maquinaId: id, maquinaNome: typeof nome === 'string' ? nome : '' };
}

function origemDaLanding(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url.replace(/\/+$/, '');
  }
}

export function criarManipulador(deps: DependenciasHttp): (pedido: Request) => Promise<Response> {
  const origemPermitida = origemDaLanding(deps.urlDaLanding);

  function cabecalhosCors(pedido: Request): Record<string, string> {
    if (pedido.headers.get('Origin') !== origemPermitida) return { Vary: 'Origin' };
    return {
      'Access-Control-Allow-Origin': origemPermitida,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
  }

  async function lerJson(pedido: Request): Promise<unknown> {
    try {
      return JSON.parse(await pedido.text());
    } catch {
      return undefined;
    }
  }

  async function rotear(pedido: Request): Promise<Response> {
    const { pathname } = new URL(pedido.url);
    const metodo = pedido.method;

    const sessao = ROTA_DA_SESSAO.exec(pathname);
    if (sessao) {
      const cors = cabecalhosCors(pedido);
      if (metodo === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      if (metodo !== 'GET') return erro(405, 'metodo-nao-permitido', 'Método não permitido.', cors);
      const resultado = await deps.cobranca.consultarSessao(decodeURIComponent(sessao[1] ?? ''));
      switch (resultado.tipo) {
        case 'pronta':
          return json({ chave: resultado.chave, plano: resultado.plano, email: resultado.email }, 200, cors);
        case 'pendente':
          return json({ pendente: true }, 202, cors);
        default:
          return erro(404, 'sessao-nao-encontrada', 'Compra não encontrada. Confira o link recebido.', cors);
      }
    }

    const rotasDeLicenca = ['/v1/licencas/ativar', '/v1/licencas/validar', '/v1/licencas/desativar'];
    if (rotasDeLicenca.includes(pathname)) {
      if (metodo !== 'POST') return erro(405, 'metodo-nao-permitido', 'Método não permitido.');
      const acao = pathname.slice('/v1/licencas/'.length);
      const pedidoLido = lerPedido(await lerJson(pedido), acao === 'ativar');
      if (!pedidoLido) return pedidoInvalido();
      try {
        if (acao === 'ativar') {
          const token = await deps.licencas.ativar(pedidoLido.chave, {
            id: pedidoLido.maquinaId,
            nome: pedidoLido.maquinaNome,
          });
          return json({ token });
        }
        if (acao === 'validar') {
          return json({ token: await deps.licencas.validar(pedidoLido.chave, pedidoLido.maquinaId) });
        }
        await deps.licencas.desativar(pedidoLido.chave, pedidoLido.maquinaId);
        return json({ ok: true });
      } catch (e) {
        if (e instanceof ErroDeLicenca) return erro(403, e.motivo, e.message);
        throw e;
      }
    }

    if (pathname === '/v1/webhooks/stripe') {
      if (metodo !== 'POST') return erro(405, 'metodo-nao-permitido', 'Método não permitido.');
      try {
        const corpo = await pedido.text();
        const resultado = await deps.cobranca.tratarWebhook(corpo, pedido.headers.get('Stripe-Signature'));
        return json({ recebido: true, resultado });
      } catch (e) {
        if (e instanceof ErroDeAssinaturaDoWebhook) return erro(400, 'assinatura-invalida', e.message);
        throw e;
      }
    }

    return erro(404, 'rota-nao-encontrada', 'Rota não encontrada.');
  }

  return async (pedido) => {
    try {
      return await rotear(pedido);
    } catch (e) {
      console.error(`[erro-interno] ${e instanceof Error ? e.message : String(e)}`);
      return erro(500, 'erro-interno', 'Erro interno. Tente novamente em instantes.', cabecalhosCors(pedido));
    }
  };
}