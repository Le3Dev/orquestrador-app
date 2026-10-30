import { createContext, createElement, type ReactElement, type ReactNode, useContext, useSyncExternalStore } from "react";

import type { DadosDaNota } from "../api/tipos";

/**
 * O conteúdo das notas (título e texto) como o servidor o confirmou.
 *
 * Fica numa loja própria, e não no estado do canvas nem em `node.data`:
 * salvar uma nota avisa só o nó dela, e o canvas não re-renderiza. O texto em
 * edição nem passa por aqui — fica no próprio nó até ser salvo.
 */
export interface LojaDasNotas {
  ler: (notaId: string) => DadosDaNota | undefined;
  /** Por que a lista de notas não carregou; nulo depois que carrega. */
  lerErroAoCarregar: () => string | null;
  assinar: (aoMudar: () => void) => () => void;
  /** A lista do servidor. Uma nota que já está aqui só é trocada pela versão mais nova. */
  carregar: (notas: readonly DadosDaNota[]) => void;
  falhouAoCarregar: (erro: string) => void;
  /** A versão que o servidor devolveu ao criar ou salvar uma nota. */
  guardar: (nota: DadosDaNota) => void;
  /** A nota foi apagada: sai da loja. */
  esquecer: (notaId: string) => void;
  /** A nota acabou de ser criada: o texto dela recebe o foco quando aparecer. */
  pedirFoco: (notaId: string) => void;
  /** Verdadeiro uma vez só, para a nota que pediu o foco. */
  consumirFoco: (notaId: string) => boolean;
}

export function criarLojaDasNotas(): LojaDasNotas {
  const notas = new Map<string, DadosDaNota>();
  const focoPedido = new Set<string>();
  const ouvintes = new Set<() => void>();
  let erroAoCarregar: string | null = null;

  const avisar = (): void => {
    for (const aoMudar of ouvintes) {
      aoMudar();
    }
  };

  return {
    ler: (notaId) => notas.get(notaId),
    lerErroAoCarregar: () => erroAoCarregar,
    assinar: (aoMudar) => {
      ouvintes.add(aoMudar);
      return () => {
        ouvintes.delete(aoMudar);
      };
    },
    carregar: (lista) => {
      for (const nota of lista) {
        const atual = notas.get(nota.id);
        if (atual === undefined || atual.atualizadaEm < nota.atualizadaEm) {
          notas.set(nota.id, nota);
        }
      }
      erroAoCarregar = null;
      avisar();
    },
    falhouAoCarregar: (erro) => {
      erroAoCarregar = erro;
      avisar();
    },
    guardar: (nota) => {
      notas.set(nota.id, nota);
      avisar();
    },
    // Sem aviso: quem lê a nota é o nó dela, que está saindo do canvas — avisar
    // o faria mostrar "carregando nota…" por um quadro antes de sumir.
    esquecer: (notaId) => {
      focoPedido.delete(notaId);
      notas.delete(notaId);
    },
    pedirFoco: (notaId) => {
      focoPedido.add(notaId);
    },
    consumirFoco: (notaId) => focoPedido.delete(notaId),
  };
}

/** O que a nota pede ao canvas: só ele mexe nos nós. Funções estáveis. */
export interface AcoesDasNotas {
  minimizarOuRestaurar: (notaId: string) => void;
  /** A nota foi apagada no servidor: sai do canvas e, com isso, do layout. */
  notaApagada: (notaId: string) => void;
}

/** O valor do contexto das notas: estável, então ler o contexto nunca re-renderiza a nota. */
export interface ValorDasNotas {
  loja: LojaDasNotas;
  acoes: AcoesDasNotas;
}

const ContextoDasNotas = createContext<ValorDasNotas | null>(null);

export function ProvedorDasNotas({ valor, children }: { valor: ValorDasNotas; children?: ReactNode }): ReactElement {
  return createElement(ContextoDasNotas.Provider, { value: valor }, children);
}

function useValorDasNotas(): ValorDasNotas {
  const valor = useContext(ContextoDasNotas);
  if (valor === null) {
    throw new Error("As notas devem ser usadas dentro do ProvedorDasNotas.");
  }
  return valor;
}

export function useLojaDasNotas(): LojaDasNotas {
  return useValorDasNotas().loja;
}

export function useAcoesDasNotas(): AcoesDasNotas {
  return useValorDasNotas().acoes;
}

/** A nota como o servidor a confirmou; só muda quando ela mesma é carregada ou salva. */
export function useNota(notaId: string): DadosDaNota | undefined {
  const loja = useLojaDasNotas();
  return useSyncExternalStore(loja.assinar, () => loja.ler(notaId));
}

export function useErroAoCarregarNotas(): string | null {
  const loja = useLojaDasNotas();
  return useSyncExternalStore(loja.assinar, loja.lerErroAoCarregar);
}
