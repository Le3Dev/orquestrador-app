import { type ReactFlowState, useStore, useStoreApi } from "@xyflow/react";
import { memo, useLayoutEffect, useRef } from "react";

/** Distância entre os pontos do fundo, em coordenadas do canvas (o `gap` do `<Background>`). */
const DISTANCIA_ENTRE_PONTOS = 24;
/** Diâmetro de cada ponto, em coordenadas do canvas (o `size` do `<Background>`). */
const TAMANHO_DO_PONTO = 1.4;

/** A câmera do canvas no React Flow: [x, y, zoom]. */
type Transformacao = ReactFlowState["transform"];

/** O mesmo posicionamento do svg do `<Background>`: cobre o canvas inteiro. */
const ESTILO_DO_FUNDO = { position: "absolute", width: "100%", height: "100%", top: 0, left: 0 } as const;

const idDoFluxo = (estado: ReactFlowState) => estado.rfId;

/**
 * O fundo de pontos do canvas: o mesmo desenho do `<Background variant="dots" gap={24} size={1.4}>` do React Flow
 * (mesmas classes, mesmo id do pattern, mesmas contas com o zoom), mas sem renderizar a cada quadro. O
 * `<Background>` assina o transform inteiro e faz um commit do React por quadro de pan e zoom, mesmo com o
 * canvas vazio; aqui a câmera vai direto nos atributos do `<pattern>` e do ponto, pela assinatura da loja
 * (como a `CamadaDeDesenho` faz com o desenho).
 */
export const FundoDoCanvas = memo(function FundoDoCanvas() {
  const loja = useStoreApi();
  // Só muda se o React Flow trocar de id (nunca durante o pan e o zoom).
  const idDoPadrao = `pattern-${useStore(idDoFluxo)}`;
  const padrao = useRef<SVGPatternElement>(null);
  const ponto = useRef<SVGCircleElement>(null);

  useLayoutEffect(() => {
    let anterior: Transformacao | null = null;
    const acompanhar = () => {
      const transformacao = loja.getState().transform;
      // A loja avisa qualquer mudança: só mexe no DOM quando x, y ou zoom mudaram.
      if (
        anterior !== null &&
        transformacao[0] === anterior[0] &&
        transformacao[1] === anterior[1] &&
        transformacao[2] === anterior[2]
      ) {
        return;
      }
      anterior = transformacao;
      const [x, y, zoom] = transformacao;
      // As mesmas contas do `<Background>` (sem deslocamento: `offset` 0).
      const distancia = DISTANCIA_ENTRE_PONTOS * zoom || 1;
      const raio = (TAMANHO_DO_PONTO * zoom) / 2;
      const metade = distancia / 2;
      padrao.current?.setAttribute("x", String(x % distancia));
      padrao.current?.setAttribute("y", String(y % distancia));
      padrao.current?.setAttribute("width", String(distancia));
      padrao.current?.setAttribute("height", String(distancia));
      padrao.current?.setAttribute("patternTransform", `translate(-${metade},-${metade})`);
      ponto.current?.setAttribute("cx", String(raio));
      ponto.current?.setAttribute("cy", String(raio));
      ponto.current?.setAttribute("r", String(raio));
    };
    acompanhar();
    return loja.subscribe(acompanhar);
  }, [loja]);

  return (
    <svg className="react-flow__background" style={ESTILO_DO_FUNDO} data-testid="rf__background">
      {/* x, y, width, height e patternTransform (e o tamanho do ponto) vêm da assinatura da loja, fora do render. */}
      <pattern ref={padrao} id={idDoPadrao} patternUnits="userSpaceOnUse">
        <circle ref={ponto} className="react-flow__background-pattern dots" />
      </pattern>
      <rect x="0" y="0" width="100%" height="100%" fill={`url(#${idDoPadrao})`} />
    </svg>
  );
});
