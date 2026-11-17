import type { RetanguloDaVista } from "../previaNativa";

/**
 * Ponte com o navegador do agente do app desktop (`window.electron.navegadorDoAgente`, electron/preload.js): um
 * Chromium por Orquestrador, que os agentes controlam por ferramentas MCP. `orquestradorId` identifica o
 * navegador. No navegador comum a ponte não existe e `apiDoNavegadorDoAgente` devolve nulo.
 */

/** O que o app avisa de um navegador aberto (`estados` e `aoMudar`). */
export interface EstadoDoNavegadorDoAgente {
  orquestradorId: string;
  /** A página atual; vazia antes da primeira. */
  url: string;
  titulo: string;
  carregando: boolean;
  /** Texto curto do que o agente está fazendo ou fez (nunca o texto digitado); nulo antes da primeira ação. */
  ultimaAcao: string | null;
  /** Um comando do agente está rodando agora. */
  emUsoPeloAgente: boolean;
  /** O usuário assumiu: os comandos do agente são recusados até ele devolver. */
  pausado: boolean;
  podeVoltar: boolean;
  podeAvancar: boolean;
}

export interface ApiDoNavegadorDoAgente {
  /** Acompanha o corpo do nó na tela (a cada quadro em que muda); só vale com a vista mostrada. */
  posicionar: (orquestradorId: string, retangulo: RetanguloDaVista) => void;
  /** Põe a vista sobre o nó (acima da tela); resolve false se o app recusou (sem navegador aberto, modo invisível). */
  mostrar: (orquestradorId: string, retangulo: RetanguloDaVista) => Promise<boolean>;
  /** Devolve a vista para baixo da tela: ela continua viva e o agente segue usando. */
  ocultar: (orquestradorId: string) => Promise<boolean>;
  /** O usuário assume: o agente é recusado ("O usuário assumiu o navegador; tente depois.") e a vista recebe o teclado. */
  pausar: (orquestradorId: string) => Promise<boolean>;
  /** O usuário devolve o navegador ao agente. */
  retomar: (orquestradorId: string) => Promise<boolean>;
  /** Fecha o navegador; `apagarDados` (ao excluir o Orquestrador) apaga também o login e os cookies. */
  fechar: (orquestradorId: string, apagarDados?: boolean) => Promise<boolean>;
  /** Os navegadores abertos agora (ao carregar a tela, para reabrir os nós). */
  estados: () => Promise<EstadoDoNavegadorDoAgente[]>;
  /** Data URI (JPEG) da página, para o nó mostrar enquanto a vista nativa está por baixo; nulo se falhou. */
  foto: (orquestradorId: string) => Promise<string | null>;
  /** Mudanças de qualquer navegador (só quando algo muda); devolve o cancelamento. */
  aoMudar: (callback: (estado: EstadoDoNavegadorDoAgente) => void) => () => void;
  /** O agente usou o navegador de um Orquestrador pela primeira vez (ou de novo, depois de fechado): a tela abre o nó. */
  aoAtivar: (callback: (dados: { orquestradorId: string }) => void) => () => void;
  /**
   * Voltar, avançar e recarregar a página, do usuário (os botões do nó, só com o agente pausado): resolvem false se
   * não há para onde ir. O app desktop os traz desde que o navegador do agente foi ligado aos turnos; ficam opcionais
   * por um app desktop antigo, que não os tem, e aí os botões do nó ficam desabilitados (o usuário navega dentro da
   * página depois de assumir o controle).
   */
  voltar?: (orquestradorId: string) => Promise<boolean>;
  avancar?: (orquestradorId: string) => Promise<boolean>;
  recarregar?: (orquestradorId: string) => Promise<boolean>;
}

interface PonteDoDesktop {
  desktop?: boolean;
  navegadorDoAgente?: ApiDoNavegadorDoAgente;
}

/** A ponte do navegador do agente, ou nulo fora do app desktop (e no app desktop antigo, que não a expõe). */
export function apiDoNavegadorDoAgente(): ApiDoNavegadorDoAgente | null {
  if (typeof window === "undefined") {
    return null;
  }
  const ponte = (window as unknown as { electron?: PonteDoDesktop }).electron;
  return ponte?.desktop === true && ponte.navegadorDoAgente !== undefined ? ponte.navegadorDoAgente : null;
}

/**
 * Fecha o navegador de um Orquestrador; com `apagarDados` (ao excluí-lo), apaga também o login e os cookies da
 * sessão. Nunca lança: sem a ponte (navegador comum) ou com o app falhando, não há o que fechar, e quem exclui o
 * Orquestrador não deve parar por isso.
 */
export async function fecharNavegadorDoAgente(orquestradorId: string, apagarDados = false): Promise<void> {
  try {
    await apiDoNavegadorDoAgente()?.fechar(orquestradorId, apagarDados);
  } catch {
    // O navegador já estava fechado, ou o app não respondeu: nada a desfazer.
  }
}
