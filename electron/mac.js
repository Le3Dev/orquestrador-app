"use strict";

// Ajustes do app desktop para o macOS. Tudo aqui só vale com
// process.platform === "darwin": no Windows e no Linux cada função devolve o
// valor de entrada (ou null), e o main.js segue exatamente como antes.
//
// O que muda no Mac:
//   1. Menu do app com os papéis nativos. Sem ele, Cmd+C, Cmd+V, Cmd+Z, Cmd+A
//      e Cmd+Q não funcionam (no Mac quem faz isso é o menu, não a página).
//   2. Janela sem a faixa de título, com as 3 bolinhas nativas dentro da
//      barra do canvas. O titleBarOverlay (botões desenhados no Windows) sai.
//   3. PATH do shell de login: aberto pelo Finder ou pelo Dock, o app recebe
//      um PATH mínimo e não acharia o `node` (nvm, Homebrew) nem o `claude`.
//   4. Servidor no Node do sistema (o projeto pede Node 22), e não no binário
//      do Electron, que traz Node 20 e não entende --env-file-if-exists.
//   5. Se já houver um servidor do Orquestrador na porta, a janela usa ele em
//      vez de subir outro (quem usa a versão no navegador e o app juntos).
//   6. Rodando pelo código (fora do app empacotado), dá para abrir sem
//      licença com ORQUESTRADOR_SEM_LICENCA=1. O app empacotado continua
//      exigindo a chave.

const { execFileSync } = require("node:child_process");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const ehMac = process.platform === "darwin";

/** Versão mínima do Node que o servidor aceita (package.json, "engines"). */
const NODE_MINIMO = 22;

// Barra do canvas: painel do React Flow com margem de 15px e 48px de altura.
// As bolinhas (cerca de 14px de altura) ficam centradas nela, à esquerda.
const SEMAFORO_DA_JANELA_PRINCIPAL = { x: 29, y: 32 };
// Tela de ativação: faixa arrastável de 40px no topo.
const SEMAFORO_DA_ATIVACAO = { x: 14, y: 13 };

// ──────────────────────────────────────────────────────────────────────────
// Janela.
// ──────────────────────────────────────────────────────────────────────────

/**
 * Ajusta as opções do BrowserWindow para o Mac. `tipo` é "principal" ou
 * "ativacao". Fora do Mac devolve as opções sem mudança.
 */
function ajustarOpcoesDaJanela(opcoes, tipo) {
  if (!ehMac) return opcoes;
  const { titleBarOverlay: _semOverlay, ...resto } = opcoes;
  return {
    ...resto,
    titleBarStyle: "hidden",
    trafficLightPosition: tipo === "ativacao" ? SEMAFORO_DA_ATIVACAO : SEMAFORO_DA_JANELA_PRINCIPAL,
  };
}

/**
 * Menu do app no Mac, só com os papéis nativos (copiar, colar, desfazer,
 * zoom, tela cheia, sair). Fora do Mac devolve null, que é o que o main.js
 * já usava para tirar o menu.
 */
function menuDoApp(Menu, nomeDoApp) {
  if (!ehMac) return null;
  return Menu.buildFromTemplate([
    {
      label: nomeDoApp,
      submenu: [
        { role: "about", label: `Sobre o ${nomeDoApp}` },
        { type: "separator" },
        { role: "hide", label: `Ocultar ${nomeDoApp}` },
        { role: "hideOthers", label: "Ocultar outros" },
        { role: "unhide", label: "Mostrar tudo" },
        { type: "separator" },
        { role: "quit", label: `Sair do ${nomeDoApp}` },
      ],
    },
    {
      label: "Editar",
      submenu: [
        { role: "undo", label: "Desfazer" },
        { role: "redo", label: "Refazer" },
        { type: "separator" },
        { role: "cut", label: "Recortar" },
        { role: "copy", label: "Copiar" },
        { role: "paste", label: "Colar" },
        { role: "pasteAndMatchStyle", label: "Colar sem formatação" },
        { role: "selectAll", label: "Selecionar tudo" },
      ],
    },
    {
      label: "Visualizar",
      submenu: [
        { role: "reload", label: "Recarregar" },
        { role: "forceReload", label: "Recarregar sem cache" },
        { role: "toggleDevTools", label: "Ferramentas do desenvolvedor" },
        { type: "separator" },
        { role: "resetZoom", label: "Tamanho original" },
        { role: "zoomIn", label: "Aumentar" },
        { role: "zoomOut", label: "Diminuir" },
        { type: "separator" },
        { role: "togglefullscreen", label: "Tela cheia" },
      ],
    },
    {
      label: "Janela",
      submenu: [
        { role: "minimize", label: "Minimizar" },
        { role: "zoom", label: "Zoom" },
        { role: "close", label: "Fechar janela" },
        { type: "separator" },
        { role: "front", label: "Trazer tudo para a frente" },
      ],
    },
  ]);
}

// ──────────────────────────────────────────────────────────────────────────
// PATH e Node do sistema.
// ──────────────────────────────────────────────────────────────────────────

