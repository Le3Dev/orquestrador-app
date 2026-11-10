import {
  createContext,
  createElement,
  type ReactElement,
  type ReactNode,
  useContext,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
} from "react";

import type { ItemLigadoParaEnvio } from "../api/cliente";
import type { ResumoDoOrquestrador, SinalDeVida } from "../api/tipos";
import type { EstadoDaConversa } from "../estado/aplicarEvento";
import type { SituacaoDaConexao } from "../hooks/useConversas";
import { mesmoConteudo } from "../hooks/useReaproveitado";
import type { EstadoDoServidor } from "../hooks/useServidor";
import type { BixinhosLimpos, EscalaDaLetra } from "./layout";
import type { RegraDeFechamentoDePrevias } from "./nos";

export interface AcoesDoCanvas {
  abrirTerminal: (orquestradorId: string) => void;
  fecharTerminal: (orquestradorId: string) => void;
  /** Minimiza o terminal à barra de título (a bolinha amarela do Mac) ou o restaura. Fica no layout do canvas. */
  minimizarOuRestaurarTerminal: (orquestradorId: string) => void;
  /** Tira do canvas os bixinhos do terminal que não estão executando. Só visual: o histórico continua. */
  limparBixinhos: (orquestradorId: string) => void;
  /** O rascunho de configuração virou um Orquestrador de verdade: troca pelo terminal, no mesmo lugar. */
  orquestradorCriado: (rascunhoId: string, orquestrador: ResumoDoOrquestrador) => void;
  descartarRascunho: (rascunhoId: string) => void;
  /**
   * Troca o tamanho da letra do cartão (terminal ou rascunho, pelo id do nó)
   * e muda o tamanho dele na mesma proporção. Fica no layout do canvas.
   */
  mudarEscalaDaLetra: (noId: string, escalaDaLetra: EscalaDaLetra) => void;
  recarregar: () => Promise<void>;
  /**
   * Abre a prévia ao vivo de um servidor que o Orquestrador subiu: se ela já
   * existe (mesmo terminal, mesmo endereço), restaura e centraliza a vista
   * nela; senão, cria ao lado do terminal. `peloAgente`: aberta sozinha porque o
   * agente citou o endereço na resposta; só essas fecham sozinhas depois.
   */
  abrirPrevia: (orquestradorId: string, url: string, opcoes?: { peloAgente?: boolean }) => void;
  /** O usuário mexeu na prévia (clicou, digitou, recarregou, redimensionou): ela deixa de fechar sozinha. */
  tocarPrevia?: (previaId: string) => void;
  /** Fecha as prévias que o agente abriu e o usuário não tocou, segundo a regra (pedido do agente ou fim de turno). */
  fecharPreviasDoAgente?: (orquestradorId: string, regra: RegraDeFechamentoDePrevias) => void;
  /** Os endereços das prévias abertas deste Orquestrador, como vão no próximo pedido (`previasAbertas`). */
  lerPreviasAbertas?: (orquestradorId: string) => string[];
  /** Leva a prévia a outro endereço (já validado). */
  navegarPrevia: (previaId: string, url: string) => void;
  minimizarOuRestaurarPrevia: (previaId: string) => void;
  /** Tira a prévia do canvas e, com isso, do layout. */
  fecharPrevia: (previaId: string) => void;
  /** Desliga do terminal uma nota, prévia ou artefato (pelo id do nó): o × do chip. Fica no layout do canvas. */
  desligarItem?: (orquestradorId: string, itemId: string) => void;
  /** Os itens ligados ao terminal agora, como vão no próximo pedido (enviar ou pôr na fila). */
  lerItensLigados?: (orquestradorId: string) => ItemLigadoParaEnvio[];
}

/**
 * O que os nós do canvas leem ao vivo. Fica num contexto, e não em
 * `node.data`, para o React Flow não precisar recriar os nós a cada evento:
 * os nós guardam só ids, e o estado chega por aqui.
 *
 * O valor só muda quando algo daqui muda — arrastar ou mover o canvas não o
 * troca. Ainda assim, todo nó que usa `useCanvas` re-renderiza quando
 * qualquer parte muda (um evento de qualquer conversa, por exemplo); para ler
 * só um pedaço, use `useSeletorDoCanvas`.
 */
