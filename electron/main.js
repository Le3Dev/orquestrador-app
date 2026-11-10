"use strict";

// Processo principal do app desktop (Electron).
//
// O Orquestrador roda SÓ dentro do aplicativo: o servidor escuta em
// 127.0.0.1 numa porta fixa por instalação (gravada no config.json) e recusa
// qualquer requisição sem o cookie `orquestrador_acesso`, cuja chave só o app
// conhece.
//
// Pasta de dados única: %APPDATA%\Orquestrador de Agentes, no app instalado e
// fora dele. Na primeira abertura, se ela ainda não tem config.json e a pasta
// antiga do desenvolvimento (%APPDATA%\orquestrador-agentes-app) tem, o
// config.json e a pasta dados/ são COPIADOS (a antiga fica intacta).
//
// Fluxo:
//   1. Licença (só no app empacotado normal E com `exigirLicenca: true` no
//      electron/config.js; hoje false, fase de testes): sem uma válida (online
//      ou grace), abre a telinha de ativação (electron/ativacao.html).
//   2. Configuração local (<userData>/config.json): sem ela, abre a janela de
//      primeira abertura (electron/primeiraAbertura.html), que grava a pasta
//      raiz dos projetos, o caminho do Claude Code e, se marcado, importa o
//      histórico da versão antiga.
//   3. Sobe o servidor (dist/root.js) num utilityProcess, grava a saída em
//      <userData>/logs/servidor.log e o religa se cair (2 s, 4 s, 8 s… até
//      30 s; 5 quedas em 2 min → para e mostra o erro).
//   4. Grava o cookie de acesso, espera /api/saude responder e carrega
//      http://127.0.0.1:<PORTA> na janela.
//   5. Atualização automática (só no app empacotado normal; electron/
//      atualizacao.js): ~10 s depois que a janela principal aparece e a cada
//      4 h, procura versão nova nas Releases públicas do GitHub
//      (Le3Dev/orquestrador-app), baixa em segundo plano e avisa a tela
//      (canal "atualizacao:estado"). A tela pergunta se reinicia agora; se
//      não, a versão baixada é instalada quando o app fecha.
//   6. Ao fechar o app, derruba a árvore inteira do servidor (os claude.exe
//      dos agentes morrem junto).
//
// Janela principal: titleBarStyle 'hidden' SEM titleBarOverlay — no Windows a
// barra e os botões nativos somem ("otherwise no window controls will be
// shown", doc do BaseWindowOptions), mas a borda, a sombra, o redimensionamento
// e o encaixe nas bordas da tela continuam (ao contrário de frame:false). A
// tela desenha a própria barra (área de arraste) e os botões ─ ☐ ✕ (IPC
// janela:*); o estado de maximizada chega por "janela:maximizada".
// Janelas de ativação e de configuração: pequenas e sem botão de fechar
// próprio, mantêm o titleBarOverlay (botões nativos na cor do tema).
//
// macOS (electron/mac.js, tudo atrás de process.platform === "darwin"): menu
// nativo (Cmd+C/V/Z/Q), PATH do shell de login (aberto pelo Finder ou pelo
// Dock), as 3 bolinhas nativas no lugar do overlay (na principal, centradas na
// barra de título do app), o `claude` do PATH na primeira abertura e nada de
// atualização automática (sem assinatura da Apple ela não funciona).

