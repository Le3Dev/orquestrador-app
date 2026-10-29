import type { SituacaoDoSubagente } from "../api/tipos";
import type { AcessorioDoBixinho, FormaDoBixinho } from "./bixinhos";

/**
 * Desenhos dos bixinhos numa grade de 16 × 16 "pixels". As duas primeiras
 * linhas ficam livres para acessórios; o corpo ocupa as 14 de baixo.
 *
 * `#` é pixel do corpo; `.` é vazio.
 */
export const COLUNAS = 16;
export const LINHAS = 16;
const LINHAS_DE_ACESSORIO = 2;

export type Pixel = readonly [linha: number, coluna: number];

const CORPOS: Readonly<Record<FormaDoBixinho, readonly string[]>> = {
  gota: [
    "................",
    "......####......",
    "....########....",
    "...##########...",
    "..############..",
    "..############..",
    ".##############.",
    ".##############.",
    ".##############.",
    "..############..",
    "...##########...",
    "....##....##....",
    "....##....##....",
    "................",
  ],
  robo: [
    "................",
    "................",
    "..############..",
    "..############..",
    ".##############.",
    ".##############.",
    "################",
    "################",
    ".##############.",
    ".##############.",
    "..############..",
    "...##......##...",
    "...##......##...",
    "................",
  ],
  fantasma: [
    "................",
    "......####......",
    "....########....",
    "...##########...",
    "..############..",
    "..############..",
    "..############..",
    "..############..",
    "..############..",
    "..############..",
    "..############..",
    "..##.##..##.##..",
    "..#...#..#...#..",
    "................",
  ],
};

export function pixelsDoCorpo(forma: FormaDoBixinho): Pixel[] {
  const pixels: Pixel[] = [];
  CORPOS[forma].forEach((linha, indice) => {
    [...linha].forEach((celula, coluna) => {
      if (celula === "#") {
        pixels.push([indice + LINHAS_DE_ACESSORIO, coluna]);
      }
    });
  });
  return pixels;
}

/** Linhas de cada forma, para conferir nos testes que a grade está íntegra. */
export function linhasDoCorpo(forma: FormaDoBixinho): readonly string[] {
  return CORPOS[forma];
}

export type Expressao = "atento" | "feliz" | "dormindo" | "tonto";

export function expressaoPara(situacao: SituacaoDoSubagente): Expressao {
  switch (situacao) {
    case "executando":
      return "atento";
    case "concluido":
      return "feliz";
    case "cancelado":
      return "dormindo";
    case "falhou":
      return "tonto";
  }
}

/** Olhos e boca de cada expressão (coordenadas na grade inteira). */
export const ROSTOS: Readonly<Record<Expressao, { olhos: Pixel[]; brilho: Pixel[]; boca: Pixel[]; bochechas: Pixel[] }>> = {
  atento: {
    olhos: [[7, 5], [7, 6], [8, 5], [8, 6], [7, 9], [7, 10], [8, 9], [8, 10]],
    brilho: [[7, 5], [7, 9]],
    boca: [[10, 7], [10, 8]],
    bochechas: [],
  },
  feliz: {
    olhos: [[8, 4], [7, 5], [7, 6], [8, 7], [8, 8], [7, 9], [7, 10], [8, 11]],
    brilho: [],
    boca: [[10, 6], [11, 7], [11, 8], [10, 9]],
    bochechas: [[9, 3], [9, 12]],
  },
  dormindo: {
    olhos: [[8, 4], [8, 5], [8, 6], [8, 9], [8, 10], [8, 11]],
    brilho: [],
    boca: [],
    bochechas: [],
  },
  tonto: {
    olhos: [[6, 4], [6, 6], [7, 5], [8, 4], [8, 6], [6, 9], [6, 11], [7, 10], [8, 9], [8, 11]],
    brilho: [],
    boca: [[11, 6], [10, 7], [10, 8], [11, 9]],
    bochechas: [],
  },
};

/** Pixels de cada acessório, separados por papel (cor escura ou de destaque). */
export const ACESSORIOS_DESENHADOS: Readonly<
  Record<AcessorioDoBixinho, { escuro: Pixel[]; destaque: Pixel[] }>
> = {
  nenhum: { escuro: [], destaque: [] },
  antena: { escuro: [[1, 8], [2, 8]], destaque: [[0, 7], [0, 8], [0, 9]] },
  chapeu: { escuro: [], destaque: [[0, 8], [1, 7], [1, 8], [1, 9], [2, 6], [2, 7], [2, 8], [2, 9], [2, 10]] },
  oculos: {
    escuro: [
      [6, 4], [6, 5], [6, 6], [6, 7], [9, 4], [9, 5], [9, 6], [9, 7], [7, 4], [8, 4], [7, 7], [8, 7],
      [6, 8], [6, 9], [6, 10], [6, 11], [9, 8], [9, 9], [9, 10], [9, 11], [7, 11], [8, 11],
    ],
    destaque: [],
  },
  broto: { escuro: [[2, 8]], destaque: [[0, 6], [0, 7], [1, 7], [1, 8], [0, 9], [0, 10], [1, 9]] },
};
