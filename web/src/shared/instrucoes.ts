import { textosAtuais } from "./idioma/idioma";
import { textosDeApoioDosNos } from "./idioma/textos/nos";

/**
 * As variáveis que o servidor troca nas instruções a cada pedido (`aplicarVariaveis`).
 * @deprecated Fixa em pt-BR; use `dicaDasVariaveis()`, que acompanha o idioma atual.
 */
export const DICA_DAS_VARIAVEIS = "Use {{pasta}} e {{nome}} para a pasta e o nome do orquestrador.";

/** A dica das variáveis das instruções, no idioma atual. */
export function dicaDasVariaveis(): string {
  return textosAtuais(textosDeApoioDosNos).instrucoes.dicaDasVariaveis;
}

/**
 * O tamanho que o servidor vai conferir nas instruções personalizadas: ele tira
 * o espaço sobrando antes de contar (fim das linhas, linhas em branco
 * repetidas e as pontas). Mesma regra de `normalizarInstrucoes` no servidor.
 */
export function tamanhoDasInstrucoes(texto: string): number {
  return texto
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((linha) => linha.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim().length;
}
