import { memo } from "react";
import Markdown, { type Components, type Options } from "react-markdown";
import remarkGfm from "remark-gfm";

// Constantes fora do componente: objetos novos a cada render não deixariam o
// react-markdown (nem quem o envolve) reaproveitar nada.

// O Claude escreve no dialeto do GitHub (tabelas, ~~riscado~~, listas de
// tarefas). Til simples fica desligado: "10~20 min" não é riscado.
const PLUGINS_DO_REMARK: Options["remarkPlugins"] = [[remarkGfm, { singleTilde: false }]];

const COMPONENTES: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  // Tabela mais larga que a janela rola na horizontal, sem esmagar colunas.
  table: ({ children }) => (
    <div className="markdown-tabela custom-scrollbar">
      <table>{children}</table>
    </div>
  ),
};

interface Props {
  texto: string;
  className?: string;
}

/**
 * Texto escrito pelo Claude, que chega em Markdown.
 *
 * O react-markdown não interpreta HTML bruto: nada que um agente escreva
 * (inclusive conteúdo copiado de arquivos ou da web) vira código na página.
 *
 * Memorizado: analisar o Markdown é caro (respostas de dezenas de KB) e o
 * mesmo texto sempre dá a mesma tela — só re-renderiza se `texto` ou
 * `className` mudarem.
 */
export const TextoFormatado = memo(function TextoFormatado({ texto, className = "" }: Props) {
  return (
    <div className={`markdown ${className}`}>
      <Markdown remarkPlugins={PLUGINS_DO_REMARK} components={COMPONENTES}>
        {texto}
      </Markdown>
    </div>
  );
});
