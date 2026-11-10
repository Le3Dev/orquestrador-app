import { useEffect, useState } from "react";

import { apiDaJanela } from "../../shared/ponteDoDesktop";

/*
 * Botões ─ ☐ ✕ da janela do app desktop. A janela principal não tem botões
 * nativos (titleBarStyle 'hidden' sem titleBarOverlay, em electron/main.js):
 * a tela desenha estes no fim da ilha da direita (Windows e Linux; no Mac as
 * bolinhas são nativas).
 */

const PROPS_DO_ICONE = {
  width: 12,
  height: 12,
  viewBox: "0 0 12 12",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.25,
  "aria-hidden": true,
} as const;

/**
 * Minimizar, maximizar/restaurar e fechar, no estilo dos botões do app. O
 * ícone do meio acompanha o estado real da janela (inclusive quando ela
 * maximiza por duplo clique na barra, Win+↑ ou encaixe na borda da tela).
 * Fora do desktop não renderiza nada.
 */
export function ControlesDaJanela() {
  const [api] = useState(apiDaJanela);
  const [maximizada, setMaximizada] = useState(false);

  useEffect(() => {
    if (!api) return;
    let ativo = true;
    api
      .estaMaximizada()
      .then((valor) => {
        if (ativo) setMaximizada(valor);
      })
      .catch(() => {
        /* sem resposta: fica o ícone de maximizar */
      });
    const cancelar = api.aoMudarMaximizada?.((valor) => setMaximizada(valor));
    return () => {
      ativo = false;
      cancelar?.();
    };
  }, [api]);

  if (!api) return null;

  const rotuloDoMeio = maximizada ? "Restaurar" : "Maximizar";
  const executar = (acao: () => Promise<void>) => () => {
    acao().catch(() => {
      /* a janela pode ter fechado no meio; não há o que avisar */
    });
  };

  return (
    <div className="controles-da-janela no-drag" role="group" aria-label="Controles da janela">
      <button
        type="button"
        className="botao-da-janela"
        title="Minimizar"
        aria-label="Minimizar"
        onClick={executar(api.minimizar)}
      >
        <svg {...PROPS_DO_ICONE}>
          <path d="M2 6.5h8" strokeLinecap="round" />
        </svg>
      </button>
      <button
        type="button"
        className="botao-da-janela"
        title={rotuloDoMeio}
        aria-label={rotuloDoMeio}
        data-maximizada={maximizada}
        onClick={executar(api.maximizar)}
      >
        {maximizada ? (
          <svg {...PROPS_DO_ICONE}>
            <rect x="1.5" y="4" width="6.5" height="6.5" rx="1" />
            <path d="M4 4V2.5a1 1 0 0 1 1-1h4.5a1 1 0 0 1 1 1V7a1 1 0 0 1-1 1H8" />
          </svg>
        ) : (
          <svg {...PROPS_DO_ICONE}>
            <rect x="2" y="2" width="8" height="8" rx="1.25" />
          </svg>
        )}
      </button>
      <button
        type="button"
        className="botao-da-janela botao-da-janela-fechar"
        title="Fechar"
        aria-label="Fechar"
        onClick={executar(api.fechar)}
      >
        <svg {...PROPS_DO_ICONE}>
          <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
