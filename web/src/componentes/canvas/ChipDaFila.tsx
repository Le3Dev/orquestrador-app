import { useEffect, useRef } from "react";

import { textoDoContadorDaFila } from "../../shared/canvas/filaAnimada";
import "../../theme/animacao-fila.css";

/** "N na fila" na barra do terminal: some sem pedidos à espera e dá um pulinho quando o número muda. */
export function ChipDaFila({ total }: { total: number }) {
  const anterior = useRef(total);
  const mudou = anterior.current !== total;
  useEffect(() => {
    anterior.current = total;
  });
  if (total === 0) {
    return null;
  }
  return (
    <span
      key={total}
      className={`chip-da-fila mono shrink-0 whitespace-nowrap ${mudou ? "chip-da-fila-pulo" : ""}`}
      title="Pedidos esperando o atual terminar"
    >
      {textoDoContadorDaFila(total)}
    </span>
  );
}
