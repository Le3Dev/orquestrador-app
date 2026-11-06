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

/**
 * Onde está a atualização automática do app: "indisponivel" fora do app
 * instalado (navegador ou desenvolvimento).
 */
export type SituacaoDaAtualizacao = "indisponivel" | "verificando" | "em-dia" | "baixando" | "pronta" | "erro";

export interface EstadoDaAtualizacao {
  situacao: SituacaoDaAtualizacao;
  versaoAtual: string;
  /** Preenchida em "baixando" e "pronta". */
  versaoNova: string | null;
  /** 0–100 (inteiro), só em "baixando". */
  progresso: number | null;
  /** Só em "erro". */
  mensagemDeErro: string | null;
}

/** A atualização automática do app desktop (baixa sozinha; instala ao fechar ou ao reiniciar). */
export interface ApiDaAtualizacao {
  obter: () => Promise<EstadoDaAtualizacao>;
  /** Verificação manual. */
  verificar: () => Promise<EstadoDaAtualizacao>;
  /** Fecha o app, instala e reabre; só faz efeito em "pronta". */
  instalarAgora: () => Promise<void>;
  /** Avisa a cada mudança; devolve a função que cancela o aviso. */
  aoMudar: (callback: (estado: EstadoDaAtualizacao) => void) => () => void;
}

interface PonteDoDesktop {
  desktop?: boolean;
  plataforma?: string;
  janela?: ApiDaJanela;
  configuracao?: ApiDaConfiguracao;
  atualizacao?: ApiDaAtualizacao;
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

/** Devolve a API da atualização do app desktop, ou null quando a ponte não a expõe. */
export function apiDaAtualizacao(): ApiDaAtualizacao | null {
  return ponteDoDesktop()?.atualizacao ?? null;
}

/** true quando a tela está rodando dentro do app desktop (Electron). */
export function rodandoNoDesktop(): boolean {
  return apiDaJanela() !== null;
}
