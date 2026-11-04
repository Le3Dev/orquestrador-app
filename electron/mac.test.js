import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it } from "vitest";

import mac from "./mac.js";

const noMac = process.platform === "darwin";

const opcoesDoWindows = {
  backgroundColor: "#141413",
  titleBarStyle: "hidden",
  titleBarOverlay: { color: "#141413", symbolColor: "#faf9f5", height: 40 },
};

describe("electron/mac", () => {
  afterEach(() => {
    delete process.env.ORQUESTRADOR_SEM_LICENCA;
  });

  it("junta PATHs sem repetir pasta e mantendo a ordem", () => {
    expect(mac.juntarPaths("/a:/b", "/b:/c:")).toBe("/a:/b:/c");
    expect(mac.juntarPaths(null, "/usr/bin")).toBe("/usr/bin");
  });

  it.runIf(noMac)("no Mac, troca os botões desenhados pelas bolinhas nativas", () => {
    const principal = mac.ajustarOpcoesDaJanela(opcoesDoWindows, "principal");
    const ativacao = mac.ajustarOpcoesDaJanela(opcoesDoWindows, "ativacao");

    expect(principal).not.toHaveProperty("titleBarOverlay");
    expect(principal.trafficLightPosition).toEqual({ x: 29, y: 32 });
    expect(ativacao.trafficLightPosition).toEqual({ x: 14, y: 13 });
    expect(principal.backgroundColor).toBe("#141413");
  });

  it.runIf(noMac)("no Mac, o menu tem copiar, colar, desfazer e sair", () => {
    const Menu = { buildFromTemplate: (modelo) => modelo };
    const papeis = mac.menuDoApp(Menu, "Orquestrador").flatMap((item) => item.submenu.map((s) => s.role));

    expect(papeis).toEqual(expect.arrayContaining(["copy", "paste", "cut", "undo", "selectAll", "quit", "close"]));
  });

  it.runIf(noMac)("no Mac, só pula a licença rodando pelo código e com a variável", () => {
    expect(mac.liberadoSemLicenca({ isPackaged: false })).toBe(false);
    process.env.ORQUESTRADOR_SEM_LICENCA = "1";
    expect(mac.liberadoSemLicenca({ isPackaged: false })).toBe(true);
    expect(mac.liberadoSemLicenca({ isPackaged: true })).toBe(false);
  });

  it.runIf(noMac)("no Mac, espera o servidor antigo sair antes de subir outro", async () => {
    const processo = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null });
    let saiu = false;
    const espera = mac.esperarSaida(processo).then(() => {
      saiu = true;
    });

    await Promise.resolve();
    expect(saiu).toBe(false);
    processo.emit("exit", 0, null);
    await espera;
    expect(saiu).toBe(true);
    expect(mac.esperarSaida({ exitCode: 0, signalCode: null })).toBeNull();
  });

  it.skipIf(noMac)("fora do Mac, nada muda", async () => {
    process.env.ORQUESTRADOR_SEM_LICENCA = "1";

    expect(mac.ajustarOpcoesDaJanela(opcoesDoWindows, "principal")).toBe(opcoesDoWindows);
    expect(mac.menuDoApp({ buildFromTemplate: () => "menu" }, "Orquestrador")).toBeNull();
    expect(mac.executavelDoServidor()).toBeNull();
    expect(mac.esperarSaida({ exitCode: null, signalCode: null, once() {} })).toBeNull();
    expect(mac.liberadoSemLicenca({ isPackaged: false })).toBe(false);
    expect(await mac.servidorJaNoAr("http://localhost:1")).toBe(false);
  });
});
