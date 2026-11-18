"use strict";

import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

const {
  PREFIXO_DA_PARTICAO,
  LIMITE_DE_VISTAS,
  LIMITES_OCULTOS,
  RAIO_OCULTO,
  MENSAGEM_PAUSADO,
  ErroDoNavegadorDoAgente,
  particaoDoOrquestrador,
  enderecoPermitido,
  navegacaoPermitida,
  resolverTecla,
  validarComando,
  descreverComando,
  expressaoDaPagina,
  criarNavegadorDoAgente,
} = require("./navegadorDoAgente");

// ──────────────────────────────────────────────────────────────────────────
// Funções puras.
// ──────────────────────────────────────────────────────────────────────────

describe("particaoDoOrquestrador", () => {
  it("é própria de cada Orquestrador e persistente, fora da tela do app e da Prévia", () => {
    expect(PREFIXO_DA_PARTICAO).toBe("persist:navegador-");
    expect(particaoDoOrquestrador("abc-123")).toBe("persist:navegador-abc-123");
    expect(particaoDoOrquestrador("abc-123")).not.toBe(particaoDoOrquestrador("outro"));
    expect(particaoDoOrquestrador("abc-123")).not.toBe("persist:previa");
  });
});

describe("enderecoPermitido", () => {
  it("aceita qualquer http e https, inclusive de máquina local, e normaliza", () => {
    expect(enderecoPermitido("https://exemplo.com/a?b=1#c")).toBe("https://exemplo.com/a?b=1#c");
    expect(enderecoPermitido("http://EXEMPLO.com")).toBe("http://exemplo.com/");
    expect(enderecoPermitido("http://localhost:5173/app")).toBe("http://localhost:5173/app");
    expect(enderecoPermitido("http://192.168.0.10:8080")).toBe("http://192.168.0.10:8080/");
  });

  it.each([
    "file:///etc/passwd",
    "chrome://settings",
    "devtools://devtools/bundled/inspector.html",
    "javascript:alert(1)",
    "data:text/html,<b>oi</b>",
    "blob:https://exemplo.com/uuid",
    "about:blank",
    "ftp://exemplo.com",
    "https://usuario:senha@exemplo.com",
    "não é url",
    "",
  ])("recusa %s", (endereco) => {
    expect(enderecoPermitido(endereco)).toBeNull();
  });

  it("recusa o que não é texto e o endereço grande demais", () => {
    expect(enderecoPermitido(undefined)).toBeNull();
    expect(enderecoPermitido(42)).toBeNull();
    expect(enderecoPermitido(`https://exemplo.com/${"a".repeat(3000)}`)).toBeNull();
  });
});

describe("navegacaoPermitida", () => {
  it("o quadro principal só vai para http e https", () => {
    expect(navegacaoPermitida("https://notion.so/x", true)).toBe(true);
    expect(navegacaoPermitida("http://localhost:3000", true)).toBe(true);
    for (const url of [
      "file:///etc/passwd",
      "chrome://settings",
      "devtools://devtools/x",
      "javascript:alert(1)",
      "data:text/html,x",
      "blob:https://exemplo.com/abc",
      "about:blank",
    ]) {
      expect(navegacaoPermitida(url, true), url).toBe(false);
    }
  });

  it("quadros internos também podem usar about:blank, blob: e data:, mas não file:, chrome: nem devtools:", () => {
    expect(navegacaoPermitida("about:blank", false)).toBe(true);
    expect(navegacaoPermitida("blob:https://exemplo.com/abc", false)).toBe(true);
    expect(navegacaoPermitida("data:text/html,x", false)).toBe(true);
    expect(navegacaoPermitida("file:///etc/passwd", false)).toBe(false);
    expect(navegacaoPermitida("chrome://settings", false)).toBe(false);
    expect(navegacaoPermitida("devtools://devtools/x", false)).toBe(false);
  });
});

describe("resolverTecla", () => {
  it("Enter escreve \\r; Tab e setas não escrevem nada", () => {
    expect(resolverTecla("Enter")).toMatchObject({ key: "Enter", code: "Enter", vk: 13, text: "\r", modifiers: 0, commands: [] });
    expect(resolverTecla("Tab")).toMatchObject({ vk: 9, text: "" });
    expect(resolverTecla("ArrowDown")).toMatchObject({ key: "ArrowDown", vk: 40, text: "" });
    expect(resolverTecla("Space")).toMatchObject({ key: " ", code: "Space", vk: 32, text: " " });
    expect(resolverTecla("F5")).toMatchObject({ key: "F5", code: "F5", vk: 116 });
  });

  it("letras e números", () => {
    expect(resolverTecla("a")).toMatchObject({ key: "a", code: "KeyA", vk: 65, text: "a" });
    expect(resolverTecla("Shift+a")).toMatchObject({ key: "A", code: "KeyA", text: "A", modifiers: 8 });
    expect(resolverTecla("7")).toMatchObject({ key: "7", code: "Digit7", vk: 55, text: "7" });
  });

  it("atalhos com Ctrl, Alt ou Meta não escrevem e levam o comando de edição", () => {
    expect(resolverTecla("Ctrl+a")).toMatchObject({ text: "", modifiers: 2, commands: ["selectAll"] });
    expect(resolverTecla("Meta+c")).toMatchObject({ text: "", modifiers: 4, commands: ["copy"] });
    expect(resolverTecla("Ctrl+v").commands).toEqual(["paste"]);
    expect(resolverTecla("Ctrl+z").commands).toEqual(["undo"]);
    expect(resolverTecla("Ctrl+Shift+z").commands).toEqual(["redo"]);
    expect(resolverTecla("Ctrl+Alt+a").commands).toEqual([]);
    expect(resolverTecla("Alt+Tab").modifiers).toBe(1);
  });

  it("recusa o que não é tecla conhecida (e não confunde com propriedades de objeto)", () => {
    for (const nome of ["Foo", "constructor", "toString", "Hyper+a", "", "Ctrl+"]) {
      expect(() => resolverTecla(nome), nome).toThrow(ErroDoNavegadorDoAgente);
    }
    expect(() => resolverTecla(undefined)).toThrow(/Informe o nome da tecla/);
  });
});

describe("validarComando", () => {
  it("copia só os campos conhecidos", () => {
    expect(validarComando({ tipo: "abrir", url: "https://exemplo.com", sobra: 1 })).toEqual({ tipo: "abrir", url: "https://exemplo.com/" });
    expect(validarComando({ tipo: "ler_pagina", x: 1 })).toEqual({ tipo: "ler_pagina" });
    expect(validarComando({ tipo: "clicar", ref: 2 })).toEqual({ tipo: "clicar", ref: 2 });
    expect(validarComando({ tipo: "clicar", texto: "Entrar" })).toEqual({ tipo: "clicar", texto: "Entrar" });
    expect(validarComando({ tipo: "digitar", texto: "oi" })).toEqual({ tipo: "digitar", texto: "oi", enviar: false });
    expect(validarComando({ tipo: "digitar", texto: "oi", ref: 3, enviar: true })).toEqual({
      tipo: "digitar",
      texto: "oi",
      enviar: true,
      ref: 3,
    });
    expect(validarComando({ tipo: "tecla", nome: "Enter" })).toEqual({ tipo: "tecla", nome: "Enter" });
    expect(validarComando({ tipo: "rolar", direcao: "baixo" })).toEqual({ tipo: "rolar", direcao: "baixo", quantidade: 1 });
    expect(validarComando({ tipo: "esperar", ms: 100 })).toEqual({ tipo: "esperar", ms: 100 });
    expect(validarComando({ tipo: "esperar", texto: "ok" })).toEqual({ tipo: "esperar", texto: "ok" });
    expect(validarComando({ tipo: "voltar" })).toEqual({ tipo: "voltar" });
  });

  it("recusa endereço que não é http/https com o motivo 'recusado'", () => {
    for (const url of ["file:///etc/passwd", "javascript:alert(1)", "data:text/html,x", "chrome://settings", "devtools://x"]) {
      expect(() => validarComando({ tipo: "abrir", url }), url).toThrowError(expect.objectContaining({ motivo: "recusado" }));
    }
  });

  it.each([
    [null],
    ["abrir"],
    [{}],
    [{ tipo: "formatar" }],
    [{ tipo: "clicar" }],
    [{ tipo: "clicar", ref: 1, texto: "x" }],
    [{ tipo: "clicar", ref: 0 }],
    [{ tipo: "digitar", texto: 5 }],
    [{ tipo: "digitar", texto: "x", ref: 1.5 }],
    [{ tipo: "tecla", nome: "Nada" }],
    [{ tipo: "rolar", direcao: "diagonal" }],
    [{ tipo: "rolar", direcao: "baixo", quantidade: 21 }],
    [{ tipo: "esperar" }],
    [{ tipo: "esperar", ms: 30_001 }],
    [{ tipo: "esperar", ms: 5, texto: "x" }],
  ])("recusa o comando inválido %j", (bruto) => {
    expect(() => validarComando(bruto)).toThrowError(expect.objectContaining({ motivo: expect.stringMatching(/comando_invalido|recusado/) }));
  });
});

