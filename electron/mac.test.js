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

  it.runIf(noMac)("no Mac, troca os botões pintados pelas bolinhas nativas, centradas com as ilhas do topo", () => {
    const principal = mac.ajustarOpcoesDaJanela(opcoesDoWindows, true);
    const pequena = mac.ajustarOpcoesDaJanela(opcoesDoWindows, false);

    expect(principal).not.toHaveProperty("titleBarOverlay");
    expect(principal.titleBarStyle).toBe("hidden");
    // Sem barra de título: ilhas do topo com 16px de margem e 48px de altura (centro em 40): 40 - 14 / 2 = 33.
    expect(principal.trafficLightPosition).toEqual({ x: 16, y: 33 });
    // Faixa de 40px das janelas de ativação e de configuração.
    expect(pequena.trafficLightPosition).toEqual({ x: 14, y: 13 });
    expect(principal.backgroundColor).toBe("#141413");
  });

  it.runIf(noMac)("no Mac, o menu tem copiar, colar, desfazer e sair", () => {
    const Menu = { buildFromTemplate: (modelo) => modelo };
    const papeis = mac.menuDoApp(Menu, "Orquestrador").flatMap((item) => item.submenu.map((s) => s.role));

    expect(papeis).toEqual(expect.arrayContaining(["copy", "paste", "cut", "undo", "selectAll", "quit", "close"]));
  });

  it("no Mac, acha o primeiro claude do PATH sem resolver o link", () => {
    const existentes = new Set(["/b/claude", "/c/claude", "/home/eu/.local/bin/claude"]);
    const ehArquivo = (caminho) => existentes.has(caminho);

    expect(mac.claudeCodeDoPath(ehArquivo, { PATH: "/a::/b:/c" }, "darwin")).toBe("/b/claude");
    // No Mac, o ~/.local/bin já entra no PATH por carregarPathDoShell.
    expect(mac.claudeCodeDoPath(ehArquivo, { PATH: "/a", HOME: "/home/eu" }, "darwin")).toBeNull();
    expect(mac.claudeCodeDoPath(ehArquivo, {}, "darwin")).toBeNull();
  });

  it("no Linux, acha o claude do PATH e, sem ele, o de ~/.local/bin ou /usr/local/bin", () => {
    const existentes = new Set(["/b/claude", "/home/eu/.local/bin/claude", "/usr/local/bin/claude"]);
    const ehArquivo = (caminho) => existentes.has(caminho);

    expect(mac.claudeCodeDoPath(ehArquivo, { PATH: "/a:/b", HOME: "/home/eu" }, "linux")).toBe("/b/claude");
    expect(mac.claudeCodeDoPath(ehArquivo, { PATH: "/usr/bin", HOME: "/home/eu" }, "linux")).toBe(
      "/home/eu/.local/bin/claude",
    );
    expect(mac.claudeCodeDoPath(ehArquivo, {}, "linux")).toBe("/usr/local/bin/claude");
    expect(mac.claudeCodeDoPath(() => false, { PATH: "/b", HOME: "/home/eu" }, "linux")).toBeNull();
  });

  it("no Windows, não procura o claude do PATH (vale a detecção do claude.exe)", () => {
    expect(mac.claudeCodeDoPath(() => true, { PATH: "/b", HOME: "/home/eu" }, "win32")).toBeNull();
  });

  it.skipIf(noMac)("fora do Mac, nada muda", () => {
    expect(mac.ehMac).toBe(false);
    expect(mac.ajustarOpcoesDaJanela(opcoesDoWindows, true)).toBe(opcoesDoWindows);
    expect(mac.ajustarOpcoesDaJanela(opcoesDoWindows, false)).toBe(opcoesDoWindows);
    expect(mac.menuDoApp({ buildFromTemplate: () => "menu" }, "Orquestrador")).toBeNull();
  });

  it.runIf(noMac)("no Mac, acha o histórico na pasta dados do repositório gravado no pacote", () => {
    const existe = (c) => c === "/repo/dados/orquestradores";
    expect(mac.historicoDoRepositorio({ repositorioDoMac: "/repo" }, existe)).toBe("/repo/dados");
    expect(mac.historicoDoRepositorio({ repositorioDoMac: "/outro" }, existe)).toBeNull();
    expect(mac.historicoDoRepositorio({}, existe)).toBeNull();
    expect(mac.historicoDoRepositorio(null, existe)).toBeNull();
  });
});
