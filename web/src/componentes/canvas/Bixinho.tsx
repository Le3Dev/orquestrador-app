import { memo } from "react";

import type { SituacaoDoSubagente } from "../../shared/api/tipos";
import type { AparenciaDoBixinho } from "../../shared/canvas/bixinhos";
import { type IconeDeFerramenta, ROTULO_DO_ICONE } from "../../shared/canvas/iconesDeFerramenta";
import {
  CAMINHOS_DOS_ICONES,
  COLUNAS,
  desenhoDoBixinho,
  expressaoPara,
  LADO_DO_ICONE,
  LINHAS,
  TAMANHO_DO_PIXEL,
} from "../../shared/canvas/sprites";

/** Na tela, o desenho (grade em unidades de `TAMANHO_DO_PIXEL`) é ampliado para `TAMANHO_NA_TELA`. */
const TAMANHO_NA_TELA = 80;

/**
 * Uma camada de células da mesma cor num `<path>` só (ver `caminhoDosPixels`),
 * em vez de um `<rect>` por célula. Sem células, não desenha nada.
 */
function Camada({ caminho, className }: { caminho: string; className: string }) {
  return caminho === "" ? null : <path className={className} d={caminho} />;
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
  const desenho = desenhoDoBixinho(aparencia.forma, aparencia.acessorio, expressaoPara(situacao));

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
          <Camada caminho={desenho.corpo} className="bixinho-corpo" />
          <Camada caminho={desenho.acessorioEscuro} className="bixinho-escuro" />
          <Camada caminho={desenho.acessorioDestaque} className="bixinho-destaque" />
          <g className="bixinho-olhos">
            <Camada caminho={desenho.olhos} className="bixinho-escuro" />
            <Camada caminho={desenho.brilho} className="bixinho-brilho" />
          </g>
          <Camada caminho={desenho.boca} className="bixinho-escuro" />
          <Camada caminho={desenho.bochechas} className="bixinho-bochecha" />
        </g>
      </svg>
    </span>
  );
});

/**
 * O selo de "concluído": um círculo verde com um check que se desenha (o
 * traço usa `pathLength` 1, então o CSS anima só o `stroke-dashoffset`). Ocupa o
 * lugar do selo da ferramenta, que some quando o Subagente termina.
 */
export const SeloDeConcluido = memo(function SeloDeConcluido() {
  return (
    <span className="selo-de-concluido" aria-hidden="true">
      <svg viewBox="0 0 24 24" width={24} height={24}>
        <circle cx={12} cy={12} r={10} />
        <path pathLength={1} d="M7 12.5l3.2 3.2L17 9" />
      </svg>
    </span>
  );
});

const VIEWBOX_DO_ICONE = `0 0 ${LADO_DO_ICONE * TAMANHO_DO_PIXEL} ${LADO_DO_ICONE * TAMANHO_DO_PIXEL}`;
const TAMANHO_DO_ICONE_NA_TELA = 12;

/**
 * O ícone da ferramenta que o Subagente usa agora (lupa, lápis, engrenagem,
 * globo), num selo ao lado do bixinho. Fica fora do `Bixinho`, e é `memo`:
 * trocar de ferramenta redesenha só o caminho do ícone, e não o do bixinho.
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
        <Camada caminho={CAMINHOS_DOS_ICONES[icone]} className="icone-da-ferramenta-pixels" />
      </svg>
    </span>
  );
});