describe("descreverComando", () => {
  it("descreve cada comando sem revelar o texto digitado", () => {
    expect(descreverComando({ tipo: "abrir", url: "https://exemplo.com/segredo?token=1" })).toBe("Abrindo https://exemplo.com");
    expect(descreverComando({ tipo: "ler_pagina" })).toBe("Lendo a página");
    expect(descreverComando({ tipo: "clicar", ref: 3 })).toBe("Clicando no elemento 3");
    expect(descreverComando({ tipo: "clicar", texto: "Entrar" })).toBe('Clicando em "Entrar"');
    expect(descreverComando({ tipo: "digitar", texto: "minha-senha", enviar: false })).toBe("Digitando");
    expect(descreverComando({ tipo: "tecla", nome: "Enter" })).toBe("Apertando Enter");
    expect(descreverComando({ tipo: "rolar", direcao: "baixo", quantidade: 1 })).toBe("Rolando para baixo");
    expect(descreverComando({ tipo: "capturar_tela" })).toBe("Capturando a tela");
    expect(descreverComando({ tipo: "esperar", ms: 5 })).toBe("Esperando");
  });
});

describe("expressaoDaPagina", () => {
  it("monta uma expressão JavaScript válida que chama o método com os argumentos em JSON", () => {
    const expressao = expressaoDaPagina("ler", { limiteDeTexto: 20_000, limiteDeElementos: 250 });

    expect(expressao).toContain('.ler({"limiteDeTexto":20000,"limiteDeElementos":250})');
    expect(expressao).toContain("globalThis.__orquestradorDoAgente ??=");
    // Só confere que a biblioteca inteira compila (ela roda dentro da página, não aqui).
    expect(() => new Function(`return ${expressao}`)).not.toThrow();
    expect(() => new Function(`return ${expressaoDaPagina("escolherOpcao", 3, 'a"b')}`)).not.toThrow();
  });

  it("escapa os argumentos: o texto do agente nunca vira código", () => {
    const expressao = expressaoDaPagina("contemTexto", '");alert(1);("');

    expect(expressao).toContain('.contemTexto("\\");alert(1);(\\"")');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Serviço, com o Electron trocado por falsos.
// ──────────────────────────────────────────────────────────────────────────

const TEMPOS = {
  carregamentoMs: 40,
  domQuietoMs: 1,
  domTetoMs: 5,
  inicioDeNavegacaoMs: 1,
  capturaMs: 30,
  textoMs: 40,
  sondagemMs: 5,
  rolagemMs: 1,
};

function metodoDaPagina(expressao) {
  const achado = /\}\)\(\)\)\.(\w+)\(([\s\S]*)\)$/.exec(String(expressao));
  return achado ? { metodo: achado[1], argumentos: JSON.parse(`[${achado[2]}]`) } : null;
}

function montar({ bloqueada = false, tempos = {} } = {}) {
  const estado = { bloqueada, janelaVisivel: true };
  const ouvintesDaJanela = {};
  const ouvintesDoConteudoDaJanela = {};
  const janelaWc = {
    isDestroyed: () => false,
    getZoomFactor: () => 1,
    send: vi.fn(),
    on: (nome, fn) => {
      ouvintesDoConteudoDaJanela[nome] = fn;
    },
    mainFrame: { quadro: "principal" },
  };
  const janela = {
    isDestroyed: () => false,
    isVisible: () => estado.janelaVisivel,
    isMinimized: () => false,
    getContentSize: () => [1440, 900],
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    webContents: janelaWc,
    on: (nome, fn) => {
      ouvintesDaJanela[nome] = fn;
    },
  };

  /** O que a página devolve a cada método da biblioteca; o teste troca à vontade. */
  const pagina = {
    respostas: {
      ler: { texto: "Olá", textoTruncado: false, elementos: [{ ref: 1, tipo: "link", nome: "Entrar" }], elementosOmitidos: 0 },
      localizar: { ok: true, x: 120, y: 80, descricao: 'botão "Enviar"', aviso: "", lista: false },
      escolherOpcao: { ok: true, escolhida: "Azul" },
      selecionarConteudo: true,
      focoAtual: "campo",
      estavel: true,
      contemTexto: true,
      posicaoDaRolagem: { x: 0, y: 0, maxX: 0, maxY: 3000 },
    },
    avaliacoes: [],
    devicePixelRatio: 1,
  };

  const views = [];
  class WebContentsViewFalsa {
    constructor(opcoes) {
      this.opcoes = opcoes;
      this.bounds = null;
      this.visivel = null;
      this.ouvintes = {};
      this.destruida = false;
      const historico = { entradas: ["https://exemplo.com/"], ativo: 0 };
      this.historico = historico;
      const dbg = new EventEmitter();
      this.debuggerFalso = dbg;
      this.anexado = false;
      this.comandosCdp = [];
      dbg.attach = vi.fn(() => {
        this.anexado = true;
      });
      dbg.detach = vi.fn(() => {
        this.anexado = false;
      });
      dbg.isAttached = () => this.anexado;
      dbg.sendCommand = vi.fn(async (metodo, parametros) => {
        this.comandosCdp.push({ metodo, parametros });
        switch (metodo) {
          case "Page.getFrameTree":
            return { frameTree: { frame: { id: "F1" } } };
          case "Page.createIsolatedWorld":
            return { executionContextId: 7 };
          case "Page.getLayoutMetrics":
            return { cssVisualViewport: { pageX: 0, pageY: 0, clientWidth: 1280, clientHeight: 800 } };
          case "Page.captureScreenshot":
            return this.respostaDaCaptura ? this.respostaDaCaptura() : { data: "QUJD" };
          case "Runtime.evaluate": {
            const expressao = parametros.expression;
            pagina.avaliacoes.push(expressao);
            if (expressao === "devicePixelRatio") return { result: { value: pagina.devicePixelRatio } };
            const chamada = metodoDaPagina(expressao);
            const resposta = chamada ? pagina.respostas[chamada.metodo] : undefined;
            if (typeof resposta === "function") return { result: { value: resposta(...chamada.argumentos) } };
            return { result: { value: resposta } };
          }
          default:
            return {};
        }
      });
      this.webContents = {
        navigationHistory: {
          canGoBack: () => historico.ativo > 0,
          canGoForward: () => historico.ativo < historico.entradas.length - 1,
          goBack: vi.fn(() => {
            historico.ativo -= 1;
          }),
          goForward: vi.fn(() => {
            historico.ativo += 1;
          }),
        },
        debugger: dbg,
        isDestroyed: () => this.destruida,
        setUserAgent: vi.fn(),
        setWindowOpenHandler: vi.fn((fn) => {
          this.abrirJanela = fn;
        }),
        on: (nome, fn) => {
          (this.ouvintes[nome] ??= []).push(fn);
        },
        removeListener: (nome, fn) => {
          this.ouvintes[nome] = (this.ouvintes[nome] ?? []).filter((outro) => outro !== fn);
        },
        emitir: (nome, ...argumentos) => {
          for (const fn of [...(this.ouvintes[nome] ?? [])]) fn(...argumentos);
        },
        loadURL: vi.fn(async (url) => {
          historico.entradas.splice(historico.ativo + 1);
          historico.entradas.push(url);
          historico.ativo += 1;
        }),
        reload: vi.fn(),
        stop: vi.fn(),
        close: vi.fn(() => {
          this.destruida = true;
        }),
        focus: vi.fn(),
        setZoomFactor: vi.fn((fator) => {
          this.zoom = fator;
        }),
        getZoomFactor: () => this.zoom ?? 1,
        getURL: () => historico.entradas[historico.ativo] ?? "",
        getTitle: () => "Exemplo",
        isLoading: () => false,
      };
      views.push(this);
    }
    setBounds(b) {
      this.bounds = b;
    }
    setBorderRadius(raio) {
      this.raio = raio;
    }
    setVisible(v) {
      this.visivel = v;
    }
  }

  const sessoes = new Map();
  const session = {
    fromPartition: vi.fn((particao) => {
      if (!sessoes.has(particao)) {
        const ouvintes = {};
        sessoes.set(particao, {
          particao,
          getUserAgent: () => "Mozilla/5.0 Chrome/130 Electron/33.4.11 Safari/537.36",
          setUserAgent: vi.fn(),
          setPermissionRequestHandler: vi.fn(),
          setPermissionCheckHandler: vi.fn(),
          setDevicePermissionHandler: vi.fn(),
          clearStorageData: vi.fn(async () => undefined),
          clearCache: vi.fn(async () => undefined),
          clearAuthCache: vi.fn(async () => undefined),
          on: vi.fn((nome, fn) => {
            ouvintes[nome] = fn;
          }),
          ouvintes,
        });
      }
      return sessoes.get(particao);
    }),
  };

  const registrar = vi.fn();
  const navegador = criarNavegadorDoAgente({
    WebContentsView: WebContentsViewFalsa,
    session,
    janelaPrincipal: () => janela,
    eDaJanelaPrincipal: (evento) => evento.sender === janelaWc && evento.senderFrame === janelaWc.mainFrame,
    bloqueada: () => estado.bloqueada,
    nomeDoApp: "orquestrador-agentes-app",
    registrar,
    tempos: { ...TEMPOS, ...tempos },
  });
  const principal = { sender: janelaWc, senderFrame: janelaWc.mainFrame };
  const intruso = { sender: { outra: true }, senderFrame: null };
  const retangulo = { x: 100, y: 100, largura: 600, altura: 400, zoom: 1 };
  const executar = (comando, orquestradorId = "orq-1", sinal = undefined) => navegador.executarComando({ orquestradorId, comando, sinal });
  const enviadoAATela = (canal) => janelaWc.send.mock.calls.filter(([nome]) => nome === canal).map(([, dados]) => dados);
  return {
    navegador,
    janela,
    janelaWc,
    views,
    sessoes,
    session,
    pagina,
    registrar,
    principal,
    intruso,
    retangulo,
    estado,
    executar,
    enviadoAATela,
    ouvintesDaJanela,
    ouvintesDoConteudoDaJanela,
  };
}

const eventosDoCdp = (view, metodo) => view.comandosCdp.filter((comando) => comando.metodo === metodo).map((comando) => comando.parametros);

/**
 * A vista escondida não pode cobrir nenhum pixel da tela do app: fica nos limites ocultos (1280x800), com só
 * 1 DIP dentro da área da janela (o Chromium só a mantém viva se algo dela estiver dentro) e o canto cortado
 * pelo raio, que apaga esse pixel. Inteira fora, ele a esconde de vez (0x0, sem pintar, captura trava).
 */
function esperarEscondida(vista, [largura, altura] = [1440, 900]) {
  expect(vista.bounds).toEqual(LIMITES_OCULTOS);
  expect(vista.bounds.width).toBe(1280);
  expect(vista.bounds.height).toBe(800);
  const dentroX = Math.min(vista.bounds.x + vista.bounds.width, largura) - Math.max(vista.bounds.x, 0);
  const dentroY = Math.min(vista.bounds.y + vista.bounds.height, altura) - Math.max(vista.bounds.y, 0);
  expect([dentroX, dentroY]).toEqual([1, 1]);
  // O canto de 1 DIP some se o raio passa de ~3,4 DIP.
  expect(vista.raio).toBe(RAIO_OCULTO);
  expect(RAIO_OCULTO).toBeGreaterThanOrEqual(4);
  expect(vista.visivel).toBe(true);
}
describe("criarNavegadorDoAgente: a vista de cada Orquestrador", () => {
  it("só cria a vista no primeiro comando, com as preferências seguras e a sessão persist:navegador-<id>", async () => {
    const { navegador, executar, views, session, sessoes } = montar();
    expect(navegador.total()).toBe(0);

    await executar({ tipo: "abrir", url: "https://exemplo.com" });

    expect(navegador.total()).toBe(1);
    expect(session.fromPartition).toHaveBeenCalledWith("persist:navegador-orq-1");
    const [vista] = views;
    expect(vista.opcoes.webPreferences).toMatchObject({
      session: sessoes.get("persist:navegador-orq-1"),
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      backgroundThrottling: false,
    });
    expect(vista.opcoes.webPreferences.preload).toBeUndefined();
  });

  it("usa uma sessão por Orquestrador, separada da Prévia e da tela", async () => {
    const { executar, views, sessoes } = montar();

    await executar({ tipo: "voltar" }, "orq-1").catch(() => undefined);
    await executar({ tipo: "voltar" }, "orq-2").catch(() => undefined);

    expect([...sessoes.keys()].sort()).toEqual(["persist:navegador-orq-1", "persist:navegador-orq-2"]);
    expect(views[0].opcoes.webPreferences.session).not.toBe(views[1].opcoes.webPreferences.session);
  });

  it("reaproveita a vista e só avisa a tela do primeiro uso ('ativado') uma vez", async () => {
    const { navegador, executar, enviadoAATela } = montar();

    await executar({ tipo: "abrir", url: "https://exemplo.com" });
    await executar({ tipo: "ler_pagina" });
    await executar({ tipo: "abrir", url: "https://outro.com" }, "orq-2");

    expect(navegador.total()).toBe(2);
    expect(enviadoAATela("navegador-do-agente:ativado")).toEqual([{ orquestradorId: "orq-1" }, { orquestradorId: "orq-2" }]);
  });

  it("fica anexada fora da área da janela (sem cobrir a tela), 'visível' para o Chromium e em 1280x800, para pintar com o nó fechado", async () => {
    const { executar, views, janela } = montar();

    await executar({ tipo: "abrir", url: "https://exemplo.com" });

    const [vista] = views;
    expect(janela.contentView.addChildView).toHaveBeenCalledWith(vista, 0);
    esperarEscondida(vista);
    expect(vista.webContents.setZoomFactor).toHaveBeenLastCalledWith(1);
    // Nunca fica desanexada: o `removeChildView` vem sempre seguido, na hora, do `addChildView(vista, 0)`
    // (a vista solta da janela trava a captura e a pintura).
    const { addChildView, removeChildView } = janela.contentView;
    expect(Math.max(...addChildView.mock.invocationCallOrder)).toBeGreaterThan(Math.max(...removeChildView.mock.invocationCallOrder));
  });

  it("recusa mais vistas que o limite", async () => {
    const { executar } = montar();
    for (let i = 0; i < LIMITE_DE_VISTAS; i += 1) await executar({ tipo: "voltar" }, `orq-${i}`).catch(() => undefined);

    await expect(executar({ tipo: "voltar" }, "orq-extra")).rejects.toThrow(/demais/);
  });

  it("sem a janela principal, responde 'indisponivel'", async () => {
    const { navegador, janela } = montar();
    janela.isDestroyed = () => true;

    await expect(navegador.executarComando({ orquestradorId: "orq-1", comando: { tipo: "voltar" } })).rejects.toMatchObject({
      motivo: "indisponivel",
    });
  });

  it("valida o id e o comando antes de criar a vista", async () => {
    const { navegador, executar } = montar();

    await expect(executar({ tipo: "abrir", url: "file:///etc/passwd" })).rejects.toMatchObject({ motivo: "recusado" });
    await expect(executar({ tipo: "formatar" })).rejects.toMatchObject({ motivo: "comando_invalido" });
    await expect(executar({ tipo: "voltar" }, "id inválido!")).rejects.toMatchObject({ motivo: "comando_invalido" });
    expect(navegador.total()).toBe(0);
  });
});

describe("criarNavegadorDoAgente: proteções da sessão e da vista", () => {
  it("nega todas as permissões do site (câmera, microfone, localização, notificações...)", async () => {
    const { executar, sessoes } = montar();
    await executar({ tipo: "voltar" }).catch(() => undefined);
    const sessao = sessoes.get("persist:navegador-orq-1");

    const retorno = vi.fn();
    sessao.setPermissionRequestHandler.mock.calls[0][0]({}, "media", retorno);
    expect(retorno).toHaveBeenCalledWith(false);
    for (const permissao of ["media", "geolocation", "notifications", "clipboard-read", "clipboard-sanitized-write", "midi"]) {
      const resposta = vi.fn();
      sessao.setPermissionRequestHandler.mock.calls[0][0]({}, permissao, resposta);
      expect(resposta, permissao).toHaveBeenCalledWith(false);
      expect(sessao.setPermissionCheckHandler.mock.calls[0][0]({}, permissao), permissao).toBe(false);
    }
    expect(sessao.setDevicePermissionHandler.mock.calls[0][0]()).toBe(false);
  });

  it("limpa o 'Electron/x' e o nome do app do user agent", async () => {
    const { executar, sessoes } = montar();
    await executar({ tipo: "voltar" }).catch(() => undefined);

    expect(sessoes.get("persist:navegador-orq-1").setUserAgent).toHaveBeenCalledWith(
      "Mozilla/5.0 Chrome/130 Safari/537.36",
    );
  });

  it("bloqueia downloads e avisa o agente no resultado do próximo comando", async () => {
    const { executar, sessoes, views, registrar } = montar();
    await executar({ tipo: "voltar" }).catch(() => undefined);
    const evento = { preventDefault: vi.fn() };

    sessoes.get("persist:navegador-orq-1").ouvintes["will-download"](evento, {}, views[0].webContents);

    expect(evento.preventDefault).toHaveBeenCalled();
    expect(registrar).toHaveBeenCalledWith(expect.stringContaining("Download bloqueado"));
    const resultado = await executar({ tipo: "recarregar" });
    expect(resultado.mensagem).toContain("Download bloqueado");
    // O aviso vale uma vez só.
    expect((await executar({ tipo: "recarregar" })).mensagem).not.toContain("Download bloqueado");
  });

  it("pop-ups e target=_blank abrem na mesma vista; o que não é http/https é negado", async () => {
    const { executar, views, registrar } = montar();
    await executar({ tipo: "abrir", url: "https://exemplo.com" });
    const [vista] = views;

    expect(vista.abrirJanela({ url: "https://exemplo.com/popup" })).toEqual({ action: "deny" });
    expect(vista.webContents.loadURL).toHaveBeenLastCalledWith("https://exemplo.com/popup");

    vista.webContents.loadURL.mockClear();
    expect(vista.abrirJanela({ url: "javascript:alert(1)" })).toEqual({ action: "deny" });
    expect(vista.abrirJanela({ url: "file:///etc/passwd" })).toEqual({ action: "deny" });
    expect(vista.webContents.loadURL).not.toHaveBeenCalled();
    expect(registrar).toHaveBeenCalledWith(expect.stringContaining("Pop-up bloqueado"));
  });

  it("barra a navegação principal para file:, chrome:, devtools:, javascript: e data:, e deixa http/https", async () => {
    const { executar, views } = montar();
    await executar({ tipo: "voltar" }).catch(() => undefined);
    const [vista] = views;

    for (const evento of ["will-frame-navigate", "will-redirect"]) {
      for (const url of ["file:///etc/passwd", "chrome://settings", "devtools://x", "javascript:alert(1)", "data:text/html,x"]) {
        const detalhes = { url, isMainFrame: true, preventDefault: vi.fn() };
        vista.webContents.emitir(evento, detalhes);
        expect(detalhes.preventDefault, `${evento} ${url}`).toHaveBeenCalled();
      }
      const bom = { url: "https://exemplo.com/x", isMainFrame: true, preventDefault: vi.fn() };
      vista.webContents.emitir(evento, bom);
      expect(bom.preventDefault).not.toHaveBeenCalled();
      const quadroInterno = { url: "about:blank", isMainFrame: false, preventDefault: vi.fn() };
      vista.webContents.emitir(evento, quadroInterno);
      expect(quadroInterno.preventDefault).not.toHaveBeenCalled();
    }
  });

  it("o log só leva a origem das páginas, nunca o caminho nem o que foi digitado", async () => {
    const { executar, registrar, views } = montar();
    await executar({ tipo: "abrir", url: "https://exemplo.com/reset?token=segredo" });
    await executar({ tipo: "digitar", texto: "minha-senha-secreta", enviar: false });
    const detalhes = { url: "file:///C:/Users/pedro/segredo.txt", isMainFrame: true, preventDefault: vi.fn() };
    views[0].webContents.emitir("will-frame-navigate", detalhes);

    const log = registrar.mock.calls.map(([texto]) => texto).join("\n");
    expect(log).not.toContain("segredo");
    expect(log).not.toContain("token=");
    expect(log).not.toContain("minha-senha");
    expect(log).not.toContain("pedro");
  });

  it("aceita o diálogo alert e recusa confirm/prompt, e avisa o agente", async () => {
    const { executar, views } = montar();
    await executar({ tipo: "ler_pagina" });
    const [vista] = views;
    const dbg = vista.debuggerFalso;

    dbg.emit("message", {}, "Page.javascriptDialogOpening", { type: "alert", message: "Oi" });
    dbg.emit("message", {}, "Page.javascriptDialogOpening", { type: "confirm", message: "Certeza?" });
    dbg.emit("message", {}, "Page.loadEventFired", {});

    const respostas = eventosDoCdp(vista, "Page.handleJavaScriptDialog");
    expect(respostas).toEqual([{ accept: true }, { accept: false }]);
    const resultado = await executar({ tipo: "recarregar" });
    expect(resultado.mensagem).toContain("(alert) e ele foi aceito: Oi");
    expect(resultado.mensagem).toContain("(confirm) e ele foi recusado: Certeza?");
  });

  it("o processo da página que cai fecha a vista; o próximo comando cria outra e avisa a tela de novo", async () => {
    const { navegador, executar, views, enviadoAATela } = montar();
    await executar({ tipo: "voltar" }).catch(() => undefined);

    views[0].webContents.emitir("render-process-gone");
    expect(navegador.total()).toBe(0);

    await executar({ tipo: "voltar" }).catch(() => undefined);
    expect(views).toHaveLength(2);
    expect(enviadoAATela("navegador-do-agente:ativado")).toHaveLength(2);
  });
});

describe("criarNavegadorDoAgente: comandos", () => {
  it("abrir: carrega a URL e devolve url, título e mensagem", async () => {
    const { executar, views } = montar();

    const resultado = await executar({ tipo: "abrir", url: "exemplo.com" }).catch((erro) => erro);
    // `exemplo.com` sem esquema é recusado aqui (o domínio TypeScript é quem completa com https).
    expect(resultado).toMatchObject({ motivo: "recusado" });

    const ok = await executar({ tipo: "abrir", url: "https://exemplo.com/pagina" });
    expect(views[0].webContents.loadURL).toHaveBeenCalledWith("https://exemplo.com/pagina");
    expect(ok).toEqual({ url: "https://exemplo.com/pagina", titulo: "Exemplo", mensagem: "Página aberta." });
  });

  it("abrir: falha de rede vira erro 'falhou' com o código, mas ERR_ABORTED (-3) não é falha", async () => {
    const { executar, views } = montar();
    await executar({ tipo: "voltar" }).catch(() => undefined);
    const { webContents } = views[0];

    webContents.loadURL.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "ERR_NAME_NOT_RESOLVED", errno: -105 }));
    await expect(executar({ tipo: "abrir", url: "https://nao-existe.invalid/x?token=1" })).rejects.toMatchObject({
      motivo: "falhou",
      message: "Não consegui abrir https://nao-existe.invalid: ERR_NAME_NOT_RESOLVED.",
    });

    webContents.loadURL.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "ERR_ABORTED", errno: -3 }));
    await expect(executar({ tipo: "abrir", url: "https://exemplo.com/" })).resolves.toMatchObject({ mensagem: "Página aberta." });
  });

  it("abrir: página que não termina de carregar é interrompida e o agente é avisado", async () => {
    const { executar, views } = montar();
    await executar({ tipo: "voltar" }).catch(() => undefined);
    views[0].webContents.loadURL.mockImplementationOnce(() => new Promise(() => undefined));

    const resultado = await executar({ tipo: "abrir", url: "https://lento.com/" });

    expect(views[0].webContents.stop).toHaveBeenCalled();
    expect(resultado.mensagem).toBe("A página ainda estava carregando; usei o que já apareceu.");
  });

  it("ler_pagina: devolve a leitura da página, avaliada no mundo isolado, com os limites de texto e de elementos", async () => {
    const { executar, views, pagina } = montar();

    const resultado = await executar({ tipo: "ler_pagina" });

    expect(resultado.pagina).toEqual(pagina.respostas.ler);
    expect(resultado.mensagem).toBe("Li a página: 1 elementos interativos.");
    const [vista] = views;
    expect(eventosDoCdp(vista, "Page.createIsolatedWorld")).toEqual([{ frameId: "F1", worldName: "orquestrador-do-agente" }]);
    const avaliacao = eventosDoCdp(vista, "Runtime.evaluate").find((parametros) => metodoDaPagina(parametros.expression)?.metodo === "ler");
    expect(avaliacao).toMatchObject({ contextId: 7, returnByValue: true, awaitPromise: true });
    expect(metodoDaPagina(avaliacao.expression).argumentos).toEqual([{ limiteDeTexto: 20_000, limiteDeElementos: 250 }]);
  });

  it("ler_pagina: erro dentro da página vira 'falhou' sem despejar o objeto do Chrome", async () => {
    const { executar, views } = montar();
    await executar({ tipo: "voltar" }).catch(() => undefined);
    const original = views[0].debuggerFalso.sendCommand.getMockImplementation();
    views[0].debuggerFalso.sendCommand.mockImplementation(async (metodo, parametros) =>
      metodo === "Runtime.evaluate" ? { exceptionDetails: { text: "Uncaught", exception: { description: "TypeError: x" } } } : original(metodo, parametros),
    );

    await expect(executar({ tipo: "ler_pagina" })).rejects.toMatchObject({ motivo: "falhou", message: expect.stringContaining("TypeError: x") });
  });

  it("clicar: localiza o elemento e manda mouseMoved, mousePressed e mouseReleased no ponto", async () => {
    const { executar, views, pagina } = montar();
    pagina.respostas.localizar = { ok: true, x: 120, y: 80, descricao: 'botão "Enviar"', aviso: "" };

    const resultado = await executar({ tipo: "clicar", ref: 5 });

    const eventos = eventosDoCdp(views[0], "Input.dispatchMouseEvent");
    expect(eventos.map((e) => e.type)).toEqual(["mouseMoved", "mousePressed", "mouseReleased"]);
    for (const e of eventos) expect(e).toMatchObject({ x: 120, y: 80 });
    expect(eventos[1]).toMatchObject({ button: "left", clickCount: 1 });
    expect(resultado.mensagem).toBe('Cliquei em botão "Enviar".');
    const localizar = views[0].comandosCdp
      .filter((c) => c.metodo === "Runtime.evaluate")
      .map((c) => metodoDaPagina(c.parametros.expression))
      .find((chamada) => chamada?.metodo === "localizar");
    expect(localizar.argumentos).toEqual([{ ref: 5 }]);
  });

  it("clicar por texto e com aviso de elemento coberto", async () => {
    const { executar, views, pagina } = montar();
    pagina.respostas.localizar = { ok: true, x: 1, y: 2, descricao: 'link "Entrar"', aviso: "Havia 2 elementos com esse texto; usei o primeiro." };

    const resultado = await executar({ tipo: "clicar", texto: "Entrar" });

    expect(resultado.mensagem).toBe('Cliquei em link "Entrar". Havia 2 elementos com esse texto; usei o primeiro.');
    const localizar = views[0].comandosCdp
      .filter((c) => c.metodo === "Runtime.evaluate")
      .map((c) => metodoDaPagina(c.parametros.expression))
      .find((chamada) => chamada?.metodo === "localizar");
    expect(localizar.argumentos).toEqual([{ texto: "Entrar" }]);
  });

  it("clicar: elemento que não existe mais, ou lista (select), voltam como erro e não clicam", async () => {
    const { executar, views, pagina } = montar();
    pagina.respostas.localizar = { ok: false, erro: "O elemento [9] não existe mais. Chame navegador_ler_pagina de novo." };
    await expect(executar({ tipo: "clicar", ref: 9 })).rejects.toMatchObject({ motivo: "falhou", message: expect.stringContaining("não existe mais") });

    pagina.respostas.localizar = { ok: true, x: 1, y: 1, descricao: 'lista "Cor"', lista: true };
    await expect(executar({ tipo: "clicar", ref: 2 })).rejects.toMatchObject({ message: expect.stringContaining("navegador_digitar") });
    expect(eventosDoCdp(views[0], "Input.dispatchMouseEvent")).toHaveLength(0);
  });

  it("digitar com ref: clica no campo, seleciona o conteúdo e insere o texto", async () => {
    const { executar, views } = montar();

    const resultado = await executar({ tipo: "digitar", ref: 7, texto: "Maria" });

    const ordem = views[0].comandosCdp.map((c) => c.metodo).filter((m) => m.startsWith("Input."));
    expect(ordem).toEqual(["Input.dispatchMouseEvent", "Input.dispatchMouseEvent", "Input.dispatchMouseEvent", "Input.insertText"]);
    expect(eventosDoCdp(views[0], "Input.insertText")).toEqual([{ text: "Maria" }]);
    expect(resultado.mensagem).toBe('Digitei 5 caracteres em botão "Enviar".');
    expect(resultado.mensagem).not.toContain("Maria");
  });

  it("digitar com enviar: aperta Enter depois do texto", async () => {
    const { executar, views } = montar();

    const resultado = await executar({ tipo: "digitar", ref: 7, texto: "x", enviar: true });

    const teclas = eventosDoCdp(views[0], "Input.dispatchKeyEvent");
    expect(teclas.map((t) => t.type)).toEqual(["keyDown", "keyUp"]);
    expect(teclas[0]).toMatchObject({ key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
    expect(resultado.mensagem).toContain("e enviei (Enter)");
  });

  it("digitar sem ref escreve onde está o foco e avisa se nada estava em foco", async () => {
    const { executar, views, pagina } = montar();

    const comFoco = await executar({ tipo: "digitar", texto: "abc" });
    expect(eventosDoCdp(views[0], "Input.dispatchMouseEvent")).toHaveLength(0);
    expect(comFoco.mensagem).toBe("Digitei 3 caracteres no campo em foco.");

    pagina.respostas.focoAtual = "";
    const semFoco = await executar({ tipo: "digitar", texto: "abc" });
    expect(semFoco.mensagem).toContain("Nenhum campo estava em foco");
  });

  it("digitar em uma lista (select) escolhe a opção em vez de digitar", async () => {
    const { executar, views, pagina } = montar();
    pagina.respostas.localizar = { ok: true, x: 1, y: 1, descricao: 'lista "Cor"', lista: true };

    const resultado = await executar({ tipo: "digitar", ref: 9, texto: "azul" });

    expect(resultado.mensagem).toBe('Escolhi a opção "Azul" em lista "Cor".');
    expect(eventosDoCdp(views[0], "Input.insertText")).toHaveLength(0);

    pagina.respostas.escolherOpcao = { ok: false, erro: 'A lista não tem a opção "roxo".' };
    await expect(executar({ tipo: "digitar", ref: 9, texto: "roxo" })).rejects.toMatchObject({ message: 'A lista não tem a opção "roxo".' });
  });

  it("tecla: manda keyDown e keyUp, com o comando de edição dos atalhos", async () => {
    const { executar, views } = montar();

    const resultado = await executar({ tipo: "tecla", nome: "Ctrl+a" });

    const teclas = eventosDoCdp(views[0], "Input.dispatchKeyEvent");
    expect(teclas[0]).toMatchObject({ type: "rawKeyDown", key: "a", modifiers: 2, commands: ["selectAll"] });
    expect(teclas[0].text).toBeUndefined();
    expect(teclas[1]).toMatchObject({ type: "keyUp", key: "a", modifiers: 2 });
    expect(resultado.mensagem).toBe("Apertei Ctrl+a.");
  });

  it("rolar: roda do mouse no centro da página, com o delta em pixels da janela (multiplica pelo zoom)", async () => {
    const { executar, views, pagina } = montar();
    pagina.respostas.posicaoDaRolagem = vi.fn().mockReturnValueOnce({ x: 0, y: 0, maxX: 0, maxY: 3000 }).mockReturnValue({ x: 0, y: 680, maxX: 0, maxY: 3000 });

    const resultado = await executar({ tipo: "rolar", direcao: "baixo", quantidade: 1 });

    const rodas = eventosDoCdp(views[0], "Input.dispatchMouseEvent");
    expect(rodas).toEqual([{ type: "mouseWheel", x: 640, y: 400, deltaX: 0, deltaY: 0.85 * 800 }]);
    expect(resultado.mensagem).toBe("Rolei para baixo (posição vertical 680 de 3000 px).");

    views[0].webContents.setZoomFactor(0.5);
    pagina.respostas.posicaoDaRolagem = vi.fn().mockReturnValueOnce({ x: 0, y: 0, maxX: 2000, maxY: 0 }).mockReturnValue({ x: 100, y: 0, maxX: 2000, maxY: 0 });
    await executar({ tipo: "rolar", direcao: "esquerda", quantidade: 1 });
    const ultima = eventosDoCdp(views[0], "Input.dispatchMouseEvent").at(-1);
    expect(ultima).toMatchObject({ deltaY: 0, deltaX: -(0.85 * 1280 * 0.5) });
  });

  it("rolar: para quando chega ao limite da página e avisa", async () => {
    const { executar, views, pagina } = montar();
    pagina.respostas.posicaoDaRolagem = { x: 0, y: 3000, maxX: 0, maxY: 3000 };

    const resultado = await executar({ tipo: "rolar", direcao: "baixo", quantidade: 20 });

    // Sem mudar de posição na primeira volta, não insiste nas outras 19.
    expect(eventosDoCdp(views[0], "Input.dispatchMouseEvent").length).toBeLessThanOrEqual(2);
    expect(resultado.mensagem).toBe("A página já está no limite para baixo (posição vertical 3000 de 3000 px).");
  });

  it("capturar_tela: JPEG da área visível, limitada a 1280 px de largura, no layout da página", async () => {
    const { executar, views, pagina } = montar();
    pagina.devicePixelRatio = 1.5;
    views[0] ?? (await executar({ tipo: "voltar" }).catch(() => undefined));

    const resultado = await executar({ tipo: "capturar_tela" });

    expect(resultado.imagem).toEqual({ base64: "QUJD", tipoDeMidia: "image/jpeg" });
    const [captura] = eventosDoCdp(views[0], "Page.captureScreenshot");
    expect(captura).toMatchObject({ format: "jpeg", quality: 80 });
    // 1280 px CSS × 1.5 de densidade = 1920 px: reduz a 1280/1920 para a imagem sair com 1280 px.
    expect(captura.clip).toMatchObject({ x: 0, y: 0, width: 1280, height: 800 });
    expect(captura.clip.scale).toBeCloseTo(1280 / (1280 * 1.5), 5);
  });

  it("capturar_tela: página estreita não é ampliada (escala 1)", async () => {
    const { executar, views } = montar();
    await executar({ tipo: "voltar" }).catch(() => undefined);
    const original = views[0].debuggerFalso.sendCommand.getMockImplementation();
    views[0].debuggerFalso.sendCommand.mockImplementation(async (metodo, parametros) =>
      metodo === "Page.getLayoutMetrics"
        ? { cssVisualViewport: { pageX: 0, pageY: 250, clientWidth: 600, clientHeight: 400 } }
        : original(metodo, parametros),
    );

    await executar({ tipo: "capturar_tela" });

    const [captura] = eventosDoCdp(views[0], "Page.captureScreenshot");
    expect(captura.clip).toEqual({ x: 0, y: 250, width: 600, height: 400, scale: 1 });
  });

  it("capturar_tela: se o Chromium não entrega o quadro (janela nunca mostrada), responde tempo esgotado com a causa", async () => {
    const { executar, views } = montar();
    await executar({ tipo: "voltar" }).catch(() => undefined);
    views[0].respostaDaCaptura = () => new Promise(() => undefined);

    await expect(executar({ tipo: "capturar_tela" })).rejects.toMatchObject({
      motivo: "tempo_esgotado",
      message: expect.stringContaining("janela do aplicativo está oculta"),
    });
  });

  it("voltar e avançar usam o histórico e avisam quando não há para onde ir", async () => {
    const { executar, views } = montar();
    await executar({ tipo: "abrir", url: "https://exemplo.com/dois" });
    const { navigationHistory } = views[0].webContents;

    await expect(executar({ tipo: "voltar" })).resolves.toMatchObject({ mensagem: "Voltei uma página.", url: "https://exemplo.com/" });
    expect(navigationHistory.goBack).toHaveBeenCalledTimes(1);
    await expect(executar({ tipo: "voltar" })).rejects.toMatchObject({ message: "Não há página anterior no histórico." });

    await expect(executar({ tipo: "avancar" })).resolves.toMatchObject({ mensagem: "Avancei uma página." });
    await expect(executar({ tipo: "avancar" })).rejects.toMatchObject({ message: "Não há página seguinte no histórico." });
  });

  it("recarregar recarrega a vista", async () => {
    const { executar, views } = montar();

    await expect(executar({ tipo: "recarregar" })).resolves.toMatchObject({ mensagem: "Página recarregada." });

    expect(views[0].webContents.reload).toHaveBeenCalledTimes(1);
  });

  it("esperar: por tempo, e por texto (acha ou estoura o tempo)", async () => {
    const { executar, pagina } = montar();

    await expect(executar({ tipo: "esperar", ms: 5 })).resolves.toMatchObject({ mensagem: "Esperei 5 ms." });

    pagina.respostas.contemTexto = true;
    await expect(executar({ tipo: "esperar", texto: "Pronto" })).resolves.toMatchObject({
      mensagem: 'O texto "Pronto" apareceu na página.',
    });

    pagina.respostas.contemTexto = false;
    await expect(executar({ tipo: "esperar", texto: "Nunca" })).rejects.toMatchObject({
      motivo: "tempo_esgotado",
      message: expect.stringContaining('"Nunca" não apareceu'),
    });
  });

  it("espera o carregamento terminar depois de uma ação que navega", async () => {
    const { executar, views } = montar();
    await executar({ tipo: "voltar" }).catch(() => undefined);
    let carregando = true;
    views[0].webContents.isLoading = () => carregando;
    const execucao = executar({ tipo: "clicar", ref: 1 });
    await new Promise((resolver) => setTimeout(resolver, 15));

    let terminou = false;
    void execucao.then(() => {
      terminou = true;
    });
    await new Promise((resolver) => setTimeout(resolver, 5));
    expect(terminou).toBe(false);

    carregando = false;
    views[0].webContents.emitir("did-stop-loading");
    await expect(execucao).resolves.toMatchObject({ mensagem: expect.stringContaining("Cliquei") });
  });

  it("erro inesperado vira 'falhou' e vai ao log, sem a pilha", async () => {
    const { executar, views, registrar } = montar();
    await executar({ tipo: "voltar" }).catch(() => undefined);
    views[0].debuggerFalso.sendCommand.mockImplementation(async () => {
      throw new Error("Connection reset by peer");
    });

    await expect(executar({ tipo: "ler_pagina" })).rejects.toMatchObject({
      motivo: "falhou",
      message: "Falha no navegador: Connection reset by peer",
    });
    expect(registrar).toHaveBeenCalledWith(expect.stringContaining("Falha inesperada"));
  });

  it("re-liga o debugger se algo o soltou", async () => {
    const { executar, views } = montar();
    await executar({ tipo: "ler_pagina" });
    views[0].anexado = false;

    await executar({ tipo: "ler_pagina" });

    expect(views[0].debuggerFalso.attach).toHaveBeenCalledTimes(2);
    expect(views[0].debuggerFalso.attach).toHaveBeenCalledWith("1.3");
  });

  it("tenta de novo uma vez se a página trocou no meio da leitura", async () => {
    const { executar, views } = montar();
    await executar({ tipo: "voltar" }).catch(() => undefined);
    const original = views[0].debuggerFalso.sendCommand.getMockImplementation();
    let falhou = false;
    views[0].debuggerFalso.sendCommand.mockImplementation(async (metodo, parametros) => {
      if (metodo === "Runtime.evaluate" && !falhou) {
        falhou = true;
        throw new Error("Cannot find context with specified id");
      }
      return original(metodo, parametros);
    });

    await expect(executar({ tipo: "ler_pagina" })).resolves.toMatchObject({ pagina: expect.any(Object) });
  });
});

