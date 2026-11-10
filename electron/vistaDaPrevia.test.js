"use strict";

import { describe, expect, it, vi } from "vitest";

const {
  PARTICAO,
  LIMITE_DE_VISTAS,
  ehHostLocal,
  pedidoParaHostLocal,
  origemDaPagina,
  origemParaLog,
  validarEnderecoExterno,
  validarId,
  validarRetangulo,
  calcularLimites,
  navegacaoPermitida,
  descartarAboutBlankDoInicio,
  permissaoLiberada,
  userAgentDeNavegador,
  criarVistasDaPrevia,
} = require("./vistaDaPrevia");

describe("ehHostLocal", () => {
  it.each([
    "localhost",
    "app.localhost",
    "127.0.0.1",
    "127.1.2.3",
    "0.0.0.0",
    "10.0.0.5",
    "172.16.0.1",
    "172.31.255.1",
    "192.168.1.20",
    "169.254.1.1",
    "[::1]",
    "::",
    "fd00::1",
    "fe80::1",
    "::ffff:7f00:1",
    "impressora.local",
    "",
    // sem ponto e sufixos internos
    "intranet",
    "servidor.lan",
    "wiki.internal",
    "ad.corp",
    "roteador.home.arpa",
    "home.arpa",
    // CGNAT, 192.0.0.0/24, multicast e reservados
    "100.64.0.1",
    "100.127.255.254",
    "192.0.0.8",
    "224.0.0.1",
    "239.255.255.250",
    "240.0.0.1",
    "255.255.255.255",
    // IPv6: ::/96, NAT64 e 6to4 com IPv4 local, multicast, inválido
    "::7f00:1",
    "::1.2.3.4",
    "[::a00:1]",
    "64:ff9b::7f00:1",
    "64:ff9b::a00:5",
    "64:ff9b::192.168.1.1",
    "2002:7f00:1::",
    "2002:c0a8:101::1",
    "2002:a00:1::",
    "ff02::1",
    "1:2:3:4:5:6:7:8:9",
  ])("%s é local", (host) => {
    expect(ehHostLocal(host)).toBe(true);
  });

  it.each([
    "docs.google.com",
    "notion.so",
    "github.com",
    "8.8.8.8",
    "172.32.0.1",
    "172.15.0.1",
    "192.169.0.1",
    "2606:4700::1111",
    "100.63.255.255",
    "100.128.0.1",
    "192.0.1.1",
    "223.255.255.255",
    "64:ff9b::808:808",
    "2002:808:808::1",
    "2001:4860:4860::8888",
    "lan.exemplo.com",
    "corp.exemplo.com",
  ])(
    "%s não é local",
    (host) => {
      expect(ehHostLocal(host)).toBe(false);
    },
  );
});

describe("pedidoParaHostLocal, origemDaPagina e origemParaLog", () => {
  it("cancela só http, https, ws e wss para host literal local", () => {
    for (const url of ["http://127.0.0.1:3200/api", "https://localhost/x", "ws://192.168.0.2/s", "wss://intranet/s", "http://[::1]:80/"]) {
      expect(pedidoParaHostLocal(url)).toBe(true);
    }
    for (const url of ["https://github.com/a", "data:text/html,oi", "blob:https://github.com/uuid", "about:blank", "não é url"]) {
      expect(pedidoParaHostLocal(url)).toBe(false);
    }
  });

  it("origemDaPagina devolve só protocolo e host (sem caminho, query nem fragmento)", () => {
    expect(origemDaPagina("https://github.com/login?token=abc#x")).toBe("https://github.com");
    expect(origemDaPagina("http://exemplo.com:8080/a/b")).toBe("http://exemplo.com:8080");
    expect(origemDaPagina("about:blank")).toBeNull();
    expect(origemDaPagina("file:///etc/passwd")).toBeNull();
    expect(origemDaPagina("lixo")).toBeNull();
  });

  it("origemParaLog nunca devolve caminho nem query", () => {
    expect(origemParaLog("https://exemplo.com/reset?token=segredo")).toBe("https://exemplo.com");
    expect(origemParaLog("file:///Users/pedro/segredo.txt")).toBe("file: (sem origem)");
    expect(origemParaLog("lixo com segredo")).toBe("(endereço inválido)");
  });
});

describe("validarEnderecoExterno", () => {
  it("aceita http e https externos e normaliza", () => {
    expect(validarEnderecoExterno("https://docs.google.com/spreadsheets/d/abc/edit#gid=0")).toBe(
      "https://docs.google.com/spreadsheets/d/abc/edit#gid=0",
    );
    expect(validarEnderecoExterno("http://EXEMPLO.com")).toBe("http://exemplo.com/");
  });

  it.each([
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,<b>oi</b>",
    "ftp://exemplo.com",
    "about:blank",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "https://192.168.0.10/app",
    "http://[::1]:8080",
    "http://intranet/wiki",
    "http://servidor.lan/",
    "http://100.64.0.1/",
    "http://224.0.0.251/",
    "http://[64:ff9b::7f00:1]/",
    "https://usuario:senha@exemplo.com",
    "exemplo.com",
    "",
    "   ",
  ])("recusa %s", (bruto) => {
    expect(validarEnderecoExterno(bruto)).toBeNull();
  });

  it("recusa o que não é texto e URLs enormes", () => {
    expect(validarEnderecoExterno(undefined)).toBeNull();
    expect(validarEnderecoExterno(42)).toBeNull();
    expect(validarEnderecoExterno({ href: "https://exemplo.com" })).toBeNull();
    expect(validarEnderecoExterno(`https://exemplo.com/${"a".repeat(3000)}`)).toBeNull();
  });
});

