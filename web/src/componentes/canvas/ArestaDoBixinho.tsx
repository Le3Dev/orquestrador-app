import { BaseEdge, type EdgeProps, getBezierPath } from "@xyflow/react";
import { memo } from "react";

import type { ArestaDoBixinho as TipoDaAresta } from "../../shared/canvas/nos";

/** Tempo de uma ida e volta da bolinha entre o terminal e o bixinho. */
const IDA_E_VOLTA = "2.4s";
/** Sai devagar de cada ponta e acelera no meio do caminho (ida e volta). */
const SUAVIZACAO = "0.45 0 0.55 1;0.45 0 0.55 1";

/**
 * A linha do terminal a um bixinho: a mesma curva da aresta padrão do React
 * Flow e, enquanto o Subagente trabalha, uma bolinha que vai até ele e volta
 * sem parar — a troca de informação com o Orquestrador. Ao terminar, some.
 *
 * A bolinha é SMIL (`animateMotion`), que segue o caminho da curva mesmo
 * quando o terminal ou o bixinho são arrastados.
 *
 * `memo`: as arestas podem ser recriadas a cada evento de conversa, mas só as
 * linhas cujas pontas ou situação mudaram precisam ser redesenhadas.
 */
export const ArestaDoBixinho = memo(function ArestaDoBixinho({
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  animated,
  style,
  markerStart,
  markerEnd,
  interactionWidth,
}: EdgeProps<TipoDaAresta>) {
  const [caminho] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });

  return (
    <>
      <BaseEdge
        path={caminho}
        style={style}
        markerStart={markerStart}
        markerEnd={markerEnd}
        interactionWidth={interactionWidth}
      />
      {animated && (
        <circle r={3.5} className="bolinha-da-troca" aria-hidden="true">
          <animateMotion
            path={caminho}
            dur={IDA_E_VOLTA}
            repeatCount="indefinite"
            keyPoints="0;1;0"
            keyTimes="0;0.5;1"
            calcMode="spline"
            keySplines={SUAVIZACAO}
          />
        </circle>
      )}
    </>
  );
});