describe("criarNavegadorDoAgente: eventos para a tela", () => {
  it("manda o estado a cada mudança, com a última ação e se o agente está usando", async () => {
    const { executar, enviadoAATela } = montar();

    await executar({ tipo: "abrir", url: "https://exemplo.com/x" });

    const mudancas = enviadoAATela("navegador-do-agente:mudou");
    expect(mudancas[0]).toMatchObject({
      orquestradorId: "orq-1",
      emUsoPeloAgente: true,
      ultimaAcao: "Abrindo https://exemplo.com",
      pausado: false,
    });
    expect(mudancas.at(-1)).toEqual({
      orquestradorId: "orq-1",
      url: "https://exemplo.com/x",
      titulo: "Exemplo",
      carregando: false,
      ultimaAcao: "Página aberta.",
      emUsoPeloAgente: false,
      pausado: false,
      podeVoltar: true,
      podeAvancar: false,
    });
  });

  it("não repete o mesmo estado", async () => {
    const { executar, enviadoAATela, views } = montar();
    await executar({ tipo: "abrir", url: "https://exemplo.com/x" });
    const antes = enviadoAATela("navegador-do-agente:mudou").length;

    views[0].webContents.emitir("did-stop-loading");
    views[0].webContents.emitir("page-title-updated");

    expect(enviadoAATela("navegador-do-agente:mudou")).toHaveLength(antes);
  });

  it("falha deixa 'Falhou: ...' na última ação e solta o 'em uso'", async () => {
    const { executar, enviadoAATela } = montar();

    await executar({ tipo: "voltar" }).catch(() => undefined);

    expect(enviadoAATela("navegador-do-agente:mudou").at(-1)).toMatchObject({
      emUsoPeloAgente: false,
      ultimaAcao: "Falhou: Não há página anterior no histórico.",
    });
  });
});