const {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  screen,
  session,
  shell,
  utilityProcess,
  WebContentsView,
} = require("electron");
const { capturarTela } = require("./capturaDeTela");
const { criarRespostaAoPedidoDeMidia, vemDaJanelaPrincipal } = require("./escutaDoModoInvisivel");
const { iniciarRastreioDoMouse } = require("./mouseDoModoInvisivel");
const { criarMaximizacao } = require("./maximizacao");
const { execFileSync, spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const { criarServicoDeAtualizacao, estadoInicial: estadoInicialDaAtualizacao } = require("./atualizacao");
const config = require("./config");
const licenca = require("./licenca");
const {
  copiarDaPastaAntiga,
  detectarClaudeCode,
  escolherPortaDaInstalacao,
  gravarConfiguracaoLocal,
  lerConfiguracaoLocal,
  sugerirPastaDosProjetos,
  validarConfiguracao,
} = require("./configuracaoLocal");
const { importarHistorico, localizarHistoricoAntigo } = require("./importacaoDoHistorico");
const { criarVistasDaPrevia } = require("./vistaDaPrevia");
// Ajustes só do macOS; fora dele cada função devolve o comportamento de antes.
const mac = require("./mac");

// Cores do tema escuro (web/src/theme/index.css): fundo e texto claro.
// COR_BARRA é o token --barra-de-titulo. O overlay (só nas janelas de ativação
// e de configuração) usa essas cores e essa altura.
const COR_BARRA = "#141413";
const COR_SIMBOLOS = "#faf9f5";
const ALTURA_DA_BARRA_DE_TITULO = 36;

const NOME_DO_COOKIE = "orquestrador_acesso";

// ──────────────────────────────────────────────────────────────────────────
// Modo de execução (decidido antes do `ready`).
// ──────────────────────────────────────────────────────────────────────────
// Build de teste: gerado por `npm run dist:win:teste`, com "buildDeTeste": true
// no package.json empacotado.
function lerPacoteDoApp() {
  try {
    return require(path.join(app.getAppPath(), "package.json"));
  } catch {
    return null;
  }
}
function lerBuildDeTeste() {
  const pacote = lerPacoteDoApp();
  return Boolean(pacote) && pacote.buildDeTeste === true;
}
const BUILD_DE_TESTE = lerBuildDeTeste();

// Licença exigida só no app empacotado normal E quando o config.js manda
// (`exigirLicenca: true`). Hoje está false (fase de testes com os devs): o app
// instalado abre sem chave. Mudar para true e publicar uma versão nova religa
// a licença em todos os apps instalados (chega pela atualização automática).
// Em desenvolvimento e no build de teste ela é sempre pulada para os testes de
// ponta a ponta rodarem sem chave nem internet. RISCO: um build de teste abre
// sem licença — ele não pode ser distribuído a clientes (fica em
// dist_electron_teste, separado do normal).
const EXIGE_LICENCA = app.isPackaged && !BUILD_DE_TESTE && config.exigirLicenca === true;

// Atualização automática só no app instalado normal: em desenvolvimento não há
// app-update.yml, e o build de teste nunca deve trocar a si mesmo por uma
// versão publicada. No Mac fica desligada: sem assinatura da Apple o
// electron-updater não instala a versão nova.
const ATUALIZACAO_ATIVA = app.isPackaged && !BUILD_DE_TESTE && !mac.ehMac;

// Pasta do usuário trocável só fora do app instalado normal (testes isolados).
// No instalado, ignorar evita que uma variável de ambiente esquecida desvie os
// dados e a licença para outra pasta.
const PODE_TROCAR_PASTA_DO_USUARIO = !app.isPackaged || BUILD_DE_TESTE;
const PASTA_DO_USUARIO_TROCADA = PODE_TROCAR_PASTA_DO_USUARIO && Boolean(process.env.ORQUESTRADOR_PASTA_DO_USUARIO);
// Antes da trava de instância única (ela é por pasta do usuário). Sem isso, o
// app instalado usaria "Orquestrador de Agentes" e o `electron .` usaria o
// nome do package.json — duas pastas, dois históricos.
const NOME_DA_PASTA_DE_DADOS = "Orquestrador de Agentes";
const NOME_DA_PASTA_ANTIGA = "orquestrador-agentes-app";
if (PASTA_DO_USUARIO_TROCADA) {
  app.setPath("userData", path.resolve(process.env.ORQUESTRADOR_PASTA_DO_USUARIO));
} else {
  app.setPath("userData", path.join(app.getPath("appData"), NOME_DA_PASTA_DE_DADOS));
}

// Desenvolvimento (`npm run desktop:dev`): a tela vem do Vite, que repassa /api
// ao servidor. Nunca aceito no app empacotado (não carregaria a tela de fora).
const URL_DA_TELA_DE_DESENVOLVIMENTO = !app.isPackaged ? process.env.ORQUESTRADOR_URL_DA_TELA || null : null;

// Valores fixos desta abertura do app: a mesma porta e a mesma chave valem até
// fechar, inclusive quando o servidor é religado.
const CHAVE_DE_ACESSO = crypto.randomBytes(32).toString("hex");
let PORTA = null;
// A porta a guardar no config.json (null quando veio de PORTA no ambiente).
let portaDaInstalacao = null;

const pastaDoUsuario = () => app.getPath("userData");
const pastaDeDados = () => path.join(pastaDoUsuario(), "dados");
const arquivoDeLog = () => path.join(pastaDoUsuario(), "logs", "servidor.log");
const caminhoDoServidor = () => path.join(app.getAppPath(), "dist", "root.js");
const urlDoServidor = () => `http://127.0.0.1:${PORTA}`;
const urlDaTela = () => URL_DA_TELA_DE_DESENVOLVIMENTO || urlDoServidor();

let janelaPrincipal = null;
let escutaManualLigada = false; // escuta ligada pelo botão, fora do modo invisível
let janelaAtivacao = null;
let janelaConfiguracao = null;
let modoDaConfiguracao = "primeira"; // "primeira" | "ajustes"
let avisoDaConfiguracao = null; // mostrado na janela de configuração ao abrir
let appFechando = false;
let salvandoConfiguracao = false;
let servicoDeAtualizacao = null; // criado no `ready` (prepararAtualizacao)

// ──────────────────────────────────────────────────────────────────────────
// Utilidades de arquivo.
// ──────────────────────────────────────────────────────────────────────────
function ehPasta(caminho) {
  try {
    return fs.statSync(caminho).isDirectory();
  } catch {
    return false;
  }
}

function ehArquivo(caminho) {
  try {
    return fs.statSync(caminho).isFile();
  } catch {
    return false;
  }
}

// Configuração local, ou null se ainda não existe / está ilegível.
function lerConfiguracaoSegura() {
  try {
    return lerConfiguracaoLocal(pastaDoUsuario());
  } catch (erro) {
    registrarNoLog("app", String(erro.message || erro));
    return null;
  }
}

function configuracaoCompleta(configuracao) {
  return Boolean(configuracao && configuracao.pastaRaizDosProjetos && configuracao.caminhoDoClaudeCode);
}

// ──────────────────────────────────────────────────────────────────────────
// Log do servidor: <userData>/logs/servidor.log, anexando, com horário.
// Passando de ~5 MB, o atual vira servidor.log.1 (o .1 anterior é descartado).
// ──────────────────────────────────────────────────────────────────────────
const LIMITE_DO_LOG = 5 * 1024 * 1024;
let tamanhoDoLog = null;

function horario() {
  const d = new Date();
  const dois = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())} ` +
    `${dois(d.getHours())}:${dois(d.getMinutes())}:${dois(d.getSeconds())}`
  );
}

function registrarNoLog(origem, texto) {
  const linhas = String(texto)
    .split(/\r?\n/)
    .filter((linha) => linha.length > 0);
  if (linhas.length === 0) return;
  const bloco = linhas.map((linha) => `${horario()} [${origem}] ${linha}`).join(os.EOL) + os.EOL;
  // Em desenvolvimento, espelha no terminal do `npm run desktop:dev`.
  if (!app.isPackaged) process.stdout.write(bloco);
  try {
    const arquivo = arquivoDeLog();
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    if (tamanhoDoLog === null) {
      tamanhoDoLog = fs.existsSync(arquivo) ? fs.statSync(arquivo).size : 0;
    }
    if (tamanhoDoLog > LIMITE_DO_LOG) {
      fs.rmSync(`${arquivo}.1`, { force: true });
      fs.renameSync(arquivo, `${arquivo}.1`);
      tamanhoDoLog = 0;
    }
    fs.appendFileSync(arquivo, bloco, "utf8");
    tamanhoDoLog += Buffer.byteLength(bloco);
  } catch {
    /* sem log não há onde avisar; o app segue */
  }
}

// Junta os pedaços do stdout/stderr em linhas inteiras antes de gravar.
function leitorDeLinhas(origem) {
  let resto = "";
  return {
    escrever(pedaco) {
      resto += pedaco.toString("utf8");
      const quebra = resto.lastIndexOf("\n");
      if (quebra < 0) return;
      registrarNoLog(origem, resto.slice(0, quebra));
      resto = resto.slice(quebra + 1);
    },
    finalizar() {
      if (resto) registrarNoLog(origem, resto);
      resto = "";
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Porta: fixa por instalação (config.json), ou a env PORTA. A tela guarda o
// layout e o zoom no localStorage, que é separado por origem (com a porta).
// ──────────────────────────────────────────────────────────────────────────
function portaLivre() {
  return new Promise((resolver, rejeitar) => {
    const provisorio = net.createServer();
    provisorio.unref();
    provisorio.on("error", rejeitar);
    provisorio.listen(0, "127.0.0.1", () => {
      const { port } = provisorio.address();
      provisorio.close(() => resolver(port));
    });
  });
}

// true quando dá para escutar na porta em 127.0.0.1 agora.
function portaEstaLivre(porta) {
  return new Promise((resolver) => {
    const provisorio = net.createServer();
    provisorio.unref();
    provisorio.once("error", () => resolver(false));
    provisorio.listen(porta, "127.0.0.1", () => provisorio.close(() => resolver(true)));
  });
}

async function escolherPorta() {
  const atual = lerConfiguracaoSegura();
  const escolha = await escolherPortaDaInstalacao({
    portaDoAmbiente: process.env.PORTA,
    portaGravada: atual ? atual.porta : null,
    estaLivre: portaEstaLivre,
    sortearPortaLivre: portaLivre,
  });
  if (escolha.origem === "ambiente") return escolha.porta;

  portaDaInstalacao = escolha.porta;
  if (escolha.origem === "gravada") return escolha.porta;
  if (escolha.origem === "trocada") {
    registrarNoLog(
      "app",
      `A porta ${escolha.anterior} estava ocupada; o servidor passa a usar a ${escolha.porta} (o layout salvo da tela antiga não vem junto).`,
    );
  } else {
    registrarNoLog("app", `Porta do servidor escolhida para esta instalação: ${escolha.porta}.`);
  }
  // Sem config.json ainda (primeira abertura), grava só a porta; os campos
  // vazios mantêm a janela de primeira abertura.
  gravarConfiguracaoLocal(pastaDoUsuario(), { ...(atual || {}), porta: escolha.porta });
  return escolha.porta;
}

// ──────────────────────────────────────────────────────────────────────────
// Servidor dentro do app (utilityProcess) com religamento.
// ──────────────────────────────────────────────────────────────────────────
const ESPERA_INICIAL_MS = 2_000;
const ESPERA_MAXIMA_MS = 30_000;
// Quedas demais em pouco tempo indicam um problema que religar não resolve
// (porta ocupada, build quebrado): melhor parar e mostrar o erro.
const JANELA_DE_QUEDAS_MS = 2 * 60_000;
const QUEDAS_PARA_DESISTIR = 5;

const servidor = {
  filho: null,
  quedas: [],
  desistiu: false,
  timerReligar: null,
};
// Processos que o próprio app mandou encerrar: a saída deles não é queda.
const encerramentosPedidos = new WeakSet();

function ambienteDoServidor(configuracao) {
  const ambiente = { ...process.env };
  // O app nunca libera o acesso pelo navegador.
  delete ambiente.ORQUESTRADOR_PERMITIR_NAVEGADOR;
  Object.assign(ambiente, {
    PORTA: String(PORTA),
    PASTA_DADOS: pastaDeDados(),
    PASTA_RAIZ_PROJETOS: configuracao.pastaRaizDosProjetos,
    CLAUDE_CODE_BIN: configuracao.caminhoDoClaudeCode,
    PASTA_DA_TELA: path.join(app.getAppPath(), "web", "dist"),
    ORQUESTRADOR_CHAVE_DE_ACESSO: CHAVE_DE_ACESSO,
  });
  // Só a URL do config.js vale; uma herdada do ambiente não é repassada.
  if (config.urlDeDownload) ambiente.ORQUESTRADOR_URL_DE_DOWNLOAD = config.urlDeDownload;
  else delete ambiente.ORQUESTRADOR_URL_DE_DOWNLOAD;
  return ambiente;
}

function subirServidor() {
  if (servidor.filho || appFechando) return;
  clearTimeout(servidor.timerReligar);
  servidor.timerReligar = null;

  const configuracao = lerConfiguracaoSegura();
  if (!configuracaoCompleta(configuracao)) {
    throw new Error("A configuração local está incompleta: abra os Ajustes e informe a pasta dos projetos e o Claude Code.");
  }
  const modulo = caminhoDoServidor();
  // fs.existsSync enxerga dentro do app.asar.
  if (!fs.existsSync(modulo)) {
    throw new Error(`O servidor não foi encontrado em "${modulo}". Rode "npm run build" antes de abrir o app.`);
  }

  fs.mkdirSync(pastaDeDados(), { recursive: true });
  const filho = utilityProcess.fork(modulo, [], {
    env: ambienteDoServidor(configuracao),
    // Nunca dentro do app.asar (o Electron não aceita cwd lá dentro).
    cwd: pastaDoUsuario(),
    // stdin só aceita "ignore"; stdout e stderr vão para o log.
    stdio: ["ignore", "pipe", "pipe"],
    serviceName: "Servidor do Orquestrador",
  });
  servidor.filho = filho;

  const saida = leitorDeLinhas("servidor");
  const erros = leitorDeLinhas("servidor:erro");
  if (filho.stdout) filho.stdout.on("data", (pedaco) => saida.escrever(pedaco));
  if (filho.stderr) filho.stderr.on("data", (pedaco) => erros.escrever(pedaco));

  filho.once("spawn", () => {
    registrarNoLog("app", `servidor em ${urlDoServidor()} (pid ${filho.pid})`);
  });

  filho.once("exit", (codigo) => {
    saida.finalizar();
    erros.finalizar();
    if (servidor.filho === filho) servidor.filho = null;
    if (appFechando || encerramentosPedidos.has(filho)) {
      registrarNoLog("app", `servidor encerrado (código ${codigo}).`);
      return;
    }
    aoCairOServidor(codigo);
  });
}

// Mesma regra do antigo vigia (scripts/manter-no-ar.cjs). Aqui qualquer saída
// não pedida pelo app é queda, inclusive código 0: o servidor só deve parar
// quando o app fecha.
function aoCairOServidor(codigo) {
  const agora = Date.now();
  servidor.quedas.push(agora);
  while (servidor.quedas.length > 0 && agora - servidor.quedas[0] > JANELA_DE_QUEDAS_MS) {
    servidor.quedas.shift();
  }
  if (servidor.quedas.length >= QUEDAS_PARA_DESISTIR) {
    servidor.desistiu = true;
    registrarNoLog(
      "app",
      `O servidor caiu ${servidor.quedas.length} vezes em 2 minutos (último código ${codigo}). Parei de religar.`,
    );
    mostrarErro(
      janelaPrincipal,
      "O servidor local caiu várias vezes seguidas.",
      `Parei de religar depois de ${QUEDAS_PARA_DESISTIR} quedas em 2 minutos. Feche e abra o app de novo; se continuar, veja os erros no log.`,
    );
    return;
  }
  const espera = Math.min(ESPERA_MAXIMA_MS, ESPERA_INICIAL_MS * 2 ** (servidor.quedas.length - 1));
  registrarNoLog("app", `O servidor caiu (código ${codigo}). Religando em ${espera / 1000}s…`);
  servidor.timerReligar = setTimeout(() => {
    try {
      subirServidor();
    } catch (erro) {
      registrarNoLog("app", `Falha ao religar o servidor: ${erro.message || erro}`);
      aoCairOServidor(codigo);
    }
  }, espera);
}

// Derruba o processo do servidor e TODOS os descendentes (os claude.exe dos
// agentes). No Windows, sem /T eles sobreviveriam ao servidor.
function encerrarArvore(filho, sincrono) {
  encerramentosPedidos.add(filho);
  const pid = filho.pid;
  try {
    if (process.platform === "win32" && pid) {
      const argumentos = ["/PID", String(pid), "/T", "/F"];
      if (sincrono) {
        // Síncrono ao fechar o app: o processo principal pode sair logo depois.
        execFileSync("taskkill", argumentos, { windowsHide: true, stdio: "ignore", timeout: 10_000 });
      } else {
        spawn("taskkill", argumentos, { windowsHide: true, stdio: "ignore" }).on("error", () => filho.kill());
      }
    } else {
      filho.kill();
    }
  } catch {
    // taskkill falha se o processo já saiu; garante pelo caminho do Electron.
    try {
      filho.kill();
    } catch {
      /* já encerrado */
    }
  }
}

// Para o servidor sem religar e espera a saída (usado ao trocar a configuração).
function pararServidor() {
  clearTimeout(servidor.timerReligar);
  servidor.timerReligar = null;
  const filho = servidor.filho;
  servidor.filho = null;
  if (!filho) return Promise.resolve();
  return new Promise((resolver) => {
    const limite = setTimeout(resolver, 10_000);
    filho.once("exit", () => {
      clearTimeout(limite);
      resolver();
    });
    encerrarArvore(filho, false);
  });
}

// Ao fechar o app, primeiro o servidor se desliga sozinho (mensagem
// "desligar"): cancela os turnos e encerra os processos que os agentes
// deixaram rodando (ADR-38). Só depois do limite, taskkill na árvore.
const ESPERA_DO_DESLIGAMENTO_MS = 8_000;
let desligamentoDoServidor = null;

function desligarServidorComCalma() {
  if (desligamentoDoServidor) return desligamentoDoServidor;
  appFechando = true;
  clearTimeout(servidor.timerReligar);
  servidor.timerReligar = null;
  const filho = servidor.filho;
  if (!filho) {
    desligamentoDoServidor = Promise.resolve();
    return desligamentoDoServidor;
  }
  desligamentoDoServidor = new Promise((resolver) => {
    const forcar = () => {
      filho.removeListener("exit", saiu);
      encerrarServidorAoFechar();
      resolver();
    };
    const limite = setTimeout(forcar, ESPERA_DO_DESLIGAMENTO_MS);
    function saiu() {
      clearTimeout(limite);
      resolver();
    }
    filho.once("exit", saiu);
    try {
      filho.postMessage({ tipo: "desligar" });
    } catch {
      clearTimeout(limite);
      forcar();
    }
  });
  return desligamentoDoServidor;
}

// Ao fechar o app: encerra de vez e não religa.
function encerrarServidorAoFechar() {
  appFechando = true;
  clearTimeout(servidor.timerReligar);
  servidor.timerReligar = null;
  const filho = servidor.filho;
  servidor.filho = null;
  if (filho) encerrarArvore(filho, true);
}

// Poll de /api/saude com o cookie (o servidor recusa requisições sem ele).
function esperarServidor(tentativas = 120, intervaloMs = 500) {
  return new Promise((resolver, rejeitar) => {
    let restam = tentativas;
    let ultimoProblema = "sem resposta";

    const tentar = () => {
      if (servidor.desistiu) {
        rejeitar(new Error("O servidor caiu várias vezes seguidas e não foi religado."));
        return;
      }
      let concluida = false;
      const falhou = (problema) => {
        if (concluida) return;
        concluida = true;
        ultimoProblema = problema;
        restam -= 1;
        if (restam <= 0) {
          rejeitar(new Error(`O servidor não respondeu em ${urlDoServidor()} a tempo (último problema: ${ultimoProblema}).`));
          return;
        }
        setTimeout(tentar, intervaloMs);
      };
      const requisicao = http.get(
        {
          host: "127.0.0.1",
          port: PORTA,
          path: "/api/saude",
          headers: { Cookie: `${NOME_DO_COOKIE}=${CHAVE_DE_ACESSO}` },
          agent: false,
        },
        (resposta) => {
          resposta.resume();
          if (resposta.statusCode === 200) {
            concluida = true;
            resolver();
          } else {
            falhou(`HTTP ${resposta.statusCode}`);
          }
        },
      );
      requisicao.on("error", (erro) => falhou(erro.code || erro.message));
      requisicao.setTimeout(2_000, () => requisicao.destroy(new Error("tempo esgotado")));
    };
    tentar();
  });
}

// Cookie de acesso, gravado antes de carregar a tela. Sem data de expiração:
// vale só enquanto o app está aberto.
async function gravarCookieDeAcesso() {
  const urls = [urlDoServidor()];
  if (URL_DA_TELA_DE_DESENVOLVIMENTO) urls.push(new URL(URL_DA_TELA_DE_DESENVOLVIMENTO).origin);
  for (const url of urls) {
    await session.defaultSession.cookies.set({
      url,
      name: NOME_DO_COOKIE,
      value: CHAVE_DE_ACESSO,
      httpOnly: true,
      sameSite: "strict",
    });
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Página de erro (sem servidor não há tela).
// ──────────────────────────────────────────────────────────────────────────
function escaparHtml(texto) {
  return String(texto).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

async function mostrarErro(janela, titulo, detalhe) {
  if (!janela || janela.isDestroyed()) return;
  const html =
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escaparHtml(titulo)}</title>` +
    `<style>:root{--bg:${COR_BARRA};--texto:${COR_SIMBOLOS}}` +
    `body{background:var(--bg);color:var(--texto);font-family:system-ui,"Segoe UI",sans-serif;padding:56px 40px;line-height:1.5}` +
    `code{font-family:ui-monospace,"Cascadia Mono",monospace;user-select:all;word-break:break-all}</style></head>` +
    `<body><h2>${escaparHtml(titulo)}</h2><p>${escaparHtml(detalhe)}</p>` +
    `<p>Log do servidor: <code>${escaparHtml(arquivoDeLog())}</code></p></body></html>`;
  try {
    await janela.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  } catch {
    /* janela fechada no meio */
  }
  if (!janela.isDestroyed() && !janela.isVisible()) janela.show();
}

