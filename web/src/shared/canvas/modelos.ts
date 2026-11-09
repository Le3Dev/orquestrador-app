import type { ItemDoModelo, ResumoDoOrquestrador } from "../api/tipos";
import { MAXIMO_DE_ITENS_POR_MODELO } from "../api/tipos";
import {
  type Ponto,
  type Retangulo,
  TAMANHO_DA_NOTA,
  TAMANHO_DA_PREVIA,
  TAMANHO_DO_SHELL,
  TAMANHO_DO_TERMINAL,
} from "./layout";
import { ehArtefato, ehNota, ehPrevia, ehRascunho, ehShell, ehTerminal, type NoDoCanvas, telasSelecionadas } from "./nos";

/**
 * Modelos de canvas (item 35): o arranjo das telas selecionadas vira uma
 * lista de itens com posições relativas, e um modelo salvo volta ao canvas
 * item a item, pela API de criar cada um. Aqui fica só o que não depende do
 * React: ler a seleção, contar, posicionar e recriar em sequência.
 */

/** O que o canvas sabe de cada tela, para guardar no modelo. */
export interface LeitoresDoModelo {
  orquestrador: (id: string) => ResumoDoOrquestrador | undefined;
  nota: (notaId: string) => { titulo: string; texto: string } | null;
}

/** O que sai da seleção: os itens do modelo e, em frases curtas, o que ficou de fora. */
export interface ArranjoDaSelecao {
  itens: ItemDoModelo[];
  ignorados: string[];
}

/** O tamanho padrão de cada tipo de item: o da janela que a tela abre. */
export const TAMANHO_PADRAO_DO_ITEM: Readonly<Record<ItemDoModelo["tipo"], { largura: number; altura: number }>> = {
  orquestrador: TAMANHO_DO_TERMINAL,
  nota: TAMANHO_DA_NOTA,
  previa: TAMANHO_DA_PREVIA,
  terminal: TAMANHO_DO_SHELL,
};

/** O item sem a posição (distribui o Omit por cada tipo da união). */
type ItemSemLugar = ItemDoModelo extends infer Item ? (Item extends ItemDoModelo ? Omit<Item, "x" | "y"> : never) : never;

/** O lugar da tela no canvas, com a altura de aberta (uma tela minimizada volta aberta). */
function lugarDaTela(no: NoDoCanvas, padrao: { largura: number; altura: number }): Retangulo {
  const minimizada =
    (ehNota(no) || ehPrevia(no) || ehTerminal(no)) && no.data.minimizada === true ? no.data.alturaAberta : undefined;
  return {
    x: no.position.x,
    y: no.position.y,
    largura: Math.round(no.width ?? no.measured?.width ?? padrao.largura),
    altura: Math.round(minimizada ?? no.height ?? no.measured?.height ?? padrao.altura),
  };
}

/** O item do modelo de uma tela; nulo (com o motivo) quando ela não entra. */
function itemDaTela(no: NoDoCanvas, leitores: LeitoresDoModelo): { item: ItemSemLugar; lugar: Retangulo } | string {
  if (ehTerminal(no)) {
    const orquestrador = leitores.orquestrador(no.data.orquestradorId);
    if (orquestrador === undefined) {
      return "um orquestrador que ainda não carregou";
    }
    // Só nome, pasta e configuração (com as instruções): nunca conversa, eventos, worktree ou id.
    return {
      item: {
        tipo: "orquestrador",
        nome: orquestrador.nome,
        pastaDeTrabalho: orquestrador.pastaDeTrabalho,
        configuracao: { ...orquestrador.configuracao },
      },
      lugar: lugarDaTela(no, TAMANHO_DO_TERMINAL),
    };
  }
  if (ehNota(no)) {
    const nota = leitores.nota(no.data.notaId);
    if (nota === null) {
      return "uma nota que ainda não carregou";
    }
    return { item: { tipo: "nota", titulo: nota.titulo, texto: nota.texto }, lugar: lugarDaTela(no, TAMANHO_DA_NOTA) };
  }
  if (ehPrevia(no)) {
    return { item: { tipo: "previa", url: no.data.url }, lugar: lugarDaTela(no, TAMANHO_DA_PREVIA) };
  }
  if (ehShell(no)) {
    // O canvas não sabe o que foi digitado no shell: vai só a pasta.
    return { item: { tipo: "terminal", pasta: no.data.pasta }, lugar: lugarDaTela(no, TAMANHO_DO_SHELL) };
  }
  if (ehArtefato(no)) {
    return "um artefato (artefatos ficam fora dos modelos)";
  }
  if (ehRascunho(no)) {
    return "um formulário de orquestrador ainda não criado";
  }
  return "uma tela de outro tipo";
}

