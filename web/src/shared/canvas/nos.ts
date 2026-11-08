import type { Edge, Node } from "@xyflow/react";

import type { SituacaoDoSubagente } from "../api/tipos";
import type { EstadoDaConversa, SubagenteNaTela } from "../estado/aplicarEvento";
import {
  ALTURA_DA_NOTA_MINIMIZADA,
  type BixinhosLimpos,
  ESCALA_DA_LETRA_PADRAO,
  type EscalaDaLetra,
  type LayoutDoCanvas,
  type Ponto,
  posicaoAoLado,
  posicaoLivrePerto,
  posicoesLivresDosBixinhos,
  type Retangulo,
  sobrepoe,
  TAMANHO_DA_NOTA,
  TAMANHO_DA_PREVIA,
  TAMANHO_DO_ARTEFATO,
  TAMANHO_DO_BIXINHO,
  TAMANHO_DO_RASCUNHO,
  TAMANHO_DO_SHELL,
  TAMANHO_DO_TERMINAL,
  TAMANHO_MINIMO_DO_TERMINAL,
  tamanhoNaEscalaDaLetra,
} from "./layout";

/** Sem `escalaDaLetra`, o cartão (terminal ou rascunho) mostra a letra normal. */
export type DadosDoTerminal = { orquestradorId: string; escalaDaLetra?: EscalaDaLetra };
export type DadosDoRascunho = { escalaDaLetra?: EscalaDaLetra };
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

/**
 * A prévia ao vivo (um navegador no canvas). O endereço fica aqui, e não numa
 * loja: só muda quando o usuário navega, e precisa ir para o layout.
 */
export type DadosDaPrevia = {
  previaId: string;
  /** Vazio enquanto o usuário não digita um endereço. */
  url: string;
  /** O Orquestrador de cujo terminal a prévia saiu; nulo quando aberta pela barra do canvas. */
  orquestradorId: string | null;
  minimizada: boolean;
  /** A altura da prévia aberta, como na nota. */
  alturaAberta: number;
};

/**
 * O bloco "Terminal" (um shell de verdade no canvas). Guarda o que vai para o
 * layout: o id do terminal no servidor (troca quando ele é aberto de novo), a
 * pasta e o Orquestrador ligado. A saída fica no xterm do bloco, não aqui.
 */
export type DadosDoNoDoShell = {
  shellId: string;
  terminalId: string;
  pasta: string;
  /** O Orquestrador de que o shell saiu; nulo quando aberto pela barra do canvas. */
  orquestradorId: string | null;
};

/**
 * A janela de um artefato guarda só o id: título, formato e versões ficam na
 * loja dos artefatos, para um evento de um artefato não mexer nos nós.
 */
export type DadosDoNoDoArtefato = { artefatoId: string };

export type NoTerminal = Node<DadosDoTerminal, "terminal">;
export type NoRascunho = Node<DadosDoRascunho, "rascunho">;
export type NoBixinho = Node<DadosDoBixinho, "bixinho">;
export type NoNota = Node<DadosDoNoDaNota, "nota">;
export type NoPrevia = Node<DadosDaPrevia, "previa">;
export type NoArtefato = Node<DadosDoNoDoArtefato, "artefato">;
export type NoShell = Node<DadosDoNoDoShell, "shell">;
export type NoDoCanvas = NoTerminal | NoRascunho | NoBixinho | NoNota | NoArtefato | NoPrevia | NoShell;
/** As janelas ligadas a um terminal por uma linha discreta: a prévia e o shell que saíram dele. */
type NoLigadoAoTerminal = NoPrevia | NoShell;

/**
 * O que a linha do terminal a um bixinho leva: a situação do Subagente, para
 * a linha notar quando ele conclui e entregar o relatório (o envelope), e
 * quando ele encerrou, para não entregar o que veio do histórico reenviado.
 */
export type DadosDaArestaDoBixinho = { situacao: SituacaoDoSubagente; encerradoEm: string | null };
/** A linha do terminal a um bixinho; `animated` já diz se o Subagente trabalha. */
export type ArestaDoBixinho = Edge<DadosDaArestaDoBixinho, "bixinho">;
/** A linha discreta (tracejada) do terminal à prévia (ou ao shell) que saiu dele: a curva padrão do React Flow. */
export type ArestaDaPrevia = Edge<Record<string, never>, "default">;
export type ArestaDoCanvas = ArestaDoBixinho | ArestaDaPrevia;