describe("validarId", () => {
  it("só aceita letras, números, _ e - de 1 a 64 caracteres", () => {
    expect(validarId("p1")).toBe("p1");
    expect(validarId("a-b_C9")).toBe("a-b_C9");
    expect(validarId("")).toBeNull();
    expect(validarId("a b")).toBeNull();
    expect(validarId("../x")).toBeNull();
    expect(validarId("a".repeat(65))).toBeNull();
    expect(validarId(7)).toBeNull();
    expect(validarId(null)).toBeNull();
  });
});

describe("validarRetangulo", () => {
  const bom = { x: 10, y: 20, largura: 300, altura: 200, zoom: 1 };

  it("devolve uma cópia só com os cinco campos", () => {
    const resultado = validarRetangulo({ ...bom, extra: "x" });
    expect(resultado).toEqual(bom);
    expect(resultado).not.toBe(bom);
  });

  it.each([
    [null],
    ["texto"],
    [{ ...bom, x: Number.NaN }],
    [{ ...bom, y: Infinity }],
    [{ ...bom, largura: 0 }],
    [{ ...bom, altura: -5 }],
    [{ ...bom, largura: 50_000 }],
    [{ ...bom, zoom: 0 }],
    [{ ...bom, zoom: 50 }],
    [{ ...bom, x: "10" }],
    [{ x: 1, y: 1, largura: 10, altura: 10 }],
  ])("recusa %j", (entrada) => {
    expect(validarRetangulo(entrada)).toBeNull();
  });
});

describe("calcularLimites", () => {
  const area = { largura: 1440, altura: 900 };

  it("sem zoom da janela, usa o retângulo e o zoom do canvas", () => {
    const resultado = calcularLimites({ x: 100, y: 120, largura: 600, altura: 400, zoom: 0.5 }, 1, area);
    expect(resultado).toEqual({ bounds: { x: 100, y: 120, width: 600, height: 400 }, zoomDaPagina: 0.5 });
  });

  it("multiplica pelo zoom da própria tela do app", () => {
    const resultado = calcularLimites({ x: 100, y: 100, largura: 200, altura: 100, zoom: 1 }, 1.5, area);
    expect(resultado.bounds).toEqual({ x: 150, y: 150, width: 300, height: 150 });
    expect(resultado.zoomDaPagina).toBe(1.5);
  });

  it("limita o zoom da página ao que o Chromium aceita", () => {
    expect(calcularLimites({ x: 0, y: 0, largura: 100, altura: 100, zoom: 0.1 }, 1, area).zoomDaPagina).toBe(0.25);
    expect(calcularLimites({ x: 0, y: 0, largura: 100, altura: 100, zoom: 9 }, 1, area).zoomDaPagina).toBe(5);
  });

  it("corta o que passa da janela e devolve nulo quando nada sobra", () => {
    const cortado = calcularLimites({ x: 1400, y: 880, largura: 200, altura: 100, zoom: 1 }, 1, area);
    expect(cortado.bounds).toEqual({ x: 1400, y: 880, width: 40, height: 20 });
    expect(calcularLimites({ x: 1500, y: 100, largura: 200, altura: 100, zoom: 1 }, 1, area)).toBeNull();
    expect(calcularLimites({ x: -300, y: 100, largura: 200, altura: 100, zoom: 1 }, 1, area)).toBeNull();
  });

  it("zoom da janela inválido vale 1", () => {
    expect(calcularLimites({ x: 10, y: 10, largura: 100, altura: 100, zoom: 1 }, 0, area).bounds.width).toBe(100);
    expect(calcularLimites({ x: 10, y: 10, largura: 100, altura: 100, zoom: 1 }, Number.NaN, area).bounds.width).toBe(100);
  });
});

describe("navegacaoPermitida", () => {
  it("o quadro principal só vai para http e https externos", () => {
    expect(navegacaoPermitida("https://notion.so/x", true)).toBe(true);
    expect(navegacaoPermitida("http://exemplo.com", true)).toBe(true);
    for (const url of [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "data:text/html,x",
      "blob:https://exemplo.com/abc",
      "about:blank",
      "orquestrador://abrir",
      "http://localhost:5173",
      "http://127.0.0.1:3999/api",
      "https://10.0.0.1",
    ]) {
      expect(navegacaoPermitida(url, true)).toBe(false);
    }
  });

  it("quadros internos também podem usar about:blank, blob: e data:, mas não file: nem endereço local", () => {
    expect(navegacaoPermitida("about:blank", false)).toBe(true);
    expect(navegacaoPermitida("blob:https://exemplo.com/abc", false)).toBe(true);
    expect(navegacaoPermitida("data:text/html,x", false)).toBe(true);
    expect(navegacaoPermitida("file:///etc/passwd", false)).toBe(false);
    expect(navegacaoPermitida("http://localhost:1", false)).toBe(false);
  });
});

describe("permissaoLiberada", () => {
  it("só o clipboard sanitizado de escrita", () => {
    expect(permissaoLiberada("clipboard-sanitized-write")).toBe(true);
    for (const nome of ["media", "notifications", "geolocation", "clipboard-read", "fullscreen", "openExternal", "usb", "hid"]) {
      expect(permissaoLiberada(nome)).toBe(false);
    }
  });
});

