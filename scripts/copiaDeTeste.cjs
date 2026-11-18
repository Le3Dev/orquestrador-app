// Cópia de teste do app: abre um segundo Orquestrador de Agentes (Electron)
// rodando o código de uma pasta (a branch que se quer testar), isolado do app
// instalado, identificável pelo nome da branch e fácil de fechar.
//
//   node scripts/copiaDeTeste.cjs abrir  [--pasta <caminho>] [--sem-build]
//   node scripts/copiaDeTeste.cjs fechar [--pasta <caminho> | --todas]
//   node scripts/copiaDeTeste.cjs listar
//
// Como abre (o caminho mais leve que fica de pé sozinho):
//   1. compila o backend (tsc -p tsconfig.build.json → dist/) e a tela
//      (vite build → web/dist/), sem o typecheck da tela; com --sem-build e os
//      dois já gerados, pula essa etapa. A saída vai para o log da cópia.
//   2. cria a pasta isolada <tmp>/orquestrador-copia-de-teste-<slug-da-branch>
//      e, se ela ainda não tem config.json, grava um com SÓ a raiz dos projetos
//      e o caminho do Claude Code do app instalado (nunca a porta, a chave, a
//      licença nem o histórico), para não parar na tela de primeira abertura.
//   3. abre o Electron da pasta (`electron .`) desacoplado, com
//      ORQUESTRADOR_PASTA_DO_USUARIO apontando para a pasta isolada (pasta de
//      dados, porta, trava de instância única e processos próprios) e
//      ORQUESTRADOR_COPIA_DE_TESTE=<branch> (título e selo da janela). Sem
//      Vite: o servidor da cópia serve web/dist, então só o Electron fica no ar.
//      No Mac vai com --use-mock-keychain (sem isso a abertura para no aviso
//      do Chaveiro pedido pelo safeStorage).
//   4. grava pid, porta e caminhos em <pasta isolada>/copia-de-teste.json.
//
// Garantias: nunca usa a pasta de dados do app instalado (recusa se
// ORQUESTRADOR_PASTA_DO_USUARIO apontar para ela) e não fecha nem toca o app
// instalado; fechar mira só o pid gravado (e o grupo de processos dele).
"use strict";

const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const NOME_DA_PASTA_DO_APP_INSTALADO = "Orquestrador de Agentes";
const PREFIXO_DA_PASTA_ISOLADA = "orquestrador-copia-de-teste-";
const NOME_DO_ARQUIVO_DE_ESTADO = "copia-de-teste.json";
const CAMPOS_SEGUROS_DO_CONFIG = ["pastaRaizDosProjetos", "caminhoDoClaudeCode"];
const NO_WINDOWS = process.platform === "win32";

const ESPERA_DA_PORTA_MS = 60_000;
const ESPERA_DO_SERVIDOR_MS = 60_000;
const ESPERA_DO_FECHAMENTO_MS = 20_000;

// ──────────────────────────────────────────────────────────────────────────
// Partes puras (testadas em copiaDeTeste.test.js).
// ──────────────────────────────────────────────────────────────────────────