export interface ValorDoCanvas {
  orquestradores: ReadonlyMap<string, ResumoDoOrquestrador>;
  conversas: ReadonlyMap<string, EstadoDaConversa>;
  conexoes: ReadonlyMap<string, SituacaoDaConexao>;
  sinais: ReadonlyMap<string, SinalDeVida>;
  /** Bixinhos limpos do canvas, por id do Orquestrador. */
  bixinhosLimpos: ReadonlyMap<string, BixinhosLimpos>;
  /**
   * Os ids dos nós dos bixinhos saindo sozinhos agora (o Subagente terminou):
   * encolhem e somem antes de virarem limpos. Ausente, nenhum.
   */
  bixinhosSaindo?: ReadonlySet<string>;
  /**
   * Situação da conexão e a memória por Orquestrador. Só é trocado quando
   * uma delas muda: os totais de memória do computador (`livreBytes`,
   * `agentesBytes`...) podem estar defasados aqui — o painel de status os lê
   * direto de `useServidor`.
   */
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

/**
 * O estado do servidor como os nós precisam: o anterior enquanto a conexão e a
 * memória por Orquestrador (o "RAM" de cada terminal) não mudarem. A memória
 * livre do computador muda a cada leitura e, sozinha, re-renderizaria todos
 * os nós sem mudar nada neles.
 */
export function servidorParaOsNos(anterior: EstadoDoServidor, novo: EstadoDoServidor): EstadoDoServidor {
  const igual =
    anterior.conectado === novo.conectado &&
    anterior.caiuEm === novo.caiuEm &&
    anterior.voltouEm === novo.voltouEm &&
    anterior.reiniciou === novo.reiniciou &&
    (anterior.memoria === null) === (novo.memoria === null) &&
    mesmoConteudo(anterior.memoria?.porOrquestrador, novo.memoria?.porOrquestrador);
  return igual ? anterior : novo;
}

/** O valor do canvas para quem lê só um pedaço dele: o atual e um aviso quando muda. */
interface LojaDoCanvas {
  ler: () => ValorDoCanvas;
  assinar: (aoMudar: () => void) => () => void;
  publicar: (valor: ValorDoCanvas) => void;
}

function criarLojaDoCanvas(inicial: ValorDoCanvas): LojaDoCanvas {
  let atual = inicial;
  const ouvintes = new Set<() => void>();
  return {
    ler: () => atual,
    assinar: (aoMudar) => {
      ouvintes.add(aoMudar);
      return () => {
        ouvintes.delete(aoMudar);
      };
    },
    publicar: (valor) => {
      if (valor === atual) {
        return;
      }
      atual = valor;
      for (const aoMudar of ouvintes) {
        aoMudar();
      }
    },
  };
}

const LOJA_AUSENTE: LojaDoCanvas = {
  ler: () => {
    throw new Error("useSeletorDoCanvas deve ser usado dentro do ProvedorDoCanvas.");
  },
  assinar: () => () => undefined,
  publicar: () => undefined,
};

const ContextoDaLojaDoCanvas = createContext<LojaDoCanvas | null>(null);

/**
 * Entrega o valor do canvas aos dois jeitos de ler: `useCanvas` (tudo) e
 * `useSeletorDoCanvas` (só um pedaço).
 */
export function ProvedorDoCanvas({ valor, children }: { valor: ValorDoCanvas; children?: ReactNode }): ReactElement {
  const [loja] = useState(() => criarLojaDoCanvas(valor));
  useLayoutEffect(() => loja.publicar(valor), [loja, valor]);
  return createElement(
    ContextoDaLojaDoCanvas.Provider,
    { value: loja },
    createElement(ContextoDoCanvas.Provider, { value: valor }, children),
  );
}

/**
 * Lê só um pedaço do canvas e só re-renderiza quando esse pedaço muda — por
 * exemplo, `useSeletorDoCanvas((canvas) => canvas.conversas.get(id))` não
 * re-renderiza com eventos das conversas dos outros terminais.
 *
 * O seletor deve devolver algo que já existe no valor (um item dos mapas, as
 * ações) ou um primitivo; um objeto novo a cada chamada re-renderizaria sem
 * parar. Exige o `ProvedorDoCanvas`.
 */
export function useSeletorDoCanvas<T>(selecionar: (valor: ValorDoCanvas) => T): T {
  const loja = useContext(ContextoDaLojaDoCanvas) ?? LOJA_AUSENTE;
  return useSyncExternalStore(loja.assinar, () => selecionar(loja.ler()));
}

/** As ações do canvas: estáveis, então quem só as usa não re-renderiza com os eventos nem com o servidor. */
export function useAcoesDoCanvas(): AcoesDoCanvas {
  return useSeletorDoCanvas((valor) => valor.acoes);
}

/** A conversa de um Orquestrador; só muda com os eventos dele. */
export function useConversaDoCanvas(orquestradorId: string): EstadoDaConversa | undefined {
  return useSeletorDoCanvas((valor) => valor.conversas.get(orquestradorId));
}
