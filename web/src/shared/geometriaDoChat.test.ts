import { describe, expect, it } from "vitest";

import {
  interpretarGeometriaDoChat,
  limitarGeometriaDoChat,
  moverGeometriaDoChat,
  PASSO_DE_MOVER_O_CHAT,
  TAMANHO_MINIMO_DO_CHAT,
} from "./geometriaDoChat";

const TELA = { largura: 1000, altura: 700 };

describe("geometriaDoChat", () => {
  it("mantém uma geometria que já cabe", () => {
    const g = { x: 100, y: 50, largura: 500, altura: 300 };
    expect(limitarGeometriaDoChat(g, TELA)).toEqual(g);
  });

  it("nunca deixa o chat sair da tela", () => {
    expect(limitarGeometriaDoChat({ x: 900, y: 650, largura: 500, altura: 300 }, TELA)).toEqual({
      x: 500,
      y: 400,
      largura: 500,
      altura: 300,
    });
    expect(limitarGeometriaDoChat({ x: -40, y: -9, largura: 500, altura: 300 }, TELA)).toMatchObject({ x: 0, y: 0 });
  });

  it("encolhe o chat maior que a tela e respeita o mínimo", () => {
    expect(limitarGeometriaDoChat({ x: 0, y: 0, largura: 5000, altura: 5000 }, TELA)).toEqual({
      x: 0,
      y: 0,
      largura: 1000,
      altura: 700,
    });
    const minimo = limitarGeometriaDoChat({ x: 0, y: 0, largura: 10, altura: 10 }, TELA);
    expect(minimo.largura).toBe(TAMANHO_MINIMO_DO_CHAT.largura);
    expect(minimo.altura).toBe(TAMANHO_MINIMO_DO_CHAT.altura);
  });

  it("move por passos de 40 px sem passar da borda", () => {
    const g = { x: 480, y: 10, largura: 500, altura: 300 };
    expect(moverGeometriaDoChat(g, PASSO_DE_MOVER_O_CHAT, -PASSO_DE_MOVER_O_CHAT, TELA)).toMatchObject({ x: 500, y: 0 });
  });

  it("interpreta só geometrias válidas", () => {
    expect(interpretarGeometriaDoChat({ x: 1.4, y: 2, largura: 400, altura: 300 })).toEqual({
      x: 1,
      y: 2,
      largura: 400,
      altura: 300,
    });
    expect(interpretarGeometriaDoChat(null)).toBeNull();
    expect(interpretarGeometriaDoChat({ x: "1", y: 2, largura: 4, altura: 3 })).toBeNull();
    expect(interpretarGeometriaDoChat({ x: Number.NaN, y: 2, largura: 4, altura: 3 })).toBeNull();
  });
});
