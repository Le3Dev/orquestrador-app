import type { ReactNode } from "react";

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

/**
 * Grade 2 × 2: "Organizar" (janelas lado a lado), nos controles do canvas.
 * Preenchido, como os ícones de zoom do React Flow ao lado dele.
 */
export function IconeGrade({ tamanho = 12, className = "" }: PropsDoIcone) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 12 12" className={className} aria-hidden="true">
      <rect x="0.5" y="0.5" width="4.75" height="4.75" rx="1" fill="currentColor" />
      <rect x="6.75" y="0.5" width="4.75" height="4.75" rx="1" fill="currentColor" />
      <rect x="0.5" y="6.75" width="4.75" height="4.75" rx="1" fill="currentColor" />
      <rect x="6.75" y="6.75" width="4.75" height="4.75" rx="1" fill="currentColor" />
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

/** Duas pessoas: os subagentes prontos. */
export function IconePessoas({ tamanho = 14, className = "" }: PropsDoIcone) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="9" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M3 19.5a6 6 0 0 1 12 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path
        d="M15.5 5.2a3.2 3.2 0 0 1 0 5.6M17.5 14.2a6 6 0 0 1 3.5 5.3"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Ícones de ação e de situação. Traço de 1.8 num quadro de 24, para ficarem
// nítidos de 12 a 18 px. No lugar de emojis, que cada sistema desenha de um
// jeito (e colorido).
// ──────────────────────────────────────────────────────────────────────────

const TRACO = {
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function Quadro({ tamanho, className, children }: PropsDoIcone & { tamanho: number; children: ReactNode }) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      {children}
    </svg>
  );
}

/** X de fechar ou descartar. */
export function IconeFechar({ tamanho = 16, className = "" }: PropsDoIcone) {
  return (
    <Quadro tamanho={tamanho} className={className}>
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" {...TRACO} strokeWidth={2} />
    </Quadro>
  );
}

/** Engrenagem: configurações. */
export function IconeEngrenagem({ tamanho = 18, className = "" }: PropsDoIcone) {
  return (
    <Quadro tamanho={tamanho} className={className}>
      <path
        d="M10.3 3.6a1.7 1.7 0 0 1 3.4 0l.1.6a1.7 1.7 0 0 0 2.5 1l.5-.3a1.7 1.7 0 0 1 2.4 2.4l-.3.5a1.7 1.7 0 0 0 1 2.5l.6.1a1.7 1.7 0 0 1 0 3.4l-.6.1a1.7 1.7 0 0 0-1 2.5l.3.5a1.7 1.7 0 0 1-2.4 2.4l-.5-.3a1.7 1.7 0 0 0-2.5 1l-.1.6a1.7 1.7 0 0 1-3.4 0l-.1-.6a1.7 1.7 0 0 0-2.5-1l-.5.3a1.7 1.7 0 0 1-2.4-2.4l.3-.5a1.7 1.7 0 0 0-1-2.5l-.6-.1a1.7 1.7 0 0 1 0-3.4l.6-.1a1.7 1.7 0 0 0 1-2.5l-.3-.5a1.7 1.7 0 0 1 2.4-2.4l.5.3a1.7 1.7 0 0 0 2.5-1l.1-.6Z"
        {...TRACO}
      />
      <circle cx="12" cy="12" r="3" {...TRACO} />
    </Quadro>
  );
}

/** Lápis: o que tem ele ao lado se edita clicando. */
export function IconeLapis({ tamanho = 13, className = "" }: PropsDoIcone) {
  return (
    <Quadro tamanho={tamanho} className={`shrink-0 ${className}`}>
      <path d="M4 20h4L19 9l-4-4L4 16z" {...TRACO} strokeWidth={1.9} />
      <path d="m13.5 6.5 4 4" {...TRACO} strokeWidth={1.9} />
    </Quadro>
  );
}

