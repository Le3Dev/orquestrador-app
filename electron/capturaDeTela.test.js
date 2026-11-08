"use strict";

import { describe, expect, it, vi } from "vitest";

const { capturarTela, tamanhoReduzido } = require("./capturaDeTela");

function imagem(bytesPorQualidade = () => 1000) {
  return {
    isEmpty: () => false,
    toJPEG: vi.fn((q) => Buffer.alloc(bytesPorQualidade(q), 1)),
  };
}

function montar({ fontes, display = { id: 2, size: { width: 2560, height: 1440 } }, protegida = true } = {}) {
  const janela = { getBounds: () => ({ x: 0, y: 0, width: 10, height: 10 }), setOpacity: vi.fn() };
  const screen = { getDisplayMatching: vi.fn(() => display) };
  const desktopCapturer = { getSources: vi.fn(async () => fontes) };
  return { janela, screen, desktopCapturer, janelaProtegida: protegida };
}

describe("tamanhoReduzido", () => {
  it("reduz para 1280 de largura mantendo a proporção", () => {
    expect(tamanhoReduzido({ width: 2560, height: 1440 })).toEqual({ width: 1280, height: 720 });
  });
  it("não amplia telas menores", () => {
    expect(tamanhoReduzido({ width: 1024, height: 768 })).toEqual({ width: 1024, height: 768 });
  });
});

describe("capturarTela", () => {
  it("escolhe o monitor da janela pelo display_id e devolve JPEG em base64", async () => {
    const certa = imagem();
    const args = montar({ fontes: [{ display_id: "1", thumbnail: imagem() }, { display_id: "2", thumbnail: certa }] });
    const registrar = vi.fn();
    const r = await capturarTela({ ...args, registrar });
    expect(args.screen.getDisplayMatching).toHaveBeenCalledWith({ x: 0, y: 0, width: 10, height: 10 });
    expect(args.desktopCapturer.getSources).toHaveBeenCalledWith({
      types: ["screen"],
      thumbnailSize: { width: 1280, height: 720 },
    });
    expect(certa.toJPEG).toHaveBeenCalledWith(70);
    expect(r.tipoDeMidia).toBe("image/jpeg");
    expect(r.nome).toMatch(/\.jpg$/);
    expect(Buffer.from(r.base64, "base64").length).toBe(1000);
    expect(registrar).toHaveBeenCalledOnce();
    expect(registrar.mock.calls[0][0]).not.toContain(r.base64);
    expect(args.janela.setOpacity).not.toHaveBeenCalled();
  });

  it("reduz a qualidade quando passa de 3 MB", async () => {
    const img = imagem((q) => (q > 55 ? 4 * 1024 * 1024 : 1000));
    const args = montar({ fontes: [{ display_id: "2", thumbnail: img }] });
    const r = await capturarTela(args);
    expect(img.toJPEG).toHaveBeenLastCalledWith(55);
    expect(Buffer.from(r.base64, "base64").length).toBe(1000);
  });

  it("falha quando não há fonte para o monitor", async () => {
    const args = montar({ fontes: [{ display_id: "9", thumbnail: imagem() }] });
    await expect(capturarTela(args)).rejects.toThrow(/capturar a tela/);
  });

  it("esconde a janela durante a captura quando não há proteção e restaura mesmo com erro", async () => {
    const args = montar({ fontes: [], protegida: false });
    args.desktopCapturer.getSources = vi.fn(async () => {
      throw new Error("x");
    });
    await expect(capturarTela(args)).rejects.toThrow("x");
    expect(args.janela.setOpacity.mock.calls).toEqual([[0], [1]]);
  });
});
