"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
// O vitest não pode ser carregado por require(); o resto do arquivo segue em CommonJS.
import { describe, expect, it } from "vitest";

const {
  CORES,
  TAMANHOS_DO_ICO,
  crc32,
  dimensoesDoPng,
  gerarIco,
  gerarPng,
  gradeDoMascote,
  pixelsDoIcone,
} = require("../scripts/gerarIcones.cjs");

const ASSINATURA_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PASTA_DOS_ICONES = path.join(__dirname, "icones");

const pixel = (rgba, tamanho, linha, coluna) => {
  const i = (linha * tamanho + coluna) * 4;
  return [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]];
};
const opaco = (cor) => [...cor, 255];

/** Entradas do diretório de um .ico: largura, altura, bitCount, tamanho e offset. */
function entradasDoIco(ico) {
  const quantidade = ico.readUInt16LE(4);
  return Array.from({ length: quantidade }, (_, n) => {
    const base = 6 + 16 * n;
    return {
      larguraGravada: ico[base],
      alturaGravada: ico[base + 1],
      planes: ico.readUInt16LE(base + 4),
      bitCount: ico.readUInt16LE(base + 6),
      bytes: ico.readUInt32LE(base + 8),
      offset: ico.readUInt32LE(base + 12),
    };
  });
}

describe("crc32", () => {
  it("bate com o CRC conhecido do bloco IEND", () => {
    expect(crc32(Buffer.from("IEND", "ascii"))).toBe(0xae426082);
  });
});

describe("gerarPng", () => {
  it("começa com a assinatura PNG e o IHDR traz largura, altura e RGBA de 8 bits", () => {
    const rgba = Buffer.alloc(3 * 2 * 4, 0x7f);
    const png = gerarPng(3, 2, rgba);

    expect([...png.subarray(0, 8)]).toEqual(ASSINATURA_PNG);
    expect(png.toString("ascii", 12, 16)).toBe("IHDR");
    expect(png.readUInt32BE(16)).toBe(3);
    expect(png.readUInt32BE(20)).toBe(2);
    expect(png[24]).toBe(8);
    expect(png[25]).toBe(6);
    expect(dimensoesDoPng(png)).toEqual({ largura: 3, altura: 2 });
    expect(png.toString("ascii", png.length - 8, png.length - 4)).toBe("IEND");
  });

  it("grava no IDAT cada linha com o filtro 0 seguido dos pixels", () => {
    const rgba = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]); // 1 × 2
    const png = gerarPng(1, 2, rgba);
    const inicioDoIdat = png.indexOf("IDAT", 0, "ascii");
    const tamanhoDoIdat = png.readUInt32BE(inicioDoIdat - 4);
    const cru = zlib.inflateSync(png.subarray(inicioDoIdat + 4, inicioDoIdat + 4 + tamanhoDoIdat));

    expect([...cru]).toEqual([0, 1, 2, 3, 4, 0, 5, 6, 7, 8]);
  });

  it("recusa RGBA com a quantidade errada de bytes", () => {
    expect(() => gerarPng(2, 2, Buffer.alloc(4))).toThrow(/Esperados 16 bytes/);
  });
});

