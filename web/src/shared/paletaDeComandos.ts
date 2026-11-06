import type { FormatoDoArtefato, OrigemDoArtefato } from "./api/artefatos";
import type { ResumoDoOrquestrador } from "./api/tipos";
import { descreverAtualizacao } from "./atualizacao";
import type { TurnoNaTela } from "./estado/aplicarEvento";
import type { EstadoDaAtualizacao } from "./ponteDoDesktop";

/**
 * Paleta de comandos (Ctrl+K): o que ela lista e como busca. Tudo aqui é puro;
 * a tela (`PaletaDeComandos`) só mostra e o canvas executa.
 */

/** As ações do canvas que a paleta oferece. */
export type AcaoDaPaleta =
  | "novo-orquestrador"
  | "nova-nota"
  | "nova-previa"
  | "organizar"
  | "zoom-100"
  | "enquadrar-tudo"
  | "ajustes-do-aplicativo"
  | "procurar-atualizacoes";

interface BaseDoItem {
  /** Único na paleta. */
  readonly id: string;
  /** A linha em destaque; é o que mais pesa no ranking. */
  readonly titulo: string;
  /** A linha de apoio, abaixo do título (pode ser vazia). */
  readonly detalhe: string;
  /** Texto a mais que a busca considera, sem aparecer (ex.: o pedido inteiro). */
  readonly busca: string;
}

export interface ItemDeAcao extends BaseDoItem {
  readonly tipo: "acao";
  readonly acao: AcaoDaPaleta;
  /** O atalho de teclado da mesma ação, quando há (ex.: "Ctrl+0"). */
  readonly atalho: string | null;
  /** Executar não fecha a paleta: o detalhe mostra o resultado (ex.: "Procurar atualizações"). */
  readonly mantemAPaletaAberta?: boolean;
}

export interface ItemDeOrquestrador extends BaseDoItem {
  readonly tipo: "orquestrador";
  readonly orquestradorId: string;
  readonly trabalhando: boolean;
  /** O terminal já está no canvas (abrir só leva até ele). */
  readonly aberto: boolean;
}

export interface ItemDeNota extends BaseDoItem {
  readonly tipo: "nota";
  readonly notaId: string;
}

/** Um artefato (página HTML ou documento Markdown); escolher abre a janela dele ou leva até ela. */
export interface ItemDeArtefato extends BaseDoItem {
  readonly tipo: "artefato";
  readonly artefatoId: string;
  readonly formato: FormatoDoArtefato;
  /** A janela já está no canvas (escolher só leva até ela). */
  readonly aberto: boolean;
}

/** Um pedido (o texto de um turno) de uma conversa carregada na tela. */
export interface ItemDePedido extends BaseDoItem {
  readonly tipo: "pedido";
  readonly orquestradorId: string;
  readonly turnoId: string;
}

export type ItemDaPaleta = ItemDeAcao | ItemDeOrquestrador | ItemDeNota | ItemDeArtefato | ItemDePedido;
export type TipoDeItemDaPaleta = ItemDaPaleta["tipo"];

/** O que a paleta lista, lido do canvas na hora de abrir. */
export interface FonteDaPaleta {
  /** Mais de uma janela no canvas: só então "Organizar" entra. */
  podeOrganizar: boolean;
  /** No app desktop: "Pastas e Claude Code" reabre os Ajustes. */
  podeAbrirAjustes: boolean;
  /** A atualização do app desktop; null sem a ponte (navegador): "Procurar atualizações" não entra. */
  atualizacao: EstadoDaAtualizacao | null;
  /** Todos os Orquestradores, abertos ou não, na ordem da lista. */
  orquestradores: readonly Pick<ResumoDoOrquestrador, "id" | "nome" | "nomeDaPasta" | "situacao">[];
  /** Orquestradores com o terminal aberto no canvas. */
  abertos: ReadonlySet<string>;
  /** As notas do canvas, com o conteúdo já confirmado pelo servidor. */
  notas: readonly { notaId: string; titulo: string; texto: string }[];
  /** Todos os artefatos do servidor, abertos ou não, do mais recente para o mais antigo. */
  artefatos: readonly {
    artefatoId: string;
    titulo: string;
    formato: FormatoDoArtefato;
    origem: OrigemDoArtefato;
    aberto: boolean;
  }[];
  /** As conversas carregadas na tela (só as dos terminais abertos). */
  conversas: ReadonlyMap<string, { readonly turnos: readonly Pick<TurnoNaTela, "id" | "texto" | "iniciadoEm">[] }>;
}