/** O `id` de cada âncora das linhas: o lado do nó, no terminal e no bixinho. */
export type Ancora = "cima" | "baixo" | "esquerda" | "direita";
/** Onde o bixinho está em relação ao terminal dele. */
export type LadoDoBixinho = "abaixo" | "acima" | "direita" | "esquerda";

/** De que âncora a linha sai no terminal e em qual chega no bixinho: os lados voltados um para o outro. */
const ANCORAS_DO_LADO: Readonly<Record<LadoDoBixinho, { terminal: Ancora; bixinho: Ancora }>> = {
  abaixo: { terminal: "baixo", bixinho: "cima" },
  acima: { terminal: "cima", bixinho: "baixo" },
  direita: { terminal: "direita", bixinho: "esquerda" },
  esquerda: { terminal: "esquerda", bixinho: "direita" },
};

/** Só a barra de título arrasta o terminal: no corpo, o mouse seleciona texto e rola. */
export const ALCA_DO_TERMINAL = "alca-do-terminal";
/** Idem para a nota: no corpo, o mouse escreve e seleciona texto. */
export const ALCA_DA_NOTA = "alca-da-nota";
/** Idem para a prévia: no corpo, o mouse é do site aberto. */
export const ALCA_DA_PREVIA = "alca-da-previa";
/** Idem para o artefato: no corpo, a página ou o documento recebem o mouse. */
export const ALCA_DO_ARTEFATO = "alca-do-artefato";
/** Idem para o shell: no corpo, o mouse seleciona o texto do terminal. */
export const ALCA_DO_SHELL = "alca-do-shell";

export function ehTerminal(no: NoDoCanvas): no is NoTerminal {
  return no.type === "terminal";
}

export function ehRascunho(no: NoDoCanvas): no is NoRascunho {
  return no.type === "rascunho";
}

export function ehBixinho(no: NoDoCanvas): no is NoBixinho {
  return no.type === "bixinho";
}

export function ehNota(no: NoDoCanvas): no is NoNota {
  return no.type === "nota";
}

export function ehPrevia(no: NoDoCanvas): no is NoPrevia {
  return no.type === "previa";
}

export function ehArtefato(no: NoDoCanvas): no is NoArtefato {
  return no.type === "artefato";
}

export function ehShell(no: NoDoCanvas): no is NoShell {
  return no.type === "shell";
}

/** O id do nó de uma nota; com prefixo, para nunca coincidir com o de um terminal. */
export function idDoNoDaNota(notaId: string): string {
  return `nota:${notaId}`;
}

/** O id do nó de uma prévia; com prefixo, como o da nota. */
export function idDoNoDaPrevia(previaId: string): string {
  return `previa:${previaId}`;
}

/** O id do nó de um shell; com prefixo, como o da nota. */
export function idDoNoDoShell(shellId: string): string {
  return `shell:${shellId}`;
}

/** O id do nó de um artefato; com prefixo, como o da nota. */
export function idDoNoDoArtefato(artefatoId: string): string {
  return `artefato:${artefatoId}`;
}

export function novoNoDeArtefato(
  artefatoId: string,
  posicao: Ponto,
  largura: number = TAMANHO_DO_ARTEFATO.largura,
  altura: number = TAMANHO_DO_ARTEFATO.altura,
): NoArtefato {
  return {
    id: idDoNoDoArtefato(artefatoId),
    type: "artefato",
    position: posicao,
    width: largura,
    height: altura,
    dragHandle: `.${ALCA_DO_ARTEFATO}`,
    data: { artefatoId },
  };
}

export function idDoBixinho(orquestradorId: string, subagenteId: string): string {
  return `${orquestradorId}::${subagenteId}`;
}

export function novoTerminal(
  orquestradorId: string,
  posicao: Ponto,
  largura: number,
  altura: number,
  escalaDaLetra: EscalaDaLetra = ESCALA_DA_LETRA_PADRAO,
): NoTerminal {
  return {
    id: orquestradorId,
    type: "terminal",
    position: posicao,
    width: largura,
    height: altura,
    dragHandle: `.${ALCA_DO_TERMINAL}`,
    // A letra normal fica sem o campo, como nos layouts antigos.
    data: escalaDaLetra === ESCALA_DA_LETRA_PADRAO ? { orquestradorId } : { orquestradorId, escalaDaLetra },
  };
}

/**
 * Troca o tamanho da letra de um terminal ou do rascunho e muda o tamanho do
 * cartão na mesma proporção (`tamanhoNaEscalaDaLetra`). Os outros nós, e o
 * mesmo tamanho de letra, voltam o mesmo objeto.
 */
