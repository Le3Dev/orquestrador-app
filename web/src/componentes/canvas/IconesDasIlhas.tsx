import type { ReactNode } from "react";

/**
 * Ícones das ilhas flutuantes do canvas (as da esquerda, da direita e a de
 * ferramentas). Traço de 1.8 num quadro de 24, em `currentColor`: a cor vem do
 * token aplicado no botão. Ficam aqui, e não em `Icones.tsx`, para a tela das
 * ilhas ser um arquivo só.
 */

interface PropsDoIcone {
  tamanho?: number;
  className?: string;
}

const TRACO = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function Quadro({ tamanho, className, children }: PropsDoIcone & { children: ReactNode }) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" className={className} aria-hidden="true">
      {children}
    </svg>
  );
}

export function IconeMais({ tamanho = 18, className = "" }: PropsDoIcone) {
  return (
    <Quadro tamanho={tamanho} className={className}>
      <path d="M12 5v14M5 12h14" {...TRACO} />
    </Quadro>
  );
}

export function IconeMenos({ tamanho = 18, className = "" }: PropsDoIcone) {
  return (
    <Quadro tamanho={tamanho} className={className}>
      <path d="M5 12h14" {...TRACO} />
    </Quadro>
  );
}

/** Lupa: a busca (paleta de comandos). */
export function IconeLupa({ tamanho = 18, className = "" }: PropsDoIcone) {
  return (
    <Quadro tamanho={tamanho} className={className}>
      <circle cx="10.5" cy="10.5" r="6" {...TRACO} />
      <path d="m15 15 5 5" {...TRACO} />
    </Quadro>
  );
}

/** Lista com marcadores: a lista de orquestradores. */
export function IconeLista({ tamanho = 18, className = "" }: PropsDoIcone) {
  return (
    <Quadro tamanho={tamanho} className={className}>
      <path d="M9 6.5h11M9 12h11M9 17.5h11" {...TRACO} />
      <circle cx="4.5" cy="6.5" r=".9" fill="currentColor" stroke="currentColor" />
      <circle cx="4.5" cy="12" r=".9" fill="currentColor" stroke="currentColor" />
      <circle cx="4.5" cy="17.5" r=".9" fill="currentColor" stroke="currentColor" />
    </Quadro>
  );
}

/** Seta para a direita: o item abre um submenu. */
export function IconeSetaDireita({ tamanho = 16, className = "" }: PropsDoIcone) {
  return (
    <Quadro tamanho={tamanho} className={className}>
      <path d="m9.5 6 6 6-6 6" {...TRACO} />
    </Quadro>
  );
}

/** Chip de memória (o miolo do anel). */
export function IconeMemoria({ tamanho = 13, className = "" }: PropsDoIcone) {
  return (
    <Quadro tamanho={tamanho} className={className}>
      <rect x="5" y="6" width="14" height="12" rx="2" {...TRACO} />
      <path d="M9 3.5V6M15 3.5V6M9 18v2.5M15 18v2.5M2.5 10H5M2.5 14H5M19 10h2.5M19 14h2.5" {...TRACO} />
    </Quadro>
  );
}

/** Círculo vazio: o orquestrador está parado. */
export function IconeParado({ tamanho = 12, className = "" }: PropsDoIcone) {
  return (
    <Quadro tamanho={tamanho} className={className}>
      <circle cx="12" cy="12" r="7" {...TRACO} />
    </Quadro>
  );
}

/** Giro: o orquestrador está trabalhando. */
export function IconeTrabalhando({ tamanho = 16, className = "" }: PropsDoIcone) {
  return (
    <Quadro tamanho={tamanho} className={className}>
      <path d="M20 12a8 8 0 1 1-3-6.2" {...TRACO} />
      <path d="M20.5 3.5v4.2h-4.2" {...TRACO} />
    </Quadro>
  );
}

/** Quatro cantos: ajustar tudo à tela. O mesmo desenho do botão de enquadrar do React Flow. */
export function IconeEnquadrar({ tamanho = 18, className = "" }: PropsDoIcone) {
  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 32 30"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M3.692 4.63c0-.53.4-.938.939-.938h5.215V0H4.708C2.13 0 0 2.054 0 4.63v5.216h3.692V4.631zM27.354 0h-5.2v3.692h5.17c.53 0 .984.4.984.939v5.215H32V4.631A4.624 4.624 0 0027.354 0zm.954 24.83c0 .532-.4.94-.939.94h-5.215v3.768h5.215c2.577 0 4.631-2.13 4.631-4.707v-5.139h-3.692v5.139zm-23.677.94c-.531 0-.939-.4-.939-.94v-5.138H0v5.139c0 2.577 2.13 4.707 4.708 4.707h5.138V25.77H4.631z" />
    </svg>
  );
}

/** Aviso de informação (a notificação da cota). */
export function IconeInfo({ tamanho = 16, className = "" }: PropsDoIcone) {
  return (
    <Quadro tamanho={tamanho} className={className}>
      <circle cx="12" cy="12" r="9" {...TRACO} />
      <path d="M12 11v5.5M12 7.8v.2" {...TRACO} />
    </Quadro>
  );
}
