/**
 * Um trecho de nota arrastado até um terminal para virar pedido: uma linha
 * da nota ou a nota inteira.
 *
 * Vai no `DataTransfer` do arraste em dois formatos: o JSON num tipo próprio,
 * que só o terminal entende, e o texto puro, para soltar em qualquer campo de
 * texto.
 */
export const TIPO_DO_PEDIDO_ARRASTADO = "application/x-orquestrador-pedido";

export interface PedidoArrastado {
  texto: string;
  notaId: string;
}

export function escreverPedidoArrastado(dataTransfer: Pick<DataTransfer, "setData">, pedido: PedidoArrastado): void {
  dataTransfer.setData(TIPO_DO_PEDIDO_ARRASTADO, JSON.stringify({ texto: pedido.texto, notaId: pedido.notaId }));
  dataTransfer.setData("text/plain", pedido.texto);
}

/**
 * Se o arraste traz um pedido. Durante o `dragover` o navegador não deixa ler
 * o conteúdo, só os tipos: serve para aceitar ou não a soltura.
 */
export function temPedidoArrastado(dataTransfer: Pick<DataTransfer, "types">): boolean {
  return Array.from(dataTransfer.types).includes(TIPO_DO_PEDIDO_ARRASTADO);
}

/**
 * O pedido arrastado, lido no `drop`. Nulo quando o arraste não traz um
 * (só texto, arquivos), quando o JSON não é válido ou quando o texto está em
 * branco.
 */
export function lerPedidoArrastado(dataTransfer: Pick<DataTransfer, "getData">): PedidoArrastado | null {
  const bruto = dataTransfer.getData(TIPO_DO_PEDIDO_ARRASTADO);
  if (bruto === "") {
    return null;
  }
  let valor: unknown;
  try {
    valor = JSON.parse(bruto);
  } catch {
    return null;
  }
  if (typeof valor !== "object" || valor === null || !("texto" in valor) || !("notaId" in valor)) {
    return null;
  }
  const { texto, notaId } = valor;
  if (typeof texto !== "string" || typeof notaId !== "string" || texto.trim() === "") {
    return null;
  }
  return { texto, notaId };
}
