import { render } from "@testing-library/react";

import type { SituacaoDoSubagente } from "../../shared/api/tipos";
import { ACESSORIOS, FORMAS } from "../../shared/canvas/bixinhos";
import type { IconeDeFerramenta } from "../../shared/canvas/iconesDeFerramenta";
import {
  ACESSORIOS_DESENHADOS,
  expressaoPara,
  type Pixel,
  pixelsDoCorpo,
  PIXELS_DOS_ICONES,
  ROSTOS,
} from "../../shared/canvas/sprites";
import { Bixinho, IconeDaFerramenta } from "./Bixinho";

const SITUACOES: readonly SituacaoDoSubagente[] = ["executando", "concluido", "cancelado", "falhou"];
const ICONES: readonly IconeDeFerramenta[] = ["lupa", "lapis", "engrenagem", "globo"];
const LADO = 4;

/** Unidade do viewBox → o que está pintado nela (classe e, se for o caso, " olhos"). */
type Rasterizacao = Map<string, string>;

function pintar(raster: Rasterizacao, x: number, y: number, largura: number, altura: number, tinta: string) {
  for (let i = x; i < x + largura; i++) {
    for (let j = y; j < y + altura; j++) raster.set(`${i},${j}`, tinta);
  }
}

/**
 * Referência: o modelo antigo, um `<rect>` de 4 × 4 por célula, camada por
 * camada na ordem em que eram pintadas (a última cobre as anteriores).
 */
function rasterDeReferencia(forma: (typeof FORMAS)[number], acessorio: (typeof ACESSORIOS)[number], situacao: SituacaoDoSubagente) {
  const corpo = pixelsDoCorpo(forma);
  const rosto = ROSTOS[expressaoPara(situacao)];
  const pecas = ACESSORIOS_DESENHADOS[acessorio];
  const ajuste = Math.min(...corpo.map(([linha]) => linha)) - 3;
  const noTopo = (pixels: readonly Pixel[]) => pixels.map(([linha, coluna]): Pixel => [linha + ajuste, coluna]);
  const camadas: [readonly Pixel[], string][] = [
    [corpo, "bixinho-corpo"],
    [noTopo(pecas.escuro), "bixinho-escuro"],
    [noTopo(pecas.destaque), "bixinho-destaque"],
    [rosto.olhos, "bixinho-escuro olhos"],
    [rosto.brilho, "bixinho-brilho olhos"],
    [rosto.boca, "bixinho-escuro"],
    [rosto.bochechas, "bixinho-bochecha"],
  ];
  const raster: Rasterizacao = new Map();
  for (const [pixels, tinta] of camadas) {
    for (const [linha, coluna] of pixels) pintar(raster, coluna * LADO, linha * LADO, LADO, LADO, tinta);
  }
  return raster;
}

/** Pinta os `<path>` na ordem do documento, lendo só o formato `M x y h n v a h -n z`. */
function rasterDosCaminhos(caminhos: Iterable<Element>, tintaDe: (caminho: Element) => string) {
  const raster: Rasterizacao = new Map();
  for (const caminho of caminhos) {
    const d = caminho.getAttribute("d") ?? "";
    const trechos = [...d.matchAll(/M(\d+) (\d+)h(\d+)v(\d+)h-(\d+)z/g)];
    expect(trechos.map((trecho) => trecho[0]).join("")).toBe(d);
    for (const [, x, y, largura, altura, volta] of trechos) {
      expect(volta).toBe(largura);
      pintar(raster, Number(x), Number(y), Number(largura), Number(altura), tintaDe(caminho));
    }
  }
  return raster;
}

describe("Bixinho", () => {
  const combinacoes = FORMAS.flatMap((forma) =>
    ACESSORIOS.flatMap((acessorio) => SITUACOES.map((situacao) => [forma, acessorio, situacao] as const)),
  );

  it.each(combinacoes)("%s com %s, %s: pinta exatamente as mesmas células que um <rect> por pixel", (forma, acessorio, situacao) => {
    const { container } = render(<Bixinho aparencia={{ nome: "teste", forma, acessorio, cor: "laranja" }} situacao={situacao} />);
    const desenho = container.querySelector(".bixinho-desenho");
    // Os grupos que o CSS anima continuam lá.
    expect(desenho?.querySelector(":scope > .bixinho-corpo-animado > .bixinho-olhos")).toBeInTheDocument();
    expect(desenho?.querySelectorAll("rect")).toHaveLength(0);

    const raster = rasterDosCaminhos(desenho?.querySelectorAll("path") ?? [], (caminho) =>
      [caminho.getAttribute("class"), caminho.closest(".bixinho-olhos") ? "olhos" : null].filter(Boolean).join(" "),
    );
    expect(raster).toEqual(rasterDeReferencia(forma, acessorio, situacao));
  });

  it.each(ICONES)("o ícone %s pinta as mesmas células que um <rect> por pixel", (icone) => {
    const { container } = render(<IconeDaFerramenta icone={icone} />);
    const raster = rasterDosCaminhos(container.querySelectorAll("path"), (caminho) => caminho.getAttribute("class") ?? "");
    const referencia: Rasterizacao = new Map();
    for (const [linha, coluna] of PIXELS_DOS_ICONES[icone]) {
      pintar(referencia, coluna * LADO, linha * LADO, LADO, LADO, "icone-da-ferramenta-pixels");
    }
    expect(raster).toEqual(referencia);
  });
});
