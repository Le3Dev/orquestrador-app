import { memo, type ReactNode, useEffect, useRef, useState } from "react";
import Markdown, { type Components, type Options } from "react-markdown";
import remarkGfm from "remark-gfm";

// Constantes fora do componente: objetos novos a cada render não deixariam o
// react-markdown (nem quem o envolve) reaproveitar nada.

// O Claude escreve no dialeto do GitHub (tabelas, ~~riscado~~, listas de
// tarefas). Til simples fica desligado: "10~20 min" não é riscado.
const PLUGINS_DO_REMARK: Options["remarkPlugins"] = [[remarkGfm, { singleTilde: false }]];

/** Quanto tempo o botão mostra "copiado" (ou "não copiou") antes de voltar. */
const DURACAO_DO_AVISO_DE_COPIA_MS = 1500;

type EstadoDaCopia = "pronto" | "copiado" | "falhou";

const ROTULOS_DA_COPIA: Readonly<Record<EstadoDaCopia, string>> = {
  pronto: "copiar",
  copiado: "copiado",
  falhou: "não copiou",
};

/**
 * Bloco de código com um botão "copiar" no canto. O botão fica fora do `pre`,
 * então o texto copiado é só o do código (sem a quebra de linha final que o
 * Markdown sempre deixa).
 */
function BlocoDeCodigo({ children }: { children?: ReactNode }) {
  const pre = useRef<HTMLPreElement>(null);
  const [estado, setEstado] = useState<EstadoDaCopia>("pronto");
  const temporizador = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const montado = useRef(true);

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
      clearTimeout(temporizador.current);
    };
  }, []);

  const avisar = (novo: EstadoDaCopia) => {
    if (!montado.current) {
      return;
    }
    setEstado(novo);
    clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => setEstado("pronto"), DURACAO_DO_AVISO_DE_COPIA_MS);
  };

  const copiar = async () => {
    const texto = (pre.current?.textContent ?? "").replace(/\n$/, "");
    try {
      await navigator.clipboard.writeText(texto);
      avisar("copiado");
    } catch {
      avisar("falhou");
    }
  };

  return (
    <div className="bloco-de-codigo">
      <pre ref={pre}>{children}</pre>
      <button
        type="button"
        className="botao-de-copiar"
        data-estado={estado}
        title="Copiar o código"
        aria-live="polite"
        onClick={() => void copiar()}
      >
        {ROTULOS_DA_COPIA[estado]}
      </button>
    </div>
  );
}

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
  // Só blocos (```) viram `pre`; código inline continua um `code` solto, sem botão.
  pre: ({ children }) => <BlocoDeCodigo>{children}</BlocoDeCodigo>,
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
