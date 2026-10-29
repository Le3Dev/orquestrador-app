import Markdown from "react-markdown";

/**
 * Texto escrito pelo Claude, que chega em Markdown.
 *
 * O react-markdown não interpreta HTML bruto: nada que um agente escreva
 * (inclusive conteúdo copiado de arquivos ou da web) vira código na página.
 */
export function TextoFormatado({ texto, className = "" }: { texto: string; className?: string }) {
  return (
    <div className={`markdown ${className}`}>
      <Markdown
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {texto}
      </Markdown>
    </div>
  );
}
