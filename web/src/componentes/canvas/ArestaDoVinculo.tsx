import { BaseEdge, type EdgeProps, getBezierPath } from "@xyflow/react";
import { memo } from "react";

import type { ArestaDoVinculo as TipoDaAresta } from "../../shared/canvas/nos";

/**
 * A linha de um vínculo entre dois orquestradores: a curva padrão do React
 * Flow, com um traço mais grosso e um "elo" no meio, para não se confundir com
 * as linhas dos bixinhos, das prévias e dos itens ligados. O clique (tratado
 * pelo canvas) abre o painel do vínculo; a área de clique é folgada.
 */
export const ArestaDoVinculo = memo(function ArestaDoVinculo({
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  style,
}: EdgeProps<TipoDaAresta>) {
  const [caminho, meioX, meioY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  return (
    <>
      <BaseEdge path={caminho} style={style} interactionWidth={28} />
      <circle cx={meioX} cy={meioY} r={5} className="elo-do-vinculo" aria-hidden="true" />
    </>
  );
});