// ──────────────────────────────────────────────────────────────────────────
// Atualização automática (electron/atualizacao.js + electron-updater).
// ──────────────────────────────────────────────────────────────────────────
// Releases públicas do GitHub (build.publish no package.json → app-update.yml
// dentro do app instalado). Sem assinatura digital: sem `publisherName` no
// app-update.yml, o electron-updater pula a verificação de assinatura.
function enviarEstadoDaAtualizacao(estado) {
  const janela = janelaPrincipal;
  if (!janela || janela.isDestroyed() || janela.webContents.isDestroyed()) return;
  janela.webContents.send("atualizacao:estado", estado);
}

// O electron-updater só é carregado no app instalado normal; fora dele o
// serviço fica inativo ("indisponivel").
function prepararAtualizacao() {
  let atualizador = null;
  if (ATUALIZACAO_ATIVA) {
    try {
      ({ autoUpdater: atualizador } = require("electron-updater"));
      atualizador.logger = {
        info: (texto) => registrarNoLog("atualizacao", texto),
        warn: (texto) => registrarNoLog("atualizacao", `aviso: ${texto}`),
        error: (texto) => registrarNoLog("atualizacao", `erro: ${texto}`),
      };
      atualizador.autoDownload = true; // baixa sozinho em segundo plano
      atualizador.autoInstallOnAppQuit = true; // fechar o app instala a versão baixada
      atualizador.allowPrerelease = false;
      // Instalador NSIS completo (não o web installer): sem isso o
      // electron-updater só enche o log com um aviso a cada download.
      atualizador.disableWebInstaller = true;
    } catch (erro) {
      registrarNoLog("atualizacao", `Atualização automática desligada: ${erro.message || erro}`);
      atualizador = null;
    }
  }
  servicoDeAtualizacao = criarServicoDeAtualizacao({
    atualizador,
    versaoAtual: app.getVersion(),
    ativo: atualizador !== null,
    registrar: (texto) => registrarNoLog("atualizacao", texto),
    aoMudar: enviarEstadoDaAtualizacao,
  });
}

