import { useCallback, useRef, useState } from "react";

import { usePreferenciasDaTela } from "../../shared/hooks/usePreferenciasDaTela";
import { VisualizadorDeArquivos } from "./VisualizadorDeArquivos";

/** Sinais de código (`< >`) sobre uma folha: o ícone dos arquivos. */
function IconeDeArquivos({ className = "" }: { className?: string }) {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M6 3.5h8l4.5 4.5v12a.5.5 0 0 1-.5.5H6a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="m10 11.5-2 2 2 2M14 11.5l2 2-2 2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * "Arquivos", na barra do terminal: abre o visualizador de código da pasta do
 * Orquestrador (o worktree, se houver). Só aparece com a preferência
 * "visualizador de código" ligada (painel Configurações, aberto pelo ⚙).
 */
export function BotaoDeArquivos({ orquestradorId, nomeDoOrquestrador }: { orquestradorId: string; nomeDoOrquestrador?: string }) {
  const { preferencias } = usePreferenciasDaTela();
  const [aberto, setAberto] = useState(false);
  const botao = useRef<HTMLButtonElement>(null);

  const aoFechar = useCallback(() => {
    setAberto(false);
    botao.current?.focus({ preventScroll: true });
  }, []);

  if (!preferencias.visualizadorDeCodigo) {
    return null;
  }

  return (
    <>
      <button
        ref={botao}
        type="button"
        className="botao-icone nodrag"
        aria-label="Arquivos"
        aria-haspopup="dialog"
        aria-expanded={aberto}
        title="Arquivos: navegar e ler o código da pasta deste orquestrador (só leitura)"
        onClick={() => setAberto(true)}
      >
        <IconeDeArquivos />
      </button>
      {aberto && (
        <VisualizadorDeArquivos
          orquestradorId={orquestradorId}
          {...(nomeDoOrquestrador !== undefined ? { nomeDoOrquestrador } : {})}
          aoFechar={aoFechar}
        />
      )}
    </>
  );
}
