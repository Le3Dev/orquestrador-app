import type { Edge, Node } from "@xyflow/react";

import type { SituacaoDoSubagente } from "../api/tipos";
import type { EstadoDaConversa, SubagenteNaTela } from "../estado/aplicarEvento";
import {
  type LayoutDoCanvas,
  type Ponto,
  posicoesDosBixinhos,
  TAMANHO_DO_BIXINHO,
  TAMANHO_DO_TERMINAL,
} from "./layout";

export type DadosDoTerminal = { orquestradorId: string };
export type DadosDoRascunho = Record<string, never>;
export type DadosDoBixinho = { orquestradorId: string; subagenteId: string };

export type NoTerminal = Node<DadosDoTerminal, "terminal">;
export type NoRascunho = Node<DadosDoRascunho, "rascunho">;
export type NoBixinho = Node<DadosDoBixinho, "bixinho">;
export type NoDoCanvas = NoTerminal | NoRascunho | NoBixinho;

/** Só a barra de título arrasta o terminal: no corpo, o mouse seleciona texto e rola. */
export const ALCA_DO_TERMINAL = "alca-do-terminal";

export function ehTerminal(no: NoDoCanvas): no is NoTerminal {
  return no.type === "terminal";
}

export function ehBixinho(no: NoDoCanvas): no is NoBixinho {
  return no.type === "bixinho";
}

export function idDoBixinho(orquestradorId: string, subagenteId: string): string {
  return `${orquestradorId}::${subagenteId}`;
}

export function novoTerminal(orquestradorId: string, posicao: Ponto, largura: number, altura: number): NoTerminal {
  return {
    id: orquestradorId,
    type: "terminal",
    position: posicao,
    width: largura,
    height: altura,
    dragHandle: `.${ALCA_DO_TERMINAL}`,
    data: { orquestradorId },
  };
}

export function nosDoLayout(layout: LayoutDoCanvas): NoDoCanvas[] {
  return Object.entries(layout.terminais).map(([id, retangulo]) =>
    novoTerminal(id, { x: retangulo.x, y: retangulo.y }, retangulo.largura, retangulo.altura),
  );
}

export function layoutDosNos(nos: readonly NoDoCanvas[], viewport: LayoutDoCanvas["viewport"]): LayoutDoCanvas {
  const terminais: LayoutDoCanvas["terminais"] = {};
  for (const no of nos.filter(ehTerminal)) {
    terminais[no.id] = {
      x: Math.round(no.position.x),
      y: Math.round(no.position.y),
      largura: Math.round(no.width ?? no.measured?.width ?? TAMANHO_DO_TERMINAL.largura),
      altura: Math.round(no.height ?? no.measured?.height ?? TAMANHO_DO_TERMINAL.altura),
    };
  }
  return { terminais, viewport };
}

/** Remove um terminal e os bixinhos dele (filhos não podem ficar sem o pai no React Flow). */
export function semTerminal(nos: readonly NoDoCanvas[], id: string): NoDoCanvas[] {
  return nos.filter((no) => no.id !== id && no.parentId !== id);
}

/**
 * Os bixinhos que um terminal mostra: os Subagentes do último pedido. Quando
 * um pedido novo começa, os do anterior vão embora — o histórico deles
 * continua no terminal.
 */
export function subagentesVisiveis(conversa: EstadoDaConversa | undefined): SubagenteNaTela[] {
  return conversa?.turnos.at(-1)?.subagentes ?? [];
}

/**
 * Acerta os bixinhos do canvas com o estado das conversas.
 *
 * Quando o grupo de um terminal muda (nasce ou sai alguém), o grupo inteiro
 * é redistribuído abaixo dele: os Subagentes nascem um a um, em segundos, e
 * posicionar cada um só com o total daquele instante os deixava amontoados.
 * Grupos que não mudaram ficam onde estão — o usuário pode tê-los arrastado.
 *
 * Devolve o mesmo array quando nada muda, para não re-renderizar o canvas a
 * cada evento de progresso.
 */
export function sincronizarBixinhos(
  nos: NoDoCanvas[],
  conversas: ReadonlyMap<string, EstadoDaConversa>,
): NoDoCanvas[] {
  const atuais = new Map(nos.filter(ehBixinho).map((bixinho) => [bixinho.id, bixinho]));
  const grupos = nos.filter(ehTerminal).map((terminal) => ({
    terminal,
    membros: subagentesVisiveis(conversas.get(terminal.data.orquestradorId)).map((subagente) => ({
      id: idDoBixinho(terminal.id, subagente.id),
      subagenteId: subagente.id,
    })),
  }));
  const desejados = new Set(grupos.flatMap((grupo) => grupo.membros.map((membro) => membro.id)));

  const gruposAlterados = grupos.filter(
    ({ terminal, membros }) =>
      membros.some((membro) => !atuais.has(membro.id)) ||
      [...atuais.values()].filter((bixinho) => bixinho.parentId === terminal.id).length !== membros.length,
  );
  const sobrou = [...atuais.keys()].some((id) => !desejados.has(id));
  if (gruposAlterados.length === 0 && !sobrou) {
    return nos;
  }

  const redistribuidos = new Set(gruposAlterados.map((grupo) => grupo.terminal.id));
  const mantidos = nos.filter(
    (no) => !ehBixinho(no) || (desejados.has(no.id) && !redistribuidos.has(no.parentId ?? "")),
  );
  const reposicionados = gruposAlterados.flatMap(({ terminal, membros }): NoBixinho[] => {
    const largura = terminal.width ?? terminal.measured?.width ?? TAMANHO_DO_TERMINAL.largura;
    const altura = terminal.height ?? terminal.measured?.height ?? TAMANHO_DO_TERMINAL.altura;
    const posicoes = posicoesDosBixinhos(membros.length, largura, altura);
    return membros.map(({ id, subagenteId }, indice) => ({
      ...atuais.get(id),
      id,
      type: "bixinho",
      parentId: terminal.id,
      position: posicoes[indice] ?? { x: 0, y: altura },
      width: TAMANHO_DO_BIXINHO.largura,
      height: TAMANHO_DO_BIXINHO.altura,
      data: { orquestradorId: terminal.data.orquestradorId, subagenteId },
    }));
  });

  // O React Flow exige que o pai venha antes dos filhos no array.
  return [...mantidos, ...reposicionados];
}

const CLASSE_DA_ARESTA: Readonly<Record<SituacaoDoSubagente, string>> = {
  executando: "aresta-executando",
  concluido: "aresta-concluido",
  falhou: "aresta-falhou",
  cancelado: "aresta-cancelado",
};

/** Uma linha do terminal a cada bixinho; animada enquanto ele trabalha. */
export function arestasDosBixinhos(
  nos: readonly NoDoCanvas[],
  conversas: ReadonlyMap<string, EstadoDaConversa>,
): Edge[] {
  return nos.filter(ehBixinho).flatMap((bixinho) => {
    const subagente = subagentesVisiveis(conversas.get(bixinho.data.orquestradorId)).find(
      (candidato) => candidato.id === bixinho.data.subagenteId,
    );
    if (subagente === undefined || bixinho.parentId === undefined) {
      return [];
    }
    return [
      {
        id: `aresta:${bixinho.id}`,
        source: bixinho.parentId,
        target: bixinho.id,
        animated: subagente.situacao === "executando",
        className: CLASSE_DA_ARESTA[subagente.situacao],
        selectable: false,
        focusable: false,
      },
    ];
  });
}