/**
 * As telas selecionadas como itens de modelo, com as posições relativas ao
 * canto de cima à esquerda do conjunto. Artefatos, rascunhos e o que passar
 * de 30 itens ficam de fora, com uma frase para o aviso.
 */
export function arranjoDaSelecao(nos: readonly NoDoCanvas[], leitores: LeitoresDoModelo): ArranjoDaSelecao {
  const aceitos: { item: ItemSemLugar; lugar: Retangulo }[] = [];
  const ignorados: string[] = [];
  for (const no of telasSelecionadas(nos)) {
    const resultado = itemDaTela(no, leitores);
    if (typeof resultado === "string") {
      ignorados.push(resultado);
    } else if (aceitos.length >= MAXIMO_DE_ITENS_POR_MODELO) {
      ignorados.push(`telas além da ${MAXIMO_DE_ITENS_POR_MODELO}ª (o limite de um modelo)`);
    } else {
      aceitos.push(resultado);
    }
  }
  const origemX = Math.min(...aceitos.map(({ lugar }) => lugar.x));
  const origemY = Math.min(...aceitos.map(({ lugar }) => lugar.y));
  const itens = aceitos.map(
    ({ item, lugar }) =>
      ({
        ...item,
        x: Math.round(lugar.x - origemX),
        y: Math.round(lugar.y - origemY),
        largura: lugar.largura,
        altura: lugar.altura,
      }) as ItemDoModelo,
  );
  return { itens, ignorados: [...new Set(ignorados)] };
}

/** O retângulo do item no arranjo, com o tamanho padrão quando o modelo não traz. */
export function lugarDoItem(item: ItemDoModelo): Retangulo {
  const padrao = TAMANHO_PADRAO_DO_ITEM[item.tipo];
  return { x: item.x, y: item.y, largura: item.largura ?? padrao.largura, altura: item.altura ?? padrao.altura };
}

/** A largura e a altura do arranjo inteiro. */
export function tamanhoDoArranjo(itens: readonly ItemDoModelo[]): { largura: number; altura: number } {
  const lugares = itens.map(lugarDoItem);
  return {
    largura: Math.max(0, ...lugares.map((lugar) => lugar.x + lugar.largura)),
    altura: Math.max(0, ...lugares.map((lugar) => lugar.y + lugar.altura)),
  };
}

/** O orquestrador ou o terminal sem pasta (exportado sem caminhos): a tela pede uma ao recriar. */
export function precisaDePasta(item: ItemDoModelo): boolean {
  if (item.tipo === "orquestrador") {
    return (item.pastaDeTrabalho ?? "").trim() === "";
  }
  return item.tipo === "terminal" && (item.pasta ?? "").trim() === "";
}

/** Quantos itens de cada tipo, e as pastas e comandos que o modelo leva. */
export interface ResumoDoModelo {
  orquestradores: number;
  notas: number;
  previas: number;
  terminais: number;
  pastas: string[];
  comandos: string[];
  semPasta: number;
}

export function resumirModelo(itens: readonly ItemDoModelo[]): ResumoDoModelo {
  const pastas = new Set<string>();
  const comandos: string[] = [];
  for (const item of itens) {
    const pasta = item.tipo === "orquestrador" ? item.pastaDeTrabalho : item.tipo === "terminal" ? item.pasta : undefined;
    if (pasta !== undefined && pasta.trim() !== "") {
      pastas.add(pasta);
    }
    if (item.tipo === "terminal" && item.comando !== undefined && item.comando.trim() !== "") {
      comandos.push(item.comando);
    }
  }
  return {
    orquestradores: itens.filter((item) => item.tipo === "orquestrador").length,
    notas: itens.filter((item) => item.tipo === "nota").length,
    previas: itens.filter((item) => item.tipo === "previa").length,
    terminais: itens.filter((item) => item.tipo === "terminal").length,
    pastas: [...pastas],
    comandos,
    semPasta: itens.filter(precisaDePasta).length,
  };
}

function plural(quantidade: number, singular: string, varios: string): string {
  return `${quantidade} ${quantidade === 1 ? singular : varios}`;
}