/** Nome da branch → pedaço seguro para nome de pasta e de log. */
function slugDaBranch(nome) {
  const slug = String(nome || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "sem-nome";
}

/** Pasta de dados (userData) da cópia de uma branch. */
function pastaIsoladaDaCopia(slug, pastaTemporaria = os.tmpdir()) {
  return path.join(pastaTemporaria, `${PREFIXO_DA_PASTA_ISOLADA}${slug}`);
}

/** Log do Electron e do build da cópia: /tmp no Mac e no Linux, %TEMP% no Windows. */
function arquivoDeLogDaCopia(slug, plataforma = process.platform, pastaTemporaria = os.tmpdir()) {
  const pasta = plataforma === "win32" ? pastaTemporaria : "/tmp";
  return path.join(pasta, `copia-de-teste-${slug}.log`);
}

/** Pasta de dados do app instalado (a que a cópia nunca pode usar). */
function pastaDoAppInstalado({ plataforma = process.platform, ambiente = process.env, pastaPessoal = os.homedir() } = {}) {
  if (plataforma === "darwin") {
    return path.join(pastaPessoal, "Library", "Application Support", NOME_DA_PASTA_DO_APP_INSTALADO);
  }
  if (plataforma === "win32") {
    const appData = ambiente.APPDATA || path.join(pastaPessoal, "AppData", "Roaming");
    return path.join(appData, NOME_DA_PASTA_DO_APP_INSTALADO);
  }
  const config = ambiente.XDG_CONFIG_HOME || path.join(pastaPessoal, ".config");
  return path.join(config, NOME_DA_PASTA_DO_APP_INSTALADO);
}

// Mac e Windows comparam nomes de pasta sem diferenciar maiúsculas.
function formaComparavel(caminho, plataforma) {
  const resolvido = path.resolve(caminho).replace(/[\\/]+$/, "");
  return plataforma === "linux" ? resolvido : resolvido.toLowerCase();
}

/** true quando `caminho` é a pasta do app instalado ou fica dentro dela. */
function ehDoAppInstalado(caminho, pastaDoInstalado, plataforma = process.platform) {
  if (!caminho) return false;
  const alvo = formaComparavel(caminho, plataforma);
  const instalado = formaComparavel(pastaDoInstalado, plataforma);
  return alvo === instalado || alvo.startsWith(instalado + path.sep) || alvo.startsWith(instalado + "/");
}

/** Lança erro se a pasta de dados escolhida for (ou estiver dentro da) do app instalado. */
function garantirPastaForaDoAppInstalado(caminho, pastaDoInstalado, plataforma = process.platform) {
  if (ehDoAppInstalado(caminho, pastaDoInstalado, plataforma)) {
    throw new Error(
      `Recusado: "${caminho}" é a pasta de dados do app instalado. A cópia de teste só roda numa pasta isolada.`,
    );
  }
}

/** Do config.json do app instalado, só o que é seguro levar para a cópia. */
function camposSegurosDoConfig(configuracao) {
  const origem = configuracao && typeof configuracao === "object" ? configuracao : {};
  const seguro = {};
  for (const campo of CAMPOS_SEGUROS_DO_CONFIG) {
    if (typeof origem[campo] === "string" && origem[campo].trim() !== "") seguro[campo] = origem[campo].trim();
  }
  return seguro;
}

// Variáveis que vêm de quem chamou (o servidor do app instalado, uma sessão do
// Claude Code) e desviariam a cópia: porta, pastas, chave e sessão aninhada.
const VARIAVEIS_REMOVIDAS = ["ELECTRON_RUN_AS_NODE", "PORTA", "PASTA_DADOS", "PASTA_DA_TELA", "PASTA_RAIZ_PROJETOS", "CLAUDECODE", "CLAUDE_PID", "CLAUDE_EFFORT"];
const PREFIXOS_REMOVIDOS = ["ORQUESTRADOR_", "CLAUDE_CODE_"];

/** Ambiente do Electron da cópia: o de quem chamou, limpo, mais a pasta isolada e o nome. */
function ambienteDaCopia(ambiente, { pastaDoUsuario, nome }) {
  const limpo = {};
  for (const [chave, valor] of Object.entries(ambiente || {})) {
    if (VARIAVEIS_REMOVIDAS.includes(chave)) continue;
    if (PREFIXOS_REMOVIDOS.some((prefixo) => chave.startsWith(prefixo))) continue;
    limpo[chave] = valor;
  }
  limpo.ORQUESTRADOR_PASTA_DO_USUARIO = pastaDoUsuario;
  limpo.ORQUESTRADOR_COPIA_DE_TESTE = nome;
  return limpo;
}

// No Mac, o safeStorage do Electron (cifra da sessão da licença) pede acesso ao
// Chaveiro e a abertura fica parada no aviso do sistema. --use-mock-keychain
// troca o Chaveiro por um falso só nesta cópia: nada é lido nem gravado no
// Chaveiro real, e a cópia abre sem pergunta.
function argumentosDoElectron(plataforma = process.platform) {
  return plataforma === "darwin" ? [".", "--use-mock-keychain"] : ["."];
}

/** Estado gravado pela cópia, ou null quando não existe ou está ilegível. */
function lerEstado(pastaDoUsuario, sistemaDeArquivos = fs) {
  try {
    const dados = JSON.parse(sistemaDeArquivos.readFileSync(path.join(pastaDoUsuario, NOME_DO_ARQUIVO_DE_ESTADO), "utf8"));
    return dados && typeof dados === "object" && Number.isInteger(dados.pid) ? dados : null;
  } catch {
    return null;
  }
}

/** true quando o processo existe (EPERM conta como vivo: existe, só não é nosso). */
function pidVivo(pid, sinalizar = process.kill) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    sinalizar(pid, 0);
    return true;
  } catch (erro) {
    return Boolean(erro && erro.code === "EPERM");
  }
}

