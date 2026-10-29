import type { DadosDoWorktree } from "../shared/api/tipos";
import { IconeBranch } from "./Icones";

/**
 * Badge do git worktree em que o Orquestrador opera: mostra o branch, com o
 * caminho no tooltip. Quando `ativo` é falso, aparece esmaecido. Com `null`
 * (pasta que não é repositório git), não mostra nada — o worktree não se aplica.
 */
export function EtiquetaDeWorktree({
  worktree,
  className = "",
}: {
  worktree: DadosDoWorktree | null;
  className?: string;
}) {
  if (worktree === null) {
    return null;
  }
  const { branch, caminho, ativo } = worktree;
  return (
    <span
      className={`chip ${ativo ? "text-active" : "text-muted"} ${className}`}
      title={`Worktree: ${caminho}${ativo ? " · em uso agora" : " · inativo"}`}
    >
      <IconeBranch tamanho={11} className="mr-1 shrink-0" />
      <span className="truncate">{branch}</span>
    </span>
  );
}
