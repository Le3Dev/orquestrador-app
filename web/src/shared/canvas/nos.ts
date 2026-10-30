import type { Edge, Node } from "@xyflow/react";

import type { SituacaoDoSubagente } from "../api/tipos";
import type { EstadoDaConversa, SubagenteNaTela } from "../estado/aplicarEvento";
import {
  ALTURA_DA_NOTA_MINIMIZADA,
  type BixinhosLimpos,
  type LayoutDoCanvas,
  type Ponto,
  posicoesDosBixinhos,
  TAMANHO_DA_NOTA,
  TAMANHO_DO_BIXINHO,
  TAMANHO_DO_TERMINAL,
} from "./layout";

export type DadosDoTerminal = { orquestradorId: string };
export type DadosDoRascunho = Record<string, never>;
export type DadosDoBixinho = { orquestradorId: string; subagenteId: string };
/**
 * A nota no canvas guarda só o id e o que é de layout: título e texto ficam
 * na loja das notas, para digitar não mexer nos nós.
 */
export type DadosDoNoDaNota = {
  notaId: string;
  minimizada: boolean;
  /** A altura da nota aberta; minimizada, o nó tem só a altura da barra, e restaurar volta a esta. */
  alturaAberta: number;
};

export type NoTerminal = Node<DadosDoTerminal, "terminal">;
export type NoRascunho = Node<DadosDoRascunho, "rascunho">;
export type NoBixinho = Node<DadosDoBixinho, "bixinho">;
export type NoNota = Node<DadosDoNoDaNota, "nota">;
export type NoDoCanvas = NoTerminal | NoRascunho | NoBixinho | NoNota;

/** A linha do terminal a um bixinho; `animated` já diz se o Subagente trabalha. */
export type ArestaDoBixinho = Edge<Record<string, never>, "bixinho">;
export type ArestaDoCanvas = ArestaDoBixinho;

/** Só a barra de título arrasta o terminal: no corpo, o mouse seleciona texto e rola. */
export const ALCA_DO_TERMINAL = "alca-do-terminal";
/** Idem para a nota: no corpo, o mouse escreve e seleciona texto. */
export const ALCA_DA_NOTA = "alca-da-nota";

export function ehTerminal(no: NoDoCanvas): no is NoTerminal {
  return no.type === "terminal";
}

export function ehBixinho(no: NoDoCanvas): no is NoBixinho {
  return no.type === "bixinho";
}

export function ehNota(no: NoDoCanvas): no is NoNota {
  return no.type === "nota";
}