function estadoDaAtualizacao() {
  return servicoDeAtualizacao ? servicoDeAtualizacao.obter() : estadoInicialDaAtualizacao(app.getVersion(), false);
}

// Se a instalação não chegou a disparar depois de o servidor ser encerrado,
// religa o servidor e recarrega a tela (o app continua aberto).
async function retomarAposFalhaNaInstalacao() {
  registrarNoLog("atualizacao", "A instalação não começou; religando o servidor.");
  appFechando = false;
  servidor.quedas = [];
  servidor.desistiu = false;
  if (janelaPrincipal && !janelaPrincipal.isDestroyed()) await carregarTela(janelaPrincipal);
}

// ──────────────────────────────────────────────────────────────────────────
// Janelas.
// ──────────────────────────────────────────────────────────────────────────
function abrirNoNavegador(url) {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
}

// `botoesNativos`: as janelas pequenas (ativação, configuração) não desenham
// botões próprios e ficam com o overlay nativo; a principal desenha os seus.
// No Mac todas usam as bolinhas nativas (mac.ajustarOpcoesDaJanela).
function criarJanela({ botoesNativos = true, transparente = false, ...opcoes } = {}) {
  const janela = new BrowserWindow(mac.ajustarOpcoesDaJanela({
    title: config.productName,
    // A principal é transparente desde a criação (o Windows não aceita mudar
    // depois); o fundo opaco do modo normal vem do CSS.
    ...(transparente ? { transparent: true, backgroundColor: "#00000000" } : { backgroundColor: COR_BARRA }),
    autoHideMenuBar: true,
    titleBarStyle: "hidden",
    ...(botoesNativos
      ? {
          titleBarOverlay: {
            color: COR_BARRA,
            symbolColor: COR_SIMBOLOS,
            height: ALTURA_DA_BARRA_DE_TITULO,
          },
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    // Mascote do app (gerado por `npm run icones`); sem ele, aparece o átomo do Electron.
    icon: path.join(__dirname, "icones", process.platform === "win32" ? "icone.ico" : "icone.png"),
    ...opcoes,
  }, !botoesNativos));
  // Links externos abrem no navegador do sistema, não dentro do app.
  janela.webContents.setWindowOpenHandler(({ url }) => {
    abrirNoNavegador(url);
    return { action: "deny" };
  });
  return janela;
}

function focar(janela) {
  if (!janela || janela.isDestroyed()) return;
  if (janela.isMinimized()) janela.restore();
  janela.focus();
}

function abrirJanelaAtivacao() {
  if (janelaAtivacao) return focar(janelaAtivacao);
  janelaAtivacao = criarJanela({ width: 520, height: 560, resizable: false });
  janelaAtivacao.loadFile(path.join(__dirname, "ativacao.html"));
  janelaAtivacao.on("closed", () => {
    janelaAtivacao = null;
  });
}

// "primeira": sem config.json; "ajustes": aberta pela tela (configuracao.abrirAjustes).
function abrirJanelaDeConfiguracao(modo, aviso = null) {
  if (janelaConfiguracao) return focar(janelaConfiguracao);
  modoDaConfiguracao = modo;
  avisoDaConfiguracao = aviso;
  const comoAjustes = modo === "ajustes" && janelaPrincipal && !janelaPrincipal.isDestroyed();
  janelaConfiguracao = criarJanela({
    width: 600,
    height: 660,
    resizable: false,
    ...(comoAjustes ? { parent: janelaPrincipal, modal: true } : {}),
  });
  janelaConfiguracao.loadFile(path.join(__dirname, "primeiraAbertura.html"));
  janelaConfiguracao.on("closed", () => {
    janelaConfiguracao = null;
  });
}

// Sobe o servidor (se preciso), espera e carrega a tela; erro → página de erro.
async function carregarTela(janela) {
  try {
    await gravarCookieDeAcesso();
    subirServidor();
    await esperarServidor();
    if (!janela.isDestroyed()) await janela.loadURL(urlDaTela());
  } catch (erro) {
    registrarNoLog("app", `Não foi possível abrir a tela: ${erro.message || erro}`);
    await mostrarErro(janela, "Não foi possível iniciar o servidor local.", String(erro.message || erro));
  }
}

async function abrirJanelaPrincipal() {
  if (janelaPrincipal) return focar(janelaPrincipal);
  const janela = criarJanela({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    botoesNativos: false,
    transparente: true,
  });
  janelaPrincipal = janela;
  janela.on("close", () => sairDoModoInvisivel());
  // Página recarregou/travou: o estado React volta a "normal", então o main
  // também precisa sair do modo invisível (senão o usuário fica preso).
  janela.webContents.on("did-start-navigation", (evento, _url, mesmoDoc, ehFramePrincipal) => {
    const principal = evento?.isMainFrame ?? ehFramePrincipal;
    const mesmo = evento?.isSameDocument ?? mesmoDoc;
    if (principal && !mesmo && modoInvisivel?.janela === janela) sairDoModoInvisivel();
    // A tela recarregou: o estado React da escuta manual voltou a "desligada".
    if (principal && !mesmo) escutaManualLigada = false;
  });
  janela.webContents.on("render-process-gone", () => {
    escutaManualLigada = false;
    if (modoInvisivel?.janela === janela) sairDoModoInvisivel();
  });
  janela.on("closed", () => {
    escutaManualLigada = false;
    if (janelaPrincipal === janela) janelaPrincipal = null;
  });
  vistasDaPrevia.anexar(janela);
  maximizacoes.set(
    janela,
    criarMaximizacao(janela, screen, (maximizada) => {
      if (janela.isDestroyed() || janela.webContents.isDestroyed()) return;
      janela.webContents.send("janela:maximizada", maximizada);
    }),
  );
  // Primeira verificação de atualização ~10 s depois que a janela aparece
  // (iniciar() só agenda uma vez por abertura do app).
  janela.once("show", () => {
    if (servicoDeAtualizacao) servicoDeAtualizacao.iniciar();
  });

  // A tela só navega dentro da própria origem; o resto vai para o navegador.
  const origemDaTela = new URL(urlDaTela()).origin;
  janela.webContents.on("will-navigate", (evento, url) => {
    let origem = null;
    try {
      origem = new URL(url).origin;
    } catch {
      /* URL inválida: bloqueia */
    }
    if (origem !== origemDaTela) {
      evento.preventDefault();
      abrirNoNavegador(url);
    }
  });

  await carregarTela(janela);
  if (!janela.isDestroyed()) janela.show();
}

// Depois da licença: primeira abertura, ajustes (se a pasta dos projetos ou o
// claude.exe gravados sumiram) ou direto para a tela.
async function seguirAposLicenca() {
  const configuracao = lerConfiguracaoSegura();
  if (!configuracaoCompleta(configuracao)) {
    abrirJanelaDeConfiguracao("primeira");
    return;
  }
  const erros = validarConfiguracao(configuracao, { ehPasta, ehArquivo });
  if (erros.length > 0) {
    registrarNoLog("app", `Configuração local inválida: ${erros.join(" ")}`);
    abrirJanelaDeConfiguracao("ajustes", `${erros.join("\n")}\nCorrija e salve para abrir o app.`);
    return;
  }
  await abrirJanelaPrincipal();
}

async function abrirConformeEstado() {
  if (EXIGE_LICENCA) {
    let liberado = false;
    try {
      ({ liberado } = await licenca.liberadoParaAbrir());
    } catch (erro) {
      registrarNoLog("app", `Falha ao verificar a licença: ${erro.message || erro}`);
    }
    if (!liberado) {
      abrirJanelaAtivacao();
      return;
    }
  }
  await seguirAposLicenca();
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
  const m = maximizacoes.get(j);
  if (m) return m.alternar();
  if (j.isMaximized()) j.unmaximize();
  else j.maximize();
});
ipcMain.handle("janela:fechar", (e) => janelaDoEvento(e)?.close());
ipcMain.handle("janela:esta-maximizada", (e) => {
  const j = janelaDoEvento(e);
  if (!j) return false;
  return maximizacoes.get(j)?.estaMaximizada() ?? j.isMaximized();
});

// A janela principal é transparente, então maximiza "na mão" (electron/maximizacao.js),
// que também avisa a tela ("janela:maximizada") para o botão trocar o ícone.
const maximizacoes = new WeakMap();

// ──────────────────────────────────────────────────────────────────────────
// IPC — licença. Após ativar com sucesso, segue para a configuração/tela.
// ──────────────────────────────────────────────────────────────────────────
ipcMain.handle("licenca:activate", async (_e, chave) => {
  const resultado = await licenca.activate(chave);
  if (resultado.ok) {
    await seguirAposLicenca();
    if (janelaAtivacao) janelaAtivacao.close();
  }
  return resultado;
});
ipcMain.handle("licenca:validate", () => licenca.validate());
ipcMain.handle("licenca:deactivate", () => licenca.deactivate());
ipcMain.handle("licenca:status", () => licenca.status());

// ──────────────────────────────────────────────────────────────────────────
// Vista nativa da prévia (electron/vistaDaPrevia.js): endereços externos num
// WebContentsView com a sessão `persist:previa`. Os IPC só valem se vierem do
// quadro principal da janela principal.
// ──────────────────────────────────────────────────────────────────────────
const vistasDaPrevia = criarVistasDaPrevia({
  WebContentsView,
  session,
  shell,
  janelaPrincipal: () => janelaPrincipal,
  eDaJanelaPrincipal: (evento) =>
    Boolean(janelaPrincipal) &&
    !janelaPrincipal.isDestroyed() &&
    evento.sender === janelaPrincipal.webContents &&
    evento.senderFrame === janelaPrincipal.webContents.mainFrame,
  bloqueada: () => modoInvisivel !== null,
  nomeDoApp: app.getName(),
  registrar: (texto) => registrarNoLog("previa", texto),
});

ipcMain.handle("previa:abrir", (evento, dados) => vistasDaPrevia.aoAbrir(evento, dados));
ipcMain.on("previa:retangulo", (evento, dados) => vistasDaPrevia.aoMoverRetangulo(evento, dados));
ipcMain.handle("previa:ativar", (evento, dados) => vistasDaPrevia.aoAtivar(evento, dados));
ipcMain.handle("previa:recarregar", (evento, dados) => vistasDaPrevia.aoRecarregar(evento, dados));
ipcMain.handle("previa:voltar", (evento, dados) => vistasDaPrevia.aoVoltar(evento, dados));
ipcMain.handle("previa:avancar", (evento, dados) => vistasDaPrevia.aoAvancar(evento, dados));
ipcMain.handle("previa:fechar", (evento, dados) => vistasDaPrevia.aoFechar(evento, dados));
ipcMain.handle("previa:sair-das-contas", (evento) => vistasDaPrevia.aoSairDasContas(evento));

// ──────────────────────────────────────────────────────────────────────────
// IPC — atualização automática (tela principal). Fora do app instalado,
// obter/verificar devolvem situacao "indisponivel" com a versão atual.
// ──────────────────────────────────────────────────────────────────────────
function exigirJanelaPrincipal(evento) {
  if (!janelaPrincipal || janelaPrincipal.isDestroyed() || evento.sender !== janelaPrincipal.webContents) {
    throw new Error("Operação permitida só na janela principal.");
  }
}

ipcMain.handle("atualizacao:obter", () => estadoDaAtualizacao());
// Dispara a verificação e devolve o estado logo em seguida (não espera o download).
ipcMain.handle("atualizacao:verificar", () => {
  if (!servicoDeAtualizacao) return estadoDaAtualizacao();
  try {
    return servicoDeAtualizacao.verificar({ manual: true });
  } catch (erro) {
    registrarNoLog("atualizacao", `Falha ao verificar a atualização: ${erro.message || erro}`);
    return estadoDaAtualizacao();
  }
});
// Só na situação "pronta": encerra o servidor e instala em silêncio, reabrindo
// o app depois. Em qualquer outra situação não faz nada.
ipcMain.handle("atualizacao:instalar-agora", async (evento) => {
  exigirJanelaPrincipal(evento);
  if (!servicoDeAtualizacao) return;
  let servidorEncerrado = false;
  const disparou = servicoDeAtualizacao.instalarAgora({
    antesDeInstalar: () => {
      servidorEncerrado = true;
      encerrarServidorAoFechar();
    },
  });
  if (!disparou && servidorEncerrado) await retomarAposFalhaNaInstalacao();
});

// ──────────────────────────────────────────────────────────────────────────
// Modo invisível da janela principal: fundo transparente, sempre no topo,
// fora de capturas de tela, cliques passando para os apps atrás (a tela liga
// a captura de mouse só sobre seus controles). Sai com Ctrl+Shift+I.
//
// A janela principal já nasce `transparent: true`; o fundo opaco do modo
// normal vem do CSS (html/body/#root), e o modo invisível só o torna transparente.
// ──────────────────────────────────────────────────────────────────────────
const ATALHO_DO_MODO_INVISIVEL = "CommandOrControl+Shift+I";
const ATALHO_CAPTURAR_AGORA = "CommandOrControl+Shift+S";
let modoInvisivel = null; // { janela, anterior } enquanto ativo

// Atalho global: não rouba o foco do app de trás; manda o quadro à tela.
async function capturarAgoraPorAtalho() {
  const atual = modoInvisivel;
  if (!atual) return;
  try {
    const captura = await capturarQuadroAtual();
    if (atual.janela && !atual.janela.isDestroyed()) {
      atual.janela.webContents.send("modo-invisivel:quadro-capturado", captura);
    }
  } catch (erro) {
    registrarNoLog("captura", `Falha ao capturar pelo atalho: ${erro.message || erro}`);
  }
}

function avisarModoInvisivel(janela, ativo) {
  if (janela && !janela.isDestroyed()) janela.webContents.send("modo-invisivel:estado", ativo);
}

function entrarNoModoInvisivel() {
  if (modoInvisivel || !janelaPrincipal || janelaPrincipal.isDestroyed()) return;
  const janela = janelaPrincipal;
  const anterior = {
    bounds: janela.getBounds(),
    maximizada: maximizacoes.get(janela)?.estaMaximizada() ?? janela.isMaximized(),
    alwaysOnTop: janela.isAlwaysOnTop(),
    skipTaskbar: false, // a janela principal nunca nasce com skipTaskbar (o Electron não tem getter)
  };
  modoInvisivel = { janela, anterior };
  // A vista nativa da prévia é uma camada por cima da tela: some no modo invisível.
  vistasDaPrevia.desativarTodas();
  // Maximizada fica como está (cobre o monitor); os bounds só são restaurados se não estava.
  janela.setAlwaysOnTop(true, "screen-saver");
  janela.setContentProtection(true);
  // Some da barra de tarefas; no Windows o Alt+Tab acompanha o skipTaskbar na maioria dos casos
  // (não há API JS dedicada para janela-ferramenta sem módulo nativo).
  janela.setSkipTaskbar(true);
  janela.setIgnoreMouseEvents(true, { forward: true });
  // O encaminhamento de mouse do Electron não entrega mouseenter no Windows: o main
  // decide pela posição do cursor se a janela recebe o clique (ver mouseDoModoInvisivel.js).
  modoInvisivel.rastreio = iniciarRastreioDoMouse({ janela, screen });
  modoInvisivel.rastreio.definir(false);
  try {
    if (!globalShortcut.register(ATALHO_DO_MODO_INVISIVEL, sairDoModoInvisivel)) {
      registrarNoLog("app", "Não foi possível registrar o atalho do modo invisível.");
    }
  } catch (erro) {
    registrarNoLog("app", `Falha ao registrar o atalho do modo invisível: ${erro.message || erro}`);
  }
  try {
    if (!globalShortcut.register(ATALHO_CAPTURAR_AGORA, capturarAgoraPorAtalho)) {
      registrarNoLog("app", "Não foi possível registrar o atalho de capturar agora.");
    }
  } catch (erro) {
    registrarNoLog("app", `Falha ao registrar o atalho de capturar agora: ${erro.message || erro}`);
  }
  registrarNoLog("app", "Modo invisível ligado.");
  avisarModoInvisivel(janela, true);
}

function sairDoModoInvisivel() {
  if (!modoInvisivel) return;
  const { janela, anterior, rastreio } = modoInvisivel;
  modoInvisivel = null;
  if (rastreio) rastreio.parar();
  try {
    globalShortcut.unregister(ATALHO_DO_MODO_INVISIVEL);
    globalShortcut.unregister(ATALHO_CAPTURAR_AGORA);
  } catch {
    /* ignora */
  }
  if (janela.isDestroyed()) return;
  janela.setIgnoreMouseEvents(false);
  janela.setContentProtection(false);
  janela.setSkipTaskbar(anterior.skipTaskbar);
  janela.setAlwaysOnTop(anterior.alwaysOnTop);
  const maximizadaAgora = maximizacoes.get(janela)?.estaMaximizada() ?? janela.isMaximized();
  if (!anterior.maximizada && !maximizadaAgora) janela.setBounds(anterior.bounds);
  registrarNoLog("app", "Modo invisível desligado.");
  avisarModoInvisivel(janela, false);
}

ipcMain.handle("modo-invisivel:entrar", (evento) => {
  exigirJanelaPrincipal(evento);
  entrarNoModoInvisivel();
});
ipcMain.handle("modo-invisivel:sair", (evento) => {
  exigirJanelaPrincipal(evento);
  sairDoModoInvisivel();
});
// A tela consulta ao montar (o ChatRapido remonta ao alternar fixo/flutuante e
// perderia o estado, que antes só chegava pelo aviso "modo-invisivel:estado").
ipcMain.handle("modo-invisivel:consultar", (evento) => {
  exigirJanelaPrincipal(evento);
  return modoInvisivel !== null;
});
ipcMain.handle("modo-invisivel:capturar-mouse", (evento, capturar) => {
  exigirJanelaPrincipal(evento);
  if (!modoInvisivel) return;
  // O rastreio pelo cursor é quem decide; o pedido da tela só o mantém em sincronia.
  modoInvisivel.rastreio.definir(capturar);
});
function capturarQuadroAtual() {
  if (!modoInvisivel) throw new Error("A captura de tela só funciona com o modo invisível ativo.");
  return capturarTela({
    desktopCapturer,
    screen,
    janela: modoInvisivel.janela,
    janelaProtegida: process.platform === "win32" || process.platform === "darwin",
    registrar: (texto) => registrarNoLog("captura", texto),
  });
}
ipcMain.handle("tela:capturar", (evento) => {
  exigirJanelaPrincipal(evento);
  return capturarQuadroAtual();
});
ipcMain.handle("modo-invisivel:capturar-agora", (evento) => {
  exigirJanelaPrincipal(evento);
  return capturarQuadroAtual();
});
app.on("will-quit", () => {
  sairDoModoInvisivel();
  globalShortcut.unregisterAll();
});

// Escuta no modo invisível (electron/escutaDoModoInvisivel.js): responde ao
// getDisplayMedia da tela principal com a tela do monitor da janela e o áudio
// do sistema ("loopback", só no Windows). Recusa todo o resto. Sem permission
// handlers: o getUserMedia do microfone (ditado) segue o padrão do Electron.
// Escuta ligada pelo botão da tela, fora do modo invisível. Só o frame
// principal da janela principal pode ligar/desligar.
ipcMain.handle("escuta:definir-ligada", (evento, ligada) => {
  exigirJanelaPrincipal(evento);
  if (!vemDaJanelaPrincipal(evento.senderFrame, janelaPrincipal)) {
    throw new Error("Operação permitida só no frame principal da janela principal.");
  }
  escutaManualLigada = ligada === true;
});
function registrarEscutaDoModoInvisivel() {
  try {
    session.defaultSession.setDisplayMediaRequestHandler(
      criarRespostaAoPedidoDeMidia({
        desktopCapturer,
        screen,
        obterJanelaPrincipal: () => janelaPrincipal,
        modoInvisivelAtivo: () => modoInvisivel !== null,
        escutaManualLigada: () => escutaManualLigada,
        plataforma: process.platform,
        registrar: (texto) => registrarNoLog("escuta", texto),
      }),
      // O seletor do sistema (só macOS 15+) ignoraria o handler; aqui não é usado.
      { useSystemPicker: false },
    );
  } catch (erro) {
    registrarNoLog("escuta", `Falha ao registrar a escuta do modo invisível: ${erro.message || erro}`);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// IPC — configuração (usado pela tela principal).
// ──────────────────────────────────────────────────────────────────────────
ipcMain.handle("configuracao:obter", () => {
  const atual = lerConfiguracaoSegura();
  return {
    pastaRaizDosProjetos: atual ? atual.pastaRaizDosProjetos : "",
    caminhoDoClaudeCode: atual ? atual.caminhoDoClaudeCode : "",
  };
});
ipcMain.handle("configuracao:abrir-ajustes", () => {
  abrirJanelaDeConfiguracao("ajustes");
});

// ──────────────────────────────────────────────────────────────────────────
// IPC — janela de primeira abertura / ajustes. Só aceito dessa janela: a tela
// principal não grava configuração nem dispara importações.
// ──────────────────────────────────────────────────────────────────────────
function exigirJanelaDeConfiguracao(evento) {
  if (!janelaConfiguracao || evento.sender !== janelaConfiguracao.webContents) {
    throw new Error("Operação permitida só na janela de configuração.");
  }
}

function historicoParaImportar(atual) {
  if (atual && atual.historicoImportadoDe) return null;
  const encontrado = localizarHistoricoAntigo({
    empacotado: app.isPackaged,
    pastaDoApp: app.getAppPath(),
    ambiente: process.env,
    destinoDados: pastaDeDados(),
  });
  return encontrado || (app.isPackaged ? mac.historicoDoRepositorio(lerPacoteDoApp(), ehPasta) : null);
}

ipcMain.handle("primeira-abertura:carregar", (e) => {
  exigirJanelaDeConfiguracao(e);
  const atual = lerConfiguracaoSegura();
  return {
    modo: modoDaConfiguracao,
    aviso: avisoDaConfiguracao,
    pastaRaizDosProjetos:
      (atual && atual.pastaRaizDosProjetos) || sugerirPastaDosProjetos(process.env, ehPasta) || "",
    caminhoDoClaudeCode: (atual && atual.caminhoDoClaudeCode) || detectarClaudeCode(process.env, ehArquivo) || mac.claudeCodeDoPath(ehArquivo) || "",
    historicoAntigo: historicoParaImportar(atual),
  };
});

ipcMain.handle("primeira-abertura:escolher-pasta", async (e, atual) => {
  exigirJanelaDeConfiguracao(e);
  const resultado = await dialog.showOpenDialog(janelaConfiguracao, {
    title: "Pasta raiz dos projetos",
    properties: ["openDirectory"],
    defaultPath: typeof atual === "string" && ehPasta(atual) ? atual : undefined,
  });
  return resultado.canceled ? null : resultado.filePaths[0] || null;
});

ipcMain.handle("primeira-abertura:escolher-claude-code", async (e, atual) => {
  exigirJanelaDeConfiguracao(e);
  const resultado = await dialog.showOpenDialog(janelaConfiguracao, {
    title: "Onde está o Claude Code (claude.exe)",
    // No Mac o ~/.local/bin, onde o instalador põe o `claude`, é oculto.
    properties: mac.ehMac ? ["openFile", "showHiddenFiles"] : ["openFile"],
    defaultPath: typeof atual === "string" && ehArquivo(atual) ? atual : undefined,
    filters:
      process.platform === "win32"
        ? [
            { name: "Claude Code", extensions: ["exe"] },
            { name: "Todos os arquivos", extensions: ["*"] },
          ]
        : [],
  });
  return resultado.canceled ? null : resultado.filePaths[0] || null;
});

ipcMain.handle("primeira-abertura:salvar", async (e, dados) => {
  exigirJanelaDeConfiguracao(e);
  if (salvandoConfiguracao) return { ok: false, erros: ["Já estou salvando, aguarde."] };
  const entrada = dados && typeof dados === "object" ? dados : {};
  const erros = validarConfiguracao(entrada, { ehPasta, ehArquivo });
  if (erros.length > 0) return { ok: false, erros };

  salvandoConfiguracao = true;
  const janelaDaConfiguracao = janelaConfiguracao;
  const reconfigurando = Boolean(janelaPrincipal);
  try {
    const anterior = lerConfiguracaoSegura();
    let historicoImportadoDe = anterior ? anterior.historicoImportadoDe : null;

    // Com o servidor parado, nada grava nos dados enquanto a cópia acontece.
    if (reconfigurando) await pararServidor();

    if (entrada.importarHistorico === true) {
      // A origem é recalculada aqui: o main não confia num caminho vindo da tela.
      const origem = historicoParaImportar(anterior);
      if (origem) {
        const resumo = importarHistorico(origem, pastaDeDados());
        historicoImportadoDe = origem;
        registrarNoLog(
          "app",
          `Histórico importado de ${origem}: ${resumo.arquivosCopiados} arquivo(s) em ` +
            `${resumo.pastas.join(", ") || "nenhuma pasta"}; ${resumo.ignorados.length} já existiam e foram mantidos.`,
        );
      }
    }

    gravarConfiguracaoLocal(pastaDoUsuario(), {
      pastaRaizDosProjetos: entrada.pastaRaizDosProjetos,
      caminhoDoClaudeCode: entrada.caminhoDoClaudeCode,
      historicoImportadoDe,
      porta: (anterior && anterior.porta) || portaDaInstalacao,
    });

    if (reconfigurando) {
      // Mesma porta e mesma chave: a tela só precisa recarregar.
      servidor.quedas = [];
      servidor.desistiu = false;
      if (janelaPrincipal) await carregarTela(janelaPrincipal);
    } else {
      await abrirJanelaPrincipal();
    }
    if (janelaDaConfiguracao && !janelaDaConfiguracao.isDestroyed()) janelaDaConfiguracao.close();
    return { ok: true };
  } catch (erro) {
    registrarNoLog("app", `Falha ao salvar a configuração: ${erro.message || erro}`);
    // Se o servidor foi parado para reconfigurar, volta com o que estiver gravado.
    if (reconfigurando && !servidor.filho) {
      try {
        subirServidor();
      } catch {
        /* a página de erro da tela principal aparece no próximo carregamento */
      }
    }
    return { ok: false, erros: [`Não foi possível salvar: ${erro.message || erro}`] };
  } finally {
    salvandoConfiguracao = false;
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Ciclo de vida.
// ──────────────────────────────────────────────────────────────────────────
// Instância única (por pasta do usuário): um segundo lançamento foca a janela
// já aberta.
// Dados da pasta antiga (`electron .` antes da pasta única): copiados uma vez.
function trazerDadosDaPastaAntiga() {
  if (PASTA_DO_USUARIO_TROCADA) return;
  try {
    const resumo = copiarDaPastaAntiga({
      pastaNova: pastaDoUsuario(),
      pastaAntiga: path.join(app.getPath("appData"), NOME_DA_PASTA_ANTIGA),
    });
    if (resumo) {
      registrarNoLog(
        "app",
        `Copiados de ${resumo.de} para ${resumo.para}: config.json${resumo.copiouDados ? " e dados/" : ""}. A pasta antiga foi mantida.`,
      );
    }
  } catch (erro) {
    registrarNoLog("app", `Falha ao copiar os dados da pasta antiga: ${erro.message || erro}`);
  }
}

const conseguiuLock = app.requestSingleInstanceLock();
if (!conseguiuLock) {
  app.quit();
} else {
  trazerDadosDaPastaAntiga();

  app.on("second-instance", () => {
    focar(janelaPrincipal || janelaConfiguracao || janelaAtivacao);
  });

  app.whenReady().then(async () => {
    // Mesmo appId do atalho do instalador: a barra de tarefas agrupa e mostra o ícone do app.
    if (process.platform === "win32") app.setAppUserModelId(config.appId);
    // Remove File/Edit/View/Window. No Mac o menu é quem faz Cmd+C/Cmd+V
    // funcionarem: volta só com o essencial (fora dele menuDoApp devolve null).
    Menu.setApplicationMenu(mac.menuDoApp(Menu, config.productName));
    // Antes de subir o servidor e da primeira abertura (que procura o `claude`).
    mac.carregarPathDoShell();
    // No Mac o ícone da janela não vale: o do Dock vem daqui fora do app empacotado.
    if (mac.ehMac && app.dock) app.dock.setIcon(path.join(__dirname, "icones", "icone.png"));
    licenca.iniciar(pastaDoUsuario());
    // Antes de abrir a janela principal (a sessão só existe depois do ready).
    registrarEscutaDoModoInvisivel();
    // Sem atualização o app ainda abre: a falha só vai para o log.
    try {
      prepararAtualizacao();
    } catch (erro) {
      registrarNoLog("atualizacao", `Falha ao preparar a atualização automática: ${erro.message || erro}`);
    }
    try {
      PORTA = await escolherPorta();
    } catch (erro) {
      dialog.showErrorBox(config.productName, `Não foi possível reservar uma porta local: ${erro.message || erro}`);
      app.quit();
      return;
    }
    try {
      await abrirConformeEstado();
    } catch (erro) {
      registrarNoLog("app", `Falha ao abrir o app: ${erro.message || erro}`);
      dialog.showErrorBox(config.productName, `Não foi possível abrir o app: ${erro.message || erro}`);
      app.quit();
      return;
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) abrirConformeEstado();
    });
  });

  app.on("window-all-closed", () => {
    // No macOS o app continua vivo sem janelas; o before-quit encerra depois.
    if (process.platform === "darwin") return;
    app.quit();
  });

  // Segura o fechamento até o servidor se desligar (ou o limite passar); as
  // janelas somem na hora. O "quit" fica como garantia.
  let servidorDesligado = false;
  app.on("before-quit", (evento) => {
    if (servidorDesligado || !servidor.filho) {
      encerrarServidorAoFechar();
      return;
    }
    evento.preventDefault();
    for (const janela of BrowserWindow.getAllWindows()) janela.hide();
    desligarServidorComCalma().finally(() => {
      servidorDesligado = true;
      app.quit();
    });
  });
  app.on("quit", encerrarServidorAoFechar);
}