describe("pixelsDoIcone", () => {
  it("em 16 px: canto transparente, corpo laranja, lente escura com brilho, boca, bochecha e fundo", () => {
    const rgba = pixelsDoIcone(16);

    expect(rgba.length).toBe(16 * 16 * 4);
    expect(pixel(rgba, 16, 0, 0)[3]).toBe(0);
    expect(pixel(rgba, 16, 15, 15)[3]).toBe(0);
    // Linha 7 do desenho deslocado = linha 6 do CORPOS.gota (".##############.").
    expect(pixel(rgba, 16, 7, 2)).toEqual(opaco(CORES.corpo));
    // Lente [7, 5] dos óculos escuros, uma linha acima depois do deslocamento.
    expect(pixel(rgba, 16, 6, 5)).toEqual(opaco(CORES.escuro));
    // Brilho [7, 4] e [7, 10], no alto de cada lente.
    expect(pixel(rgba, 16, 6, 4)).toEqual(opaco(CORES.brilho));
    expect(pixel(rgba, 16, 6, 10)).toEqual(opaco(CORES.brilho));
    // Boca [11, 7] (o sorriso).
    expect(pixel(rgba, 16, 10, 7)).toEqual(opaco(CORES.escuro));
    expect(pixel(rgba, 16, 8, 3)).toEqual(opaco(CORES.bochecha));
    expect(pixel(rgba, 16, 8, 0)).toEqual(opaco(CORES.fundo));
  });

  it("os óculos não têm olhos por baixo: as duas lentes e a ponte são blocos escuros", () => {
    const grade = gradeDoMascote();
    const lentes = [5, 6, 7].flatMap((linha) =>
      [3, 4, 5, 6, 9, 10, 11, 12].map((coluna) => [linha, coluna]),
    );
    const brilhos = new Set(["6,4", "6,10"]);

    for (const [linha, coluna] of lentes) {
      expect(grade[linha][coluna]).toBe(brilhos.has(`${linha},${coluna}`) ? "brilho" : "escuro");
    }
    expect(grade[5][7]).toBe("escuro");
    expect(grade[5][8]).toBe("escuro");
    expect(grade[6][7]).toBe("corpo");
    expect(grade[7][8]).toBe("corpo");
  });

  it("centraliza o desenho: linhas 2–13 e colunas 1–14", () => {
    const grade = gradeDoMascote();
    const linhasUsadas = grade.flatMap((linha, l) => (linha.some(Boolean) ? [l] : []));
    const colunasUsadas = [...new Set(grade.flatMap((linha) => linha.flatMap((c, col) => (c ? [col] : []))))].sort(
      (a, b) => a - b,
    );

    expect(linhasUsadas[0]).toBe(2);
    expect(linhasUsadas.at(-1)).toBe(13);
    expect(colunasUsadas[0]).toBe(1);
    expect(colunasUsadas.at(-1)).toBe(14);
  });

  it("em 256 px cada célula vira um bloco nítido de 16 × 16", () => {
    const rgba = pixelsDoIcone(256);

    expect(pixel(rgba, 256, 7 * 16, 2 * 16)).toEqual(opaco(CORES.corpo));
    expect(pixel(rgba, 256, 7 * 16 + 15, 2 * 16 + 15)).toEqual(opaco(CORES.corpo));
    expect(pixel(rgba, 256, 6 * 16 + 8, 5 * 16 + 8)).toEqual(opaco(CORES.escuro));
    expect(pixel(rgba, 256, 6 * 16, 4 * 16)).toEqual(opaco(CORES.brilho));
    expect(pixel(rgba, 256, 6 * 16 + 15, 4 * 16 + 15)).toEqual(opaco(CORES.brilho));
    expect(pixel(rgba, 256, 0, 0)[3]).toBe(0);
  });

  it("em 24 px usa escala 1 e margem 4", () => {
    const rgba = pixelsDoIcone(24);

    expect(pixel(rgba, 24, 4 + 7, 4 + 2)).toEqual(opaco(CORES.corpo));
    expect(pixel(rgba, 24, 4 + 6, 4 + 5)).toEqual(opaco(CORES.escuro));
  });

  it("suaviza a borda do arredondado com alpha parcial", () => {
    const rgba = pixelsDoIcone(256);
    const alphas = new Set();
    for (let x = 0; x < 64; x += 1) alphas.add(pixel(rgba, 256, x, x)[3]);

    expect([...alphas].some((a) => a > 0 && a < 255)).toBe(true);
  });

  it("recusa tamanho menor que a grade", () => {
    expect(() => pixelsDoIcone(8)).toThrow(/Tamanho inválido/);
  });
});

describe("gerarIco", () => {
  it("grava o cabeçalho de ícone, as entradas e 0 na largura do 256", () => {
    const pngs = [16, 256].map((t) => gerarPng(t, t, pixelsDoIcone(t)));
    const ico = gerarIco(pngs);
    const entradas = entradasDoIco(ico);

    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(2);
    expect(entradas.map((e) => e.larguraGravada)).toEqual([16, 0]);
    expect(entradas.map((e) => e.alturaGravada)).toEqual([16, 0]);
    expect(entradas.every((e) => e.planes === 1 && e.bitCount === 32)).toBe(true);
    entradas.forEach((entrada, n) => {
      expect(entrada.bytes).toBe(pngs[n].length);
      expect(ico.subarray(entrada.offset, entrada.offset + entrada.bytes).equals(pngs[n])).toBe(true);
    });
  });

  it("recusa lista vazia e PNG maior que 256", () => {
    expect(() => gerarIco([])).toThrow(/pelo menos um PNG/);
    expect(() => gerarIco([gerarPng(257, 1, Buffer.alloc(257 * 4))])).toThrow(/no máximo 256/);
  });
});

describe("ícones versionados em electron/icones", () => {
  it("o icone.ico tem os 9 tamanhos, inclusive o 256, cada um como PNG", () => {
    const ico = fs.readFileSync(path.join(PASTA_DOS_ICONES, "icone.ico"));
    const entradas = entradasDoIco(ico);
    const tamanhos = entradas.map((e) => {
      const png = ico.subarray(e.offset, e.offset + e.bytes);
      expect([...png.subarray(0, 8)]).toEqual(ASSINATURA_PNG);
      const { largura, altura } = dimensoesDoPng(png);
      expect(altura).toBe(largura);
      expect(e.larguraGravada).toBe(largura === 256 ? 0 : largura);
      return largura;
    });

    expect(ico.readUInt16LE(2)).toBe(1);
    expect(tamanhos).toEqual(TAMANHOS_DO_ICO);
    expect(tamanhos).toHaveLength(9);
    expect(tamanhos).toContain(256);
  });

  it("o icone.png tem 512 × 512", () => {
    const png = fs.readFileSync(path.join(PASTA_DOS_ICONES, "icone.png"));

    expect(dimensoesDoPng(png)).toEqual({ largura: 512, altura: 512 });
  });
});
