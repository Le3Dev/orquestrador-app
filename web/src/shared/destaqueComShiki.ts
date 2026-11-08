import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

import type { LinguagemDoDestaque, LinhaDestacada } from "./destaqueDeSintaxe";

/**
 * O shiki em pacote fino: o núcleo, o motor de expressões em JavaScript (sem
 * WebAssembly), o tema Dark+ do VS Code e uma gramática por linguagem, cada
 * uma baixada só quando um arquivo dela é aberto. Só é importado por
 * `destaqueDeSintaxe.ts`, com import dinâmico (chunk à parte).
 */

const TEMA = "dark-plus";

const GRAMATICAS: Readonly<Record<LinguagemDoDestaque, () => Promise<unknown>>> = {
  typescript: () => import("shiki/langs/typescript.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  shellscript: () => import("shiki/langs/shellscript.mjs"),
};

/** Bits do `fontStyle` do shiki. */
const ITALICO = 1;
const NEGRITO = 2;
const SUBLINHADO = 4;

let destacador: Promise<HighlighterCore> | null = null;
const carregadas = new Map<LinguagemDoDestaque, Promise<void>>();

/** O destacador com o tema e nenhuma gramática; criado uma vez só. */
export function prepararDestacador(): Promise<HighlighterCore> {
  if (destacador === null) {
    destacador = createHighlighterCore({
      themes: [import("shiki/themes/dark-plus.mjs")],
      langs: [],
      // `forgiving`: uma expressão que o motor em JavaScript não entende não derruba o arquivo inteiro.
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    }).catch((falha: unknown) => {
      destacador = null;
      throw falha;
    });
  }
  return destacador;
}

async function carregarGramatica(nucleo: HighlighterCore, linguagem: LinguagemDoDestaque): Promise<void> {
  let carregando = carregadas.get(linguagem);
  if (carregando === undefined) {
    carregando = GRAMATICAS[linguagem]()
      .then((gramatica) => nucleo.loadLanguage(gramatica as Parameters<HighlighterCore["loadLanguage"]>[0]))
      .catch((falha: unknown) => {
        carregadas.delete(linguagem);
        throw falha;
      });
    carregadas.set(linguagem, carregando);
  }
  await carregando;
}

/** O código (sem a quebra final) em linhas de trechos coloridos pelo tema. */
export async function destacar(codigo: string, linguagem: LinguagemDoDestaque): Promise<LinhaDestacada[]> {
  const nucleo = await prepararDestacador();
  await carregarGramatica(nucleo, linguagem);
  const { tokens } = nucleo.codeToTokens(codigo, { lang: linguagem, theme: TEMA });
  return tokens.map((linha) =>
    linha.map((token) => {
      const estilo = token.fontStyle ?? 0;
      return {
        texto: token.content,
        ...(token.color !== undefined ? { cor: token.color } : {}),
        ...(estilo > 0 && (estilo & ITALICO) !== 0 ? { italico: true } : {}),
        ...(estilo > 0 && (estilo & NEGRITO) !== 0 ? { negrito: true } : {}),
        ...(estilo > 0 && (estilo & SUBLINHADO) !== 0 ? { sublinhado: true } : {}),
      };
    }),
  );
}
