import { useState } from "react";

/**
 * Compara dados vindos da API (JSON: objetos simples, arrays e primitivos)
 * pelo conteúdo. Outros objetos (Date, Map...) só são iguais se forem o
 * mesmo objeto.
 */
export function mesmoConteudo(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, indice) => mesmoConteudo(item, b[indice]))
    );
  }
  if (!ehObjetoSimples(a) || !ehObjetoSimples(b)) {
    return false;
  }
  const chaves = Object.keys(a);
  return (
    chaves.length === Object.keys(b).length &&
    chaves.every((chave) => Object.hasOwn(b, chave) && mesmoConteudo(a[chave], b[chave]))
  );
}

function ehObjetoSimples(valor: object): valor is Record<string, unknown> {
  const prototipo: unknown = Object.getPrototypeOf(valor);
  return prototipo === Object.prototype || prototipo === null;
}

/**
 * A lista nova, mas com os itens que não mudaram (mesmo id e mesmo conteúdo)
 * reaproveitados da anterior. Quando nada mudou, devolve a própria lista
 * anterior: quem compara por referência não vê mudança onde não houve.
 */
export function reaproveitarLista<T extends { id: string }>(anteriores: readonly T[] | null, novos: T[]): T[] {
  if (anteriores === null) {
    return novos;
  }
  const porId = new Map(anteriores.map((item) => [item.id, item]));
  const resultado = novos.map((novo) => {
    const anterior = porId.get(novo.id);
    return anterior !== undefined && mesmoConteudo(anterior, novo) ? anterior : novo;
  });
  const nadaMudou = resultado.length === anteriores.length && resultado.every((item, indice) => item === anteriores[indice]);
  return nadaMudou ? (anteriores as T[]) : resultado;
}

/**
 * Devolve o valor anterior enquanto `reaproveitar` disser que o novo é
 * equivalente — para o React (e o React Flow) não tratarem como mudança o que
 * só foi recalculado.
 *
 * `reaproveitar(anterior, novo)` precisa devolver o próprio `anterior` quando
 * os dois forem equivalentes; senão, o componente renderizaria sem parar.
 * Guarda o valor no estado, ajustado durante a renderização — o jeito que o
 * React recomenda para lembrar algo da renderização anterior.
 */
export function useReaproveitado<T>(valor: T, reaproveitar: (anterior: T, novo: T) => T): T {
  const [guardado, setGuardado] = useState<T>(() => valor);
  const atual = reaproveitar(guardado, valor);
  if (atual !== guardado) {
    setGuardado(() => atual);
  }
  return atual;
}
