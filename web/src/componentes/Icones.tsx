/**
 * Ícones próprios da tela, desenhados aqui (não são marcas da Anthropic).
 * Usam `currentColor`, então a cor vem do token aplicado no elemento pai.
 */

interface PropsDoIcone {
  tamanho?: number;
  className?: string;
}

/** Um nó central ligado a três nós: o Orquestrador e seus Subagentes. */
export function IconeOrquestrador({ tamanho = 20, className = "" }: PropsDoIcone) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 9.5V5.5M9.8 13.3 6.3 15.4M14.2 13.3l3.5 2.1"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="12" cy="12" r="2.6" fill="currentColor" />
      <circle cx="12" cy="4" r="1.8" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="5" cy="16.3" r="1.8" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="19" cy="16.3" r="1.8" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

/** Pasta de projeto. */
export function IconePasta({ tamanho = 12, className = "" }: PropsDoIcone) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M3.5 7.5A2 2 0 0 1 5.5 5.5h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7.5Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Branch de git: dois nós ligados, como o ícone de ramo de versão. */
export function IconeBranch({ tamanho = 12, className = "" }: PropsDoIcone) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="6.5" cy="5" r="2.2" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="6.5" cy="19" r="2.2" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="17.5" cy="7.5" r="2.2" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M6.5 7.2v9.6M17.5 9.7v1.3a4 4 0 0 1-4 4h-3"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
