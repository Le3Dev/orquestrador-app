/**
 * Destaque de sintaxe do visualizador de código. Este módulo é leve: o shiki
 * (motor, tema e gramáticas) fica em `destaqueComShiki.ts`, num chunk à parte
 * que só é baixado quando o visualizador abre. Sem ele (ainda carregando ou
 * com falha), o arquivo aparece como texto puro.
 */

/** As gramáticas que o visualizador conhece; cada uma também é um chunk à parte. */
export type LinguagemDoDestaque =
  | "typescript"
  | "tsx"
  | "javascript"
  | "json"
  | "css"
  | "html"
  | "markdown"
  | "python"
  | "sql"
  | "yaml"
  | "shellscript";

/** Um trecho de uma linha com o mesmo estilo. */
export interface PedacoDestacado {
  texto: string;
  /** Cor do tema (`#rrggbb`); ausente, vale a cor do texto. */
  cor?: string;
  italico?: boolean;
  negrito?: boolean;
  sublinhado?: boolean;
}

export type LinhaDestacada = PedacoDestacado[];

/** Acima disto o destaque fica de fora: tokenizar no navegador travaria a tela. */
export const MAXIMO_DE_CARACTERES_PARA_DESTACAR = 200_000;
export const MAXIMO_DE_LINHAS_PARA_DESTACAR = 5_000;

const POR_EXTENSAO: Readonly<Record<string, LinguagemDoDestaque>> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  json: "json",
  jsonc: "json",
  css: "css",
  html: "html",
  htm: "html",
  md: "markdown",
  markdown: "markdown",
  py: "python",
  sql: "sql",
  yaml: "yaml",
  yml: "yaml",
  sh: "shellscript",
  bash: "shellscript",
  zsh: "shellscript",
};

const POR_NOME: Readonly<Record<string, LinguagemDoDestaque>> = {
  ".bashrc": "shellscript",
  ".zshrc": "shellscript",
  ".profile": "shellscript",
};

/** A gramática pela extensão do arquivo; `null` quando não há uma (fica texto puro). */
export function linguagemDoArquivo(caminho: string): LinguagemDoDestaque | null {
  const nome = (caminho.split("/").at(-1) ?? "").toLowerCase();
  const porNome = POR_NOME[nome];
  if (porNome !== undefined) {
    return porNome;
  }
  const ponto = nome.lastIndexOf(".");
  if (ponto <= 0) {
    return null;
  }
  return POR_EXTENSAO[nome.slice(ponto + 1)] ?? null;
}

/** As linhas do texto, sem a linha vazia que a quebra final deixaria. `\r\n` vale como `\n`. */
export function linhasDoTexto(conteudo: string): string[] {
  if (conteudo === "") {
    return [];
  }
  const normalizado = conteudo.replace(/\r\n?/g, "\n");
  return (normalizado.endsWith("\n") ? normalizado.slice(0, -1) : normalizado).split("\n");
}

type ModuloDoShiki = typeof import("./destaqueComShiki");

let carregamento: Promise<ModuloDoShiki> | null = null;

/** Baixa o shiki (uma vez só). Chamado ao abrir o visualizador, para o destaque já estar pronto. */
function carregarShiki(): Promise<ModuloDoShiki> {
  if (carregamento === null) {
    carregamento = import("./destaqueComShiki").catch((falha: unknown) => {
      // Uma falha (rede, chunk sumido) não fica guardada: a próxima abertura tenta de novo.
      carregamento = null;
      throw falha;
    });
  }
  return carregamento;
}

/** Começa a baixar o destaque sem esperar; falhas são ignoradas (o texto puro continua valendo). */
export function precarregarDestaque(): void {
  carregarShiki().then(
    (modulo) => modulo.prepararDestacador().catch(() => undefined),
    () => undefined,
  );
}

/**
 * O código em linhas destacadas, uma por linha de `linhasDoTexto`. `null`
 * quando o arquivo é grande demais para destacar. Lança se o shiki falhar.
 */
export async function destacarCodigo(
  conteudo: string,
  linguagem: LinguagemDoDestaque,
): Promise<LinhaDestacada[] | null> {
  const linhas = linhasDoTexto(conteudo);
  if (conteudo.length > MAXIMO_DE_CARACTERES_PARA_DESTACAR || linhas.length > MAXIMO_DE_LINHAS_PARA_DESTACAR) {
    return null;
  }
  const modulo = await carregarShiki();
  return modulo.destacar(linhas.join("\n"), linguagem);
}
