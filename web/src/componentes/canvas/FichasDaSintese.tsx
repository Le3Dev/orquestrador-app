import type { CSSProperties } from "react";

import { fichasDaSintese } from "../../shared/canvas/fichasDaSintese";
import "../../theme/animacao-sintese.css";

/**
 * "sintetizado de": uma ficha por Subagente que trabalhou no pedido, acima da
 * resposta do Orquestrador. Com `montando`, as fichas chegam em sequência.
 */
export function FichasDaSintese({ subagentes }: { subagentes: readonly { id: string; papel: string | null }[] }) {
  const { fichas, restantes } = fichasDaSintese(subagentes);
  if (fichas.length === 0) {
    return null;
  }
  return (
    <ul className="fichas-da-sintese" aria-label="Subagentes que alimentaram a resposta">
      <li className="rotulo-da-sintese mono" aria-hidden="true">
        sintetizado de
      </li>
      {fichas.map((ficha, indice) => (
        <li
          key={ficha.id}
          className="ficha-da-sintese mono"
          style={{ "--cor-da-ficha": ficha.cor, "--i": indice } as CSSProperties}
        >
          <i aria-hidden="true" />
          {ficha.nome}
        </li>
      ))}
      {restantes > 0 && <li className="ficha-da-sintese ficha-da-sintese-resto mono" style={{ "--i": fichas.length } as CSSProperties}>{`+${restantes}`}</li>}
    </ul>
  );
}
