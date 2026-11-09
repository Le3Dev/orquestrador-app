/**
 * Algo que o Claude propõe fazer no app a partir do chat. Objeto de valor.
 *
 * O chat nunca executa a ação sozinho: ela vira um cartão na tela e só roda
 * quando o usuário clica. As mensagens gravadas antes das ações de subagente
 * só têm `abrir_orquestrador` e continuam válidas.
 *
 * - `abrir_orquestrador`: abrir (ou criar) um Orquestrador na pasta do
 *   projeto, opcionalmente já com um pedido para ele. Sem `novo`, reaproveita
 *   um orquestrador que já existe na pasta (o indicado em `orquestrador`, ou
 *   um que esteja livre) e só cria se não houver nenhum; com `novo: true`,
 *   cria outro orquestrador no mesmo projeto. `nome` é a função sugerida
 *   para o orquestrador que for criado (ex.: "Correção da memória"); quem
 *   reaproveita um existente o ignora.
 * - `criar_subagente`: acrescentar um subagente pronto à biblioteca global.
 * - `editar_subagente`: trocar campos de um subagente pronto existente, pelo
 *   nome; os campos nulos ficam como estão.
 *
 * As duas de subagente não são conferidas aqui contra a biblioteca: a tela
 * relê a lista no clique e o servidor valida ao gravar.
 */
export type AcaoDoApp = AcaoDeAbrirOrquestrador | AcaoDeCriarSubagente | AcaoDeEditarSubagente;

export interface AcaoDeAbrirOrquestrador {
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
  /** Nome sugerido (a função dele) para o orquestrador que a ação criar; nulo usa o nome do projeto. */
  readonly nome: string | null;
}

/** Os modelos que o chat pode sugerir: os mesmos que o painel Subagentes oferece. */
export const MODELOS_DO_SUBAGENTE_NO_CHAT = ["herdar", "opus", "sonnet", "haiku"] as const;
export type ModeloDoSubagenteNoChat = (typeof MODELOS_DO_SUBAGENTE_NO_CHAT)[number];

export interface AcaoDeCriarSubagente {
  readonly tipo: "criar_subagente";
  /** Como o Orquestrador o chamará (minúsculas, números e hífen; o servidor confere). */
  readonly nome: string;
  /** Quando usar, uma linha. */
  readonly descricao: string;
  readonly prompt: string;
  /** `herdar` quando o Claude não indicou. */
  readonly modelo: ModeloDoSubagenteNoChat;
}

export interface AcaoDeEditarSubagente {
  readonly tipo: "editar_subagente";
  /** Nome de um subagente pronto existente. */
  readonly nome: string;
  /** Os campos a trocar; nulo fica como está. Pelo menos um vem preenchido. */
  readonly descricao: string | null;
  readonly prompt: string | null;
  readonly modelo: ModeloDoSubagenteNoChat | null;
}

export function abrirOrquestrador(
  projeto: string,
  pasta: string,
  pedido: string | null,
  novo = false,
  orquestrador: string | null = null,
  nome: string | null = null,
): AcaoDeAbrirOrquestrador {
  const pedidoLimpo = pedido === null ? null : pedido.trim();
  return Object.freeze({
    tipo: "abrir_orquestrador",
    projeto,
    pasta,
    pedido: pedidoLimpo === null || pedidoLimpo === "" ? null : pedidoLimpo,
    novo,
    orquestrador,
    nome,
  });
}

export function criarSubagente(
  nome: string,
  descricao: string,
  prompt: string,
  modelo: ModeloDoSubagenteNoChat = "herdar",
): AcaoDeCriarSubagente {
  return Object.freeze({ tipo: "criar_subagente", nome, descricao, prompt, modelo });
}

export function editarSubagente(
  nome: string,
  campos: { descricao?: string | null; prompt?: string | null; modelo?: ModeloDoSubagenteNoChat | null },
): AcaoDeEditarSubagente {
  return Object.freeze({
    tipo: "editar_subagente",
    nome,
    descricao: campos.descricao ?? null,
    prompt: campos.prompt ?? null,
    modelo: campos.modelo ?? null,
  });
}
