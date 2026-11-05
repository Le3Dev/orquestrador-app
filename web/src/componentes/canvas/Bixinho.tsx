import { memo } from "react";

import type { SituacaoDoSubagente } from "../../shared/api/tipos";
import type { AparenciaDoBixinho } from "../../shared/canvas/bixinhos";
import { type IconeDeFerramenta, ROTULO_DO_ICONE } from "../../shared/canvas/iconesDeFerramenta";
import {
  ACESSORIOS_DESENHADOS,
  COLUNAS,
  expressaoPara,
  LADO_DO_ICONE,
  LINHAS,
  type Pixel,
  pixelsDoCorpo,
  PIXELS_DOS_ICONES,
  ROSTOS,
} from "../../shared/canvas/sprites";

/** Unidade da grade no viewBox; na tela, o desenho é ampliado para `TAMANHO_NA_TELA`. */
const TAMANHO_DO_PIXEL = 4;
const TAMANHO_NA_TELA = 80;

function Pixels({ pixels, className }: { pixels: readonly Pixel[]; className: string }) {
  return (
    <g className={className}>
      {pixels.map(([linha, coluna]) => (
        <rect
          key={`${linha}-${coluna}`}
          x={coluna * TAMANHO_DO_PIXEL}
          y={linha * TAMANHO_DO_PIXEL}
          width={TAMANHO_DO_PIXEL}
          height={TAMANHO_DO_PIXEL}
        />
      ))}
    </g>
  );
}

interface Props {
  aparencia: AparenciaDoBixinho;
  situacao: SituacaoDoSubagente;
}

const VIEWBOX = `0 0 ${COLUNAS * TAMANHO_DO_PIXEL} ${LINHAS * TAMANHO_DO_PIXEL}`;

/**
 * O bixinho em pixel art. A cor vem de um token do tema (classe
 * `bixinho-cor-*`), a expressão muda com a situação do Subagente e as
 * animações (pular, piscar, comemorar) ficam no CSS.
 *
 * São dois SVGs empilhados na mesma caixa: a sombra fica no chão e o desenho,
 * num SVG só dele, pula inteiro — assim o pulo anima o elemento `<svg>` (que o
 * navegador move numa camada própria) em vez de redesenhar as células a cada
 * quadro.
 */
export const Bixinho = memo(function Bixinho({ aparencia, situacao }: Props) {
  const corpo = pixelsDoCorpo(aparencia.forma);
  const rosto = ROSTOS[expressaoPara(situacao)];
  const acessorio = ACESSORIOS_DESENHADOS[aparencia.acessorio];
  // Acessórios encostam no topo da cabeça, que muda de altura conforme a forma.
  const topoDaCabeca = Math.min(...corpo.map(([linha]) => linha));
  const ajuste = topoDaCabeca - 3;
  const noTopo = (pixels: readonly Pixel[]): Pixel[] => pixels.map(([linha, coluna]) => [linha + ajuste, coluna]);

  return (
    <span className={`bixinho-sprite bixinho-cor-${aparencia.cor}`} aria-hidden="true">
      <svg viewBox={VIEWBOX} width={TAMANHO_NA_TELA} height={TAMANHO_NA_TELA} shapeRendering="crispEdges">
        <ellipse className="bixinho-sombra" cx={32} cy={62} rx={18} ry={2.5} />
      </svg>
      <svg
        className="bixinho-desenho"
        viewBox={VIEWBOX}
        width={TAMANHO_NA_TELA}
        height={TAMANHO_NA_TELA}
        shapeRendering="crispEdges"
      >
        <g className="bixinho-corpo-animado">
          <Pixels pixels={corpo} className="bixinho-corpo" />
          <Pixels pixels={noTopo(acessorio.escuro)} className="bixinho-escuro" />
          <Pixels pixels={noTopo(acessorio.destaque)} className="bixinho-destaque" />
          <g className="bixinho-olhos">
            <Pixels pixels={rosto.olhos} className="bixinho-escuro" />
            <Pixels pixels={rosto.brilho} className="bixinho-brilho" />
          </g>
          <Pixels pixels={rosto.boca} className="bixinho-escuro" />
          <Pixels pixels={rosto.bochechas} className="bixinho-bochecha" />
        </g>
      </svg>
    </span>
  );
});

const VIEWBOX_DO_ICONE = `0 0 ${LADO_DO_ICONE * TAMANHO_DO_PIXEL} ${LADO_DO_ICONE * TAMANHO_DO_PIXEL}`;
const TAMANHO_DO_ICONE_NA_TELA = 12;

/**
 * O ícone da ferramenta que o Subagente usa agora (lupa, lápis, engrenagem,
 * globo), num selo ao lado do bixinho. Fica fora do `Bixinho`, e é `memo`:
 * trocar de ferramenta redesenha só as poucas células do ícone, e não as do
 * bixinho.
 */
export const IconeDaFerramenta = memo(function IconeDaFerramenta({ icone }: { icone: IconeDeFerramenta }) {
  const rotulo = ROTULO_DO_ICONE[icone];
  return (
    <span className={`icone-da-ferramenta icone-da-ferramenta-${icone}`} role="img" aria-label={rotulo} title={rotulo}>
      <svg
        viewBox={VIEWBOX_DO_ICONE}
        width={TAMANHO_DO_ICONE_NA_TELA}
        height={TAMANHO_DO_ICONE_NA_TELA}
        shapeRendering="crispEdges"
        aria-hidden="true"
      >
        <Pixels pixels={PIXELS_DOS_ICONES[icone]} className="icone-da-ferramenta-pixels" />
      </svg>
    </span>
  );
});