/** A linha de comando é de um Electron (protege contra pid reaproveitado pelo sistema). */
function comandoEhDoElectron(comando) {
  return /electron/i.test(String(comando || ""));
}

/** Cópia aberta: estado com pid vivo e, quando dá para conferir, de um Electron. */
function copiaEstaAberta(estado, { vivo = pidVivo, comandoDoPid = comandoDoProcesso } = {}) {
  if (!estado || !vivo(estado.pid)) return false;
  const comando = comandoDoPid(estado.pid);
  return comando === null ? true : comandoEhDoElectron(comando);
}

/** Lê os argumentos: subcomando, --pasta, --todas, --sem-build. */
function lerArgumentos(argumentos) {
  const resultado = { comando: null, pasta: null, todas: false, semBuild: false };
  for (let i = 0; i < argumentos.length; i++) {
    const argumento = argumentos[i];
    if (argumento === "--pasta") {
      resultado.pasta = argumentos[++i] || null;
      if (!resultado.pasta) throw new Error("--pasta precisa de um caminho.");
    } else if (argumento === "--todas") resultado.todas = true;
    else if (argumento === "--sem-build") resultado.semBuild = true;
    else if (!argumento.startsWith("--") && !resultado.comando) resultado.comando = argumento;
    else throw new Error(`Argumento desconhecido: ${argumento}`);
  }
  return resultado;
}

// ──────────────────────────────────────────────────────────────────────────
// Partes com efeito (git, disco, processos, rede).
// ──────────────────────────────────────────────────────────────────────────
const log = (mensagem) => console.log(`[cópia de teste] ${mensagem}`);

function comandoDoProcesso(pid) {
  if (NO_WINDOWS) return null;
  const resultado = spawnSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
  if (resultado.status !== 0) return null;
  return resultado.stdout.trim() || null;
}

function git(pasta, argumentos) {
  const resultado = spawnSync("git", ["-C", pasta, ...argumentos], { encoding: "utf8" });
  if (resultado.status !== 0) {
    throw new Error(`git ${argumentos.join(" ")} falhou em "${pasta}": ${(resultado.stderr || "").trim()}`);
  }
  return resultado.stdout.trim();
}

