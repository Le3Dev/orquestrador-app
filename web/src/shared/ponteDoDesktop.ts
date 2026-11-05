/**
 * Ponte com o app desktop (Electron).
 *
 * O preload do Electron (electron/preload.js) expõe `window.electron`; no
 * navegador puro ele não existe e as funções abaixo devolvem false/null — a
 * tela web segue intacta.
 */

export interface ApiDaJanela {
  minimizar: () => Promise<void>;
  /** Alterna entre maximizada e restaurada. */
  maximizar: () => Promise<void>;
  fechar: () => Promise<void>;
  estaMaximizada: () => Promise<boolean>;
  /** Avisa a cada maximizar/restaurar; devolve a função que cancela o aviso. */
  aoMudarMaximizada?: (callback: (maximizada: boolean) => void) => () => void;
}

/** Configuração local do app: pasta raiz dos projetos e executável do Claude Code. */
export interface ConfiguracaoDoAplicativo {
  pastaRaizDosProjetos: string;
  caminhoDoClaudeCode: string;
}

/** Ajustes da primeira abertura, que o app desktop deixa reabrir. */
export interface ApiDaConfiguracao {
  obter: () => Promise<ConfiguracaoDoAplicativo>;
  /** Reabre a tela de ajustes (pasta dos projetos e Claude Code). */
  abrirAjustes: () => Promise<void>;
}

interface PonteDoDesktop {
  desktop?: boolean;
  plataforma?: string;
  janela?: ApiDaJanela;
  configuracao?: ApiDaConfiguracao;
}

function ponteDoDesktop(): PonteDoDesktop | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { electron?: PonteDoDesktop }).electron ?? null;
}

/** Devolve a API da janela do app desktop, ou null fora dele. */
export function apiDaJanela(): ApiDaJanela | null {
  const ponte = ponteDoDesktop();
  return ponte?.desktop && ponte.janela ? ponte.janela : null;
}

/** Devolve a API de configuração do app desktop, ou null quando a ponte não a expõe. */
export function apiDaConfiguracao(): ApiDaConfiguracao | null {
  return ponteDoDesktop()?.configuracao ?? null;
}

/** true quando a tela está rodando dentro do app desktop (Electron). */
export function rodandoNoDesktop(): boolean {
  return apiDaJanela() !== null;
}
