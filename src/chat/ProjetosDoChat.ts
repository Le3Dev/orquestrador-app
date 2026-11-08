/** Uma pasta de projeto dentro da pasta raiz. */
export interface ProjetoDoChat {
  /** Nome da pasta, como o usuário e o Claude se referem a ela. */
  nome: string;
  caminho: string;
}

/**
 * Um Orquestrador que já existe no app, como o chat o enxerga: o bastante
 * para o Claude saber quem está livre antes de sugerir para onde vai um pedido.
 */
export interface OrquestradorExistente {
  nome: string;
  pasta: string;
  situacao: "ocioso" | "trabalhando";
  /** O texto do pedido em andamento (o bloco de contexto corta em 100 caracteres); nulo quando ocioso. */
  pedidoAtual: string | null;
  /** Quando o pedido em andamento começou; nulo quando ocioso. */
  turnoIniciadoEm: Date | null;
  /** Quantos pedidos esperam na fila. */
  tamanhoDaFila: number;
  /** O último pedido terminou com um Plano à espera da aprovação do usuário. */
  planoPendente: boolean;
  /** A branch do worktree isolado, ou nulo quando não há worktree. */
  branch: string | null;
  /**
   * Se o worktree tem alterações sem commit. Aproximado, sem rodar git: o fim
   * de cada turno remove o worktree limpo, então um worktree que ficou com o
   * orquestrador parado tem trabalho. Durante um turno é desconhecido (nulo).
   */
  alteracoesSemCommit: boolean | null;
}

/**
 * O que o chat precisa saber do resto do app para contextualizar o Claude e
 * validar as ações que ele propõe.
 *
 * Porta: o contexto `chat` não conhece o agregado `Orquestrador` nem o
 * sistema de arquivos — quem traduz é o adaptador montado em `root.ts`.
 */
export interface ProjetosDoChat {
  listarProjetos(): Promise<ProjetoDoChat[]>;
  listarOrquestradores(): Promise<OrquestradorExistente[]>;
}
