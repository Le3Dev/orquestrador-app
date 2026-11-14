/**
 * As contas do desenho sobre o canvas (`CamadaDeDesenho`) e sobre a página do
 * artefato (`desenhoNaPagina.ts`): o caminho SVG de cada traço, a
 * simplificação dos pontos da mão livre e o toque da borracha. Tudo nas
 * coordenadas do traço; os traços em si (tipos, leitura e gravação) moram no
 * layout (`layout.ts`).
 */

import type { EspessuraDoDesenho, Ponto, Retangulo, TipoDoTraco, TracoDoDesenho } from "./layout";

/** O que o clique no canvas faz com a barra de desenho aberta: nada (selecionar), um traço ou apagar. */
export type FerramentaDeDesenho = "selecionar" | TipoDoTraco | "borracha";

/** Distância mínima, em pixels da tela, entre dois pontos seguidos da mão livre. */
export const DISTANCIA_MINIMA_ENTRE_PONTOS_PX = 2;
/** Quanto a mão livre pode se desviar (em pixels da tela) ao simplificar os pontos no fim do traço. */
export const TOLERANCIA_DA_SIMPLIFICACAO_PX = 0.8;
/** O raio da borracha, em pixels da tela. */
export const RAIO_DA_BORRACHA_PX = 8;
/** Quantos passos o desfazer guarda. */
export const LIMITE_DO_DESFAZER = 100;

/**
 * As contas, todas dentro desta função e sem nada de fora dela: o script que
 * desenha dentro da página do artefato (outro documento, num iframe isolado)
 * leva o texto dela (`toString`). Aqui dentro não entra import, constante do
 * módulo nem helper externo; só o que o próprio JavaScript tem.
 */