describe("criarNavegadorDoAgente: pausar e assumir", () => {
  it("pausado, o comando é recusado com a mensagem do usuário; retomado, volta a funcionar", async () => {
    const { navegador, executar, principal, enviadoAATela } = montar();
    await executar({ tipo: "ler_pagina" });

    expect(await navegador.aoPausar(principal, { orquestradorId: "orq-1" })).toBe(true);
    await expect(executar({ tipo: "ler_pagina" })).rejects.toMatchObject({
      motivo: "pausado",
      message: "O usuário assumiu o navegador; tente depois.",
    });
    expect(MENSAGEM_PAUSADO).toBe("O usuário assumiu o navegador; tente depois.");
    expect(enviadoAATela("navegador-do-agente:mudou").at(-1)).toMatchObject({ pausado: true });
    // Só o Orquestrador pausado é recusado.
    await expect(executar({ tipo: "ler_pagina" }, "orq-2")).resolves.toBeDefined();

    expect(await navegador.aoRetomar(principal, { orquestradorId: "orq-1" })).toBe(true);
    await expect(executar({ tipo: "ler_pagina" })).resolves.toBeDefined();
    expect(enviadoAATela("navegador-do-agente:mudou").at(-1)).toMatchObject({ pausado: false });
  });

  it("pausar antes de qualquer comando já recusa o primeiro (e não cria a vista)", async () => {
    const { navegador, executar, principal } = montar();

    navegador.aoPausar(principal, { orquestradorId: "orq-1" });

    await expect(executar({ tipo: "voltar" })).rejects.toMatchObject({ motivo: "pausado" });
    expect(navegador.total()).toBe(0);
  });

  it("pausar cancela o comando em andamento com o erro 'pausado' e dá o foco à vista mostrada", async () => {
    const { navegador, executar, principal, retangulo, views } = montar();
    await executar({ tipo: "voltar" }).catch(() => undefined);
    navegador.aoMostrar(principal, { orquestradorId: "orq-1", retangulo });
    const execucao = executar({ tipo: "esperar", ms: 30_000 });
    await new Promise((resolver) => setTimeout(resolver, 5));

    navegador.aoPausar(principal, { orquestradorId: "orq-1" });

    await expect(execucao).rejects.toMatchObject({ motivo: "pausado" });
    expect(views[0].webContents.focus).toHaveBeenCalled();
  });

  it("o pedido do servidor que é abortado cancela o comando", async () => {
    const { executar } = montar();
    const abortador = new AbortController();
    const execucao = executar({ tipo: "esperar", ms: 30_000 }, "orq-1", abortador.signal);
    await new Promise((resolver) => setTimeout(resolver, 5));

    abortador.abort();

    await expect(execucao).rejects.toMatchObject({ motivo: "cancelado" });
  });

  it("um comando por vez em cada Orquestrador: o segundo espera o primeiro", async () => {
    const { executar } = montar();
    const ordem = [];
    const primeiro = executar({ tipo: "esperar", ms: 20 }).then(() => ordem.push("primeiro"));
    const segundo = executar({ tipo: "esperar", ms: 1 }).then(() => ordem.push("segundo"));

    await Promise.all([primeiro, segundo]);

    expect(ordem).toEqual(["primeiro", "segundo"]);
  });
});