export interface GrupoDaPaleta {
  tipo: TipoDeItemDaPaleta;
  rotulo: string;
  itens: readonly ItemDaPaleta[];
}

/** No máximo isto de resultados por busca. */
export const LIMITE_DE_RESULTADOS = 50;

/** Tamanho do trecho do pedido mostrado no título. */
const TAMANHO_DO_TRECHO = 90;
/** Até quanto do texto de um pedido a busca lê (pedidos enormes não pesam a digitação). */
const TAMANHO_MAXIMO_DA_BUSCA = 4_000;

/** Sem texto, e no empate do ranking: ações, Orquestradores, notas, artefatos e pedidos, nesta ordem. */
const ORDEM_DOS_TIPOS: Readonly<Record<TipoDeItemDaPaleta, number>> = {
  acao: 0,
  orquestrador: 1,
  nota: 2,
  artefato: 3,
  pedido: 4,
};

export const ROTULOS_DOS_TIPOS: Readonly<Record<TipoDeItemDaPaleta, string>> = {
  acao: "Ações",
  orquestrador: "Orquestradores",
  nota: "Notas",
  artefato: "Artefatos",
  pedido: "Pedidos",
};

const ROTULOS_DOS_FORMATOS: Readonly<Record<FormatoDoArtefato, string>> = { html: "HTML", markdown: "Markdown" };
/** Palavras a mais que a busca considera para cada formato (ex.: "md", "pagina"). */
const BUSCA_DOS_FORMATOS: Readonly<Record<FormatoDoArtefato, string>> = {
  html: "pagina web",
  markdown: "md documento",
};

/** Sem acentos e em minúsculas: "Ação" e "acao" casam. */
export function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** O texto numa linha só, cortado com "…" se passar do tamanho. */
function trecho(texto: string, tamanho: number): string {
  const linha = texto.replace(/\s+/g, " ").trim();
  return linha.length > tamanho ? `${linha.slice(0, tamanho).trimEnd()}…` : linha;
}

function primeiraLinha(texto: string): string {
  return trecho(texto.trim().split("\n")[0] ?? "", TAMANHO_DO_TRECHO);
}

/** "Procurar atualizações" (só com a ponte do app desktop): o detalhe traz a versão e o resultado. */
function acaoDeAtualizacao(estado: EstadoDaAtualizacao): ItemDeAcao {
  return {
    tipo: "acao",
    id: "acao:procurar-atualizacoes",
    acao: "procurar-atualizacoes",
    titulo: "Procurar atualizações",
    detalhe: descreverAtualizacao(estado),
    busca: "atualizar atualizacao versao nova update",
    atalho: null,
    mantemAPaletaAberta: true,
  };
}

function acoes(
  podeOrganizar: boolean,
  podeAbrirAjustes: boolean,
  atualizacao: EstadoDaAtualizacao | null,
): ItemDeAcao[] {
  const todas: ItemDeAcao[] = [
    {
      tipo: "acao",
      id: "acao:novo-orquestrador",
      acao: "novo-orquestrador",
      titulo: "Novo orquestrador",
      detalhe: "Abre o formulário de um terminal novo",
      busca: "criar terminal",
      atalho: "Ctrl+N",
    },
    {
      tipo: "acao",
      id: "acao:nova-nota",
      acao: "nova-nota",
      titulo: "Nova nota",
      detalhe: "Cria uma nota no centro da tela",
      busca: "criar notas bloco",
      atalho: "Ctrl+Shift+N",
    },
    {
      tipo: "acao",
      id: "acao:nova-previa",
      acao: "nova-previa",
      titulo: "Nova prévia",
      detalhe: "Abre um navegador no canvas para ver o site rodando",
      busca: "criar previa navegador site localhost",
      atalho: null,
    },
    {
      tipo: "acao",
      id: "acao:organizar",
      acao: "organizar",
      titulo: "Organizar",
      detalhe: "Terminais lado a lado; notas e artefatos em colunas à direita",
      busca: "arrumar grade",
      atalho: null,
    },
    {
      tipo: "acao",
      id: "acao:zoom-100",
      acao: "zoom-100",
      titulo: "Zoom 100%",
      detalhe: "Volta o zoom para 100% sem sair do lugar (texto nítido)",
      busca: "cem por cento",
      atalho: "Ctrl+0",
    },
    {
      tipo: "acao",
      id: "acao:enquadrar-tudo",
      acao: "enquadrar-tudo",
      titulo: "Enquadrar tudo",
      detalhe: "Mostra tudo o que está no canvas, sem passar de 100%",
      busca: "ver tudo ajustar zoom",
      atalho: null,
    },
    {
      tipo: "acao",
      id: "acao:ajustes-do-aplicativo",
      acao: "ajustes-do-aplicativo",
      titulo: "Pastas e Claude Code",
      detalhe: "Abre os ajustes: pasta dos projetos e Claude Code",
      busca: "ajustes configuracao pasta projetos claude code engrenagem",
      atalho: null,
    },
  ];
  const disponiveis = todas.filter(
    (item) =>
      (podeOrganizar || item.acao !== "organizar") && (podeAbrirAjustes || item.acao !== "ajustes-do-aplicativo"),
  );
  return atualizacao === null ? disponiveis : [...disponiveis, acaoDeAtualizacao(atualizacao)];
}

