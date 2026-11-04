/** Uma pasta de projeto dentro da pasta raiz. */
export interface ProjetoDoChat {
  /** Nome da pasta, como o usuário e o Claude se referem a ela. */
  nome: string;
  caminho: string;
}

/** Um Orquestrador que já existe no app, como o chat o enxerga. */
export interface OrquestradorExistente {
  nome: string;
  pasta: string;
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
