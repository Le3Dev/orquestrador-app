import { type ReactNode, useId } from "react";

interface Props {
  /** O campo explicado, para o leitor de tela: "O que é {sobre}". */
  sobre: string;
  /** Primeira linha, em destaque. */
  titulo: string;
  children: ReactNode;
}

/**
 * Ícone ⓘ ao lado do nome de um campo. A explicação aparece ao passar o mouse
 * ou ao chegar nele pelo Tab (só CSS: `.dica:hover` e `:focus-within`).
 */
export function Dica({ sobre, titulo, children }: Props) {
  const id = useId();
  return (
    <span className="dica">
      <button type="button" className="dica-icone" aria-label={`O que é ${sobre}`} aria-describedby={id}>
        <svg aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
          <path d="M12 11v6M12 7.5v.01" />
        </svg>
      </button>
      <span className="dica-balao" role="tooltip" id={id}>
        <strong>{titulo}</strong>
        {children}
      </span>
    </span>
  );
}
