import { describe, expect, it } from "vitest";

import mac from "./mac.js";

const noMac = process.platform === "darwin";

const opcoesDoWindows = {
  backgroundColor: "#141413",
  titleBarStyle: "hidden",
  titleBarOverlay: { color: "#141413", symbolColor: "#faf9f5", height: 36 },
};

describe("electron/mac", () => {
  it("junta PATHs sem repetir pasta e mantendo a ordem", () => {
    expect(mac.juntarPaths("/a:/b", "/b:/c:")).toBe("/a:/b:/c");
    expect(mac.juntarPaths(null, "/usr/bin")).toBe("/usr/bin");
  });

  it.runIf(noMac)("no Mac, troca os botões pintados pelas bolinhas nativas, centradas na barra", () => {
    const principal = mac.ajustarOpcoesDaJanela(opcoesDoWindows, true);
    const pequena = mac.ajustarOpcoesDaJanela(opcoesDoWindows, false);

    expect(principal).not.toHaveProperty("titleBarOverlay");
    expect(principal.titleBarStyle).toBe("hidden");
    // Barra de título do app com 36px: (36 - 14) / 2 = 11.
    expect(principal.trafficLightPosition).toEqual({ x: 14, y: 11 });
    // Faixa de 40px das janelas de ativação e de configuração.
    expect(pequena.trafficLightPosition).toEqual({ x: 14, y: 13 });
    expect(principal.backgroundColor).toBe("#141413");
  });

  it.runIf(noMac)("no Mac, o menu tem copiar, colar, desfazer e sair", () => {
    const Menu = { buildFromTemplate: (modelo) => modelo };
    const papeis = mac.menuDoApp(Menu, "Orquestrador").flatMap((item) => item.submenu.map((s) => s.role));

    expect(papeis).toEqual(expect.arrayContaining(["copy", "paste", "cut", "undo", "selectAll", "quit", "close"]));
  });

  it.runIf(noMac)("no Mac, acha o primeiro claude do PATH sem resolver o link", () => {
    const existentes = new Set(["/b/claude", "/c/claude"]);
    const ehArquivo = (caminho) => existentes.has(caminho);

    expect(mac.claudeCodeDoPath(ehArquivo, { PATH: "/a::/b:/c" })).toBe("/b/claude");
    expect(mac.claudeCodeDoPath(ehArquivo, { PATH: "/a" })).toBeNull();
    expect(mac.claudeCodeDoPath(ehArquivo, {})).toBeNull();
  });

  it.skipIf(noMac)("fora do Mac, nada muda", () => {
    expect(mac.ehMac).toBe(false);
    expect(mac.ajustarOpcoesDaJanela(opcoesDoWindows, true)).toBe(opcoesDoWindows);
    expect(mac.ajustarOpcoesDaJanela(opcoesDoWindows, false)).toBe(opcoesDoWindows);
    expect(mac.menuDoApp({ buildFromTemplate: () => "menu" }, "Orquestrador")).toBeNull();
    expect(mac.claudeCodeDoPath(() => true, { PATH: "/b" })).toBeNull();
  });

  it.runIf(noMac)("no Mac, acha o histórico na pasta dados do repositório gravado no pacote", () => {
    const existe = (c) => c === "/repo/dados/orquestradores";
    expect(mac.historicoDoRepositorio({ repositorioDoMac: "/repo" }, existe)).toBe("/repo/dados");
    expect(mac.historicoDoRepositorio({ repositorioDoMac: "/outro" }, existe)).toBeNull();
    expect(mac.historicoDoRepositorio({}, existe)).toBeNull();
    expect(mac.historicoDoRepositorio(null, existe)).toBeNull();
  });
});