/** O id do nó de uma nota; com prefixo, para nunca coincidir com o de um terminal. */
export function idDoNoDaNota(notaId: string): string {
  return `nota:${notaId}`;
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

export function novaNota(
  notaId: string,
  posicao: Ponto,
  largura: number = TAMANHO_DA_NOTA.largura,
  altura: number = TAMANHO_DA_NOTA.altura,
  minimizada = false,
): NoNota {
  return {
    id: idDoNoDaNota(notaId),
    type: "nota",
    position: posicao,
    width: largura,
    height: minimizada ? ALTURA_DA_NOTA_MINIMIZADA : altura,
    dragHandle: `.${ALCA_DA_NOTA}`,
    data: { notaId, minimizada, alturaAberta: altura },
  };
}

/** A altura da nota aberta, esteja ela minimizada ou não. */
function alturaAbertaDaNota(no: NoNota): number {
  return no.data.minimizada ? no.data.alturaAberta : (no.height ?? no.measured?.height ?? TAMANHO_DA_NOTA.altura);
}

/** Minimiza a nota (fica só a barra de título, no mesmo lugar) ou a restaura ao tamanho de antes. */
export function minimizarOuRestaurar(no: NoNota): NoNota {
  const alturaAberta = Math.round(alturaAbertaDaNota(no));
  const minimizada = !no.data.minimizada;
  return {
    ...no,
    height: minimizada ? ALTURA_DA_NOTA_MINIMIZADA : alturaAberta,
    data: { ...no.data, minimizada, alturaAberta },
  };
}

/**
 * Acerta as notas do canvas com a lista do servidor: as que não existem mais
 * saem (e, com isso, do layout), menos as de `manter` (criadas depois que a
 * lista saiu); as que ainda não têm nó ganham um na posição padrão. Devolve
 * o mesmo array quando nada muda.
 */
export function sincronizarNotas(
  nos: NoDoCanvas[],
  notaIds: readonly string[],
  manter: ReadonlySet<string>,
  posicaoPadrao: (ocupadas: readonly Ponto[]) => Ponto,
): NoDoCanvas[] {
  const existentes = new Set(notaIds);
  const restantes = nos.filter((no) => !ehNota(no) || existentes.has(no.data.notaId) || manter.has(no.data.notaId));
  const noCanvas = new Set(restantes.filter(ehNota).map((no) => no.data.notaId));
  const ocupadas = restantes.filter(ehNota).map((no) => no.position);
  const novas: NoNota[] = [];
  for (const notaId of notaIds) {
    if (!noCanvas.has(notaId)) {
      const nota = novaNota(notaId, posicaoPadrao(ocupadas));
      ocupadas.push(nota.position);
      novas.push(nota);
    }
  }
  return restantes.length === nos.length && novas.length === 0 ? nos : [...restantes, ...novas];
}

export function nosDoLayout(layout: LayoutDoCanvas): NoDoCanvas[] {
  const terminais = Object.entries(layout.terminais).map(([id, retangulo]) =>
    novoTerminal(id, { x: retangulo.x, y: retangulo.y }, retangulo.largura, retangulo.altura),
  );
  // O conteúdo das notas chega do servidor depois; os nós já nascem aqui para
  // a gravação do layout, logo ao abrir, não apagar a posição delas.
  const notas = Object.entries(layout.notas).map(([notaId, retangulo]) =>
    novaNota(notaId, { x: retangulo.x, y: retangulo.y }, retangulo.largura, retangulo.altura, retangulo.minimizada),
  );
  return [...terminais, ...notas];
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
  const notas: LayoutDoCanvas["notas"] = {};
  for (const no of nos.filter(ehNota)) {
    notas[no.data.notaId] = {
      x: Math.round(no.position.x),
      y: Math.round(no.position.y),
      largura: Math.round(no.width ?? no.measured?.width ?? TAMANHO_DA_NOTA.largura),
      altura: Math.round(alturaAbertaDaNota(no)),
      minimizada: no.data.minimizada,
    };
  }
  return { terminais, notas, viewport };
}

/** Remove um terminal e os bixinhos dele (filhos não podem ficar sem o pai no React Flow). */
export function semTerminal(nos: readonly NoDoCanvas[], id: string): NoDoCanvas[] {
  return nos.filter((no) => no.id !== id && no.parentId !== id);
}

/**
 * Os bixinhos que um terminal mostra: os Subagentes do último pedido, menos
 * os que o usuário limpou. Quando um pedido novo começa, os do anterior vão
 * embora — o histórico deles continua no terminal.
 */
export function subagentesVisiveis(
  conversa: EstadoDaConversa | undefined,
  limpos?: BixinhosLimpos,
): SubagenteNaTela[] {
  const turno = conversa?.turnos.at(-1);
  if (turno === undefined) {
    return [];
  }
  // A limpeza de um pedido anterior não vale para o atual.
  if (limpos === undefined || limpos.turnoId !== turno.id) {
    return turno.subagentes;
  }
  return turno.subagentes.filter((subagente) => !limpos.subagentes.includes(subagente.id));
}

/** O que "Limpar bixinhos" tira do canvas: os bixinhos à vista cujo Subagente não está executando. */
export function bixinhosParaLimpar(conversa: EstadoDaConversa | undefined, limpos?: BixinhosLimpos): SubagenteNaTela[] {
  return subagentesVisiveis(conversa, limpos).filter((subagente) => subagente.situacao !== "executando");
}

/**
 * Limpa os bixinhos parados de um terminal, somando-os aos já limpos do mesmo
 * pedido. Quem executa fica, e os Subagentes que nascerem depois aparecem
 * normalmente. Nulo quando não há o que limpar.
 */
export function limparBixinhos(
  conversa: EstadoDaConversa | undefined,
  limpos?: BixinhosLimpos,
): BixinhosLimpos | null {
  const turno = conversa?.turnos.at(-1);
  const novos = bixinhosParaLimpar(conversa, limpos);
  if (turno === undefined || novos.length === 0) {
    return null;
  }
  const anteriores = limpos?.turnoId === turno.id ? limpos.subagentes : [];
  return { turnoId: turno.id, subagentes: [...anteriores, ...novos.map((subagente) => subagente.id)] };
}

/**
 * Acerta os bixinhos do canvas com o estado das conversas.
 *
 * Quando o grupo de um terminal muda (nasce ou sai alguém), o grupo inteiro
 * é redistribuído abaixo dele: os Subagentes nascem um a um, em segundos, e
 * posicionar cada um só com o total daquele instante os deixava amontoados.
 * Grupos que não mudaram ficam onde estão — o usuário pode tê-los arrastado.
 * Os bixinhos limpos ficam de fora já aqui: não viram nó nem linha.
 *
 * Devolve o mesmo array quando nada muda, para não re-renderizar o canvas a
 * cada evento de progresso.
 */
export function sincronizarBixinhos(
  nos: NoDoCanvas[],
  conversas: ReadonlyMap<string, EstadoDaConversa>,
  limpezas: ReadonlyMap<string, BixinhosLimpos> = new Map(),
): NoDoCanvas[] {
  const atuais = new Map(nos.filter(ehBixinho).map((bixinho) => [bixinho.id, bixinho]));
  const grupos = nos.filter(ehTerminal).map((terminal) => ({
    terminal,
    membros: subagentesVisiveis(
      conversas.get(terminal.data.orquestradorId),
      limpezas.get(terminal.data.orquestradorId),
    ).map((subagente) => ({
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
): ArestaDoCanvas[] {
  return nos.filter(ehBixinho).flatMap((bixinho): ArestaDoBixinho[] => {
    const subagente = subagentesVisiveis(conversas.get(bixinho.data.orquestradorId)).find(
      (candidato) => candidato.id === bixinho.data.subagenteId,
    );
    if (subagente === undefined || bixinho.parentId === undefined) {
      return [];
    }
    return [
      {
        id: `aresta:${bixinho.id}`,
        type: "bixinho",
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

/**
 * Os bixinhos anteriores enquanto nenhum nasce, some ou troca de terminal: as
 * linhas só dependem disso, não da posição — arrastar não as recalcula.
 */
export function mesmasLigacoes(anteriores: NoBixinho[], novos: NoBixinho[]): NoBixinho[] {
  const iguais =
    anteriores.length === novos.length &&
    anteriores.every((anterior, indice) => {
      const novo = novos[indice];
      return (
        novo !== undefined &&
        anterior.id === novo.id &&
        anterior.parentId === novo.parentId &&
        anterior.data.orquestradorId === novo.data.orquestradorId &&
        anterior.data.subagenteId === novo.data.subagenteId
      );
    });
  return iguais ? anteriores : novos;
}

/** Duas linhas que o React Flow desenharia do mesmo jeito. */
function mesmaAresta(anterior: ArestaDoCanvas, nova: ArestaDoCanvas): boolean {
  return (
    anterior.id === nova.id &&
    anterior.source === nova.source &&
    anterior.target === nova.target &&
    anterior.type === nova.type &&
    anterior.animated === nova.animated &&
    anterior.className === nova.className
  );
}

/**
 * As linhas novas, reaproveitando o objeto anterior de cada uma que não mudou
 * — e o próprio array anterior quando nenhuma mudou. Arrastar um nó ou um
 * evento que não mexe na situação dos Subagentes não troca nada, e o React
 * Flow não redesenha as linhas à toa.
 */
export function reaproveitarArestas(anteriores: ArestaDoCanvas[], novas: ArestaDoCanvas[]): ArestaDoCanvas[] {
  const porId = new Map(anteriores.map((aresta) => [aresta.id, aresta]));
  const resultado = novas.map((nova) => {
    const anterior = porId.get(nova.id);
    return anterior !== undefined && mesmaAresta(anterior, nova) ? anterior : nova;
  });
  const nadaMudou = resultado.length === anteriores.length && resultado.every((aresta, indice) => aresta === anteriores[indice]);
  return nadaMudou ? anteriores : resultado;
}