describe("criarNavegadorDoAgente: IPC da tela", () => {
  it("só aceita do quadro principal da janela principal", async () => {
    const { navegador, intruso, retangulo } = montar();

    expect(() => navegador.aoMostrar(intruso, { orquestradorId: "orq-1", retangulo })).toThrow(/só na janela principal/);
    expect(() => navegador.aoOcultar(intruso, { orquestradorId: "orq-1" })).toThrow(/só na janela principal/);
    expect(() => navegador.aoPausar(intruso, { orquestradorId: "orq-1" })).toThrow(/só na janela principal/);
    expect(() => navegador.aoRetomar(intruso, { orquestradorId: "orq-1" })).toThrow(/só na janela principal/);
    expect(() => navegador.aoPedirEstados(intruso)).toThrow(/só na janela principal/);
    await expect(navegador.aoFechar(intruso, { orquestradorId: "orq-1" })).rejects.toThrow(/só na janela principal/);
    await expect(navegador.aoPedirFoto(intruso, { orquestradorId: "orq-1" })).rejects.toThrow(/só na janela principal/);
    // O envio de retângulo não responde: ignora em silêncio.
    expect(() => navegador.aoPosicionar(intruso, { orquestradorId: "orq-1", retangulo })).not.toThrow();
  });

  it("mostrar põe a vista sobre o nó (topo da tela), com os limites do retângulo e o zoom do canvas", async () => {
    const { navegador, executar, principal, views, janela } = montar();
    await executar({ tipo: "ler_pagina" });

    const ok = navegador.aoMostrar(principal, {
      orquestradorId: "orq-1",
      retangulo: { x: 100, y: 120, largura: 600, altura: 400, zoom: 0.5 },
    });

    expect(ok).toBe(true);
    const [vista] = views;
    expect(vista.bounds).toEqual({ x: 100, y: 120, width: 600, height: 400 });
    expect(vista.webContents.setZoomFactor).toHaveBeenLastCalledWith(0.5);
    expect(janela.contentView.addChildView).toHaveBeenLastCalledWith(vista);
    expect(vista.visivel).toBe(true);
    // Sem o raio do canto da vista escondida.
    expect(vista.raio).toBe(0);
  });

  it("posicionar acompanha o nó enquanto está mostrada, e é ignorado enquanto está oculta", async () => {
    const { navegador, executar, principal, views } = montar();
    await executar({ tipo: "ler_pagina" });
    const [vista] = views;

    navegador.aoPosicionar(principal, { orquestradorId: "orq-1", retangulo: { x: 5, y: 5, largura: 100, altura: 100, zoom: 1 } });
    esperarEscondida(vista);

    navegador.aoMostrar(principal, { orquestradorId: "orq-1", retangulo: { x: 10, y: 20, largura: 300, altura: 200, zoom: 1 } });
    navegador.aoPosicionar(principal, { orquestradorId: "orq-1", retangulo: { x: 40, y: 50, largura: 300, altura: 200, zoom: 1 } });
    expect(vista.bounds).toEqual({ x: 40, y: 50, width: 300, height: 200 });
    // Retângulo inválido não mexe em nada.
    navegador.aoPosicionar(principal, { orquestradorId: "orq-1", retangulo: { x: 1 } });
    expect(vista.bounds).toEqual({ x: 40, y: 50, width: 300, height: 200 });
  });

  it("ocultar devolve a vista para fora da área da janela, em 1280x800 e zoom 1, ainda visível para o Chromium", async () => {
    const { navegador, executar, principal, retangulo, views, janela } = montar();
    await executar({ tipo: "ler_pagina" });
    navegador.aoMostrar(principal, { orquestradorId: "orq-1", retangulo });
    const [vista] = views;
    expect(vista.bounds).not.toEqual(LIMITES_OCULTOS);

    expect(navegador.aoOcultar(principal, { orquestradorId: "orq-1" })).toBe(true);

    esperarEscondida(vista);
    expect(vista.webContents.setZoomFactor).toHaveBeenLastCalledWith(1);
    expect(janela.contentView.addChildView).toHaveBeenLastCalledWith(vista, 0);
    // O agente segue usando com o nó fechado.
    await expect(executar({ tipo: "capturar_tela" })).resolves.toMatchObject({ imagem: expect.any(Object) });
  });

  it("mostrar e ocultar de novo, várias vezes, sempre termina escondida fora da janela (e mostrada no retângulo)", async () => {
    const { navegador, executar, principal, retangulo, views } = montar();
    await executar({ tipo: "ler_pagina" });
    const [vista] = views;

    for (let i = 0; i < 3; i += 1) {
      navegador.aoMostrar(principal, { orquestradorId: "orq-1", retangulo });
      expect(vista.bounds).toEqual({ x: 100, y: 100, width: 600, height: 400 });
      expect(vista.raio).toBe(0);

      navegador.aoOcultar(principal, { orquestradorId: "orq-1" });
      esperarEscondida(vista);
    }
  });

  it("mostrar e ocultar de um Orquestrador sem navegador resolvem false", () => {
    const { navegador, principal, retangulo } = montar();

    expect(navegador.aoMostrar(principal, { orquestradorId: "orq-1", retangulo })).toBe(false);
    expect(navegador.aoOcultar(principal, { orquestradorId: "orq-1" })).toBe(false);
    expect(navegador.aoMostrar(principal, { orquestradorId: "orq-1", retangulo: { x: 1 } })).toBe(false);
  });

  it("modo invisível: não mostra, e a vista escondida segue fora da área da janela transparente (e volta ao sair do modo)", async () => {
    const { navegador, executar, principal, retangulo, views, estado, janela } = montar();
    await executar({ tipo: "ler_pagina" });
    navegador.aoMostrar(principal, { orquestradorId: "orq-1", retangulo });

    estado.bloqueada = true;
    navegador.reaplicarTodas();

    esperarEscondida(views[0]);
    expect(navegador.aoMostrar(principal, { orquestradorId: "orq-1", retangulo })).toBe(false);
    await expect(executar({ tipo: "capturar_tela" })).resolves.toBeDefined();

    estado.bloqueada = false;
    navegador.reaplicarTodas();
    esperarEscondida(views[0]);
    expect(janela.contentView.addChildView).toHaveBeenLastCalledWith(views[0], 0);
    expect(navegador.aoMostrar(principal, { orquestradorId: "orq-1", retangulo })).toBe(true);
    expect(views[0].bounds).toEqual({ x: 100, y: 100, width: 600, height: 400 });
  });

  it("estados devolve o estado de cada navegador aberto", async () => {
    const { navegador, executar, principal } = montar();
    await executar({ tipo: "abrir", url: "https://exemplo.com/x" }, "orq-1");
    await executar({ tipo: "abrir", url: "https://exemplo.com/y" }, "orq-2");

    const estados = navegador.aoPedirEstados(principal);

    expect(estados.map((e) => [e.orquestradorId, e.url])).toEqual([
      ["orq-1", "https://exemplo.com/x"],
      ["orq-2", "https://exemplo.com/y"],
    ]);
  });

  it("foto devolve um data URI JPEG da página, ou null sem navegador", async () => {
    const { navegador, executar, principal } = montar();
    await executar({ tipo: "ler_pagina" });

    expect(await navegador.aoPedirFoto(principal, { orquestradorId: "orq-1" })).toBe("data:image/jpeg;base64,QUJD");
    expect(await navegador.aoPedirFoto(principal, { orquestradorId: "outro" })).toBeNull();
  });

  describe("voltar, avançar e recarregar pelo usuário", () => {
    it("só aceita do quadro principal da janela principal", () => {
      const { navegador, intruso } = montar();

      expect(() => navegador.aoVoltar(intruso, { orquestradorId: "orq-1" })).toThrow(/só na janela principal/);
      expect(() => navegador.aoAvancar(intruso, { orquestradorId: "orq-1" })).toThrow(/só na janela principal/);
      expect(() => navegador.aoRecarregar(intruso, { orquestradorId: "orq-1" })).toThrow(/só na janela principal/);
    });

    it("voltar e avançar andam no histórico da página e avisam a tela; sem para onde ir, resolvem false", async () => {
      const { navegador, executar, principal, views, enviadoAATela } = montar();
      await executar({ tipo: "abrir", url: "https://exemplo.com/a" });
      await executar({ tipo: "abrir", url: "https://exemplo.com/b" });
      const { navigationHistory } = views[0].webContents;

      expect(navegador.aoAvancar(principal, { orquestradorId: "orq-1" })).toBe(false);
      expect(navigationHistory.goForward).not.toHaveBeenCalled();

      expect(navegador.aoVoltar(principal, { orquestradorId: "orq-1" })).toBe(true);
      expect(navigationHistory.goBack).toHaveBeenCalledTimes(1);
      expect(enviadoAATela("navegador-do-agente:mudou").at(-1)).toMatchObject({
        url: "https://exemplo.com/a",
        podeAvancar: true,
      });

      expect(navegador.aoAvancar(principal, { orquestradorId: "orq-1" })).toBe(true);
      expect(navigationHistory.goForward).toHaveBeenCalledTimes(1);

      // Gasta o histórico: no começo, voltar resolve false e não aciona nada.
      for (let tentativa = 0; tentativa < 5 && navigationHistory.canGoBack(); tentativa += 1) {
        navegador.aoVoltar(principal, { orquestradorId: "orq-1" });
      }
      const chamadas = navigationHistory.goBack.mock.calls.length;
      expect(navegador.aoVoltar(principal, { orquestradorId: "orq-1" })).toBe(false);
      expect(navigationHistory.goBack).toHaveBeenCalledTimes(chamadas);
    });

    it("recarregar recarrega a página do Orquestrador", async () => {
      const { navegador, executar, principal, views } = montar();
      await executar({ tipo: "abrir", url: "https://exemplo.com/a" });

      expect(navegador.aoRecarregar(principal, { orquestradorId: "orq-1" })).toBe(true);

      expect(views[0].webContents.reload).toHaveBeenCalledTimes(1);
    });

    it("valem com o agente pausado (é para isso que servem) e não passam pela fila de comandos do agente", async () => {
      const { navegador, executar, principal, views } = montar();
      await executar({ tipo: "abrir", url: "https://exemplo.com/a" });
      await executar({ tipo: "abrir", url: "https://exemplo.com/b" });
      const execucao = executar({ tipo: "esperar", ms: 30_000 });
      await new Promise((resolver) => setTimeout(resolver, 5));
      navegador.aoPausar(principal, { orquestradorId: "orq-1" });
      await expect(execucao).rejects.toMatchObject({ motivo: "pausado" });

      expect(navegador.aoVoltar(principal, { orquestradorId: "orq-1" })).toBe(true);
      expect(navegador.aoRecarregar(principal, { orquestradorId: "orq-1" })).toBe(true);

      expect(views[0].webContents.navigationHistory.goBack).toHaveBeenCalledTimes(1);
      expect(views[0].webContents.reload).toHaveBeenCalledTimes(1);
      // O agente segue recusado enquanto o usuário não devolve.
      await expect(executar({ tipo: "ler_pagina" })).rejects.toMatchObject({ motivo: "pausado" });
    });

    it("de um Orquestrador sem navegador, ou de um id inválido, resolvem false", () => {
      const { navegador, principal } = montar();

      expect(navegador.aoVoltar(principal, { orquestradorId: "orq-9" })).toBe(false);
      expect(navegador.aoAvancar(principal, { orquestradorId: "orq-9" })).toBe(false);
      expect(navegador.aoRecarregar(principal, { orquestradorId: "orq-9" })).toBe(false);
      expect(navegador.aoRecarregar(principal, { orquestradorId: 42 })).toBe(false);
      expect(navegador.aoRecarregar(principal, undefined)).toBe(false);
    });

    it("registram no log só um texto curto, sem o endereço da página", async () => {
      const { navegador, executar, principal, registrar } = montar();
      await executar({ tipo: "abrir", url: "https://exemplo.com/a?segredo=1" });

      navegador.aoRecarregar(principal, { orquestradorId: "orq-1" });

      const linhas = registrar.mock.calls.map(([texto]) => String(texto));
      expect(linhas.some((linha) => linha.includes("o usuário usou recarregar"))).toBe(true);
      expect(linhas.some((linha) => linha.includes("segredo"))).toBe(false);
    });
  });

  it("fechar remove a vista da janela, desliga o debugger, fecha a página e solta a pausa", async () => {
    const { navegador, executar, principal, views, janela } = montar();
    await executar({ tipo: "ler_pagina" });
    navegador.aoPausar(principal, { orquestradorId: "orq-1" });
    const [vista] = views;

    expect(await navegador.aoFechar(principal, { orquestradorId: "orq-1" })).toBe(true);

    expect(janela.contentView.removeChildView).toHaveBeenCalledWith(vista);
    expect(vista.debuggerFalso.detach).toHaveBeenCalled();
    expect(vista.webContents.close).toHaveBeenCalled();
    expect(navegador.total()).toBe(0);
    // A pausa não sobrevive ao fechamento.
    await expect(executar({ tipo: "ler_pagina" })).resolves.toBeDefined();
  });

  it("fechar com apagarDados apaga o login e o armazenamento da sessão do Orquestrador", async () => {
    const { navegador, executar, principal, sessoes } = montar();
    await executar({ tipo: "ler_pagina" });
    const sessao = sessoes.get("persist:navegador-orq-1");

    await navegador.aoFechar(principal, { orquestradorId: "orq-1" });
    expect(sessao.clearStorageData).not.toHaveBeenCalled();

    await navegador.aoFechar(principal, { orquestradorId: "orq-1", apagarDados: true });
    expect(sessao.clearStorageData).toHaveBeenCalled();
    expect(sessao.clearCache).toHaveBeenCalled();
    expect(sessao.clearAuthCache).toHaveBeenCalled();
  });

  it("fechar cancela o comando em andamento", async () => {
    const { navegador, executar, principal } = montar();
    await executar({ tipo: "voltar" }).catch(() => undefined);
    const execucao = executar({ tipo: "esperar", ms: 30_000 });
    await new Promise((resolver) => setTimeout(resolver, 5));

    await navegador.aoFechar(principal, { orquestradorId: "orq-1" });

    await expect(execucao).rejects.toMatchObject({ motivo: "cancelado" });
  });
});