const MARCA = "__PATH_DO_ORQUESTRADOR__";

/** PATH que o shell de login da pessoa monta (nvm, Homebrew, ~/.local/bin). */
function pathDoShellDeLogin() {
  const shell = process.env.SHELL || "/bin/zsh";
  try {
    // -i -l: lê .zprofile e .zshrc, onde nvm e Homebrew costumam ficar. As
    // marcas separam o PATH de qualquer coisa que o .zshrc imprima.
    const saida = execFileSync(shell, ["-ilc", `printf '%s%s%s' '${MARCA}' "$PATH" '${MARCA}'`], {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const partes = saida.split(MARCA);
    return partes.length >= 3 ? partes[1] : null;
  } catch {
    return null;
  }
}

/** Junta dois PATHs sem repetir pasta, mantendo a ordem do primeiro. */
function juntarPaths(primeiro, segundo) {
  const vistas = new Set();
  const resultado = [];
  for (const pasta of `${primeiro || ""}:${segundo || ""}`.split(":")) {
    if (pasta && !vistas.has(pasta)) {
      vistas.add(pasta);
      resultado.push(pasta);
    }
  }
  return resultado.join(":");
}

/**
 * No Mac, completa o process.env.PATH com o do shell de login e com as pastas
 * comuns do Homebrew. Assim o servidor (e o Claude Code que ele chama) acham
 * `node` e `claude` mesmo com o app aberto pelo Finder. Fora do Mac não faz nada.
 */
function carregarPathDoShell() {
  if (!ehMac) return;
  const doShell = pathDoShellDeLogin();
  const comuns = ["/opt/homebrew/bin", "/usr/local/bin", path.join(os.homedir(), ".local", "bin")].join(":");
  process.env.PATH = juntarPaths(juntarPaths(doShell, process.env.PATH), comuns);
}

/** Versão principal de um executável `node`, ou null se não rodar. */
function versaoPrincipalDoNode(executavel) {
  // Sem isto, herdado de um terminal do VS Code, um Electron no PATH
  // responderia como se fosse Node.
  const ambiente = { ...process.env };
  delete ambiente.ELECTRON_RUN_AS_NODE;
  try {
    const saida = execFileSync(executavel, ["--version"], {
      encoding: "utf8",
      timeout: 4000,
      env: ambiente,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const m = /^v(\d+)\./.exec(saida.trim());
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

/** Primeiro `node` do PATH com a versão que o servidor pede. */
function nodeDoSistema() {
  for (const pasta of (process.env.PATH || "").split(":")) {
    if (!pasta) continue;
    const candidato = path.join(pasta, "node");
    const versao = versaoPrincipalDoNode(candidato);
    if (versao !== null && versao >= NODE_MINIMO) return candidato;
  }
  return null;
}

/**
 * Executável que deve rodar o vigia do servidor. No Mac, o Node do sistema
 * (22 ou mais); fora do Mac, ou sem Node adequado instalado, devolve null e o
 * main.js usa o process.execPath como sempre.
 */
function executavelDoServidor() {
  if (!ehMac) return null;
  return nodeDoSistema();
}

// ──────────────────────────────────────────────────────────────────────────
// Servidor já no ar.
// ──────────────────────────────────────────────────────────────────────────

/** true se já há um servidor respondendo em `url` (só consultado no Mac). */
function servidorJaNoAr(url, limiteMs = 800) {
  if (!ehMac) return Promise.resolve(false);
  return new Promise((resolver) => {
    const req = http.get(`${url}/api/saude`, (res) => {
      res.resume();
      resolver(res.statusCode === 200);
    });
    req.on("error", () => resolver(false));
    req.setTimeout(limiteMs, () => {
      req.destroy();
      resolver(false);
    });
  });
}

/**
 * Promessa que resolve quando o processo sair (ou após `limiteMs`). Serve
 * para, no Mac, não subir um servidor novo enquanto o antigo ainda grava o
 * histórico. Fora do Mac devolve null.
 */
function esperarSaida(processo, limiteMs = 10_000) {
  if (!ehMac || !processo || processo.exitCode !== null || processo.signalCode !== null) return null;
  return new Promise((resolver) => {
    const limite = setTimeout(resolver, limiteMs);
    processo.once("exit", () => {
      clearTimeout(limite);
      resolver();
    });
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Licença ao rodar pelo código.
// ──────────────────────────────────────────────────────────────────────────

/**
 * true quando o Mac roda pelo código (não empacotado) com
 * ORQUESTRADOR_SEM_LICENCA=1. O app empacotado sempre passa pela licença.
 */
function liberadoSemLicenca(app) {
  return ehMac && !app.isPackaged && process.env.ORQUESTRADOR_SEM_LICENCA === "1";
}

module.exports = {
  ehMac,
  ajustarOpcoesDaJanela,
  menuDoApp,
  carregarPathDoShell,
  executavelDoServidor,
  servidorJaNoAr,
  esperarSaida,
  liberadoSemLicenca,
  // Expostos para teste.
  juntarPaths,
};