export function comEscalaDaLetra(no: NoDoCanvas, escalaDaLetra: EscalaDaLetra): NoDoCanvas {
  if (!ehTerminal(no) && !ehRascunho(no)) {
    return no;
  }
  const anterior = no.data.escalaDaLetra ?? ESCALA_DA_LETRA_PADRAO;
  if (anterior === escalaDaLetra) {
    return no;
  }
  const padrao = ehTerminal(no) ? TAMANHO_DO_TERMINAL : TAMANHO_DO_RASCUNHO;
  const { largura, altura } = tamanhoNaEscalaDaLetra(
    tamanhoDoNo(no),
    anterior,
    escalaDaLetra,
    padrao,
    TAMANHO_MINIMO_DO_TERMINAL,
  );
  // Um ramo por tipo de nó: assim os dados de cada um continuam do tipo certo.
  return ehTerminal(no)
    ? { ...no, width: largura, height: altura, data: { ...no.data, escalaDaLetra } }
    : { ...no, width: largura, height: altura, data: { ...no.data, escalaDaLetra } };
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

export function novaPrevia(
  previaId: string,
  posicao: Ponto,
  { url, orquestradorId }: { url: string; orquestradorId: string | null },
  largura: number = TAMANHO_DA_PREVIA.largura,
  altura: number = TAMANHO_DA_PREVIA.altura,
  minimizada = false,
): NoPrevia {
  return {
    id: idDoNoDaPrevia(previaId),
    type: "previa",
    position: posicao,
    width: largura,
    height: minimizada ? ALTURA_DA_NOTA_MINIMIZADA : altura,
    dragHandle: `.${ALCA_DA_PREVIA}`,
    data: { previaId, url, orquestradorId, minimizada, alturaAberta: altura },
  };
}

export function novoShell(
  shellId: string,
  posicao: Ponto,
  { terminalId, pasta, orquestradorId }: Omit<DadosDoNoDoShell, "shellId">,
  largura: number = TAMANHO_DO_SHELL.largura,
  altura: number = TAMANHO_DO_SHELL.altura,
): NoShell {
  return {
    id: idDoNoDoShell(shellId),
    type: "shell",
    position: posicao,
    width: largura,
    height: altura,
    dragHandle: `.${ALCA_DO_SHELL}`,
    data: { shellId, terminalId, pasta, orquestradorId },
  };
}

/** As janelas que se minimizam à barra de título. */
type NoMinimizavel = NoNota | NoPrevia;

/** A altura da nota (ou prévia) aberta, esteja ela minimizada ou não. */
function alturaAbertaDaNota(no: NoMinimizavel): number {
  const padrao = ehNota(no) ? TAMANHO_DA_NOTA.altura : TAMANHO_DA_PREVIA.altura;
  return no.data.minimizada ? no.data.alturaAberta : (no.height ?? no.measured?.height ?? padrao);
}

/** Minimiza a nota ou a prévia (fica só a barra de título, no mesmo lugar) ou a restaura ao tamanho de antes. */
export function minimizarOuRestaurar<T extends NoMinimizavel>(no: T): T {
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
    novoTerminal(id, { x: retangulo.x, y: retangulo.y }, retangulo.largura, retangulo.altura, retangulo.escalaDaLetra),
  );
  // O conteúdo das notas chega do servidor depois; os nós já nascem aqui para
  // a gravação do layout, logo ao abrir, não apagar a posição delas.
  const notas = Object.entries(layout.notas).map(([notaId, retangulo]) =>
    novaNota(notaId, { x: retangulo.x, y: retangulo.y }, retangulo.largura, retangulo.altura, retangulo.minimizada),
  );
  const previas = Object.entries(layout.previas).map(([previaId, retangulo]) =>
    novaPrevia(
      previaId,
      { x: retangulo.x, y: retangulo.y },
      { url: retangulo.url, orquestradorId: retangulo.orquestradorId },
      retangulo.largura,
      retangulo.altura,
      retangulo.minimizada,
    ),
  );
  // Idem para os artefatos: o conteúdo chega do servidor depois.
  const artefatos = Object.entries(layout.artefatos).map(([artefatoId, retangulo]) =>
    novoNoDeArtefato(artefatoId, { x: retangulo.x, y: retangulo.y }, retangulo.largura, retangulo.altura),
  );
  // Os shells religam ao terminal do servidor quando o bloco monta (ou mostram "encerrado").
  const shells = Object.entries(layout.shells).map(([shellId, retangulo]) =>
    novoShell(
      shellId,
      { x: retangulo.x, y: retangulo.y },
      { terminalId: retangulo.terminalId, pasta: retangulo.pasta, orquestradorId: retangulo.orquestradorId },
      retangulo.largura,
      retangulo.altura,
    ),
  );
  return [...terminais, ...notas, ...artefatos, ...previas, ...shells];
}

