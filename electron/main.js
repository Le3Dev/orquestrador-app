"use strict";

// Processo principal do app desktop (Electron).
//
// Fluxo:
//   1. Carrega a licença local; se não houver uma válida (online ou grace),
//      abre a telinha de ativação (electron/ativacao.html) ANTES do app.
//   2. Sobe o servidor Express reutilizando o vigia (scripts/manter-no-ar.cjs),
//      que faz spawn de `node dist/root.js` e o religa se cair.
//   3. Espera a porta 3200 responder e carrega http://localhost:3200 na janela.
//   4. Ao fechar o app, encerra o processo do servidor.
//
// Janela: titleBarStyle 'hidden' + titleBarOverlay (combinando com o tema
// escuro) — preserva snap/arraste do Windows, ao contrário de frame:false.

const { app, BrowserWindow, ipcMain, Menu, shell } = require("electron");
const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");

const config = require("./config");
const licenca = require("./licenca");

const PASTA_DO_APP = path.resolve(__dirname, "..");
const PORTA = Number(process.env.PORTA || config.porta || 3200);
const URL_DO_APP = `http://localhost:${PORTA}`;

// Cores do tema escuro (web/src/theme/index.css): fundo #141413, texto claro.
const COR_BARRA = "#141413";
const COR_SIMBOLOS = "#faf9f5";

let janelaPrincipal = null;
let janelaAtivacao = null;
let processoServidor = null;

// ──────────────────────────────────────────────────────────────────────────
// Servidor Express local via vigia (religa sozinho se cair).
// ──────────────────────────────────────────────────────────────────────────
function subirServidor() {
  if (processoServidor) return;
  processoServidor = spawn(process.execPath, ["scripts/manter-no-ar.cjs"], {
    cwd: PASTA_DO_APP,
    stdio: "inherit",
    env: { ...process.env, PORTA: String(PORTA) },
  });
  processoServidor.on("exit", () => {
    processoServidor = null;
  });
}

function encerrarServidor() {
  if (!processoServidor) return;
  try {
    // No Windows, matar a árvore garante que o node dist/root.js morra junto.
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(processoServidor.pid), "/t", "/f"], { windowsHide: true });
    } else {
      processoServidor.kill("SIGTERM");
    }
  } catch {
    /* já encerrando */
  }
  processoServidor = null;
}

// Poll simples: resolve quando a porta responde (qualquer status HTTP serve).
function esperarServidor(tentativas = 60, intervaloMs = 500) {
  return new Promise((resolver, rejeitar) => {
    let restam = tentativas;
    const tentar = () => {
      const req = http.get(`${URL_DO_APP}/api/saude`, (res) => {
        res.resume();
        resolver();
      });
      req.on("error", () => {
        restam -= 1;
        if (restam <= 0) {
          rejeitar(new Error(`Servidor não respondeu em ${URL_DO_APP} a tempo.`));
          return;
        }
        setTimeout(tentar, intervaloMs);
      });
      req.setTimeout(intervaloMs, () => req.destroy());
    };
    tentar();
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Janelas.
// ──────────────────────────────────────────────────────────────────────────
function opcoesComuns() {
  return {
    backgroundColor: COR_BARRA,
    autoHideMenuBar: true,
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: COR_BARRA,
      symbolColor: COR_SIMBOLOS,
      height: 40,
    },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };
}

function abrirJanelaAtivacao() {
  janelaAtivacao = new BrowserWindow({
    width: 520,
    height: 560,
    resizable: false,
    title: config.productName,
    ...opcoesComuns(),
  });
  janelaAtivacao.loadFile(path.join(__dirname, "ativacao.html"));
  janelaAtivacao.on("closed", () => {
    janelaAtivacao = null;
  });
}

async function abrirJanelaPrincipal() {
  janelaPrincipal = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: config.productName,
    show: false,
    ...opcoesComuns(),
  });

  // Links externos abrem no navegador do sistema, não dentro do app.
  janelaPrincipal.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http")) shell.openExternal(url);
    return { action: "deny" };
  });

  subirServidor();
  try {
    await esperarServidor();
    await janelaPrincipal.loadURL(URL_DO_APP);
  } catch (erro) {
    // Sem servidor não há tela: mostra uma mensagem simples de erro.
    await janelaPrincipal.loadURL(
      "data:text/html;charset=utf-8," +
        encodeURIComponent(
          `<body style="background:${COR_BARRA};color:${COR_SIMBOLOS};font-family:sans-serif;padding:40px">` +
            `<h2>Não foi possível iniciar o servidor local.</h2><p>${String(erro.message || erro)}</p></body>`,
        ),
    );
  }
  janelaPrincipal.show();
  janelaPrincipal.on("closed", () => {
    janelaPrincipal = null;
  });
}

// Decide qual janela abrir conforme o estado da licença.
async function abrirConformeLicenca() {
  const { liberado } = await licenca.liberadoParaAbrir();
  if (liberado) {
    await abrirJanelaPrincipal();
  } else {
    abrirJanelaAtivacao();
  }
}

// ──────────────────────────────────────────────────────────────────────────
// IPC — controles de janela.
// ──────────────────────────────────────────────────────────────────────────
function janelaDoEvento(evento) {
  return BrowserWindow.fromWebContents(evento.sender);
}

ipcMain.handle("janela:minimizar", (e) => janelaDoEvento(e)?.minimize());
ipcMain.handle("janela:maximizar", (e) => {
  const j = janelaDoEvento(e);
  if (!j) return;
  if (j.isMaximized()) j.unmaximize();
  else j.maximize();
});
ipcMain.handle("janela:fechar", (e) => janelaDoEvento(e)?.close());
ipcMain.handle("janela:esta-maximizada", (e) => janelaDoEvento(e)?.isMaximized() ?? false);

// ──────────────────────────────────────────────────────────────────────────
// IPC — licença. Após ativar com sucesso, troca a tela de ativação pela app.
// ──────────────────────────────────────────────────────────────────────────
ipcMain.handle("licenca:activate", async (_e, chave) => {
  const resultado = await licenca.activate(chave);
  if (resultado.ok) {
    await abrirJanelaPrincipal();
    if (janelaAtivacao) janelaAtivacao.close();
  }
  return resultado;
});
ipcMain.handle("licenca:validate", () => licenca.validate());
ipcMain.handle("licenca:deactivate", () => licenca.deactivate());
ipcMain.handle("licenca:status", () => licenca.status());

// ──────────────────────────────────────────────────────────────────────────
// Ciclo de vida.
// ──────────────────────────────────────────────────────────────────────────
// Instância única: um segundo lançamento foca a janela já aberta.
const conseguiuLock = app.requestSingleInstanceLock();
if (!conseguiuLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const j = janelaPrincipal || janelaAtivacao;
    if (j) {
      if (j.isMinimized()) j.restore();
      j.focus();
    }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null); // remove File/Edit/View/Window
    licenca.iniciar(app.getPath("userData"));
    abrirConformeLicenca();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) abrirConformeLicenca();
    });
  });

  app.on("window-all-closed", () => {
    encerrarServidor();
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", encerrarServidor);
  app.on("quit", encerrarServidor);
}
