import { useEffect } from "react";

import {
  type Idioma,
  lerPreferencias,
  mudarPreferenciasDaTela,
  usePreferenciasDaTela,
} from "../hooks/usePreferenciasDaTela";

/**
 * Tradução da interface (Português/English) sem biblioteca: dicionários tipados
 * por área + hooks.
 *
 * Convenção: um arquivo de textos por área em `shared/idioma/textos/<area>.ts`,
 * exportando uma constante `textosDe<Area>` criada com `definirTextos`:
 *
 *   export const textosDeExemplo = definirTextos({
 *     "pt-BR": { titulo: "Exemplo", subagentes: (n: number) => `${n} subagentes` },
 *     en: { titulo: "Example", subagentes: (n: number) => `${n} subagents` },
 *   });
 *
 * O pt-BR é a fonte do formato: o TypeScript recusa um `en` com chaves ou
 * assinaturas diferentes. Textos com variáveis são funções.
 *
 * Num componente: `const t = useTextos(textosDeExemplo);` e `t.titulo`.
 * Fora do React: `textosAtuais(textosDeExemplo).titulo`.
 * Intl/toLocale*: `localeDoIdioma(idiomaAtual())` (ou `useIdioma()` no componente).
 *
 * O idioma vive em `PreferenciasDaTela.idioma` (localStorage, por computador).
 */
export type { Idioma };

/** As opções da tela: o rótulo de cada idioma sempre na própria língua. */
export const OPCOES_DE_IDIOMA: readonly { valor: Idioma; rotulo: string; dica: string }[] = [
  { valor: "pt-BR", rotulo: "Português", dica: "Português (Brasil)" },
  { valor: "en", rotulo: "English", dica: "English" },
];

/** O idioma como `Intl`/`toLocale*` entendem. */
export function localeDoIdioma(idioma: Idioma): "pt-BR" | "en-US" {
  return idioma === "en" ? "en-US" : "pt-BR";
}

/** Mantém `<html lang>` em dia (leitores de tela, hifenização, correção ortográfica). */
function aplicarNoDocumento(idioma: Idioma): void {
  if (typeof document !== "undefined" && document.documentElement.lang !== idioma) {
    document.documentElement.lang = idioma;
  }
}

/** O idioma atual, lido do armazenamento; para código fora do React. */
export function idiomaAtual(): Idioma {
  return lerPreferencias().idioma;
}

/** Troca o idioma na hora: grava, avisa quem usa os hooks e atualiza `<html lang>`. */
export function definirIdioma(idioma: Idioma): void {
  mudarPreferenciasDaTela({ idioma });
  aplicarNoDocumento(idiomaAtual());
}

/** O idioma atual; re-renderiza ao trocar. */
export function useIdioma(): Idioma {
  const { preferencias } = usePreferenciasDaTela();
  const idioma = preferencias.idioma;
  // Cobre o início e a troca vinda de outra aba.
  useEffect(() => {
    aplicarNoDocumento(idioma);
  }, [idioma]);
  return idioma;
}

/** Troca `string` literal por `string` e preserva as assinaturas das funções (com os parâmetros). */
type Alargar<T> = T extends string
  ? string
  : T extends (...argumentos: infer A) => string
    ? (...argumentos: A) => string
    : T extends object
      ? { [K in keyof T]: Alargar<T[K]> }
      : T;

/** Um dicionário de uma área: as duas versões, com o mesmo formato. */
export type DicionarioDeTextos<T> = { readonly "pt-BR": T; readonly en: T };

/** Os textos de um dicionário (o formato do pt-BR). */
export type TextosDe<D> = D extends DicionarioDeTextos<infer T> ? T : never;

/** Declara os textos de uma área; erro de compilação se o `en` divergir do formato do `pt-BR`. */
export function definirTextos<T extends object>(dicionario: {
  "pt-BR": T;
  en: NoInfer<Alargar<T>>;
}): DicionarioDeTextos<Alargar<T>> {
  return dicionario as DicionarioDeTextos<Alargar<T>>;
}

/** Os textos da área no idioma atual (fora do React). */
export function textosAtuais<T>(dicionario: DicionarioDeTextos<T>): T {
  return dicionario[idiomaAtual()];
}

/** Os textos da área no idioma atual; re-renderiza ao trocar. */
export function useTextos<T>(dicionario: DicionarioDeTextos<T>): T {
  return dicionario[useIdioma()];
}

// No início: o `<html lang>` já nasce no idioma guardado.
aplicarNoDocumento(idiomaAtual());
