/**
 * Algo que o Claude propõe fazer no app a partir do chat. Objeto de valor.
 *
 * O chat nunca executa a ação sozinho: ela vira um cartão na tela e só roda
 * quando o usuário clica.
 *
 * - `abrir_orquestrador`: abrir (ou criar) um Orquestrador na pasta do
 *   projeto, opcionalmente já com um pedido para ele. Sem `novo`, reaproveita
 *   um orquestrador que já existe na pasta (o indicado em `orquestrador`, ou
 *   um que esteja livre) e só cria se não houver nenhum; com `novo: true`,
 *   cria outro orquestrador no mesmo projeto.
 */
export interface AcaoDoApp {
  readonly tipo: "abrir_orquestrador";
  /** Nome da pasta do projeto, como aparece na pasta raiz. */
  readonly projeto: string;
  /** Caminho absoluto da pasta do projeto, resolvido pelo servidor. */
  readonly pasta: string;
  readonly pedido: string | null;
  /** Se cria outro orquestrador no projeto em vez de reaproveitar o existente. */
  readonly novo: boolean;
  /**
   * Nome de um orquestrador existente do projeto que o Claude escolheu para o
   * pedido, já conferido pelo servidor; nulo para a tela escolher.
   */
  readonly orquestrador: string | null;
}

export function abrirOrquestrador(
  projeto: string,
  pasta: string,
  pedido: string | null,
  novo = false,
  orquestrador: string | null = null,
): AcaoDoApp {
  const pedidoLimpo = pedido === null ? null : pedido.trim();
  return Object.freeze({
    tipo: "abrir_orquestrador",
    projeto,
    pasta,
    pedido: pedidoLimpo === null || pedidoLimpo === "" ? null : pedidoLimpo,
    novo,
    orquestrador,
  });
}