/** De onde o artefato veio, para o detalhe: "de <Orquestrador>" ou "do chat rápido". */
function origemDoArtefato(origem: OrigemDoArtefato, nomes: ReadonlyMap<string, string>): string {
  if (origem.tipo === "chat") {
    return "do chat rápido";
  }
  const nome = origem.id === null ? undefined : nomes.get(origem.id);
  return nome === undefined ? "de um orquestrador" : `de ${nome}`;
}

/**
 * Os itens da paleta: as ações, todos os Orquestradores, as notas do canvas,
 * todos os artefatos e os pedidos das conversas carregadas (só dos terminais
 * abertos), do mais recente para o mais antigo. Pedidos só com imagens (sem
 * texto) ficam de fora.
 */
export function montarItensDaPaleta(fonte: FonteDaPaleta): ItemDaPaleta[] {
  const nomes = new Map(fonte.orquestradores.map((orquestrador) => [orquestrador.id, orquestrador.nome]));

  const orquestradores = fonte.orquestradores.map((orquestrador): ItemDeOrquestrador => {
    const aberto = fonte.abertos.has(orquestrador.id);
    const trabalhando = orquestrador.situacao === "trabalhando";
    return {
      tipo: "orquestrador",
      id: `orquestrador:${orquestrador.id}`,
      orquestradorId: orquestrador.id,
      titulo: orquestrador.nome,
      detalhe: [orquestrador.nomeDaPasta, ...(trabalhando ? ["trabalhando"] : []), aberto ? "no canvas" : "abrir"].join(" · "),
      busca: "",
      trabalhando,
      aberto,
    };
  });

  const notas = fonte.notas.map(
    (nota): ItemDeNota => ({
      tipo: "nota",
      id: `nota:${nota.notaId}`,
      notaId: nota.notaId,
      titulo: nota.titulo.trim() === "" ? "Nota sem título" : nota.titulo.trim(),
      detalhe: nota.texto.trim() === "" ? "nota vazia" : primeiraLinha(nota.texto),
      busca: nota.texto.slice(0, TAMANHO_MAXIMO_DA_BUSCA),
    }),
  );

  const artefatos = fonte.artefatos.map(
    (artefato): ItemDeArtefato => ({
      tipo: "artefato",
      id: `artefato:${artefato.artefatoId}`,
      artefatoId: artefato.artefatoId,
      titulo: artefato.titulo.trim() === "" ? "Artefato sem título" : artefato.titulo.trim(),
      detalhe: [
        ROTULOS_DOS_FORMATOS[artefato.formato],
        origemDoArtefato(artefato.origem, nomes),
        artefato.aberto ? "no canvas" : "abrir",
      ].join(" · "),
      busca: `artefato ${BUSCA_DOS_FORMATOS[artefato.formato]}`,
      formato: artefato.formato,
      aberto: artefato.aberto,
    }),
  );

  const pedidos = [...fonte.conversas]
    .filter(([orquestradorId]) => fonte.abertos.has(orquestradorId))
    .flatMap(([orquestradorId, conversa]) =>
      conversa.turnos
        .filter((turno) => turno.texto.trim() !== "")
        .map((turno) => ({ orquestradorId, turno })),
    )
    .sort((a, b) => Date.parse(b.turno.iniciadoEm) - Date.parse(a.turno.iniciadoEm))
    .map(
      ({ orquestradorId, turno }): ItemDePedido => ({
        tipo: "pedido",
        id: `pedido:${orquestradorId}:${turno.id}`,
        orquestradorId,
        turnoId: turno.id,
        titulo: trecho(turno.texto, TAMANHO_DO_TRECHO),
        detalhe: nomes.get(orquestradorId) ?? "Orquestrador",
        busca: turno.texto.slice(0, TAMANHO_MAXIMO_DA_BUSCA),
      }),
    );

  return [
    ...acoes(fonte.podeOrganizar, fonte.podeAbrirAjustes, fonte.atualizacao),
    ...orquestradores,
    ...notas,
    ...artefatos,
    ...pedidos,
  ];
}

