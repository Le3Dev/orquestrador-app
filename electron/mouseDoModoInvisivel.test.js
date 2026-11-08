"use strict";

import { describe, expect, it, vi } from "vitest";

const { iniciarRastreioDoMouse, dentroDoRetangulo } = require("./mouseDoModoInvisivel");

function montar({ cursor, retangulo }) {
  const janela = {
    isDestroyed: () => false,
    getContentBounds: () => ({ x: 100, y: 50, width: 800, height: 600 }),
    setIgnoreMouseEvents: vi.fn(),
    webContents: { executeJavaScript: vi.fn(async () => retangulo) },
  };
  const screen = { getCursorScreenPoint: vi.fn(() => cursor) };
  const rastreio = iniciarRastreioDoMouse({
    janela,
    screen,
    agendar: () => 1,
    cancelar: () => undefined,
  });
  return { janela, screen, rastreio };
}

describe("dentroDoRetangulo", () => {
  it("aceita pontos dentro e recusa fora ou sem retângulo", () => {
    expect(dentroDoRetangulo(5, 5, [0, 0, 10, 10])).toBe(true);
    expect(dentroDoRetangulo(11, 5, [0, 0, 10, 10])).toBe(false);
    expect(dentroDoRetangulo(5, 5, null)).toBe(false);
  });
});

describe("iniciarRastreioDoMouse", () => {
  it("captura o mouse quando o cursor está sobre o chat, em coordenadas da janela", async () => {
    const { janela, rastreio } = montar({ cursor: { x: 400, y: 500 }, retangulo: [250, 400, 500, 560] });
    await rastreio.verificar();
    expect(janela.setIgnoreMouseEvents).toHaveBeenCalledWith(false);
  });

  it("deixa os cliques atravessarem quando o cursor está na janela mas fora do chat", async () => {
    const { janela, rastreio } = montar({ cursor: { x: 150, y: 80 }, retangulo: [250, 400, 500, 560] });
    await rastreio.verificar();
    expect(janela.setIgnoreMouseEvents).toHaveBeenCalledWith(true, { forward: true });
  });

  it("fora da janela solta sem consultar a tela, e só reaplica quando muda", async () => {
    const { janela, screen, rastreio } = montar({ cursor: { x: 5, y: 5 }, retangulo: [0, 0, 10, 10] });
    await rastreio.verificar();
    await rastreio.verificar();
    expect(janela.webContents.executeJavaScript).not.toHaveBeenCalled();
    expect(janela.setIgnoreMouseEvents).toHaveBeenCalledTimes(1);
    screen.getCursorScreenPoint.mockReturnValue({ x: 400, y: 500 });
    janela.webContents.executeJavaScript.mockResolvedValue([250, 400, 500, 560]);
    await rastreio.verificar();
    expect(janela.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false);
  });

  it("para de agir depois de parar", async () => {
    const { janela, rastreio } = montar({ cursor: { x: 400, y: 500 }, retangulo: [250, 400, 500, 560] });
    rastreio.parar();
    await rastreio.verificar();
    expect(janela.setIgnoreMouseEvents).not.toHaveBeenCalled();
  });
});
