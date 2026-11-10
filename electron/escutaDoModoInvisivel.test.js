"use strict";

import { describe, expect, it, vi } from "vitest";

const { criarRespostaAoPedidoDeMidia, vemDaJanelaPrincipal } = require("./escutaDoModoInvisivel");

const FRAME_PRINCIPAL = { processId: 4, routingId: 1 };

function janelaFalsa({ destruida = false, mainFrame = FRAME_PRINCIPAL } = {}) {
  return {
    isDestroyed: () => destruida,
    getBounds: () => ({ x: 0, y: 0, width: 10, height: 10 }),
    webContents: { isDestroyed: () => false, mainFrame },
  };
}

function montar({
  ativo = true,
  manual = false,
  plataforma = "win32",
  janela = janelaFalsa(),
  fontes = [
    { id: "screen:1:0", name: "Tela 1", display_id: "1" },
    { id: "screen:2:0", name: "Tela 2", display_id: "2" },
  ],
} = {}) {
  const estado = { ativo };
  const desktopCapturer = { getSources: vi.fn(async () => fontes) };
  const screen = { getDisplayMatching: vi.fn(() => ({ id: 2 })) };
  const registrar = vi.fn();
  const handler = criarRespostaAoPedidoDeMidia({
    desktopCapturer,
    screen,
    obterJanelaPrincipal: () => janela,
    modoInvisivelAtivo: () => estado.ativo,
    escutaManualLigada: () => manual,
    plataforma,
    registrar,
  });
  return { handler, desktopCapturer, screen, registrar, estado };
}

// Outra instância de WebFrameMain para o mesmo frame (mesmo processId + routingId).
function pedido(sobrescritas = {}) {
  return {
    frame: { processId: 4, routingId: 1 },
    securityOrigin: "http://127.0.0.1:5000",
    videoRequested: true,
    audioRequested: true,
    userGesture: false,
    ...sobrescritas,
  };
}

describe("vemDaJanelaPrincipal", () => {
  it("compara pelo processId + routingId do frame principal", () => {
    expect(vemDaJanelaPrincipal({ processId: 4, routingId: 1 }, janelaFalsa())).toBe(true);
    expect(vemDaJanelaPrincipal({ processId: 4, routingId: 2 }, janelaFalsa())).toBe(false);
    expect(vemDaJanelaPrincipal({ processId: 5, routingId: 1 }, janelaFalsa())).toBe(false);
  });

  it("recusa frame nulo, janela ausente ou destruída", () => {
    expect(vemDaJanelaPrincipal(null, janelaFalsa())).toBe(false);
    expect(vemDaJanelaPrincipal(FRAME_PRINCIPAL, null)).toBe(false);
    expect(vemDaJanelaPrincipal(FRAME_PRINCIPAL, janelaFalsa({ destruida: true }))).toBe(false);
  });
});

