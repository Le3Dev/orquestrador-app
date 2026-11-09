import type { Nodes, Parents, PhrasingContent, TableRow } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

/**
 * Tira a marcação de um texto em Markdown e deixa o que se lê: a nota criada
 * pelo arraste de uma resposta do chat mostra texto, não `**`, `|---|` e cercas.
 *
 * Usa o mesmo analisador do TextoFormatado (remark, no dialeto do GitHub), já
 * no pacote por causa do react-markdown: sem analisador novo, e as mesmas
 * regras da tela do chat decidem o que é negrito, tabela ou código.
 *
 * - negrito, itálico e riscado: só o texto; código em linha: o conteúdo;
 * - títulos sem `#`; citações sem `>`;
 * - listas com "• " (ou "1. ", "2. "), recuadas nas aninhadas; tarefas como
 *   `[ ]` e `[x]`, o formato dos itens de checklist da nota;
 * - links como "texto (url)" (só a url quando o texto é a própria url);
 * - blocos de código mantidos, sem as cercas;
 * - tabelas como linhas com as colunas separadas por " | ", sem a linha de traços.
 */

const ANALISADOR = unified().use(remarkParse).use(remarkGfm, { singleTilde: false });

const LINHA_HORIZONTAL = "────────";

function emLinha(filhos: readonly PhrasingContent[]): string {
  return filhos.map(textoDeNo).join("");
}

/** Os blocos filhos, um depois do outro, separados por `separador`. */
function blocos(no: Parents, separador: string): string {
  return no.children
    .map(textoDeNo)
    .filter((texto) => texto !== "")
    .join(separador);
}

function linhaDaTabela(linha: TableRow): string {
  return linha.children.map((celula) => emLinha(celula.children).replace(/\s*\n\s*/g, " ")).join(" | ");
}

function recuar(texto: string, recuo: string): string {
  return texto
    .split("\n")
    .map((linha, indice) => (indice === 0 || linha === "" ? linha : recuo + linha))
    .join("\n");
}

function textoDeNo(no: Nodes): string {
  switch (no.type) {
    case "text":
    case "inlineCode":
    case "code":
    case "html":
      return no.value;
    case "break":
      return "\n";
    case "image":
      return no.alt === null || no.alt === undefined || no.alt === "" ? no.url : `${no.alt} (${no.url})`;
    case "link": {
      const texto = emLinha(no.children);
      return texto === "" || texto === no.url || `mailto:${texto}` === no.url ? no.url : `${texto} (${no.url})`;
    }
    case "heading":
    case "paragraph":
    case "strong":
    case "emphasis":
    case "delete":
    case "linkReference":
    case "tableCell":
      return emLinha(no.children);
    case "root":
      return blocos(no, "\n\n");
    case "blockquote":
      return blocos(no, "\n\n");
    case "list":
      return no.children
        .map((item, indice) => {
          const marcador =
            item.checked === true ? "[x] " : item.checked === false ? "[ ] " : no.ordered === true ? `${(no.start ?? 1) + indice}. ` : "• ";
          return marcador + recuar(blocos(item, "\n"), " ".repeat(marcador.length));
        })
        .join("\n");
    case "table":
      return no.children.map(linhaDaTabela).join("\n");
    case "thematicBreak":
      return LINHA_HORIZONTAL;
    case "footnoteReference":
      return `[${no.label ?? no.identifier}]`;
    default:
      // Definições de link e notas de rodapé não têm o que mostrar; o resto
      // que traz filhos ou valor (listItem solto, etc.) cai no que houver.
      if ("children" in no) {
        return blocos(no, "\n");
      }
      return "value" in no && typeof no.value === "string" ? no.value : "";
  }
}

/** O texto sem a marcação do Markdown; vazio para vazio. */
export function markdownParaTexto(markdown: string): string {
  if (markdown.trim() === "") {
    return "";
  }
  return textoDeNo(ANALISADOR.parse(markdown)).trim();
}
