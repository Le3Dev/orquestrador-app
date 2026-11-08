import type { DadosDoWorktree } from "../shared/api/tipos";
import { IconeBranch } from "./Icones";

/**
 * Badge do git worktree em que o Orquestrador opera: mostra o branch, com o
 * caminho no tooltip. Quando `ativo` é falso, aparece esmaecido. Com `null`
 * (pasta que não é repositório git), não mostra nada — o worktree não se aplica.
 *
 * O `.chip` não encolhe (`flex-shrink: 0`): quem usa limita a largura pelo
 * `className` (ex.: `max-w-full`) e a etiqueta corta o branch com reticências
 * (`min-w-0` + `overflow-hidden` no chip, `min-w-0` no texto). O branch inteiro
 * vai no tooltip, já que pode aparecer cortado.
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
      className={`chip ${ativo ? "chip-ativo" : "chip-inativo"} min-w-0 overflow-hidden ${className}`}
      title={`Branch: ${branch}\nWorktree: ${caminho}${ativo ? " · em uso agora" : " · inativo"}`}
    >
      <IconeBranch tamanho={11} className="mr-1 shrink-0" />
      <span className="min-w-0 truncate">{branch}</span>
    </span>
  );
}
