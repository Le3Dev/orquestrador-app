import type { Ambiente } from './ambiente';
import { montarManipulador } from './composicao';

export default {
  async fetch(pedido: Request, env: Ambiente): Promise<Response> {
    try {
      return await (await montarManipulador(env))(pedido);
    } catch (e) {
      console.error(`[erro-interno] ${e instanceof Error ? e.message : String(e)}`);
      return new Response(
        JSON.stringify({ erro: 'Erro interno. Tente novamente em instantes.', motivo: 'erro-interno' }),
        { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' } },
      );
    }
  },
} satisfies ExportedHandler<Ambiente>;