/** Clipe de anexo. */
export function IconeAnexo({ tamanho = 18, className = "" }: PropsDoIcone) {
  return (
    <Quadro tamanho={tamanho} className={className}>
      <path
        d="M20 11.5l-7.6 7.6a5 5 0 0 1-7.1-7.1l7.9-7.9a3.3 3.3 0 0 1 4.7 4.7l-7.9 7.9a1.7 1.7 0 0 1-2.4-2.4l7.3-7.3"
        {...TRACO}
      />
    </Quadro>
  );
}

/** Microfone: ditar por voz. */
export function IconeMicrofone({ tamanho = 18, className = "" }: PropsDoIcone) {
  return (
    <Quadro tamanho={tamanho} className={className}>
      <rect x="9" y="3" width="6" height="11" rx="3" {...TRACO} />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" {...TRACO} />
    </Quadro>
  );
}

/** Triângulo de alerta. */
export function IconeAlerta({ tamanho = 14, className = "" }: PropsDoIcone) {
  return (
    <Quadro tamanho={tamanho} className={className}>
      <path d="M10.3 4.3a2 2 0 0 1 3.4 0l7.4 12.8a2 2 0 0 1-1.7 3H4.6a2 2 0 0 1-1.7-3l7.4-12.8Z" {...TRACO} />
      <path d="M12 9.5v4" {...TRACO} strokeWidth={2} />
      <circle cx="12" cy="16.8" r="1.1" fill="currentColor" />
    </Quadro>
  );
}

/** Coração: sinal de vida do Claude durante o turno. */
export function IconeCoracao({ tamanho = 12, className = "" }: PropsDoIcone) {
  return (
    <Quadro tamanho={tamanho} className={className}>
      <path
        d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20Z"
        fill="currentColor"
      />
    </Quadro>
  );
}

/** Raio: um subagente acabou de ser criado. */
export function IconeRaio({ tamanho = 12, className = "" }: PropsDoIcone) {
  return (
    <Quadro tamanho={tamanho} className={className}>
      <path d="M13.5 2.5 5 13.5h6l-1 8 8.5-11h-6l1-8Z" fill="currentColor" />
    </Quadro>
  );
}

/** Seta para cima: pasta acima. */
export function IconeSetaAcima({ tamanho = 16, className = "" }: PropsDoIcone) {
  return (
    <Quadro tamanho={tamanho} className={className}>
      <path d="M12 19V5M6 11l6-6 6 6" {...TRACO} strokeWidth={2} />
    </Quadro>
  );
}

/** Traço para baixo: minimizar a janela à barra de título (nota, prévia). */
export function IconeMinimizar({ tamanho = 12, className = "" }: PropsDoIcone) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M5 17h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** Quadrado: restaurar a janela minimizada. */
export function IconeRestaurar({ tamanho = 12, className = "" }: PropsDoIcone) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

/** Globo: a prévia ao vivo, um navegador dentro do canvas. */
export function IconeNavegador({ tamanho = 14, className = "" }: PropsDoIcone) {
  return (
    <Quadro tamanho={tamanho} className={className}>
      <circle cx="12" cy="12" r="8.5" {...TRACO} />
      <path d="M3.5 12h17M12 3.5c2.3 2.4 3.5 5.2 3.5 8.5s-1.2 6.1-3.5 8.5c-2.3-2.4-3.5-5.2-3.5-8.5s1.2-6.1 3.5-8.5Z" {...TRACO} />
    </Quadro>
  );
}

/** Seta circular: recarregar a página. */
export function IconeRecarregar({ tamanho = 14, className = "" }: PropsDoIcone) {
  return (
    <Quadro tamanho={tamanho} className={className}>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" {...TRACO} />
      <path d="M19.5 4.5v4h-4" {...TRACO} />
    </Quadro>
  );
}

/** Caixa com seta saindo: abrir fora, no navegador do sistema. */
export function IconeAbrirFora({ tamanho = 14, className = "" }: PropsDoIcone) {
  return (
    <Quadro tamanho={tamanho} className={className}>
      <path d="M13.5 4.5h6v6M19.5 4.5l-8 8" {...TRACO} />
      <path d="M17.5 14v4a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18V8A1.5 1.5 0 0 1 6 6.5h4" {...TRACO} />
    </Quadro>
  );
}