describe("userAgentDeNavegador", () => {
  it("tira Electron/x e o nome do app, e deixa o resto", () => {
    const original =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) orquestrador-agentes-app/0.2.2 Chrome/130.0.0.0 Electron/33.4.11 Safari/537.36";
    expect(userAgentDeNavegador(original, "orquestrador-agentes-app")).toBe(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Serviço, com o Electron trocado por falsos.
// ──────────────────────────────────────────────────────────────────────────

function montar({ bloqueada = false, registrar = undefined } = {}) {
  const estado = { janelaEmFoco: true, bloqueada };
  const ouvintesDaJanela = {};
  const janelaWc = {
    isDestroyed: () => false,
    getZoomFactor: () => 1,
    send: vi.fn(),
    on: vi.fn(),
    mainFrame: { quadro: "principal" },
  };
  const janela = {
    isDestroyed: () => false,
    isVisible: () => true,
    isMinimized: () => false,
    isFocused: () => estado.janelaEmFoco,
    getContentSize: () => [1440, 900],
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    webContents: janelaWc,
    on: (nome, fn) => {
      ouvintesDaJanela[nome] = fn;
    },
  };
  const vistas = [];
  class WebContentsViewFalsa {
    constructor(opcoes) {
      this.opcoes = opcoes;
      this.bounds = null;
      this.visivel = null;
      this.ouvintes = {};
      // O histórico da vista: `entradas` e o índice da atual (`ativo`); os testes o mexem à mão.
      const historico = { entradas: [], ativo: -1 };
      this.historico = historico;
      this.webContents = {
        navigationHistory: {
          length: () => historico.entradas.length,
          getActiveIndex: () => historico.ativo,
          getEntryAtIndex: (indice) => ({ url: historico.entradas[indice] }),
          removeEntryAtIndex: vi.fn((indice) => {
            historico.entradas.splice(indice, 1);
            if (indice < historico.ativo) historico.ativo -= 1;
            return true;
          }),
          canGoBack: () => historico.ativo > 0,
          canGoForward: () => historico.ativo < historico.entradas.length - 1,
          goBack: vi.fn(() => {
            historico.ativo -= 1;
          }),
          goForward: vi.fn(() => {
            historico.ativo += 1;
          }),
        },
        isDestroyed: () => false,
        setUserAgent: vi.fn(),
        setWindowOpenHandler: vi.fn((fn) => {
          this.abrirJanela = fn;
        }),
        on: (nome, fn) => {
          this.ouvintes[nome] = fn;
        },
        loadURL: vi.fn(async () => undefined),
        reload: vi.fn(),
        close: vi.fn(),
        focus: vi.fn(),
        setZoomFactor: vi.fn(),
        capturePage: vi.fn(async () => ({
          isEmpty: () => false,
          getSize: () => ({ width: 400, height: 300 }),
          resize: () => ({}),
          toJPEG: () => Buffer.from("foto"),
        })),
      };
      vistas.push(this);
    }
    setBounds(b) {
      this.bounds = b;
    }
    getBounds() {
      return this.bounds || { x: 0, y: 0, width: 400, height: 300 };
    }
    setVisible(v) {
      this.visivel = v;
    }
  }
  const sessao = {
    getUserAgent: () => "Mozilla/5.0 Chrome/130 Electron/33.4.11 Safari/537.36",
    setUserAgent: vi.fn(),
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    setDevicePermissionHandler: vi.fn(),
    clearStorageData: vi.fn(async () => undefined),
    clearCache: vi.fn(async () => undefined),
    clearAuthCache: vi.fn(async () => undefined),
    clearHostResolverCache: vi.fn(async () => undefined),
    webRequest: {
      onBeforeRequest: vi.fn((fn) => {
        sessao.aoPedir = fn;
      }),
    },
    on: vi.fn((nome, fn) => {
      sessao.ouvintes[nome] = fn;
    }),
    ouvintes: {},
  };
  const session = { fromPartition: vi.fn(() => sessao) };
  const shell = { openExternal: vi.fn() };
  const servico = criarVistasDaPrevia({
    WebContentsView: WebContentsViewFalsa,
    session,
    shell,
    janelaPrincipal: () => janela,
    eDaJanelaPrincipal: (evento) => evento.sender === janelaWc && evento.senderFrame === janelaWc.mainFrame,
    bloqueada: () => estado.bloqueada,
    nomeDoApp: "orquestrador-agentes-app",
    registrar,
  });
  const principal = { sender: janelaWc, senderFrame: janelaWc.mainFrame };
  const intruso = { sender: { outra: true }, senderFrame: null };
  const retangulo = { x: 100, y: 100, largura: 600, altura: 400, zoom: 1 };
  return { servico, janela, janelaWc, vistas, sessao, session, shell, principal, intruso, retangulo, ouvintesDaJanela, estado };
}

describe("criarVistasDaPrevia: IPC", () => {
  it("só aceita do quadro principal da janela principal", async () => {
    const { servico, intruso, vistas } = montar();
    expect(() => servico.aoAbrir(intruso, { id: "p1", url: "https://notion.so" })).toThrow(/só na janela principal/);
    await expect(servico.aoAtivar(intruso, { id: "p1", ativa: true })).rejects.toThrow(/só na janela principal/);
    expect(() => servico.aoRecarregar(intruso, { id: "p1" })).toThrow();
    expect(() => servico.aoVoltar(intruso, { id: "p1" })).toThrow(/só na janela principal/);
    expect(() => servico.aoAvancar(intruso, { id: "p1" })).toThrow(/só na janela principal/);
    expect(() => servico.aoFechar(intruso, { id: "p1" })).toThrow();
    await expect(servico.aoSairDasContas(intruso)).rejects.toThrow();
    // O envio de retângulo não responde: ignora em silêncio.
    expect(() => servico.aoMoverRetangulo(intruso, { id: "p1", retangulo: {} })).not.toThrow();
    expect(vistas).toHaveLength(0);
  });

  it("recusa de quem manda um quadro que não é o principal", () => {
    const { servico, janelaWc } = montar();
    const deIframe = { sender: janelaWc, senderFrame: { quadro: "iframe" } };
    expect(() => servico.aoAbrir(deIframe, { id: "p1", url: "https://notion.so" })).toThrow();
  });

  it("abrir valida o id e a URL antes de criar a vista", () => {
    const { servico, principal, vistas } = montar();
    expect(servico.aoAbrir(principal, { id: "p 1", url: "https://notion.so" })).toBe(false);
    expect(servico.aoAbrir(principal, { id: "p1", url: "file:///etc/passwd" })).toBe(false);
    expect(servico.aoAbrir(principal, { id: "p1", url: "http://localhost:5173" })).toBe(false);
    expect(servico.aoAbrir(principal, undefined)).toBe(false);
    expect(servico.aoAbrir(principal, "texto")).toBe(false);
    expect(vistas).toHaveLength(0);
  });

  it("abrir cria a vista escondida, com as preferências seguras e a sessão persist:previa", () => {
    const { servico, principal, vistas, session, sessao, janela, retangulo } = montar();
    expect(servico.aoAbrir(principal, { id: "p1", url: "https://docs.google.com/document/d/1/edit", retangulo })).toBe(true);

    expect(session.fromPartition).toHaveBeenCalledWith(PARTICAO);
    expect(PARTICAO).toBe("persist:previa");
    const [vista] = vistas;
    const prefs = vista.opcoes.webPreferences;
    expect(prefs).toMatchObject({
      session: sessao,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    });
    expect(prefs.preload).toBeUndefined();
    expect(vista.visivel).toBe(false);
    expect(vista.bounds).toEqual({ x: 100, y: 100, width: 600, height: 400 });
    expect(janela.contentView.addChildView).toHaveBeenCalledWith(vista);
    expect(vista.webContents.loadURL).toHaveBeenCalledWith("https://docs.google.com/document/d/1/edit");
    // User agent sem Electron e permissões negadas por padrão.
    expect(sessao.setUserAgent).toHaveBeenCalledWith("Mozilla/5.0 Chrome/130 Safari/537.36");
    const pedir = vi.fn();
    sessao.setPermissionRequestHandler.mock.calls[0][0](null, "media", pedir);
    expect(pedir).toHaveBeenCalledWith(false);
    expect(sessao.setPermissionCheckHandler.mock.calls[0][0](null, "notifications")).toBe(false);
    expect(sessao.setPermissionCheckHandler.mock.calls[0][0](null, "clipboard-sanitized-write")).toBe(true);
    expect(sessao.setDevicePermissionHandler.mock.calls[0][0]()).toBe(false);
  });

  it("abrir de novo com o mesmo endereço não recarrega; com outro, navega", () => {
    const { servico, principal, vistas } = montar();
    servico.aoAbrir(principal, { id: "p1", url: "https://notion.so/a" });
    servico.aoAbrir(principal, { id: "p1", url: "https://notion.so/a" });
    expect(vistas).toHaveLength(1);
    expect(vistas[0].webContents.loadURL).toHaveBeenCalledTimes(1);
    servico.aoAbrir(principal, { id: "p1", url: "https://notion.so/b" });
    expect(vistas[0].webContents.loadURL).toHaveBeenCalledTimes(2);
  });

  it("limita quantas vistas ficam abertas", () => {
    const { servico, principal } = montar();
    for (let i = 0; i < LIMITE_DE_VISTAS; i += 1) {
      expect(servico.aoAbrir(principal, { id: `p${i}`, url: "https://notion.so" })).toBe(true);
    }
    expect(servico.aoAbrir(principal, { id: "extra", url: "https://notion.so" })).toBe(false);
    expect(servico.total()).toBe(LIMITE_DE_VISTAS);
  });

  it("ativar mostra a vista nos limites do retângulo, com zoom e foco; só com retângulo válido", async () => {
    const { servico, principal, vistas, retangulo } = montar();
    servico.aoAbrir(principal, { id: "p1", url: "https://notion.so" });
    const [vista] = vistas;

    expect(await servico.aoAtivar(principal, { id: "p1", ativa: true })).toBe(false);
    expect(await servico.aoAtivar(principal, { id: "p1", ativa: true, retangulo: { x: 1 } })).toBe(false);
    expect(await servico.aoAtivar(principal, { id: "p1", ativa: "sim" })).toBe(false);
    expect(await servico.aoAtivar(principal, { id: "nao-existe", ativa: true, retangulo })).toBe(false);
    expect(vista.visivel).toBe(false);

    expect(await servico.aoAtivar(principal, { id: "p1", ativa: true, retangulo: { ...retangulo, zoom: 0.5 } })).toBe(true);
    expect(vista.visivel).toBe(true);
    expect(vista.bounds).toEqual({ x: 100, y: 100, width: 600, height: 400 });
    expect(vista.webContents.setZoomFactor).toHaveBeenLastCalledWith(0.5);
    expect(vista.webContents.focus).toHaveBeenCalled();
  });

  it("o retângulo enviado depois move a vista; inativa, ele só guarda", async () => {
    const { servico, principal, vistas, retangulo } = montar();
    servico.aoAbrir(principal, { id: "p1", url: "https://notion.so" });
    const [vista] = vistas;

    servico.aoMoverRetangulo(principal, { id: "p1", retangulo: { ...retangulo, x: 50 } });
    expect(vista.visivel).toBe(false);

    await servico.aoAtivar(principal, { id: "p1", ativa: true, retangulo });
    servico.aoMoverRetangulo(principal, { id: "p1", retangulo: { ...retangulo, x: 250, zoom: 2 } });
    expect(vista.bounds.x).toBe(250);
    expect(vista.webContents.setZoomFactor).toHaveBeenLastCalledWith(2);
    // Inválido: ignorado.
    servico.aoMoverRetangulo(principal, { id: "p1", retangulo: { ...retangulo, largura: -1 } });
    expect(vista.bounds.x).toBe(250);
  });

  it("desativar fotografa, esconde e avisa a tela com a foto", async () => {
    const { servico, principal, vistas, retangulo, janelaWc } = montar();
    servico.aoAbrir(principal, { id: "p1", url: "https://notion.so" });
    await servico.aoAtivar(principal, { id: "p1", ativa: true, retangulo });
    await servico.aoAtivar(principal, { id: "p1", ativa: false });

    expect(vistas[0].visivel).toBe(false);
    const eventos = janelaWc.send.mock.calls.filter(([canal]) => canal === "previa:evento").map(([, evento]) => evento);
    expect(eventos).toContainEqual({ tipo: "foto", id: "p1", foto: `data:image/jpeg;base64,${Buffer.from("foto").toString("base64")}` });
  });

  it("só fotografa com a vista ativa: carregar uma vista escondida não gera foto (a captura sairia vazia)", async () => {
    const { servico, principal, vistas, janelaWc, retangulo } = montar();
    servico.aoAbrir(principal, { id: "p1", url: "https://notion.so", retangulo });
    const [vista] = vistas;
    vista.ouvintes["did-finish-load"]();
    await new Promise((resolver) => setTimeout(resolver, 50));

    expect(vista.webContents.capturePage).not.toHaveBeenCalled();
    expect(janelaWc.send).toHaveBeenCalledWith("previa:evento", {
      tipo: "estado",
      id: "p1",
      carregando: false,
      erro: null,
      origem: null,
      podeVoltar: false,
      podeAvancar: false,
    });
  });

  it("uma vista ativa por vez: ativar outra esconde a primeira e avisa a tela", async () => {
    const { servico, principal, vistas, retangulo, janelaWc } = montar();
    servico.aoAbrir(principal, { id: "p1", url: "https://notion.so" });
    servico.aoAbrir(principal, { id: "p2", url: "https://github.com" });
    await servico.aoAtivar(principal, { id: "p1", ativa: true, retangulo });
    await servico.aoAtivar(principal, { id: "p2", ativa: true, retangulo });

    expect(vistas[0].visivel).toBe(false);
    expect(vistas[1].visivel).toBe(true);
    expect(janelaWc.send).toHaveBeenCalledWith("previa:evento", { tipo: "desativada", id: "p1" });
  });

  it("modo invisível: não ativa; desativarTodas esconde o que estava ativo", async () => {
    const bloqueio = montar({ bloqueada: true });
    bloqueio.servico.aoAbrir(bloqueio.principal, { id: "p1", url: "https://notion.so" });
    expect(await bloqueio.servico.aoAtivar(bloqueio.principal, { id: "p1", ativa: true, retangulo: bloqueio.retangulo })).toBe(false);
    expect(bloqueio.vistas[0].visivel).toBe(false);

    const { servico, principal, vistas, retangulo } = montar();
    servico.aoAbrir(principal, { id: "p1", url: "https://notion.so" });
    await servico.aoAtivar(principal, { id: "p1", ativa: true, retangulo });
    servico.desativarTodas();
    await vi.waitFor(() => expect(vistas[0].visivel).toBe(false));
  });

  it("minimizar ou esconder a janela desativa; recarregar a tela destrói as vistas", async () => {
    const { servico, principal, vistas, retangulo, janela, janelaWc, ouvintesDaJanela } = montar();
    servico.anexar(janela);
    servico.aoAbrir(principal, { id: "p1", url: "https://notion.so" });
    await servico.aoAtivar(principal, { id: "p1", ativa: true, retangulo });

    ouvintesDaJanela.minimize();
    await vi.waitFor(() => expect(vistas[0].visivel).toBe(false));

    const aoNavegar = janelaWc.on.mock.calls.find(([nome]) => nome === "did-start-navigation")[1];
    aoNavegar({ isMainFrame: false, isSameDocument: false });
    aoNavegar({ isMainFrame: true, isSameDocument: true });
    expect(servico.total()).toBe(1);
    aoNavegar({ isMainFrame: true, isSameDocument: false });
    expect(servico.total()).toBe(0);
    expect(vistas[0].webContents.close).toHaveBeenCalled();
  });

  it("fechar destrói a vista (remove da janela e fecha o conteúdo)", () => {
    const { servico, principal, vistas, janela } = montar();
    servico.aoAbrir(principal, { id: "p1", url: "https://notion.so" });
    expect(servico.aoFechar(principal, { id: "p1" })).toBe(true);
    expect(janela.contentView.removeChildView).toHaveBeenCalledWith(vistas[0]);
    expect(vistas[0].webContents.close).toHaveBeenCalled();
    expect(servico.total()).toBe(0);
    expect(servico.aoFechar(principal, { id: "../x" })).toBe(false);
  });

  it("sair das contas: about:blank em todas as vistas, limpa a sessão, só então recarrega e manda a tela descartar as fotos", async () => {
    const { servico, principal, vistas, sessao, janelaWc } = montar();
    servico.aoAbrir(principal, { id: "p1", url: "https://notion.so/pagina" });
    servico.aoAbrir(principal, { id: "p2", url: "https://github.com" });
    const ordem = [];
    for (const vista of vistas) {
      vista.webContents.loadURL.mockClear();
      vista.webContents.loadURL.mockImplementation(async (url) => {
        ordem.push(`carregar:${url}`);
      });
    }
    for (const nome of ["clearStorageData", "clearCache", "clearAuthCache", "clearHostResolverCache"]) {
      sessao[nome].mockImplementation(async () => {
        ordem.push(nome);
      });
    }
    janelaWc.send.mockImplementation((_canal, evento) => ordem.push(`evento:${evento.tipo}`));

    expect(await servico.aoSairDasContas(principal)).toBe(true);

    expect(ordem).toEqual([
      "carregar:about:blank",
      "carregar:about:blank",
      "clearStorageData",
      "clearCache",
      "clearAuthCache",
      "clearHostResolverCache",
      "evento:sessao-limpa",
      "carregar:https://notion.so/pagina",
      "carregar:https://github.com/",
    ]);
    expect(vistas[0].webContents.reload).not.toHaveBeenCalled();
  });

  it("sair das contas não espera para sempre uma vista que não larga a página", async () => {
    vi.useFakeTimers();
    try {
      const { servico, principal, vistas, sessao } = montar();
      servico.aoAbrir(principal, { id: "p1", url: "https://notion.so" });
      vistas[0].webContents.loadURL.mockImplementationOnce(() => new Promise(() => undefined));
      const saida = servico.aoSairDasContas(principal);
      await vi.advanceTimersByTimeAsync(3500);
      expect(await saida).toBe(true);
      expect(sessao.clearStorageData).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("uma foto que estava sendo tirada antes de sair das contas é descartada", async () => {
    const { servico, principal, vistas, retangulo, janelaWc } = montar();
    servico.aoAbrir(principal, { id: "p1", url: "https://notion.so" });
    await servico.aoAtivar(principal, { id: "p1", ativa: true, retangulo });
    let entregar;
    vistas[0].webContents.capturePage.mockImplementationOnce(
      () =>
        new Promise((resolver) => {
          entregar = () =>
            resolver({ isEmpty: () => false, getSize: () => ({ width: 10, height: 10 }), resize: () => ({}), toJPEG: () => Buffer.from("velha") });
        }),
    );
    const desativando = servico.aoAtivar(principal, { id: "p1", ativa: false });
    await servico.aoSairDasContas(principal);
    entregar();
    await desativando;
    const fotos = janelaWc.send.mock.calls.filter(([, evento]) => evento.tipo === "foto");
    expect(fotos).toHaveLength(0);
  });

  it("o estado leva a origem real da página (só protocolo e host) a cada navegação, também dentro da página", () => {
    const { servico, principal, vistas, janelaWc } = montar();
    servico.aoAbrir(principal, { id: "p1", url: "https://github.com" });
    const { ouvintes } = vistas[0];
    janelaWc.send.mockClear();

    ouvintes["did-navigate"]({}, "https://github.com/login?return_to=%2Fsegredo#x");
    ouvintes["did-navigate-in-page"]({}, "https://github.com/a/b?c=1", true);
    ouvintes["did-navigate-in-page"]({}, "https://anuncio.exemplo.net/x", false);
    ouvintes["did-navigate"]({}, "https://accounts.google.com/o/oauth2/auth?client_id=1");
    ouvintes["did-finish-load"]();

    const estados = janelaWc.send.mock.calls.map(([, evento]) => evento);
    const sem = { podeVoltar: false, podeAvancar: false };
    expect(estados).toEqual([
      { tipo: "estado", id: "p1", carregando: true, erro: null, origem: "https://github.com", ...sem },
      { tipo: "estado", id: "p1", carregando: true, erro: null, origem: "https://github.com", ...sem },
      { tipo: "estado", id: "p1", carregando: true, erro: null, origem: "https://accounts.google.com", ...sem },
      { tipo: "estado", id: "p1", carregando: false, erro: null, origem: "https://accounts.google.com", ...sem },
    ]);
    expect(JSON.stringify(estados)).not.toMatch(/segredo|client_id|login/);
  });

  it("o estado leva podeVoltar e podeAvancar do histórico da vista, a cada navegação", () => {
    const { servico, principal, vistas, janelaWc } = montar();
    servico.aoAbrir(principal, { id: "p1", url: "https://github.com" });
    const [vista] = vistas;
    const ultimoEstado = () => janelaWc.send.mock.calls.map(([, evento]) => evento).findLast((evento) => evento.tipo === "estado");

    vista.historico.entradas = ["https://github.com/"];
    vista.historico.ativo = 0;
    vista.ouvintes["did-navigate"]({}, "https://github.com/");
    expect(ultimoEstado()).toMatchObject({ podeVoltar: false, podeAvancar: false });

    vista.historico.entradas.push("https://github.com/a");
    vista.historico.ativo = 1;
    vista.ouvintes["did-navigate"]({}, "https://github.com/a");
    expect(ultimoEstado()).toMatchObject({ podeVoltar: true, podeAvancar: false });

    vista.historico.ativo = 0;
    vista.ouvintes["did-navigate-in-page"]({}, "https://github.com/", true);
    expect(ultimoEstado()).toMatchObject({ podeVoltar: false, podeAvancar: true });
  });

  it("voltar e avançar andam no histórico da vista e recusam quando não há para onde ir", () => {
    const { servico, principal, vistas } = montar();
    servico.aoAbrir(principal, { id: "p1", url: "https://github.com" });
    const [vista] = vistas;
    const { goBack, goForward } = vista.webContents.navigationHistory;
    vista.historico.entradas = ["https://github.com/", "https://github.com/a"];
    vista.historico.ativo = 1;

    expect(servico.aoAvancar(principal, { id: "p1" })).toBe(false);
    expect(goForward).not.toHaveBeenCalled();
    expect(servico.aoVoltar(principal, { id: "p1" })).toBe(true);
    expect(goBack).toHaveBeenCalledTimes(1);
    expect(servico.aoVoltar(principal, { id: "p1" })).toBe(false);
    expect(goBack).toHaveBeenCalledTimes(1);
    expect(servico.aoAvancar(principal, { id: "p1" })).toBe(true);
    expect(goForward).toHaveBeenCalledTimes(1);
  });

  it("voltar e avançar validam o id e ignoram vista que não existe", () => {
    const { servico, principal } = montar();
    expect(servico.aoVoltar(principal, { id: "p 1" })).toBe(false);
    expect(servico.aoVoltar(principal, { id: "nao-existe" })).toBe(false);
    expect(servico.aoAvancar(principal, undefined)).toBe(false);
    expect(servico.aoAvancar(principal, "texto")).toBe(false);
  });

  it("descartarAboutBlankDoInicio tira o about:blank que o 'sair das contas' deixa no começo do histórico", () => {
    const { servico, principal, vistas, janelaWc } = montar();
    servico.aoAbrir(principal, { id: "p1", url: "https://github.com" });
    const [vista] = vistas;
    vista.historico.entradas = ["about:blank", "https://github.com/"];
    vista.historico.ativo = 1;
    janelaWc.send.mockClear();

    vista.ouvintes["did-finish-load"]();

    expect(vista.historico.entradas).toEqual(["https://github.com/"]);
    expect(janelaWc.send.mock.calls.at(-1)[1]).toMatchObject({ podeVoltar: false });

    // Se o about:blank é a página atual, ou a única, a entrada fica.
    const remover = vi.fn();
    const falso = (entradas, ativo) => ({
      length: () => entradas.length,
      getActiveIndex: () => ativo,
      getEntryAtIndex: (indice) => ({ url: entradas[indice] }),
      removeEntryAtIndex: remover,
    });
    descartarAboutBlankDoInicio(falso(["about:blank"], 0));
    descartarAboutBlankDoInicio(falso(["about:blank", "https://github.com/"], 0));
    descartarAboutBlankDoInicio(falso(["https://github.com/", "https://github.com/a"], 1));
    expect(remover).not.toHaveBeenCalled();
  });

  it("a ativação não vale se o modo invisível ligou enquanto a outra vista desativava (corrida)", async () => {
    const { servico, principal, vistas, retangulo, estado } = montar();
    servico.aoAbrir(principal, { id: "p1", url: "https://notion.so" });
    servico.aoAbrir(principal, { id: "p2", url: "https://github.com" });
    await servico.aoAtivar(principal, { id: "p1", ativa: true, retangulo });
    // A foto da p1 demora; nesse meio tempo o modo invisível liga.
    vistas[0].webContents.capturePage.mockImplementationOnce(async () => {
      estado.bloqueada = true;
      return { isEmpty: () => true };
    });
    expect(await servico.aoAtivar(principal, { id: "p2", ativa: true, retangulo })).toBe(false);
    expect(vistas[1].visivel).toBe(false);
  });
});

describe("criarVistasDaPrevia: sessão da prévia", () => {
  it("cancela pedidos para host literal local e deixa os externos passarem", () => {
    const { servico, principal, sessao } = montar();
    servico.aoAbrir(principal, { id: "p1", url: "https://notion.so" });
    const retorno = vi.fn();
    sessao.aoPedir({ url: "http://127.0.0.1:3200/api/saude?x=segredo" }, retorno);
    sessao.aoPedir({ url: "https://intranet/x" }, retorno);
    sessao.aoPedir({ url: "https://notion.so/a" }, retorno);
    expect(retorno.mock.calls).toEqual([[{ cancel: true }], [{ cancel: true }], [{ cancel: false }]]);
  });

  it("downloads: só da vista ativa e um por vez", async () => {
    const { servico, principal, vistas, retangulo, sessao } = montar();
    servico.aoAbrir(principal, { id: "p1", url: "https://notion.so" });
    servico.aoAbrir(principal, { id: "p2", url: "https://github.com" });
    const baixar = (vista) => {
      const evento = { preventDefault: vi.fn() };
      const item = { once: vi.fn((_nome, fn) => (item.terminar = fn)) };
      sessao.ouvintes["will-download"](evento, item, vista.webContents);
      return { evento, item };
    };

    // Escondida: cancela.
    expect(baixar(vistas[0]).evento.preventDefault).toHaveBeenCalled();
    // Origem desconhecida: cancela.
    const estranho = { preventDefault: vi.fn() };
    sessao.ouvintes["will-download"](estranho, { once: vi.fn() }, { outro: true });
    expect(estranho.preventDefault).toHaveBeenCalled();

    await servico.aoAtivar(principal, { id: "p1", ativa: true, retangulo });
    const primeiro = baixar(vistas[0]);
    expect(primeiro.evento.preventDefault).not.toHaveBeenCalled();
    // Um por vez.
    expect(baixar(vistas[0]).evento.preventDefault).toHaveBeenCalled();
    primeiro.item.terminar();
    const depois = baixar(vistas[0]);
    expect(depois.evento.preventDefault).not.toHaveBeenCalled();
  });
});

describe("criarVistasDaPrevia: o que a página pode fazer", () => {
  it("janelas novas são negadas; só link http/https externo de vista ativa, com a janela em foco, vai ao navegador do sistema, com limite de ritmo", async () => {
    vi.useFakeTimers();
    try {
      const { servico, principal, vistas, shell, retangulo } = montar();
      servico.aoAbrir(principal, { id: "p1", url: "https://notion.so" });
      await servico.aoAtivar(principal, { id: "p1", ativa: true, retangulo });
      const abrir = vistas[0].abrirJanela;

      expect(abrir({ url: "file:///etc/passwd" })).toEqual({ action: "deny" });
      expect(abrir({ url: "javascript:alert(1)" })).toEqual({ action: "deny" });
      expect(abrir({ url: "http://localhost:3000" })).toEqual({ action: "deny" });
      expect(shell.openExternal).not.toHaveBeenCalled();

      vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
      expect(abrir({ url: "https://exemplo.com/a" })).toEqual({ action: "deny" });
      expect(abrir({ url: "https://exemplo.com/b" })).toEqual({ action: "deny" });
      expect(shell.openExternal).toHaveBeenCalledTimes(1);
      expect(shell.openExternal).toHaveBeenCalledWith("https://exemplo.com/a");

      vi.setSystemTime(new Date("2030-01-01T00:00:02Z"));
      abrir({ url: "https://exemplo.com/c" });
      expect(shell.openExternal).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("vista escondida ou janela sem foco não abre nada no navegador do sistema", async () => {
    vi.useFakeTimers();
    try {
      const { servico, principal, vistas, shell, retangulo, estado } = montar();
      servico.aoAbrir(principal, { id: "p1", url: "https://notion.so" });
      const abrir = vistas[0].abrirJanela;
      vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));

      // Escondida (nunca ativada).
      abrir({ url: "https://exemplo.com/a" });
      expect(shell.openExternal).not.toHaveBeenCalled();

      // Ativa, mas a janela do app perdeu o foco.
      await servico.aoAtivar(principal, { id: "p1", ativa: true, retangulo });
      estado.janelaEmFoco = false;
      abrir({ url: "https://exemplo.com/b" });
      expect(shell.openExternal).not.toHaveBeenCalled();

      // Com foco: abre. Depois de desativada: não abre de novo.
      estado.janelaEmFoco = true;
      vi.setSystemTime(new Date("2030-01-01T00:00:05Z"));
      abrir({ url: "https://exemplo.com/c" });
      expect(shell.openExternal).toHaveBeenCalledTimes(1);
      await servico.aoAtivar(principal, { id: "p1", ativa: false });
      vi.setSystemTime(new Date("2030-01-01T00:00:10Z"));
      abrir({ url: "https://exemplo.com/d" });
      expect(shell.openExternal).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cada vista tem um teto de 5 aberturas por minuto, e o limite é por vista", async () => {
    vi.useFakeTimers();
    try {
      const { servico, principal, vistas, shell, retangulo } = montar();
      servico.aoAbrir(principal, { id: "p1", url: "https://notion.so" });
      servico.aoAbrir(principal, { id: "p2", url: "https://github.com" });
      await servico.aoAtivar(principal, { id: "p1", ativa: true, retangulo });
      vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
      for (let i = 0; i < 8; i += 1) {
        vi.setSystemTime(new Date(`2030-01-01T00:00:${String(i * 2).padStart(2, "0")}Z`));
        vistas[0].abrirJanela({ url: `https://exemplo.com/${i}` });
      }
      expect(shell.openExternal).toHaveBeenCalledTimes(5);

      // Passado um minuto da primeira, volta a abrir.
      vi.setSystemTime(new Date("2030-01-01T00:01:01Z"));
      vistas[0].abrirJanela({ url: "https://exemplo.com/depois" });
      expect(shell.openExternal).toHaveBeenCalledTimes(6);

      // A outra vista (ativando depois) tem o próprio teto.
      await servico.aoAtivar(principal, { id: "p2", ativa: true, retangulo });
      vi.setSystemTime(new Date("2030-01-01T00:01:05Z"));
      vistas[1].abrirJanela({ url: "https://exemplo.com/outra" });
      expect(shell.openExternal).toHaveBeenCalledTimes(7);
    } finally {
      vi.useRealTimers();
    }
  });

  it("bloqueia a navegação e o redirecionamento para esquemas que não são http/https e para endereços locais", () => {
    const { servico, principal, vistas } = montar();
    servico.aoAbrir(principal, { id: "p1", url: "https://notion.so" });
    const { ouvintes } = vistas[0];

    for (const evento of ["will-frame-navigate", "will-redirect"]) {
      const barrada = { url: "file:///etc/passwd", isMainFrame: true, preventDefault: vi.fn() };
      ouvintes[evento](barrada);
      expect(barrada.preventDefault).toHaveBeenCalled();

      const local = { url: "http://127.0.0.1:4000/api", isMainFrame: true, preventDefault: vi.fn() };
      ouvintes[evento](local);
      expect(local.preventDefault).toHaveBeenCalled();

      const permitida = { url: "https://notion.so/outra", isMainFrame: true, preventDefault: vi.fn() };
      ouvintes[evento](permitida);
      expect(permitida.preventDefault).not.toHaveBeenCalled();
    }
  });

  it("o log da navegação bloqueada traz só a origem, nunca caminho nem query", () => {
    const registrar = vi.fn();
    const { servico, principal, vistas } = montar({ registrar });
    servico.aoAbrir(principal, { id: "p1", url: "https://notion.so" });
    vistas[0].ouvintes["will-frame-navigate"]({
      url: "http://127.0.0.1:4000/api/segredo?token=abc",
      isMainFrame: true,
      preventDefault: vi.fn(),
    });
    expect(registrar).toHaveBeenCalledWith("Navegação bloqueada na prévia p1: http://127.0.0.1:4000");
    expect(registrar.mock.calls.flat().join(" ")).not.toMatch(/segredo|token/);
  });

  it("Shift+Esc dentro da página devolve o controle ao canvas; Esc sozinho é da página", async () => {
    const { servico, principal, vistas, retangulo } = montar();
    servico.aoAbrir(principal, { id: "p1", url: "https://notion.so" });
    await servico.aoAtivar(principal, { id: "p1", ativa: true, retangulo });
    const { ouvintes } = vistas[0];

    const soEsc = { preventDefault: vi.fn() };
    ouvintes["before-input-event"](soEsc, { type: "keyDown", key: "Escape", shift: false });
    expect(soEsc.preventDefault).not.toHaveBeenCalled();
    expect(vistas[0].visivel).toBe(true);

    const comShift = { preventDefault: vi.fn() };
    ouvintes["before-input-event"](comShift, { type: "keyDown", key: "Escape", shift: true });
    expect(comShift.preventDefault).toHaveBeenCalled();
    await vi.waitFor(() => expect(vistas[0].visivel).toBe(false));
  });
});