interface TextoNormalizado {
  titulo: string;
  /** Título, detalhe e busca juntos. */
  tudo: string;
}

/** Os itens são imutáveis: o texto normalizado de cada um é calculado uma vez só. */
const NORMALIZADOS = new WeakMap<ItemDaPaleta, TextoNormalizado>();

function textoNormalizado(item: ItemDaPaleta): TextoNormalizado {
  const guardado = NORMALIZADOS.get(item);
  if (guardado !== undefined) {
    return guardado;
  }
  const titulo = normalizar(item.titulo);
  const texto = { titulo, tudo: `${titulo}\n${normalizar(item.detalhe)}\n${normalizar(item.busca)}` };
  NORMALIZADOS.set(item, texto);
  return texto;
}

const LETRA_OU_DIGITO = /[\p{L}\p{N}]/u;

/** A palavra aparece no começo de alguma palavra do texto (início ou depois de espaço/pontuação). */
function comecaPalavra(texto: string, palavra: string): boolean {
  for (let indice = texto.indexOf(palavra); indice !== -1; indice = texto.indexOf(palavra, indice + 1)) {
    const anterior = texto[indice - 1];
    if (anterior === undefined || !LETRA_OU_DIGITO.test(anterior)) {
      return true;
    }
  }
  return false;
}

/**
 * Quão bem o item casa com as palavras: 0 se o título começa com a primeira
 * palavra; 1 se toda palavra começa uma palavra do item; 2 se alguma casa só
 * no meio. Nulo quando alguma palavra não aparece.
 */
function relevancia(item: ItemDaPaleta, palavras: readonly string[]): number | null {
  const { titulo, tudo } = textoNormalizado(item);
  if (!palavras.every((palavra) => tudo.includes(palavra))) {
    return null;
  }
  const primeira = palavras[0];
  if (primeira !== undefined && titulo.startsWith(primeira)) {
    return 0;
  }
  return palavras.every((palavra) => comecaPalavra(tudo, palavra)) ? 1 : 2;
}

/**
 * Busca na paleta, sem diferenciar maiúsculas nem acentos. Todas as palavras
 * digitadas precisam aparecer no item (título, detalhe ou texto de busca).
 * Ordem: título começando com o digitado, depois começo de palavra, depois
 * meio; no empate, ações, Orquestradores, notas, artefatos e pedidos, e a
 * ordem original.
 * Sem texto, devolve os itens na ordem dos tipos. No máximo
 * `LIMITE_DE_RESULTADOS`.
 */
export function buscarNaPaleta(itens: readonly ItemDaPaleta[], consulta: string): ItemDaPaleta[] {
  const palavras = normalizar(consulta).split(/\s+/).filter((palavra) => palavra !== "");
  return itens
    .map((item, indice) => ({ item, indice, grau: palavras.length === 0 ? 0 : relevancia(item, palavras) }))
    .filter((candidato): candidato is { item: ItemDaPaleta; indice: number; grau: number } => candidato.grau !== null)
    .sort(
      (a, b) =>
        a.grau - b.grau || ORDEM_DOS_TIPOS[a.item.tipo] - ORDEM_DOS_TIPOS[b.item.tipo] || a.indice - b.indice,
    )
    .slice(0, LIMITE_DE_RESULTADOS)
    .map((candidato) => candidato.item);
}

/**
 * Os resultados agrupados por tipo, para a lista. Os grupos aparecem na ordem
 * do primeiro item de cada um (o melhor resultado fica no primeiro grupo), e
 * cada grupo mantém a ordem do ranking.
 */
export function agruparPorTipo(itens: readonly ItemDaPaleta[]): GrupoDaPaleta[] {
  const grupos = new Map<TipoDeItemDaPaleta, ItemDaPaleta[]>();
  for (const item of itens) {
    const grupo = grupos.get(item.tipo);
    if (grupo === undefined) {
      grupos.set(item.tipo, [item]);
    } else {
      grupo.push(item);
    }
  }
  return [...grupos].map(([tipo, doGrupo]) => ({ tipo, rotulo: ROTULOS_DOS_TIPOS[tipo], itens: doGrupo }));
}
