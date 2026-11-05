/**
 * Algo que o Claude propõe fazer no app a partir do chat. Objeto de valor.
 *
 * O chat nunca executa a ação sozinho: ela vira um cartão na tela e só roda
 * quando o usuário clica.
 *
 * - `abrir_orquestrador`: abrir (ou criar) um Orquestrador na pasta do
 *   projeto, opcionalmente já com um pedido para ele.
 */
export interface AcaoDoApp {
  readonly tipo: "abrir_orquestrador";
  /** Nome da pasta do projeto, como aparece na pasta raiz. */
  readonly projeto: string;
  /** Caminho absoluto da pasta do projeto, resolvido pelo servidor. */
  readonly pasta: string;
  readonly pedido: string | null;
}

export function abrirOrquestrador(projeto: string, pasta: string, pedido: string | null): AcaoDoApp {
  const pedidoLimpo = pedido === null ? null : pedido.trim();
  return Object.freeze({
    tipo: "abrir_orquestrador",
    projeto,
    pasta,
    pedido: pedidoLimpo === null || pedidoLimpo === "" ? null : pedidoLimpo,
  });
}
