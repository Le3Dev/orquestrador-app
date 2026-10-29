import { createContext, useContext } from "react";

import type { ResumoDoOrquestrador, SinalDeVida } from "../api/tipos";
import type { EstadoDaConversa } from "../estado/aplicarEvento";
import type { SituacaoDaConexao } from "../hooks/useConversas";
import type { EstadoDoServidor } from "../hooks/useServidor";

export interface AcoesDoCanvas {
  abrirTerminal: (orquestradorId: string) => void;
  fecharTerminal: (orquestradorId: string) => void;
  /** O rascunho de configuração virou um Orquestrador de verdade: troca pelo terminal, no mesmo lugar. */
  orquestradorCriado: (rascunhoId: string, orquestrador: ResumoDoOrquestrador) => void;
  descartarRascunho: (rascunhoId: string) => void;
  recarregar: () => Promise<void>;
}

/**
 * O que os nós do canvas leem ao vivo. Fica num contexto, e não em
 * `node.data`, para o React Flow não precisar recriar os nós a cada evento:
 * os nós guardam só ids, e o estado chega por aqui.
 */
export interface ValorDoCanvas {
  orquestradores: ReadonlyMap<string, ResumoDoOrquestrador>;
  conversas: ReadonlyMap<string, EstadoDaConversa>;
  conexoes: ReadonlyMap<string, SituacaoDaConexao>;
  sinais: ReadonlyMap<string, SinalDeVida>;
  servidor: EstadoDoServidor;
  acoes: AcoesDoCanvas;
}

export const ContextoDoCanvas = createContext<ValorDoCanvas | null>(null);

export function useCanvas(): ValorDoCanvas {
  const valor = useContext(ContextoDoCanvas);
  if (valor === null) {
    throw new Error("useCanvas deve ser usado dentro do canvas de orquestradores.");
  }
  return valor;
}
