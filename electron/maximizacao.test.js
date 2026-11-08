"use strict";

import { describe, expect, it, vi } from "vitest";

const { criarMaximizacao } = require("./maximizacao");

const AREA = { x: 0, y: 0, width: 1920, height: 1040 };

function montar() {
  let bounds = { x: 100, y: 80, width: 1440, height: 900 };
  const ouvintes = {};
  const janela = {
    getBounds: () => bounds,
    setBounds: vi.fn((b) => {
      bounds = b;
    }),
    isMaximized: vi.fn(() => false),
    maximize: vi.fn(),
    unmaximize: vi.fn(),
    on: (evento, fn) => {
      ouvintes[evento] = fn;
    },
  };
  const screen = { getDisplayMatching: vi.fn(() => ({ workArea: AREA })) };
  const avisar = vi.fn();
  const m = criarMaximizacao(janela, screen, avisar);
  return { janela, m, avisar, ouvintes, bounds: () => bounds };
}

describe("criarMaximizacao", () => {
  it("maximiza para a área útil do monitor, avisa e restaura os bounds anteriores", () => {
    const { m, avisar, bounds } = montar();
    m.alternar();
    expect(bounds()).toEqual(AREA);
    expect(m.estaMaximizada()).toBe(true);
    expect(avisar).toHaveBeenLastCalledWith(true);

    m.alternar();
    expect(bounds()).toEqual({ x: 100, y: 80, width: 1440, height: 900 });
    expect(m.estaMaximizada()).toBe(false);
    expect(avisar).toHaveBeenLastCalledWith(false);
  });

  it("redimensionar à mão a janela maximizada tira o estado de maximizada", () => {
    const { m, avisar, janela, ouvintes } = montar();
    m.alternar();
    janela.setBounds({ x: 0, y: 0, width: 1200, height: 700 });
    ouvintes.resize();
    expect(m.estaMaximizada()).toBe(false);
    expect(avisar).toHaveBeenLastCalledWith(false);
  });

  it("não perde o estado ao receber resize disparado pela própria maximização", () => {
    const { m, ouvintes } = montar();
    m.alternar();
    ouvintes.resize();
    expect(m.estaMaximizada()).toBe(true);
  });

  it("se o sistema maximizou de verdade, alterna usando unmaximize", () => {
    const { m, janela } = montar();
    janela.isMaximized.mockReturnValue(true);
    expect(m.estaMaximizada()).toBe(true);
    m.alternar();
    expect(janela.unmaximize).toHaveBeenCalled();
  });
});