describe("criarNavegadorDoAgente: janela principal", () => {
  it("fecha todas as vistas quando a janela fecha e as desce quando a tela recarrega", async () => {
    const { navegador, executar, principal, retangulo, views, janelaWc, janela, ouvintesDaJanela, ouvintesDoConteudoDaJanela } = montar();
    navegador.anexar({ ...janela, on: janela.on, webContents: janelaWc });
    await executar({ tipo: "ler_pagina" });
    navegador.aoMostrar(principal, { orquestradorId: "orq-1", retangulo });

    expect(views[0].bounds).not.toEqual(LIMITES_OCULTOS);
    ouvintesDoConteudoDaJanela["did-start-navigation"]({ isMainFrame: true, isSameDocument: false });
    esperarEscondida(views[0]);
    expect(navegador.total()).toBe(1);

    ouvintesDoConteudoDaJanela["did-start-navigation"]({ isMainFrame: false, isSameDocument: false });
    ouvintesDaJanela.closed();
    expect(navegador.total()).toBe(0);
    expect(views[0].webContents.close).toHaveBeenCalled();
  });

  it("destruirTodas fecha tudo", async () => {
    const { navegador, executar, views } = montar();
    await executar({ tipo: "ler_pagina" }, "orq-1");
    await executar({ tipo: "ler_pagina" }, "orq-2");

    navegador.destruirTodas();

    expect(navegador.total()).toBe(0);
    expect(views.every((vista) => vista.webContents.close.mock.calls.length === 1)).toBe(true);
  });
});

