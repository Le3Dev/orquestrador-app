import { useEffect, useState } from "react";

/**
 * Botões minimizar / maximizar / fechar da janela do app desktop (Electron).
 *
 * Só aparecem quando a tela roda DENTRO do app (o preload do Electron expõe
 * `window.electron`). No navegador puro, `apiDaJanela()` devolve null e nada é
 * renderizado — a tela web segue intacta.
 */

interface ApiDaJanela {
  minimizar: () => Promise<void>;
  maximizar: () => Promise<void>;
  fechar: () => Promise<void>;
  estaMaximizada: () => Promise<boolean>;
}

interface PonteDoDesktop {
  desktop?: boolean;
  plataforma?: string;
  janela?: ApiDaJanela;
}

/** Devolve a API de janela do Electron, ou null fora do app desktop. */
function apiDaJanela(): ApiDaJanela | null {
  if (typeof window === "undefined") return null;
  const ponte = (window as unknown as { electron?: PonteDoDesktop }).electron;
  return ponte?.desktop && ponte.janela ? ponte.janela : null;
}

/** true quando a tela está rodando dentro do app desktop (Electron). */
export function rodandoNoDesktop(): boolean {
  return apiDaJanela() !== null;
}

export function ControlesDaJanela() {
  const api = apiDaJanela();
  const [maximizada, setMaximizada] = useState(false);

  useEffect(() => {
    if (!api) return;
    api.estaMaximizada().then(setMaximizada).catch(() => {});
  }, [api]);

  if (!api) return null;

  const aoMaximizar = () => {
    void api.maximizar();
    // O estado real é consultado logo após o toggle.
    api.estaMaximizada().then(setMaximizada).catch(() => {});
  };

  return (
    <div className="controles-da-janela no-drag" role="group" aria-label="Controles da janela">
      <button
        type="button"
        className="botao-janela"
        title="Minimizar"
        aria-label="Minimizar"
        onClick={() => void api.minimizar()}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1 5h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </button>
      <button
        type="button"
        className="botao-janela"
        title={maximizada ? "Restaurar" : "Maximizar"}
        aria-label={maximizada ? "Restaurar" : "Maximizar"}
        onClick={aoMaximizar}
      >
        {maximizada ? (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2.5 3.5V2h5.5v5.5H6.5" stroke="currentColor" strokeWidth="1.1" fill="none" />
            <rect x="1.5" y="3.5" width="5" height="5" stroke="currentColor" strokeWidth="1.1" fill="none" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <rect x="1.5" y="1.5" width="7" height="7" stroke="currentColor" strokeWidth="1.2" fill="none" />
          </svg>
        )}
      </button>
      <button
        type="button"
        className="botao-janela botao-janela-fechar"
        title="Fechar"
        aria-label="Fechar"
        onClick={() => void api.fechar()}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
