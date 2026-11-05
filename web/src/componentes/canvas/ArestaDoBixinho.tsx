import { BaseEdge, type EdgeProps, getBezierPath } from "@xyflow/react";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  DURACAO_DA_ENTREGA_MS,
  entregaRecente,
  houveEntrega,
  prefereMovimentoReduzido,
} from "../../shared/canvas/entrega";
import type { ArestaDoBixinho as TipoDaAresta } from "../../shared/canvas/nos";

/** Tempo de uma ida e volta da bolinha entre o terminal e o bixinho. */
const IDA_E_VOLTA = "2.4s";
/** Sai devagar de cada ponta e acelera no meio do caminho (ida e volta). */
const SUAVIZACAO = "0.45 0 0.55 1;0.45 0 0.55 1";
/** O envelope sai ligeiro do bixinho e chega devagar ao terminal. */
const SUAVIZACAO_DA_ENTREGA = "0.3 0 0.2 1";
const DURACAO_DA_ENTREGA = `${DURACAO_DA_ENTREGA_MS}ms`;

/** Começa uma animação SMIL agora. No jsdom (testes) não há `beginElement`. */
function comecar(animacao: SVGAnimationElement | null): void {
  if (animacao !== null && typeof animacao.beginElement === "function") {
    animacao.beginElement();
  }
}

/**
 * O envelope do relatório: vai do bixinho ao terminal pela curva da linha,
 * uma vez, e avisa ao terminar.
 *
 * As animações SMIL ficam com `begin="indefinite"` e começam aqui, por
 * `beginElement()`: inseridas depois de a página carregar, com o `begin`
 * padrão (0s) elas começariam no tempo do documento, que já passou, e o
 * envelope apareceria direto no fim (ou nem apareceria). Até começar, o
 * envelope é transparente — senão piscaria na origem do canvas.
 */
function EnvelopeDaEntrega({ caminho, aoTerminar }: { caminho: string; aoTerminar: () => void }) {
  const envelope = useRef<SVGGElement>(null);
  const percurso = useRef<SVGAnimationElement>(null);
  const visibilidade = useRef<SVGAnimationElement>(null);

  // De layout: começa antes de o navegador pintar o envelope parado.
  useLayoutEffect(() => {
    // Sem servidor, nada no canvas é "ao vivo": não há entrega para mostrar.
    if (envelope.current?.closest(".canvas-desconectado")) {
      aoTerminar();
      return undefined;
    }
    comecar(percurso.current);
    comecar(visibilidade.current);
    const fim = setTimeout(aoTerminar, DURACAO_DA_ENTREGA_MS);
    return () => clearTimeout(fim);
  }, [aoTerminar]);

  return (
    <g ref={envelope} className="envelope-da-entrega" opacity={0} aria-hidden="true">
      <rect className="envelope-da-entrega-papel" x={-6.5} y={-4.5} width={13} height={9} rx={1.5} />
      <path className="envelope-da-entrega-aba" d="M -6 -4 L 0 0.8 L 6 -4" />
      {/* A linha vai do terminal (0) ao bixinho (1): o envelope faz o caminho de volta. */}
      <animateMotion
        ref={percurso}
        path={caminho}
        begin="indefinite"
        dur={DURACAO_DA_ENTREGA}
        fill="freeze"
        keyPoints="1;0"
        keyTimes="0;1"
        calcMode="spline"
        keySplines={SUAVIZACAO_DA_ENTREGA}
      />
      <animate
        ref={visibilidade}
        attributeName="opacity"
        begin="indefinite"
        dur={DURACAO_DA_ENTREGA}
        fill="freeze"
        values="0;1;1;0"
        keyTimes="0;0.1;0.85;1"
      />
    </g>
  );
}

/**
 * A linha do terminal a um bixinho: a mesma curva da aresta padrão do React
 * Flow e, enquanto o Subagente trabalha, uma bolinha que vai até ele e volta
 * sem parar — a troca de informação com o Orquestrador. Ao terminar, some.
 *
 * Quando o Subagente passa de executando a concluído com a linha já na tela,
 * um envelope (o relatório) percorre a linha do bixinho até o terminal, uma
 * vez. Não aparece ao montar a linha com o Subagente já concluído, com o
 * histórico antigo reenviado evento a evento (ao recarregar a página: só
 * entrega o que encerrou há pouco, `entregaRecente`), ao falhar ou ser
 * cancelado, com o reduzir movimento do sistema nem com o servidor desconectado.
 *
 * A bolinha e o envelope são SMIL (`animateMotion`), que segue o caminho da
 * curva mesmo quando o terminal ou o bixinho são arrastados.
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
  data,
  style,
  markerStart,
  markerEnd,
  interactionWidth,
}: EdgeProps<TipoDaAresta>) {
  const [caminho] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const situacao = data?.situacao;
  const encerradoEm = data?.encerradoEm ?? null;
  // A situação vista na renderização anterior: começa com a da montagem, então montar já concluído não entrega.
  const situacaoAnterior = useRef(situacao);
  const [entregando, setEntregando] = useState(false);
  const terminarEntrega = useCallback(() => setEntregando(false), []);

  useEffect(() => {
    const anterior = situacaoAnterior.current;
    situacaoAnterior.current = situacao;
    if (houveEntrega(anterior, situacao) && entregaRecente(encerradoEm, Date.now()) && !prefereMovimentoReduzido()) {
      setEntregando(true);
    }
  }, [situacao, encerradoEm]);

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
      {entregando && <EnvelopeDaEntrega caminho={caminho} aoTerminar={terminarEntrega} />}
    </>
  );
});
