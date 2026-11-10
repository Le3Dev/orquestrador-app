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

/** Foto da tela (JPEG reduzido) do monitor onde está a janela. */
export interface CapturaDeTela {
  nome: string;
  tipoDeMidia: "image/jpeg";
  base64: string;
}

/**
 * O modo invisível: a janela fica transparente, só o header e o chat rápido
 * aparecem, e os cliques fora deles atravessam para os apps de trás.
 */
export interface ApiDoModoInvisivel {
  entrar: () => Promise<void>;
  sair: () => Promise<void>;
  /** true: a janela recebe os cliques; false: eles atravessam para os apps de trás. */
  capturarMouse: (capturar: boolean) => Promise<void>;
  capturarTela: () => Promise<CapturaDeTela>;
  /** Botão "capturar agora": o quadro atual da tela. */
  capturarAgora: () => Promise<CapturaDeTela>;
  /** Quadros capturados pelo atalho global Ctrl+Shift+S; devolve a função que cancela. */
  aoCapturarQuadro: (callback: (captura: CapturaDeTela) => void) => () => void;
  /** Avisa a cada entrar/sair (inclusive pelo atalho Ctrl+Shift+I); devolve a função que cancela o aviso. */
  aoMudar: (callback: (ativo: boolean) => void) => () => void;
  /**
   * Consulta se o modo invisível está ligado agora (para a tela que monta com o
   * modo já ativo, como o chat rápido ao alternar entre fixo e flutuante).
   */
  estaAtivo(): Promise<boolean>;
  /**
   * true quando a escuta do áudio do sistema (getDisplayMedia com loopback)
   * funciona nesta plataforma: hoje só no Windows.
   */
  escutaDisponivel: boolean;
  /**
   * Liga/desliga a escuta fora do modo invisível (botão do chat): o processo
   * principal passa a atender o getDisplayMedia com o áudio do sistema.
   * Opcional para pontes antigas.
   */
  definirEscutaLigada?(ligada: boolean): Promise<void>;
}

/** Onde o corpo da prévia está na tela (pixels CSS da janela) e a escala do canvas. */
export interface RetanguloDaPrevia {
  x: number;
  y: number;
  largura: number;
  altura: number;
  zoom: number;
}

/** O que o app desktop avisa sobre uma vista nativa da prévia. */
export type EventoDaPrevia =
  /** Foto da página (data URI JPEG), mostrada enquanto a prévia está inativa. */
  | { tipo: "foto"; id: string; foto: string }
  /**
   * `origem`: só protocolo e host da página que está aberta agora (muda ao navegar), ou null (ainda sem página).
   * `podeVoltar` e `podeAvancar`: o histórico da vista tem para onde ir.
   */
  | {
      tipo: "estado";
      id: string;
      carregando: boolean;
      erro: string | null;
      origem: string | null;
      podeVoltar: boolean;
      podeAvancar: boolean;
    }
  /** O app escondeu a vista (janela minimizada, modo invisível, Shift+Esc na página). */
  | { tipo: "desativada"; id: string }
  /** "Sair das contas" terminou: a tela descarta as fotos (data URI) que guardou das páginas. */
  | { tipo: "sessao-limpa" };

/**
 * Vista nativa da Prévia: endereços externos abrem num WebContentsView com
 * sessão própria (`persist:previa`), em que o login fica salvo. `id` é o
 * previaId. O app só aceita endereços http/https externos.
 */
export interface ApiDaPrevia {
  /** Cria a vista (escondida) e carrega o endereço; false se o app recusou. */
  abrir: (id: string, url: string, retangulo?: RetanguloDaPrevia) => Promise<boolean>;
  /** Mostra a vista (com o foco da página) ou a esconde; `retangulo` é obrigatório ao ativar. */
  ativar: (id: string, ativa: boolean, retangulo?: RetanguloDaPrevia) => Promise<boolean>;
  /** Acompanha o corpo da prévia na tela enquanto ativa. */
  retangulo: (id: string, retangulo: RetanguloDaPrevia) => void;
  recarregar: (id: string) => Promise<boolean>;
  /** Volta e avança no histórico da vista; false se não há para onde ir. O estado novo chega em `aoMudar`. */
  voltar: (id: string) => Promise<boolean>;
  avancar: (id: string) => Promise<boolean>;
  /** Destrói a vista. */
  fechar: (id: string) => Promise<boolean>;
  /** Apaga o login e os dados dos sites da sessão da prévia e recarrega as vistas abertas. */
  sairDasContas: () => Promise<boolean>;
  aoMudar: (callback: (evento: EventoDaPrevia) => void) => () => void;
}

interface PonteDoDesktop {
  desktop?: boolean;
  plataforma?: string;
  janela?: ApiDaJanela;
  configuracao?: ApiDaConfiguracao;
  atualizacao?: ApiDaAtualizacao;
  modoInvisivel?: ApiDoModoInvisivel;
  previa?: ApiDaPrevia;
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

/** Devolve a API do modo invisível, ou null fora do app desktop. */
export function apiDoModoInvisivel(): ApiDoModoInvisivel | null {
  const ponte = ponteDoDesktop();
  return ponte?.desktop && ponte.modoInvisivel ? ponte.modoInvisivel : null;
}

/** Devolve a API da vista nativa da prévia, ou null fora do app desktop (no navegador, endereço externo vira "abrir em nova aba"). */
export function apiDaPrevia(): ApiDaPrevia | null {
  const ponte = ponteDoDesktop();
  return ponte?.desktop && ponte.previa ? ponte.previa : null;
}

/** true quando a tela está rodando dentro do app desktop (Electron). */
export function rodandoNoDesktop(): boolean {
  return apiDaJanela() !== null;
}

/**
 * true dentro do app desktop no macOS (o preload expõe `plataforma`, o
 * process.platform). Lá a janela tem as 3 bolinhas nativas no canto esquerdo
 * da barra de título, e a tela não desenha os botões ─ ☐ ✕.
 */
export function rodandoNoMac(): boolean {
  return rodandoNoDesktop() && ponteDoDesktop()?.plataforma === "darwin";
}