/** "2 orquestradores · 1 nota · 1 prévia": só os tipos presentes. */
export function descreverContagem(resumo: ResumoDoModelo): string {
  const partes = [
    resumo.orquestradores > 0 ? plural(resumo.orquestradores, "orquestrador", "orquestradores") : null,
    resumo.notas > 0 ? plural(resumo.notas, "nota", "notas") : null,
    resumo.previas > 0 ? plural(resumo.previas, "prévia", "prévias") : null,
    resumo.terminais > 0 ? plural(resumo.terminais, "terminal", "terminais") : null,
  ].filter((parte) => parte !== null);
  return partes.length === 0 ? "nenhum item" : partes.join(" · ");
}

/** O nome do item para a lista do resultado. */
export function rotuloDoItem(item: ItemDoModelo): string {
  switch (item.tipo) {
    case "orquestrador":
      return `Orquestrador "${item.nome}"`;
    case "nota":
      return `Nota "${item.titulo}"`;
    case "previa":
      return item.url === "" ? "Prévia vazia" : `Prévia ${item.url}`;
    case "terminal":
      return "Terminal";
  }
}

/**
 * Quem cria cada item no canvas, já no lugar dele. A pasta vem resolvida (a
 * do item ou a escolhida para os que não têm). Cada um lança o erro do item.
 */
export interface CriadoresDosItens {
  orquestrador: (item: Extract<ItemDoModelo, { tipo: "orquestrador" }>, lugar: Retangulo, pasta: string) => Promise<string>;
  nota: (item: Extract<ItemDoModelo, { tipo: "nota" }>, lugar: Retangulo) => Promise<string>;
  previa: (item: Extract<ItemDoModelo, { tipo: "previa" }>, lugar: Retangulo) => Promise<string>;
  terminal: (item: Extract<ItemDoModelo, { tipo: "terminal" }>, lugar: Retangulo, pasta: string) => Promise<string>;
}

/** Como foi cada item: o id do nó criado, ou o erro. */
export interface ResultadoDoItem {
  rotulo: string;
  noId: string | null;
  erro: string | null;
}

function mensagem(falha: unknown): string {
  return falha instanceof Error ? falha.message : String(falha);
}

/**
 * Recria os itens um a um, na ordem do modelo, com o canto do arranjo em
 * `origem`: o erro de um item fica no resultado dele e não para os outros.
 * `pastaParaOsSemPasta` vale para o orquestrador e o terminal sem pasta.
 */
export async function recriarItens(
  itens: readonly ItemDoModelo[],
  origem: Ponto,
  pastaParaOsSemPasta: string | null,
  criar: CriadoresDosItens,
): Promise<ResultadoDoItem[]> {
  const resultados: ResultadoDoItem[] = [];
  for (const item of itens) {
    const lugarRelativo = lugarDoItem(item);
    const lugar = { ...lugarRelativo, x: origem.x + lugarRelativo.x, y: origem.y + lugarRelativo.y };
    const rotulo = rotuloDoItem(item);
    try {
      let noId: string;
      switch (item.tipo) {
        case "orquestrador":
        case "terminal": {
          const propria = item.tipo === "orquestrador" ? item.pastaDeTrabalho : item.pasta;
          const pasta = precisaDePasta(item) ? pastaParaOsSemPasta : (propria ?? "").trim();
          if (pasta === null || pasta === "") {
            throw new Error("Escolha uma pasta para recriar este item.");
          }
          noId = item.tipo === "orquestrador" ? await criar.orquestrador(item, lugar, pasta) : await criar.terminal(item, lugar, pasta);
          break;
        }
        case "nota":
          noId = await criar.nota(item, lugar);
          break;
        case "previa":
          noId = await criar.previa(item, lugar);
          break;
      }
      resultados.push({ rotulo, noId, erro: null });
    } catch (falha) {
      resultados.push({ rotulo, noId: null, erro: mensagem(falha) });
    }
  }
  return resultados;
}

/** O texto do arquivo escolhido na importação, como JSON; a mensagem certa se não for. */
export function lerArquivoDeModelo(texto: string): unknown {
  try {
    return JSON.parse(texto) as unknown;
  } catch {
    throw new Error("O arquivo não é um JSON válido. Escolha um modelo exportado pelo Orquestrador.");
  }
}

/** O nome do arquivo baixado no "Exportar". */
export function nomeDoArquivoDoModelo(nome: string): string {
  const base = nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `modelo-${base === "" ? "de-canvas" : base}.json`;
}