export function criarContasDoDesenho() {
  /** O marca-texto é largo: esta vezes a espessura escolhida. */
  const LARGURA_DO_MARCA_TEXTO = 4;
  /** A ponta da seta: o comprimento mínimo, quantas espessuras ela tem e a abertura de cada lado. */
  const PONTA_DA_SETA = { minimo: 12, porEspessura: 4, abertura: Math.PI / 7 };
  /** Largura média de uma letra e altura da linha, em relação ao tamanho da fonte do texto solto. */
  const PROPORCAO_DA_LETRA = { largura: 0.6, altura: 1.25 };

  /** Um número do caminho com no máximo uma casa: o SVG e o armazenamento ficam enxutos. */
  function numero(valor: number): string {
    return String(Math.round(valor * 10) / 10);
  }

  function ponto({ x, y }: Ponto): string {
    return `${numero(x)} ${numero(y)}`;
  }

  function meio(a: Ponto, b: Ponto): Ponto {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  function distancia(a: Ponto, b: Ponto): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  /** A largura com que o traço é desenhado: a espessura, ou bem mais larga no marca-texto. */
  function larguraDoTraco(traco: Pick<TracoDoDesenho, "tipo" | "espessura">): number {
    return traco.tipo === "marca-texto" ? traco.espessura * LARGURA_DO_MARCA_TEXTO : traco.espessura;
  }

  /** O tamanho da fonte do texto solto: cresce com a espessura escolhida. */
  function tamanhoDoTexto(espessura: EspessuraDoDesenho): number {
    return 12 + espessura * 4;
  }

  /**
   * O caminho da mão livre, suavizado: curvas que passam pelo meio entre
   * pontos vizinhos. Um ponto só vira um pingo (o traço tem ponta redonda).
   */
  function caminhoDaMaoLivre(pontos: readonly Ponto[]): string {
    const [primeiro, segundo] = pontos;
    if (primeiro === undefined) {
      return "";
    }
    if (segundo === undefined) {
      return `M ${ponto(primeiro)} L ${ponto(primeiro)}`;
    }
    if (pontos.length === 2) {
      return `M ${ponto(primeiro)} L ${ponto(segundo)}`;
    }
    const partes = [`M ${ponto(primeiro)}`, `L ${ponto(meio(primeiro, segundo))}`];
    for (let indice = 1; indice < pontos.length - 1; indice++) {
      const atual = pontos[indice] as Ponto;
      const proximo = pontos[indice + 1] as Ponto;
      partes.push(`Q ${ponto(atual)} ${ponto(meio(atual, proximo))}`);
    }
    partes.push(`L ${ponto(pontos[pontos.length - 1] as Ponto)}`);
    return partes.join(" ");
  }

  /** As duas pontas das abas da seta que termina em `ate`. */
  function abasDaSeta(de: Ponto, ate: Ponto, espessura: number): [Ponto, Ponto] {
    const angulo = Math.atan2(ate.y - de.y, ate.x - de.x);
    const comprimento = Math.max(PONTA_DA_SETA.minimo, espessura * PONTA_DA_SETA.porEspessura);
    const aba = (lado: number): Ponto => ({
      x: ate.x - comprimento * Math.cos(angulo + lado * PONTA_DA_SETA.abertura),
      y: ate.y - comprimento * Math.sin(angulo + lado * PONTA_DA_SETA.abertura),
    });
    return [aba(1), aba(-1)];
  }

  /** O caminho da seta: a haste e as duas abas da ponta, em `ate`. Sem comprimento, só o pingo. */
  function caminhoDaSeta(de: Ponto, ate: Ponto, espessura: number): string {
    if (distancia(de, ate) === 0) {
      return `M ${ponto(de)} L ${ponto(ate)}`;
    }
    const [aba1, aba2] = abasDaSeta(de, ate, espessura);
    return `M ${ponto(de)} L ${ponto(ate)} M ${ponto(aba1)} L ${ponto(ate)} L ${ponto(aba2)}`;
  }

  /** O retângulo entre dois cantos opostos, em qualquer direção do arraste. */
  function retanguloEntre(de: Ponto, ate: Ponto): Retangulo {
    return {
      x: Math.min(de.x, ate.x),
      y: Math.min(de.y, ate.y),
      largura: Math.abs(ate.x - de.x),
      altura: Math.abs(ate.y - de.y),
    };
  }

  /** A caixa que o texto solto ocupa (estimada pela quantidade de letras), a partir do canto superior esquerdo. */
  function caixaDoTexto(em: Ponto, texto: string, espessura: EspessuraDoDesenho): Retangulo {
    const tamanho = tamanhoDoTexto(espessura);
    return {
      x: em.x,
      y: em.y,
      largura: Math.max(1, texto.length) * tamanho * PROPORCAO_DA_LETRA.largura,
      altura: tamanho * PROPORCAO_DA_LETRA.altura,
    };
  }

  /** A menor distância do ponto ao segmento de `a` a `b`. */
  function distanciaAoSegmento(p: Ponto, a: Ponto, b: Ponto): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const comprimento2 = dx * dx + dy * dy;
    if (comprimento2 === 0) {
      return distancia(p, a);
    }
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / comprimento2));
    return distancia(p, { x: a.x + t * dx, y: a.y + t * dy });
  }

  /**
   * Ramer-Douglas-Peucker: tira os pontos que se desviam menos que `tolerancia`
   * da reta entre os vizinhos que ficam. O primeiro e o último sempre ficam; os
   * pontos saem arredondados a uma casa, como no caminho.
   */
  function simplificarPontos(pontos: readonly Ponto[], tolerancia: number): Ponto[] {
    const arredondar = ({ x, y }: Ponto): Ponto => ({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
    if (pontos.length <= 2) {
      return pontos.map(arredondar);
    }
    const manter = new Array<boolean>(pontos.length).fill(false);
    manter[0] = true;
    manter[pontos.length - 1] = true;
    const pilha: [number, number][] = [[0, pontos.length - 1]];
    while (pilha.length > 0) {
      const [inicio, fim] = pilha.pop() as [number, number];
      let maior = 0;
      let indiceDoMaior = -1;
      for (let indice = inicio + 1; indice < fim; indice++) {
        const desvio = distanciaAoSegmento(pontos[indice] as Ponto, pontos[inicio] as Ponto, pontos[fim] as Ponto);
        if (desvio > maior) {
          maior = desvio;
          indiceDoMaior = indice;
        }
      }
      if (indiceDoMaior !== -1 && maior > tolerancia) {
        manter[indiceDoMaior] = true;
        pilha.push([inicio, indiceDoMaior], [indiceDoMaior, fim]);
      }
    }
    return pontos.filter((_, indice) => manter[indice]).map(arredondar);
  }

  /** Os segmentos que formam o traço desenhado (o texto não tem: vale a caixa dele). */
  function segmentosDoTraco(traco: TracoDoDesenho): [Ponto, Ponto][] {
    const [de, ate] = traco.pontos;
    if (de === undefined) {
      return [];
    }
    switch (traco.tipo) {
      case "caneta":
      case "marca-texto": {
        if (traco.pontos.length === 1) {
          return [[de, de]];
        }
        return traco.pontos.slice(1).map((atual, indice) => [traco.pontos[indice] as Ponto, atual]);
      }
      case "linha":
        return ate === undefined ? [] : [[de, ate]];
      case "seta": {
        if (ate === undefined) {
          return [];
        }
        const [aba1, aba2] = abasDaSeta(de, ate, traco.espessura);
        return [
          [de, ate],
          [aba1, ate],
          [aba2, ate],
        ];
      }
      case "retangulo": {
        if (ate === undefined) {
          return [];
        }
        const { x, y, largura, altura } = retanguloEntre(de, ate);
        const cantos: Ponto[] = [
          { x, y },
          { x: x + largura, y },
          { x: x + largura, y: y + altura },
          { x, y: y + altura },
        ];
        return cantos.map((canto, indice) => [canto, cantos[(indice + 1) % cantos.length] as Ponto]);
      }
      case "texto":
        return [];
    }
  }

  /**
   * Se a borracha em `ponto` toca o traço: a linha desenhada (com a largura
   * dela) a até `folga` do ponto. O retângulo só pela borda; o texto, pela caixa.
   */
  function tracoTocado(traco: TracoDoDesenho, ponto: Ponto, folga: number): boolean {
    if (traco.tipo === "texto") {
      const [em] = traco.pontos;
      if (em === undefined) {
        return false;
      }
      const caixa = caixaDoTexto(em, traco.texto ?? "", traco.espessura);
      return (
        ponto.x >= caixa.x - folga &&
        ponto.x <= caixa.x + caixa.largura + folga &&
        ponto.y >= caixa.y - folga &&
        ponto.y <= caixa.y + caixa.altura + folga
      );
    }
    const alcance = larguraDoTraco(traco) / 2 + folga;
    return segmentosDoTraco(traco).some(([a, b]) => distanciaAoSegmento(ponto, a, b) <= alcance);
  }

  /**
   * Os pontos de `de` até `ate` (sem `de`), a cada `passo` no máximo: a
   * borracha arrastada depressa não pula um traço fino entre dois eventos.
   */
  function pontosEntre(de: Ponto, ate: Ponto, passo: number): Ponto[] {
    const partes = Math.max(1, Math.ceil(distancia(de, ate) / Math.max(passo, Number.EPSILON)));
    return Array.from({ length: partes }, (_, indice) => {
      const t = (indice + 1) / partes;
      return { x: de.x + (ate.x - de.x) * t, y: de.y + (ate.y - de.y) * t };
    });
  }

  return {
    larguraDoTraco,
    tamanhoDoTexto,
    caminhoDaMaoLivre,
    caminhoDaSeta,
    retanguloEntre,
    caixaDoTexto,
    distanciaAoSegmento,
    simplificarPontos,
    tracoTocado,
    pontosEntre,
  };
}

/** As contas do desenho (o tipo do que `criarContasDoDesenho` devolve). */
export type ContasDoDesenho = ReturnType<typeof criarContasDoDesenho>;

export const {
  larguraDoTraco,
  tamanhoDoTexto,
  caminhoDaMaoLivre,
  caminhoDaSeta,
  retanguloEntre,
  caixaDoTexto,
  distanciaAoSegmento,
  simplificarPontos,
  tracoTocado,
  pontosEntre,
} = criarContasDoDesenho();
