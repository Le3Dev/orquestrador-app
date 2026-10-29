/**
 * Onde um turno vai rodar. Quando a pasta de trabalho é um repositório git com
 * HEAD, o turno roda num worktree isolado; senão, na própria pasta.
 */
export interface PreparoDeWorktree {
  /** cwd que o motor deve usar no turno. */
  cwd: string;
  /** Estado a registrar no agregado; `null` quando não há worktree. */
  worktree: { branch: string; caminho: string } | null;
}

/**
 * Porta do domínio para o ciclo de vida do worktree de um Orquestrador.
 * Degradação graciosa é responsabilidade da implementação: nunca lançar por
 * falta de git.
 */
export interface GerenciadorDeWorktrees {
  /**
   * Garante o worktree do Orquestrador antes de um turno. Se a pasta não for
   * repo git com HEAD, devolve a própria pasta e `worktree: null`.
   */
  preparar(orquestradorId: string, pastaDeTrabalho: string): Promise<PreparoDeWorktree>;

  /**
   * Ao fim de um turno: se o worktree não teve alterações, remove-o (worktree
   * remove + branch -D + prune) e devolve `true`; caso contrário mantém e
   * devolve `false`.
   */
  concluir(orquestradorId: string, pastaDeTrabalho: string): Promise<boolean>;
}
