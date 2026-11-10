"use strict";

// Ajustes do app desktop para o macOS. Tudo aqui só vale com
// process.platform === "darwin": no Windows e no Linux cada função devolve o
// valor de entrada (ou null), e o main.js segue exatamente como antes.
//
// O que muda no Mac:
//   1. Menu do app com os papéis nativos. Sem ele, Cmd+C, Cmd+V, Cmd+Z, Cmd+A
//      e Cmd+Q não funcionam (no Mac quem faz isso é o menu, não a página).
//   2. Janelas com as 3 bolinhas nativas. O titleBarOverlay (botões nativos
//      pintados no Windows) sai; na janela principal não há barra de título:
//      as bolinhas flutuam no canto superior esquerdo, centradas com as ilhas
//      do topo da tela, e a tela não desenha os botões ─ ☐ ✕.
//   3. PATH do shell de login: aberto pelo Finder ou pelo Dock, o app recebe
//      um PATH mínimo, e o Claude Code (que precisa do `node`, via nvm ou
//      Homebrew) não rodaria.
//   4. Primeira abertura: acha o `claude` no PATH (no Mac não há claude.exe).
//      Esta é a única que vale também no Linux, que procura ainda em
//      ~/.local/bin e /usr/local/bin (o app aberto pelo menu do sistema pode
//      vir com um PATH sem o ~/.local/bin).
//   5. Sem atualização automática: sem assinatura da Apple ela não funciona.

const { execFileSync } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");

const ehMac = process.platform === "darwin";

// Bolinhas (cerca de 14px de altura) no canto superior esquerdo.
// Janela principal: sem barra de título; as ilhas do topo têm 48px de altura a
// 16px da borda (centro em y = 40), então as bolinhas ficam em y = 40 - 7 = 33,
// e a ilha do nome anda para a direita para não encostar nelas (ilhas.css).
const SEMAFORO_DA_JANELA_PRINCIPAL = { x: 16, y: 33 };
// Ativação e primeira abertura: faixa arrastável de 40px no topo.
const SEMAFORO_DAS_JANELAS_PEQUENAS = { x: 14, y: 13 };

// ──────────────────────────────────────────────────────────────────────────
// Janela.
// ──────────────────────────────────────────────────────────────────────────

/**
 * Ajusta as opções do BrowserWindow para o Mac. `principal` diz se é a janela
 * principal (barra de título do app) ou uma das pequenas (ativação,
 * configuração). Fora do Mac devolve as opções sem mudança.
 */
function ajustarOpcoesDaJanela(opcoes, principal) {
  if (!ehMac) return opcoes;
  const { titleBarOverlay: _semOverlay, ...resto } = opcoes;
  return {
    ...resto,
    titleBarStyle: "hidden",
    trafficLightPosition: principal ? SEMAFORO_DA_JANELA_PRINCIPAL : SEMAFORO_DAS_JANELAS_PEQUENAS,
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
// PATH do shell de login.
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
 * comuns do Homebrew. O servidor herda esse PATH, e o Claude Code que ele
 * chama acha o `node` mesmo com o app aberto pelo Finder. Fora do Mac não faz
 * nada.
 */
function carregarPathDoShell() {
  if (!ehMac) return;
  const doShell = pathDoShellDeLogin();
  const comuns = ["/opt/homebrew/bin", "/usr/local/bin", path.join(os.homedir(), ".local", "bin")].join(":");
  process.env.PATH = juntarPaths(juntarPaths(doShell, process.env.PATH), comuns);
}

// ──────────────────────────────────────────────────────────────────────────
// Primeira abertura.
// ──────────────────────────────────────────────────────────────────────────

/**
 * No Mac e no Linux, o primeiro `claude` do PATH. Fica o caminho do link (o de
 * ~/.local/bin aponta para a versão instalada), que continua valendo quando o
 * Claude Code se atualiza. No Linux, sem ele no PATH, tenta ainda
 * ~/.local/bin/claude (onde o instalador do Claude Code o põe) e
 * /usr/local/bin/claude. No Windows, ou sem `claude` instalado, devolve null e
 * a primeira abertura segue com a detecção do Windows.
 */
function claudeCodeDoPath(ehArquivo, ambiente = process.env, plataforma = process.platform) {
  if (plataforma !== "darwin" && plataforma !== "linux") return null;
  const pastas = (ambiente.PATH || "").split(":");
  if (plataforma === "linux") {
    if (ambiente.HOME) pastas.push(path.posix.join(ambiente.HOME, ".local", "bin"));
    pastas.push("/usr/local/bin");
  }
  for (const pasta of pastas) {
    if (!pasta) continue;
    // Caminhos do Mac e do Linux: com "/" mesmo nos testes rodados no Windows.
    const candidato = path.posix.join(pasta, "claude");
    if (ehArquivo(candidato)) return candidato;
  }
  return null;
}

/**
 * No Mac, a pasta `dados` do repositório de onde o app foi gerado (o
 * `npm run dist:mac` grava esse caminho em "repositorioDoMac" no package.json
 * empacotado). É onde fica o histórico de quem usava o app pelo terminal, e o
 * app instalado não teria como achá-la sozinho. Devolve null fora do Mac, sem
 * o caminho gravado ou quando a pasta não tem orquestradores/ nem notas/.
 */
function historicoDoRepositorio(pacote, ehPasta) {
  if (!ehMac || !pacote || typeof pacote.repositorioDoMac !== "string") return null;
  const dados = path.join(pacote.repositorioDoMac, "dados");
  return ["orquestradores", "notas"].some((nome) => ehPasta(path.join(dados, nome))) ? dados : null;
}

module.exports = {
  ehMac,
  ajustarOpcoesDaJanela,
  menuDoApp,
  carregarPathDoShell,
  claudeCodeDoPath,
  historicoDoRepositorio,
  // Expostos para teste.
  juntarPaths,
};