describe("criarRespostaAoPedidoDeMidia", () => {
  it("no caso válido, responde com a fonte do monitor da janela e o loopback (sem silenciar)", async () => {
    const { handler, desktopCapturer, screen, registrar } = montar();
    const responder = vi.fn();

    await handler(pedido(), responder);

    expect(screen.getDisplayMatching).toHaveBeenCalledWith({ x: 0, y: 0, width: 10, height: 10 });
    expect(desktopCapturer.getSources).toHaveBeenCalledWith({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } });
    expect(responder).toHaveBeenCalledOnce();
    expect(responder).toHaveBeenCalledWith({ video: { id: "screen:2:0", name: "Tela 2" }, audio: "loopback" });
    expect(registrar).toHaveBeenCalledWith(expect.stringContaining("liberada"));
  });

  it("sem a fonte do monitor, usa a primeira tela (o vídeo é descartado)", async () => {
    const { handler } = montar({ fontes: [{ id: "screen:9:0", name: "Outra", display_id: "9" }] });
    const responder = vi.fn();

    await handler(pedido(), responder);

    expect(responder).toHaveBeenCalledWith({ video: { id: "screen:9:0", name: "Outra" }, audio: "loopback" });
  });

  it("recusa fora do modo invisível", async () => {
    const { handler, desktopCapturer, registrar } = montar({ ativo: false });
    const responder = vi.fn();

    await handler(pedido(), responder);

    expect(responder).toHaveBeenCalledWith(null);
    expect(desktopCapturer.getSources).not.toHaveBeenCalled();
    expect(registrar).toHaveBeenCalledWith(expect.stringContaining("escuta manual estão ativos"));
  });

  it("atende fora do modo invisível quando a escuta manual está ligada", async () => {
    const { handler, desktopCapturer } = montar({ ativo: false, manual: true });
    const responder = vi.fn();

    await handler(pedido(), responder);

    expect(desktopCapturer.getSources).toHaveBeenCalled();
    expect(responder).toHaveBeenCalledWith({ video: { id: "screen:2:0", name: "Tela 2" }, audio: "loopback" });
  });

  it("a escuta manual não libera pedido de outra janela", async () => {
    const { handler } = montar({ ativo: false, manual: true });
    const responder = vi.fn();

    await handler(pedido({ frame: { processId: 9, routingId: 1 } }), responder);

    expect(responder).toHaveBeenCalledWith(null);
  });

  it("recusa fora do Windows", async () => {
    const { handler, registrar } = montar({ plataforma: "darwin" });
    const responder = vi.fn();

    await handler(pedido(), responder);

    expect(responder).toHaveBeenCalledWith(null);
    expect(registrar).toHaveBeenCalledWith(expect.stringContaining("só existe no Windows"));
  });

  it("recusa pedido de outra janela (ou de um subframe) e com frame nulo", async () => {
    const { handler, registrar } = montar();
    const deOutra = vi.fn();
    const semFrame = vi.fn();

    await handler(pedido({ frame: { processId: 7, routingId: 1 } }), deOutra);
    await handler(pedido({ frame: null }), semFrame);

    expect(deOutra).toHaveBeenCalledWith(null);
    expect(semFrame).toHaveBeenCalledWith(null);
    expect(registrar).toHaveBeenCalledWith(expect.stringContaining("não veio da janela principal"));
  });

  it("recusa pedido sem áudio", async () => {
    const { handler, registrar } = montar();
    const responder = vi.fn();

    await handler(pedido({ audioRequested: false }), responder);

    expect(responder).toHaveBeenCalledWith(null);
    expect(registrar).toHaveBeenCalledWith(expect.stringContaining("não inclui áudio"));
  });

  it("recusa quando o getSources falha", async () => {
    const { handler, desktopCapturer, registrar } = montar();
    desktopCapturer.getSources.mockRejectedValue(new Error("sem permissão de captura"));
    const responder = vi.fn();

    await handler(pedido(), responder);

    expect(responder).toHaveBeenCalledOnce();
    expect(responder).toHaveBeenCalledWith(null);
    expect(registrar).toHaveBeenCalledWith(expect.stringContaining("sem permissão de captura"));
  });

  it("recusa quando não há nenhuma fonte de tela", async () => {
    const { handler } = montar({ fontes: [] });
    const responder = vi.fn();

    await handler(pedido(), responder);

    expect(responder).toHaveBeenCalledWith(null);
  });

  it("recusa se o modo invisível foi desligado durante a busca das fontes", async () => {
    const { handler, desktopCapturer, estado } = montar();
    desktopCapturer.getSources.mockImplementation(async () => {
      estado.ativo = false;
      return [{ id: "screen:2:0", name: "Tela 2", display_id: "2" }];
    });
    const responder = vi.fn();

    await handler(pedido(), responder);

    expect(responder).toHaveBeenCalledOnce();
    expect(responder).toHaveBeenCalledWith(null);
  });

  it("não responde duas vezes se o callback do Electron lançar ao liberar", async () => {
    const { handler, registrar } = montar();
    const responder = vi.fn(() => {
      throw new Error("frame destruído");
    });

    await handler(pedido(), responder);

    expect(responder).toHaveBeenCalledOnce();
    expect(registrar).toHaveBeenCalledWith(expect.stringContaining("frame destruído"));
  });
});