/** Nome da branch da pasta; destacada (HEAD solto), o commit curto. */
function nomeDaBranch(pasta) {
  const branch = git(pasta, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return branch === "HEAD" ? git(pasta, ["rev-parse", "--short", "HEAD"]) : branch;
}

function validarPastaDoApp(pasta) {
  for (const exigido of ["package.json", path.join("electron", "main.js"), path.join("web", "package.json")]) {
    if (!fs.existsSync(path.join(pasta, exigido))) {
      throw new Error(`"${pasta}" não parece o código do app (falta ${exigido}).`);
    }
  }
}

/** Tudo que identifica a cópia de uma pasta. */
function identificarCopia(pastaDoCodigo) {
  const pasta = path.resolve(pastaDoCodigo);
  validarPastaDoApp(pasta);
  const nome = nomeDaBranch(pasta);
  const slug = slugDaBranch(nome);
  const pastaDoUsuario = pastaIsoladaDaCopia(slug);
  return { pasta, nome, slug, pastaDoUsuario, log: arquivoDeLogDaCopia(slug) };
}

function gravarEstado(pastaDoUsuario, estado) {
  const arquivo = path.join(pastaDoUsuario, NOME_DO_ARQUIVO_DE_ESTADO);
  const temporario = `${arquivo}.${process.pid}.tmp`;
  fs.writeFileSync(temporario, JSON.stringify(estado, null, 2), "utf8");
  fs.renameSync(temporario, arquivo);
}

function lerConfigJson(pasta) {
  try {
    return JSON.parse(fs.readFileSync(path.join(pasta, "config.json"), "utf8"));
  } catch {
    return null;
  }
}

/** Grava o config.json da pasta isolada (só na primeira vez). Devolve o que fez. */
function semearConfiguracao(pastaDoUsuario, pastaDoInstalado) {
  const destino = path.join(pastaDoUsuario, "config.json");
  if (fs.existsSync(destino)) return "mantida";
  const seguro = camposSegurosDoConfig(lerConfigJson(pastaDoInstalado));
  if (Object.keys(seguro).length === 0) return "vazia";
  fs.writeFileSync(destino, JSON.stringify({ ...seguro, historicoImportadoDe: null, porta: null }, null, 2), "utf8");
  return "semeada";
}

function rodarEtapa(titulo, comando, argumentos, cwd, descritor) {
  log(`${titulo}…`);
  fs.writeSync(descritor, `\n===== ${titulo} (${new Date().toISOString()}) =====\n`);
  const resultado = spawnSync(comando, argumentos, { cwd, stdio: ["ignore", descritor, descritor], windowsHide: true });
  if (resultado.status !== 0) {
    throw new Error(`${titulo} falhou (código ${resultado.status}). Veja o log.`);
  }
}

function compilar(pasta, descritor) {
  const resolver = (modulo, base) => require.resolve(modulo, { paths: [base] });
  const tsc = path.join(path.dirname(resolver("typescript/package.json", pasta)), "bin", "tsc");
  rodarEtapa("Compilando o backend (tsc → dist/)", process.execPath, [tsc, "-p", "tsconfig.build.json"], pasta, descritor);
  const pastaDaTela = path.join(pasta, "web");
  const vite = path.join(path.dirname(resolver("vite/package.json", pastaDaTela)), "bin", "vite.js");
  rodarEtapa("Gerando a tela (vite build → web/dist/)", process.execPath, [vite, "build"], pastaDaTela, descritor);
}

function buildPronto(pasta) {
  return fs.existsSync(path.join(pasta, "dist", "root.js")) && fs.existsSync(path.join(pasta, "web", "dist", "index.html"));
}

function esperar(milissegundos) {
  return new Promise((resolve) => setTimeout(resolve, milissegundos));
}

/** Espera a cópia gravar a porta no config.json dela. */
async function esperarPorta(pastaDoUsuario, pid) {
  const limite = Date.now() + ESPERA_DA_PORTA_MS;
  while (Date.now() < limite && pidVivo(pid)) {
    const configuracao = lerConfigJson(pastaDoUsuario);
    if (configuracao && Number.isInteger(configuracao.porta)) return configuracao.porta;
    await esperar(500);
  }
  return null;
}

/** Qualquer resposta HTTP conta: sem o cookie do app o servidor responde 403. */
function responde(porta) {
  return new Promise((resolve) => {
    const requisicao = http.get({ host: "127.0.0.1", port: porta, path: "/api/saude" }, (resposta) => {
      resposta.resume();
      resolve(resposta.statusCode);
    });
    requisicao.on("error", () => resolve(null));
    requisicao.setTimeout(2_000, () => requisicao.destroy());
  });
}

async function esperarServidor(porta, pid) {
  const limite = Date.now() + ESPERA_DO_SERVIDOR_MS;
  while (Date.now() < limite && pidVivo(pid)) {
    const status = await responde(porta);
    if (status !== null) return status;
    await esperar(500);
  }
  return null;
}

function comoFechar(pasta) {
  return `node scripts/copiaDeTeste.cjs fechar --pasta "${pasta}"`;
}

async function abrir({ pasta: pastaInformada, semBuild }) {
  const pastaDoInstalado = pastaDoAppInstalado();
  if (process.env.ORQUESTRADOR_PASTA_DO_USUARIO) {
    garantirPastaForaDoAppInstalado(process.env.ORQUESTRADOR_PASTA_DO_USUARIO, pastaDoInstalado);
  }
  const copia = identificarCopia(pastaInformada || process.cwd());
  garantirPastaForaDoAppInstalado(copia.pastaDoUsuario, pastaDoInstalado);

  const anterior = lerEstado(copia.pastaDoUsuario);
  if (copiaEstaAberta(anterior)) {
    log(`Já existe uma cópia aberta da branch "${copia.nome}" (pid ${anterior.pid}, porta ${anterior.porta ?? "?"}).`);
    log(`Nada foi aberto. Para fechar: ${comoFechar(anterior.pasta || copia.pasta)}`);
    return 1;
  }

  fs.mkdirSync(copia.pastaDoUsuario, { recursive: true });
  const descritor = fs.openSync(copia.log, "a");
  try {
    if (semBuild && buildPronto(copia.pasta)) log("Build já gerado: pulando a compilação (--sem-build).");
    else compilar(copia.pasta, descritor);

    const semente = semearConfiguracao(copia.pastaDoUsuario, pastaDoInstalado);
    if (semente === "semeada") log("Configuração semeada com a raiz dos projetos e o Claude Code do app instalado.");
    else if (semente === "vazia") log("Sem config do app instalado: a cópia vai abrir na tela de primeira abertura.");

    const executavel = require(require.resolve("electron", { paths: [copia.pasta] }));
    fs.writeSync(descritor, `\n===== Electron (${new Date().toISOString()}) =====\n`);
    const filho = spawn(executavel, argumentosDoElectron(), {
      cwd: copia.pasta,
      detached: true,
      stdio: ["ignore", descritor, descritor],
      env: ambienteDaCopia(process.env, { pastaDoUsuario: copia.pastaDoUsuario, nome: copia.nome }),
      windowsHide: false,
    });
    filho.unref();
    const estado = {
      pid: filho.pid,
      nome: copia.nome,
      slug: copia.slug,
      pasta: copia.pasta,
      pastaDoUsuario: copia.pastaDoUsuario,
      log: copia.log,
      porta: null,
      abertaEm: new Date().toISOString(),
    };
    gravarEstado(copia.pastaDoUsuario, estado);
    log(`Electron aberto (pid ${filho.pid}). Esperando o servidor da cópia…`);

    const porta = await esperarPorta(copia.pastaDoUsuario, filho.pid);
    const status = porta ? await esperarServidor(porta, filho.pid) : null;
    if (porta) gravarEstado(copia.pastaDoUsuario, { ...estado, porta });

    console.log("");
    console.log(`  Cópia de teste:  ${copia.nome}`);
    console.log(`  Código:          ${copia.pasta}`);
    console.log(`  Pasta de dados:  ${copia.pastaDoUsuario}`);
    console.log(`  Porta:           ${porta ?? "ainda não gravada (veja o log)"}${status ? ` (servidor respondeu ${status})` : ""}`);
    console.log(`  pid:             ${filho.pid}`);
    console.log(`  Log:             ${copia.log}`);
    console.log(`  Para fechar:     ${comoFechar(copia.pasta)}`);
    console.log("");
    if (!pidVivo(filho.pid)) {
      log("O Electron saiu logo depois de abrir. Veja o log.");
      return 1;
    }
    return porta && status ? 0 : 1;
  } finally {
    fs.closeSync(descritor);
  }
}

/** pids vivos do grupo de processos (o Electron abre com detached: grupo próprio). */
function membrosDoGrupo(pgid) {
  if (NO_WINDOWS) return [];
  const resultado = spawnSync("ps", ["-A", "-o", "pid=,pgid="], { encoding: "utf8" });
  if (resultado.status !== 0) return [];
  return resultado.stdout
    .split("\n")
    .map((linha) => linha.trim().split(/\s+/).map(Number))
    .filter(([pid, grupo]) => grupo === pgid && Number.isInteger(pid))
    .map(([pid]) => pid);
}

function sinalizarGrupo(pgid, sinal) {
  try {
    process.kill(-pgid, sinal);
  } catch {
    /* grupo já vazio */
  }
}

async function fecharCopia(estado) {
  const { pid } = estado;
  if (!copiaEstaAberta(estado)) {
    log(`"${estado.nome}" já estava fechada.`);
    return true;
  }
  log(`Fechando "${estado.nome}" (pid ${pid})…`);
  if (NO_WINDOWS) {
    spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
  } else {
    // SIGTERM: o Electron sai pelo before-quit, que desliga o servidor e a árvore dele.
    process.kill(pid, "SIGTERM");
    const limite = Date.now() + ESPERA_DO_FECHAMENTO_MS;
    while (Date.now() < limite && pidVivo(pid)) await esperar(300);
    if (pidVivo(pid)) {
      log("Não saiu com SIGTERM: encerrando o grupo com SIGKILL.");
      sinalizarGrupo(pid, "SIGKILL");
    }
    // Sobras do grupo (o servidor ou um filho que não saiu junto).
    if (membrosDoGrupo(pid).length > 0) {
      sinalizarGrupo(pid, "SIGTERM");
      await esperar(1_000);
      if (membrosDoGrupo(pid).length > 0) sinalizarGrupo(pid, "SIGKILL");
    }
  }
  await esperar(300);
  const saiu = !pidVivo(pid) && membrosDoGrupo(pid).length === 0;
  log(saiu ? `"${estado.nome}" fechada: o pid ${pid} e o grupo dele saíram.` : `O pid ${pid} ainda está vivo.`);
  return saiu;
}

/** Estados de todas as cópias com pasta isolada no tmp. */
function todasAsCopias(pastaTemporaria = os.tmpdir()) {
  let nomes = [];
  try {
    nomes = fs.readdirSync(pastaTemporaria);
  } catch {
    return [];
  }
  return nomes
    .filter((nome) => nome.startsWith(PREFIXO_DA_PASTA_ISOLADA))
    .map((nome) => lerEstado(path.join(pastaTemporaria, nome)))
    .filter(Boolean);
}

async function fechar({ pasta, todas }) {
  const alvos = todas
    ? todasAsCopias().filter((estado) => copiaEstaAberta(estado))
    : [lerEstado(identificarCopia(pasta || process.cwd()).pastaDoUsuario)].filter(Boolean);
  if (alvos.length === 0) {
    log("Nenhuma cópia aberta para fechar.");
    return 0;
  }
  let tudoCerto = true;
  for (const estado of alvos) tudoCerto = (await fecharCopia(estado)) && tudoCerto;
  return tudoCerto ? 0 : 1;
}

function listar() {
  const abertas = todasAsCopias().filter((estado) => copiaEstaAberta(estado));
  if (abertas.length === 0) {
    log("Nenhuma cópia de teste aberta.");
    return 0;
  }
  for (const estado of abertas) {
    console.log(`${estado.nome}  pid ${estado.pid}  porta ${estado.porta ?? "?"}`);
    console.log(`  código: ${estado.pasta}`);
    console.log(`  dados:  ${estado.pastaDoUsuario}`);
  }
  return 0;
}

const AJUDA = `Uso:
  node scripts/copiaDeTeste.cjs abrir  [--pasta <caminho>] [--sem-build]
  node scripts/copiaDeTeste.cjs fechar [--pasta <caminho> | --todas]
  node scripts/copiaDeTeste.cjs listar`;

async function principal(argumentos) {
  const opcoes = lerArgumentos(argumentos);
  if (opcoes.comando === "abrir") return abrir(opcoes);
  if (opcoes.comando === "fechar") return fechar(opcoes);
  if (opcoes.comando === "listar") return listar();
  console.log(AJUDA);
  return opcoes.comando ? 1 : 0;
}

if (require.main === module) {
  principal(process.argv.slice(2))
    .then((codigo) => process.exit(codigo))
    .catch((erro) => {
      console.error(`[cópia de teste] ${erro instanceof Error ? erro.message : String(erro)}`);
      process.exit(1);
    });
}

module.exports = {
  ambienteDaCopia,
  argumentosDoElectron,
  arquivoDeLogDaCopia,
  camposSegurosDoConfig,
  comandoEhDoElectron,
  copiaEstaAberta,
  ehDoAppInstalado,
  garantirPastaForaDoAppInstalado,
  lerArgumentos,
  lerEstado,
  pastaDoAppInstalado,
  pastaIsoladaDaCopia,
  pidVivo,
  slugDaBranch,
  NOME_DO_ARQUIVO_DE_ESTADO,
};