export function layoutDosNos(nos: readonly NoDoCanvas[], viewport: LayoutDoCanvas["viewport"]): LayoutDoCanvas {
  const terminais: LayoutDoCanvas["terminais"] = {};
  for (const no of nos.filter(ehTerminal)) {
    const { escalaDaLetra } = no.data;
    terminais[no.id] = {
      x: Math.round(no.position.x),
      y: Math.round(no.position.y),
      largura: Math.round(no.width ?? no.measured?.width ?? TAMANHO_DO_TERMINAL.largura),
      altura: Math.round(no.height ?? no.measured?.height ?? TAMANHO_DO_TERMINAL.altura),
      // A letra normal fica sem o campo, como nos layouts antigos.
      ...(escalaDaLetra !== undefined && escalaDaLetra !== ESCALA_DA_LETRA_PADRAO ? { escalaDaLetra } : {}),
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
  const artefatos: LayoutDoCanvas["artefatos"] = {};
  for (const no of nos.filter(ehArtefato)) {
    artefatos[no.data.artefatoId] = {
      x: Math.round(no.position.x),
      y: Math.round(no.position.y),
      largura: Math.round(no.width ?? no.measured?.width ?? TAMANHO_DO_ARTEFATO.largura),
      altura: Math.round(no.height ?? no.measured?.height ?? TAMANHO_DO_ARTEFATO.altura),
    };
  }
  const previas: LayoutDoCanvas["previas"] = {};
  for (const no of nos.filter(ehPrevia)) {
    previas[no.data.previaId] = {
      x: Math.round(no.position.x),
      y: Math.round(no.position.y),
      largura: Math.round(no.width ?? no.measured?.width ?? TAMANHO_DA_PREVIA.largura),
      altura: Math.round(alturaAbertaDaNota(no)),
      minimizada: no.data.minimizada,
      url: no.data.url,
      orquestradorId: no.data.orquestradorId,
    };
  }
  const shells: LayoutDoCanvas["shells"] = {};
  for (const no of nos.filter(ehShell)) {
    shells[no.data.shellId] = {
      x: Math.round(no.position.x),
      y: Math.round(no.position.y),
      largura: Math.round(no.width ?? no.measured?.width ?? TAMANHO_DO_SHELL.largura),
      altura: Math.round(no.height ?? no.measured?.height ?? TAMANHO_DO_SHELL.altura),
      terminalId: no.data.terminalId,
      pasta: no.data.pasta,
      orquestradorId: no.data.orquestradorId,
    };
  }
  return { terminais, notas, artefatos, previas, shells, viewport };
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

/** O tamanho de um nó: o definido, o medido ou o padrão do tipo dele. */
function tamanhoDoNo(no: NoDoCanvas): { largura: number; altura: number } {
  const padrao = ehBixinho(no)
    ? TAMANHO_DO_BIXINHO
    : ehNota(no)
      ? TAMANHO_DA_NOTA
      : ehArtefato(no)
        ? TAMANHO_DO_ARTEFATO
        : ehPrevia(no)
          ? TAMANHO_DA_PREVIA
          : ehShell(no)
            ? TAMANHO_DO_SHELL
            : no.type === "rascunho"
              ? TAMANHO_DO_RASCUNHO
              : TAMANHO_DO_TERMINAL;
  return {
    largura: no.width ?? no.measured?.width ?? padrao.largura,
    altura: no.height ?? no.measured?.height ?? padrao.altura,
  };
}

/** Onde o nó fica no canvas, em coordenadas absolutas: o bixinho é relativo ao terminal, cuja posição é `origem`. */
function retanguloNoCanvas(no: NoDoCanvas, origem: Ponto = { x: 0, y: 0 }): Retangulo {
  return { x: origem.x + no.position.x, y: origem.y + no.position.y, ...tamanhoDoNo(no) };
}

/** As janelas do canvas (terminais, rascunhos, notas, artefatos, prévias e shells), com o retângulo de cada uma. */
function janelasNoCanvas(nos: readonly NoDoCanvas[]): { id: string; retangulo: Retangulo }[] {
  return nos.filter((no) => !ehBixinho(no)).map((no) => ({ id: no.id, retangulo: retanguloNoCanvas(no) }));
}

/**
 * Tudo o que ocupa lugar no canvas, em coordenadas absolutas: as janelas
 * (terminais, rascunhos, notas, artefatos e prévias) e os bixinhos. É o que uma
 * janela nova não deve cobrir.
 */
export function areasOcupadas(nos: readonly NoDoCanvas[]): { id: string; retangulo: Retangulo }[] {
  const origens = new Map(nos.filter((no) => !ehBixinho(no)).map((no) => [no.id, no.position]));
  return nos.map((no) => ({
    id: no.id,
    retangulo: ehBixinho(no) ? retanguloNoCanvas(no, origens.get(no.parentId ?? "")) : retanguloNoCanvas(no),
  }));
}

/** As janelas que não são o terminal dado: os bixinhos dele não podem ficar por cima delas. */
function outrasJanelas(janelas: readonly { id: string; retangulo: Retangulo }[], terminalId: string): Retangulo[] {
  return janelas.filter((janela) => janela.id !== terminalId).map((janela) => janela.retangulo);
}

/**
 * Acerta os bixinhos do canvas com o estado das conversas.
 *
 * Quando o grupo de um terminal muda (nasce ou sai alguém), o grupo inteiro
 * é redistribuído ao redor dele — abaixo, se houver lugar; senão, no primeiro
 * lugar livre de outras janelas e bixinhos: os Subagentes nascem um a um, em
 * segundos, e posicionar cada um só com o total daquele instante os deixava
 * amontoados. Grupos que não mudaram ficam onde estão — o usuário pode
 * tê-los arrastado. Os bixinhos limpos ficam de fora já aqui: não viram nó
 * nem linha.
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
  const janelas = janelasNoCanvas(nos);
  const origens = new Map(nos.filter((no) => !ehBixinho(no)).map((no) => [no.id, no.position]));
  // Os bixinhos que ficam onde estão já ocupam o lugar deles; os redistribuídos entram à medida que são posicionados.
  const bixinhosNoLugar = mantidos
    .filter(ehBixinho)
    .map((bixinho) => retanguloNoCanvas(bixinho, origens.get(bixinho.parentId ?? "")));
  const reposicionados: NoBixinho[] = [];
  for (const { terminal, membros } of gruposAlterados) {
    const retangulo = retanguloNoCanvas(terminal);
    const posicoes = posicoesLivresDosBixinhos(membros.length, retangulo, [
      ...outrasJanelas(janelas, terminal.id),
      ...bixinhosNoLugar,
    ]);
    for (const [indice, { id, subagenteId }] of membros.entries()) {
      const bixinho: NoBixinho = {
        ...atuais.get(id),
        id,
        type: "bixinho",
        parentId: terminal.id,
        position: posicoes[indice] ?? { x: 0, y: retangulo.altura },
        width: TAMANHO_DO_BIXINHO.largura,
        height: TAMANHO_DO_BIXINHO.altura,
        data: { orquestradorId: terminal.data.orquestradorId, subagenteId },
      };
      reposicionados.push(bixinho);
      bixinhosNoLugar.push(retanguloNoCanvas(bixinho, terminal.position));
    }
  }

  // O React Flow exige que o pai venha antes dos filhos no array.
  return [...mantidos, ...reposicionados];
}

/**
 * Tira os bixinhos de cima das outras janelas: o grupo de um terminal em que
 * algum bixinho ficou sobre outro terminal (ou rascunho) ou sobre uma nota vai
 * inteiro para o primeiro lugar livre ao redor do próprio terminal, longe
 * também dos bixinhos dos outros. Grupos sem conflito ficam exatamente onde
 * estão — inclusive os arrastados pelo usuário.
 *
 * Chamada ao soltar um arraste, ao terminar de redimensionar, ao abrir uma
 * janela e ao organizar — nunca a cada quadro do arraste. Devolve o mesmo
 * array quando nada muda.
 */
export function reacomodarBixinhos(nos: NoDoCanvas[]): NoDoCanvas[] {
  const bixinhos = nos.filter(ehBixinho);
  if (bixinhos.length === 0) {
    return nos;
  }
  const janelas = janelasNoCanvas(nos);
  const origens = new Map(nos.filter((no) => !ehBixinho(no)).map((no) => [no.id, no.position]));
  // Onde cada bixinho está agora, em coordenadas absolutas; acompanha os grupos que se movem.
  const ocupados = new Map(
    bixinhos.map((bixinho) => [bixinho.id, retanguloNoCanvas(bixinho, origens.get(bixinho.parentId ?? ""))]),
  );
  const novasPosicoes = new Map<string, Ponto>();

  for (const terminal of nos.filter(ehTerminal)) {
    const membros = bixinhos.filter((bixinho) => bixinho.parentId === terminal.id);
    const outras = outrasJanelas(janelas, terminal.id);
    const emConflito = membros.some((membro) => {
      const lugar = ocupados.get(membro.id);
      return lugar !== undefined && outras.some((janela) => sobrepoe(lugar, janela));
    });
    if (!emConflito) {
      continue;
    }

    const doGrupo = new Set(membros.map((membro) => membro.id));
    const dosOutros = [...ocupados].filter(([id]) => !doGrupo.has(id)).map(([, lugar]) => lugar);
    const posicoes = posicoesLivresDosBixinhos(membros.length, retanguloNoCanvas(terminal), [...outras, ...dosOutros]);
    const mudou = membros.some((membro, indice) => {
      const nova = posicoes[indice];
      return nova !== undefined && (nova.x !== membro.position.x || nova.y !== membro.position.y);
    });
    if (!mudou) {
      continue;
    }
    for (const [indice, membro] of membros.entries()) {
      const nova = posicoes[indice];
      if (nova !== undefined) {
        novasPosicoes.set(membro.id, nova);
        ocupados.set(membro.id, retanguloNoCanvas({ ...membro, position: nova }, terminal.position));
      }
    }
  }

  if (novasPosicoes.size === 0) {
    return nos;
  }
  return nos.map((no) => {
    const nova = novasPosicoes.get(no.id);
    return nova === undefined ? no : { ...no, position: nova };
  });
}

const CLASSE_DA_ARESTA: Readonly<Record<SituacaoDoSubagente, string>> = {
  executando: "aresta-executando",
  concluido: "aresta-concluido",
  falhou: "aresta-falhou",
  cancelado: "aresta-cancelado",
};

/**
 * De que lado do terminal o bixinho está, pela posição dele (relativa ao
 * terminal, de quem é filho) e pelos tamanhos dos dois: acima, se a base do
 * bixinho não passa do topo do terminal; à direita, se ele começa depois da
 * borda direita; à esquerda, se termina antes da borda esquerda; senão,
 * abaixo (o padrão — também quando está por cima do terminal). Encostar
 * conta como estar do lado, como em `sobrepoe`.
 */
export function ladoDoBixinho(bixinho: NoBixinho, terminal: NoTerminal): LadoDoBixinho {
  return ladoEmRelacaoAoTerminal(bixinho.position, tamanhoDoNo(bixinho), tamanhoDoNo(terminal));
}

/** A regra de `ladoDoBixinho`, para um nó na posição `{ x, y }` relativa ao terminal. */
function ladoEmRelacaoAoTerminal(
  { x, y }: Ponto,
  tamanho: { largura: number; altura: number },
  doTerminal: { largura: number; altura: number },
): LadoDoBixinho {
  if (y + tamanho.altura <= 0) {
    return "acima";
  }
  if (x >= doTerminal.largura) {
    return "direita";
  }
  if (x + tamanho.largura <= 0) {
    return "esquerda";
  }
  return "abaixo";
}

/**
 * De que lado do terminal a prévia (ou o shell) está, com a mesma regra dos
 * bixinhos. A prévia não é filha do terminal: a posição dela é absoluta.
 */
export function ladoDaPrevia(previa: NoLigadoAoTerminal, terminal: NoTerminal): LadoDoBixinho {
  const relativa = { x: previa.position.x - terminal.position.x, y: previa.position.y - terminal.position.y };
  return ladoEmRelacaoAoTerminal(relativa, tamanhoDoNo(previa), tamanhoDoNo(terminal));
}

/** O terminal de que a prévia (ou o shell) saiu, se ele estiver no canvas. */
function terminalDaPrevia(previa: NoLigadoAoTerminal, terminais: ReadonlyMap<string, NoTerminal>): NoTerminal | undefined {
  return previa.data.orquestradorId === null ? undefined : terminais.get(previa.data.orquestradorId);
}

/** O lado da prévia em relação ao terminal dela; nulo sem o terminal no canvas (não há linha). */
function ladoDaPreviaNoTerminal(
  previa: NoLigadoAoTerminal,
  terminais: ReadonlyMap<string, NoTerminal>,
): LadoDoBixinho | null {
  const terminal = terminalDaPrevia(previa, terminais);
  return terminal === undefined ? null : ladoDaPrevia(previa, terminal);
}

/**
 * Onde abrir a prévia do terminal dado: ao lado dele, longe das outras
 * janelas e dos bixinhos (`posicaoAoLado`). Nulo sem o terminal no canvas.
 */
export function posicaoDaPreviaDoTerminal(
  nos: readonly NoDoCanvas[],
  terminalId: string,
  tamanho: { largura: number; altura: number },
): Ponto | null {
  const terminal = nos.find((no) => ehTerminal(no) && no.id === terminalId);
  if (terminal === undefined) {
    return null;
  }
  const origens = new Map(nos.filter((no) => !ehBixinho(no)).map((no) => [no.id, no.position]));
  const obstaculos = [
    ...outrasJanelas(janelasNoCanvas(nos), terminalId),
    ...nos.filter(ehBixinho).map((bixinho) => retanguloNoCanvas(bixinho, origens.get(bixinho.parentId ?? ""))),
  ];
  return posicaoAoLado(retanguloNoCanvas(terminal), tamanho, obstaculos);
}

/**
 * Onde abrir o terminal do Orquestrador: nulo se ele já está no canvas (aí só
 * se leva a câmera até ele); senão, a primeira área livre perto de `inicio`,
 * sem cobrir nenhuma janela nem bixinho (`posicaoLivrePerto`).
 */
export function posicaoDoTerminalNovo(
  nos: readonly NoDoCanvas[],
  orquestradorId: string,
  inicio: Ponto,
  tamanho: { largura: number; altura: number },
): Ponto | null {
  if (nos.some((no) => ehTerminal(no) && no.data.orquestradorId === orquestradorId)) {
    return null;
  }
  return posicaoLivrePerto(
    inicio,
    tamanho,
    areasOcupadas(nos).map((area) => area.retangulo),
  );
}

/** O lado do bixinho em relação ao terminal dele; sem o terminal na lista, o padrão (abaixo). */
function ladoNoTerminal(bixinho: NoBixinho, terminais: ReadonlyMap<string, NoTerminal>): LadoDoBixinho {
  const terminal = terminais.get(bixinho.parentId ?? "");
  return terminal === undefined ? "abaixo" : ladoDoBixinho(bixinho, terminal);
}

function terminaisPorId(nos: readonly NoDoCanvas[]): Map<string, NoTerminal> {
  return new Map(nos.filter(ehTerminal).map((terminal) => [terminal.id, terminal]));
}

/**
 * Uma linha do terminal a cada bixinho; animada enquanto ele trabalha e com a
 * situação do Subagente e a hora do fim em `data` (a entrega do relatório). Sai do
 * lado do terminal voltado para o bixinho e chega no lado do bixinho voltado
 * para o terminal (`ladoDoBixinho`), por isso `nos` precisa trazer também os
 * terminais.
 */
export function arestasDosBixinhos(
  nos: readonly NoDoCanvas[],
  conversas: ReadonlyMap<string, EstadoDaConversa>,
): ArestaDoBixinho[] {
  const terminais = terminaisPorId(nos);
  return nos.filter(ehBixinho).flatMap((bixinho): ArestaDoBixinho[] => {
    const subagente = subagentesVisiveis(conversas.get(bixinho.data.orquestradorId)).find(
      (candidato) => candidato.id === bixinho.data.subagenteId,
    );
    if (subagente === undefined || bixinho.parentId === undefined) {
      return [];
    }
    const ancoras = ANCORAS_DO_LADO[ladoNoTerminal(bixinho, terminais)];
    return [
      {
        id: `aresta:${bixinho.id}`,
        type: "bixinho",
        source: bixinho.parentId,
        sourceHandle: ancoras.terminal,
        target: bixinho.id,
        targetHandle: ancoras.bixinho,
        animated: subagente.situacao === "executando",
        className: CLASSE_DA_ARESTA[subagente.situacao],
        data: { situacao: subagente.situacao, encerradoEm: subagente.encerradoEm },
        selectable: false,
        focusable: false,
      },
    ];
  });
}

/**
 * Uma linha discreta do terminal a cada prévia que saiu dele, do lado voltado
 * para ela (`ladoDaPrevia`). Prévias soltas, ou com o terminal fechado, ficam
 * sem linha. `nos` precisa trazer também os terminais.
 */
export function arestasDasPrevias(nos: readonly NoDoCanvas[]): ArestaDoCanvas[] {
  return arestasAoTerminal(nos.filter(ehPrevia), terminaisPorId(nos), "aresta-previa");
}

/**
 * Uma linha discreta do terminal a cada shell aberto a partir dele, como a da
 * prévia. Shells soltos, ou com o terminal fechado, ficam sem linha.
 */
export function arestasDosShells(nos: readonly NoDoCanvas[]): ArestaDoCanvas[] {
  return arestasAoTerminal(nos.filter(ehShell), terminaisPorId(nos), "aresta-shell");
}

function arestasAoTerminal(
  ligados: readonly NoLigadoAoTerminal[],
  terminais: ReadonlyMap<string, NoTerminal>,
  classe: string,
): ArestaDaPrevia[] {
  return ligados.flatMap((ligado): ArestaDaPrevia[] => {
    const terminal = terminalDaPrevia(ligado, terminais);
    if (terminal === undefined) {
      return [];
    }
    // As âncoras do lado: a do "bixinho" é a ponta que chega, aqui na prévia (ou no shell).
    const ancoras = ANCORAS_DO_LADO[ladoDaPrevia(ligado, terminal)];
    return [
      {
        id: `aresta:${ligado.id}`,
        type: "default",
        source: terminal.id,
        sourceHandle: ancoras.terminal,
        target: ligado.id,
        targetHandle: ancoras.bixinho,
        className: classe,
        selectable: false,
        focusable: false,
      },
    ];
  });
}

/**
 * Os nós anteriores (terminais, bixinhos, prévias e shells) enquanto as linhas não mudam: nenhum
 * bixinho nasce, some ou troca de terminal, e nenhum passa para outro lado do
 * terminal. Fora isso, a posição e o tamanho não importam — arrastar ou
 * redimensionar sem trocar de lado não recalcula as linhas.
 */
export function mesmasLigacoes<T extends NoDoCanvas>(anteriores: T[], novos: T[]): T[] {
  if (anteriores === novos) {
    return anteriores;
  }
  if (anteriores.length !== novos.length) {
    return novos;
  }
  const terminaisAnteriores = terminaisPorId(anteriores);
  const terminaisNovos = terminaisPorId(novos);
  const iguais = anteriores.every((anterior, indice) => {
    const novo = novos[indice];
    if (novo === undefined || anterior.id !== novo.id || anterior.type !== novo.type || anterior.parentId !== novo.parentId) {
      return false;
    }
    if ((ehPrevia(anterior) && ehPrevia(novo)) || (ehShell(anterior) && ehShell(novo))) {
      return (
        anterior.data.orquestradorId === novo.data.orquestradorId &&
        ladoDaPreviaNoTerminal(anterior, terminaisAnteriores) === ladoDaPreviaNoTerminal(novo, terminaisNovos)
      );
    }
    if (!ehBixinho(anterior) || !ehBixinho(novo)) {
      return true;
    }
    return (
      anterior.data.orquestradorId === novo.data.orquestradorId &&
      anterior.data.subagenteId === novo.data.subagenteId &&
      ladoNoTerminal(anterior, terminaisAnteriores) === ladoNoTerminal(novo, terminaisNovos)
    );
  });
  return iguais ? anteriores : novos;
}

/** Duas linhas que o React Flow desenharia do mesmo jeito. */
function mesmaAresta(anterior: ArestaDoCanvas, nova: ArestaDoCanvas): boolean {
  return (
    anterior.id === nova.id &&
    anterior.source === nova.source &&
    anterior.sourceHandle === nova.sourceHandle &&
    anterior.target === nova.target &&
    anterior.targetHandle === nova.targetHandle &&
    anterior.type === nova.type &&
    anterior.animated === nova.animated &&
    anterior.className === nova.className &&
    anterior.data?.situacao === nova.data?.situacao &&
    anterior.data?.encerradoEm === nova.data?.encerradoEm
  );
}

/**
 * As linhas novas, reaproveitando o objeto anterior de cada uma que não mudou
 * — e o próprio array anterior quando nenhuma mudou. Arrastar um nó sem que
 * um bixinho troque de lado, ou um evento que não mexe na situação dos
 * Subagentes, não troca nada, e o React Flow não redesenha as linhas à toa.
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