describe("criarNavegadorDoAgente: ponte com o servidor (utilityProcess)", () => {
  function filhoFalso() {
    const filho = new EventEmitter();
    filho.postMessage = vi.fn();
    return filho;
  }
  const esperarResposta = async (filho, id) => {
    await vi.waitFor(() => expect(filho.postMessage.mock.calls.some(([mensagem]) => mensagem.id === id)).toBe(true));
    return filho.postMessage.mock.calls.map(([mensagem]) => mensagem).find((mensagem) => mensagem.id === id);
  };

  it("executa o comando e responde navegador:resposta com o resultado", async () => {
    const { navegador } = montar();
    const filho = filhoFalso();
    navegador.ligarAoServidor(filho);

    filho.emit("message", { tipo: "navegador:comando", id: "c1", orquestradorId: "orq-1", comando: { tipo: "abrir", url: "https://exemplo.com/" } });

    expect(await esperarResposta(filho, "c1")).toEqual({
      tipo: "navegador:resposta",
      id: "c1",
      ok: true,
      resultado: { url: "https://exemplo.com/", titulo: "Exemplo", mensagem: "Página aberta." },
    });
  });

  it("responde o erro com o motivo e a mensagem", async () => {
    const { navegador } = montar();
    const filho = filhoFalso();
    navegador.ligarAoServidor(filho);

    filho.emit("message", { tipo: "navegador:comando", id: "c2", orquestradorId: "orq-1", comando: { tipo: "abrir", url: "file:///etc/passwd" } });
    filho.emit("message", { tipo: "navegador:comando", id: "c3", orquestradorId: "orq-1", comando: { tipo: "voltar" } });

    expect(await esperarResposta(filho, "c2")).toMatchObject({ ok: false, erro: { motivo: "recusado" } });
    expect(await esperarResposta(filho, "c3")).toMatchObject({
      ok: false,
      erro: { motivo: "falhou", mensagem: "Não há página anterior no histórico." },
    });
  });

  it("erro que não é do navegador responde genérico (sem vazar detalhes) e vai ao log", async () => {
    const { navegador, views, registrar, executar } = montar();
    await executar({ tipo: "voltar" }).catch(() => undefined);
    const filho = filhoFalso();
    navegador.ligarAoServidor(filho);
    views[0].webContents.isDestroyed = () => {
      throw new Error("detalhe interno C:\\segredo");
    };

    filho.emit("message", { tipo: "navegador:comando", id: "c4", orquestradorId: "orq-1", comando: { tipo: "ler_pagina" } });

    const resposta = await esperarResposta(filho, "c4");
    expect(resposta).toMatchObject({ ok: false, erro: { motivo: "falhou", mensagem: "O navegador do agente falhou." } });
    expect(registrar).toHaveBeenCalledWith(expect.stringContaining("detalhe interno"));
  });

  it("navegador:cancelar aborta o comando em andamento", async () => {
    const { navegador } = montar();
    const filho = filhoFalso();
    navegador.ligarAoServidor(filho);
    filho.emit("message", { tipo: "navegador:comando", id: "c5", orquestradorId: "orq-1", comando: { tipo: "esperar", ms: 30_000 } });
    await new Promise((resolver) => setTimeout(resolver, 5));

    filho.emit("message", { tipo: "navegador:cancelar", id: "c5" });

    expect(await esperarResposta(filho, "c5")).toMatchObject({ ok: false, erro: { motivo: "cancelado" } });
  });

  it("o servidor que sai aborta o que estava em andamento", async () => {
    const { navegador } = montar();
    const filho = filhoFalso();
    navegador.ligarAoServidor(filho);
    filho.emit("message", { tipo: "navegador:comando", id: "c6", orquestradorId: "orq-1", comando: { tipo: "esperar", ms: 30_000 } });
    await new Promise((resolver) => setTimeout(resolver, 5));

    filho.emit("exit", 1);

    expect(await esperarResposta(filho, "c6")).toMatchObject({ ok: false, erro: { motivo: "cancelado" } });
  });

  it("ignora lixo e mensagens de outros tipos, e não estoura se o servidor já saiu", async () => {
    const { navegador } = montar();
    const filho = filhoFalso();
    filho.postMessage.mockImplementation(() => {
      throw new Error("canal fechado");
    });
    navegador.ligarAoServidor(filho);

    for (const mensagem of [null, "texto", {}, { tipo: "desligar" }, { tipo: "navegador:comando" }, { tipo: "navegador:resposta", id: "x" }]) {
      expect(() => filho.emit("message", mensagem)).not.toThrow();
    }
    filho.emit("message", { tipo: "navegador:comando", id: "c7", orquestradorId: "orq-1", comando: { tipo: "voltar" } });
    await vi.waitFor(() => expect(filho.postMessage).toHaveBeenCalled());
  });

  it("serve cada servidor religado, respondendo pelo filho que perguntou", async () => {
    const { navegador } = montar();
    const antigo = filhoFalso();
    const novo = filhoFalso();
    navegador.ligarAoServidor(antigo);
    navegador.ligarAoServidor(novo);

    novo.emit("message", { tipo: "navegador:comando", id: "n1", orquestradorId: "orq-1", comando: { tipo: "recarregar" } });

    expect(await esperarResposta(novo, "n1")).toMatchObject({ ok: true });
    expect(antigo.postMessage).not.toHaveBeenCalled();
  });
});
