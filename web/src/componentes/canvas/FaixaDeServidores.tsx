import { memo } from "react";

import { enderecoCurto, enderecosParaPrevia } from "../../shared/enderecosLocais";

interface Props {
  /** Os servidores que os agentes subiram na conversa (`EstadoDaConversa.enderecosLocais`). */
  enderecos: readonly string[];
  aoAbrir: (url: string) => void;
}

/**
 * Faixa fina logo acima do prompt quando um agente sobe um servidor de
 * desenvolvimento: "servidor no ar · localhost:5173 abrir prévia". Mostra os
 * três mais recentes, menos o da própria tela.
 *
 * Memorizada: só muda quando a lista de endereços muda.
 */
export const FaixaDeServidores = memo(function FaixaDeServidores({ enderecos, aoAbrir }: Props) {
  const oferecidos = enderecosParaPrevia(enderecos, window.location.origin);
  if (oferecidos.length === 0) {
    return null;
  }
  return (
    <div className="faixa-de-servidores nodrag">
      <span className="ponto-de-status" aria-hidden="true" />
      <span className="text-muted">servidor no ar</span>
      {oferecidos.map((url) => (
        <span key={url} className="faixa-de-servidores-item">
          <span className="text-muted">·</span>
          <span className="truncate text-caption" title={url}>
            {enderecoCurto(url)}
          </span>
          <button
            type="button"
            className="botao-de-texto"
            title={`Abre ${url} numa prévia ao vivo no canvas`}
            aria-label={`Abrir prévia de ${url}`}
            onClick={() => aoAbrir(url)}
          >
            abrir prévia
          </button>
        </span>
      ))}
    </div>
  );
});
