import type { ReactNode } from "react";

/**
 * Ícones do marketplace de skills (menu "Explorar marketplace", catálogo de plugins e a aba Instaladas).
 * O mesmo estilo de `IconesDasIlhas.tsx`: traço de 1.8 num quadro de 24, em `currentColor`.
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

/** Bússola: explorar o marketplace. */
export function IconeExplorar({ tamanho = 18, className = "" }: PropsDoIcone) {
  return (
    <Quadro tamanho={tamanho} className={className}>
      <circle cx="12" cy="12" r="8.5" {...TRACO} />
      <path d="m15.6 8.4-2 5.2-5.2 2 2-5.2z" {...TRACO} />
    </Quadro>
  );
}

/** Seta para baixo sobre uma base: baixar e instalar. */
export function IconeBaixar({ tamanho = 14, className = "" }: PropsDoIcone) {
  return (
    <Quadro tamanho={tamanho} className={className}>
      <path d="M12 4v11M7.5 11 12 15.5l4.5-4.5M5 19.5h14" {...TRACO} />
    </Quadro>
  );
}

/** Nuvem cortada: sem conexão com a internet. */
export function IconeSemInternet({ tamanho = 14, className = "" }: PropsDoIcone) {
  return (
    <Quadro tamanho={tamanho} className={className}>
      <path d="M7.5 18.5h9.2a3.8 3.8 0 0 0 .9-7.5A5.4 5.4 0 0 0 9 8.7M5.6 10.6A4.4 4.4 0 0 0 7.5 18.5" {...TRACO} />
      <path d="M4 4l16 16" {...TRACO} />
    </Quadro>
  );
}

export function IconeLixeira({ tamanho = 16, className = "" }: PropsDoIcone) {
  return (
    <Quadro tamanho={tamanho} className={className}>
      <path d="M5 7h14M10 7V5h4v2M7 7l.8 12h8.4L17 7M10.5 11v5M13.5 11v5" {...TRACO} />
    </Quadro>
  );
}

/** Seta saindo de um quadrado: abre num link de fora. */
export function IconeLinkExterno({ tamanho = 13, className = "" }: PropsDoIcone) {
  return (
    <Quadro tamanho={tamanho} className={className}>
      <path d="M14 5h5v5M19 5l-8 8M17 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4" {...TRACO} />
    </Quadro>
  );
}

/** Raio: o hook, um comando que roda sozinho. */
export function IconeHook({ tamanho = 12, className = "" }: PropsDoIcone) {
  return (
    <Quadro tamanho={tamanho} className={className}>
      <path d="M13 3.5 6 13.5h5l-1 7 7-10h-5l1-7Z" {...TRACO} />
    </Quadro>
  );
}

export function IconeVoltar({ tamanho = 14, className = "" }: PropsDoIcone) {
  return (
    <Quadro tamanho={tamanho} className={className}>
      <path d="m14.5 6-6 6 6 6" {...TRACO} />
    </Quadro>
  );
}

export function IconeConfirmar({ tamanho = 14, className = "" }: PropsDoIcone) {
  return (
    <Quadro tamanho={tamanho} className={className}>
      <path d="m5 12.5 4.5 4.5L19 7.5" {...TRACO} />
    </Quadro>
  );
}

/** O visto do selo "Oficial": mais grosso para ler em 10 px. */
export function IconeSeloOficial({ tamanho = 10, className = "" }: PropsDoIcone) {
  return (
    <Quadro tamanho={tamanho} className={className}>
      <path d="m5 12.5 4.5 4.5L19 7.5" {...TRACO} strokeWidth={2.6} />
    </Quadro>
  );
}

export function IconeTentarDeNovo({ tamanho = 14, className = "" }: PropsDoIcone) {
  return (
    <Quadro tamanho={tamanho} className={className}>
      <path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v4.5h-4.5" {...TRACO} />
    </Quadro>
  );
}

/** Duas setas verticais: a ordem da lista. */
export function IconeOrdem({ tamanho = 13, className = "" }: PropsDoIcone) {
  return (
    <Quadro tamanho={tamanho} className={className}>
      <path d="M8 5v14M8 19l-3-3M8 19l3-3M16 19V5M16 5l-3 3M16 5l3 3" {...TRACO} />
    </Quadro>
  );
}
