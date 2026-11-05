// Desenvolvimento do aplicativo desktop: `npm run desktop:dev`.
//
//   1. compila o backend uma vez (tsc -p tsconfig.build.json → dist/);
//   2. sobe o Vite (npm --prefix web run dev) com PORTA_DA_API=3201, para o
//      /api da tela ir ao servidor que o app sobe nessa porta;
//   3. espera a tela responder em http://localhost:5173;
//   4. abre o Electron com ORQUESTRADOR_URL_DA_TELA=http://localhost:5173 e
//      PORTA=3201 (o app sobe o servidor e carrega a tela do Vite, com
//      recarga ao salvar arquivos de web/).
//
// Fechar o app ou apertar Ctrl+C encerra tudo (no Windows, a árvore inteira de
// cada processo). Alterações no backend pedem fechar e rodar de novo.
"use strict";

const { spawn, spawnSync } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");

const PASTA_DO_APP = path.resolve(__dirname, "..");
const PORTA_DO_SERVIDOR = "3201";
const URL_DA_TELA = "http://localhost:5173";
const ESPERA_MAXIMA_DA_TELA_MS = 60_000;
const NO_WINDOWS = process.platform === "win32";

const processos = new Set();
let encerrando = false;

const log = (mensagem) => console.log(`[desktop:dev] ${mensagem}`);
const erro = (mensagem) => console.error(`[desktop:dev] ${mensagem}`);

/** Resolve um pacote a partir da pasta do app (inclui node_modules de pastas acima). */
function resolver(modulo) {
  return require.resolve(modulo, { paths: [PASTA_DO_APP] });
}

function encerrarProcesso(filho) {
  if (filho.exitCode !== null || filho.pid === undefined) return;
  try {
    if (NO_WINDOWS) {
      spawnSync("taskkill", ["/pid", String(filho.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
    } else {
      filho.kill("SIGTERM");
    }
  } catch {
    /* já saiu */
  }
}

function encerrarTudo(codigo) {
  if (encerrando) return;
  encerrando = true;
  for (const filho of processos) encerrarProcesso(filho);
  process.exit(codigo);
}

function iniciar(nome, comando, argumentos, opcoes) {
  const filho = spawn(comando, argumentos, { cwd: PASTA_DO_APP, stdio: "inherit", ...opcoes });
  processos.add(filho);
  filho.on("error", (falha) => {
    erro(`Não foi possível iniciar ${nome}: ${falha.message}`);
    encerrarTudo(1);
  });
  filho.on("exit", () => processos.delete(filho));
  return filho;
}

function compilarBackend() {
  log("Compilando o backend (tsc -p tsconfig.build.json)…");
  const tsc = path.join(path.dirname(resolver("typescript/package.json")), "bin", "tsc");
  const resultado = spawnSync(process.execPath, [tsc, "-p", "tsconfig.build.json"], {
    cwd: PASTA_DO_APP,
    stdio: "inherit",
  });
  if (resultado.status !== 0) {
    erro("A compilação do backend falhou. Corrija os erros acima e rode de novo.");
    process.exit(resultado.status ?? 1);
  }
}

function subirTela() {
  log(`Subindo a tela (Vite) em ${URL_DA_TELA}, com /api → 127.0.0.1:${PORTA_DO_SERVIDOR}…`);
  // O npm no Windows é um .cmd: precisa de shell.
  const vite = iniciar("o Vite", "npm --prefix web run dev", [], {
    shell: true,
    env: { ...process.env, PORTA_DA_API: PORTA_DO_SERVIDOR },
  });
  vite.on("exit", (codigo) => {
    if (encerrando) return;
    erro(`O Vite foi encerrado (código ${codigo}). Fechando tudo.`);
    encerrarTudo(codigo || 1);
  });
}

function esperarTela() {
  const limite = Date.now() + ESPERA_MAXIMA_DA_TELA_MS;
  return new Promise((resolve, reject) => {
    const tentar = () => {
      const requisicao = http.get(URL_DA_TELA, (resposta) => {
        resposta.resume();
        resolve();
      });
      requisicao.on("error", () => {
        if (Date.now() > limite) {
          reject(new Error(`A tela não respondeu em ${URL_DA_TELA} em ${ESPERA_MAXIMA_DA_TELA_MS / 1000}s.`));
          return;
        }
        setTimeout(tentar, 500);
      });
      requisicao.setTimeout(2_000, () => requisicao.destroy());
    };
    tentar();
  });
}

function abrirAplicativo() {
  // Em Node puro, require("electron") devolve o caminho do executável.
  const executavelDoElectron = require(resolver("electron"));
  log(`Abrindo o aplicativo (servidor na porta ${PORTA_DO_SERVIDOR}). Feche a janela ou aperte Ctrl+C para sair.`);
  const ambiente = {
    ...process.env,
    ORQUESTRADOR_URL_DA_TELA: URL_DA_TELA,
    PORTA: PORTA_DO_SERVIDOR,
  };
  // Herdada de outro app Electron (ex.: um editor), faria o Electron rodar como Node.
  delete ambiente.ELECTRON_RUN_AS_NODE;
  const aplicativo = iniciar("o Electron", executavelDoElectron, ["."], { env: ambiente });
  aplicativo.on("exit", (codigo) => {
    if (encerrando) return;
    log("O aplicativo foi fechado. Encerrando o Vite…");
    encerrarTudo(codigo ?? 0);
  });
}

process.on("SIGINT", () => encerrarTudo(0));
process.on("SIGTERM", () => encerrarTudo(0));

async function principal() {
  compilarBackend();
  subirTela();
  try {
    await esperarTela();
  } catch (falha) {
    erro(falha instanceof Error ? falha.message : String(falha));
    encerrarTudo(1);
    return;
  }
  if (!encerrando) abrirAplicativo();
}

principal().catch((falha) => {
  erro(`Falha inesperada: ${falha instanceof Error ? falha.message : String(falha)}`);
  encerrarTudo(1);
});
