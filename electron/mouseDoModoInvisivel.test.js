"use strict";

import { describe, expect, it, vi } from "vitest";

const { iniciarRastreioDoMouse, dentroDoRetangulo, scriptDoPonto } = require("./mouseDoModoInvisivel");

// `capturar`: o que a tela responderia (true = ponto sobre uma área clicável).
function montar({ cursor, capturar, zoom = 1 }) {
  const janela = {
    isDestroyed: () => false,
    getContentBounds: () => ({ x: 100, y: 50, width: 800, height: 600 }),
    setIgnoreMouseEvents: vi.fn(),
    webContents: { executeJavaScript: vi.fn(async () => capturar), getZoomFactor: () => zoom },
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

describe("scriptDoPonto", () => {
  it("usa elementFromPoint nas áreas marcadas e cai no retângulo do chat sem marcação", () => {
    const script = scriptDoPonto(12, 34);
    expect(script).toContain("const x = 12, y = 34");
    expect(script).toContain("elementFromPoint");
    expect(script).toContain("[data-area-clicavel]");
    expect(script).toContain(".chat-rapido");
  });
});

describe("iniciarRastreioDoMouse", () => {
  it("captura o mouse quando o cursor está sobre uma área clicável, em coordenadas da janela", async () => {
    const { janela, rastreio } = montar({ cursor: { x: 400, y: 500 }, capturar: true });
    await rastreio.verificar();
    expect(janela.webContents.executeJavaScript.mock.calls[0][0]).toContain("const x = 300, y = 450");
    expect(janela.setIgnoreMouseEvents).toHaveBeenCalledWith(false);
  });

  it("divide as coordenadas pelo zoom da página", async () => {
    const { janela, rastreio } = montar({ cursor: { x: 400, y: 500 }, capturar: true, zoom: 1.5 });
    await rastreio.verificar();
    expect(janela.webContents.executeJavaScript.mock.calls[0][0]).toContain("const x = 200, y = 300");
  });

  it("deixa os cliques atravessarem num vão transparente dentro da janela", async () => {
    const { janela, rastreio } = montar({ cursor: { x: 150, y: 80 }, capturar: false });
    await rastreio.verificar();
    expect(janela.setIgnoreMouseEvents).toHaveBeenCalledWith(true, { forward: true });
  });

  it("fora da janela solta sem consultar a tela, e só reaplica quando muda", async () => {
    const { janela, screen, rastreio } = montar({ cursor: { x: 5, y: 5 }, capturar: true });
    await rastreio.verificar();
    await rastreio.verificar();
    expect(janela.webContents.executeJavaScript).not.toHaveBeenCalled();
    expect(janela.setIgnoreMouseEvents).toHaveBeenCalledTimes(1);
    screen.getCursorScreenPoint.mockReturnValue({ x: 400, y: 500 });
    await rastreio.verificar();
    expect(janela.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false);
  });

  it("pausado: força passar os cliques, ignora o cursor e o definir; retoma depois", async () => {
    const { janela, rastreio } = montar({ cursor: { x: 400, y: 500 }, capturar: true });
    await rastreio.verificar();
    expect(janela.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false);
    rastreio.pausar(true);
    expect(janela.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true });
    const chamadas = janela.setIgnoreMouseEvents.mock.calls.length;
    rastreio.definir(true);
    await rastreio.verificar();
    expect(janela.setIgnoreMouseEvents).toHaveBeenCalledTimes(chamadas);
    rastreio.pausar(false);
    await rastreio.verificar();
    expect(janela.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false);
  });

  it("para de agir depois de parar", async () => {
    const { janela, rastreio } = montar({ cursor: { x: 400, y: 500 }, capturar: true });
    rastreio.parar();
    await rastreio.verificar();
    expect(janela.setIgnoreMouseEvents).not.toHaveBeenCalled();
  });
});
