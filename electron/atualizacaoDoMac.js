"use strict";

// Atualização pelo botão no Mac, e a espera pelos orquestradores antes de
// reiniciar (esta vale no Windows e no Mac).
//
// No Mac o electron-updater não instala (o app não tem assinatura da Apple).
// Em vez dele, o app se gera de novo a partir da pasta do código de onde veio
// (o `npm run dist:mac` grava "repositorioDoMac" e "commitDoMac" no
// package.json empacotado):
//   1. Verificar: `git fetch <remoto> main` (remoto "upstream" se existir,
//      senão "origin") e compara <remoto>/main com o commit do app. Igual (ou o
//      app já à frente) → "em-dia".
//   2. Versão nova: confere antes que a pasta não tem alterações rastreadas sem
//      commit e que a branch avança direto (fast-forward); senão "erro" e nada
//      é alterado. Depois "baixando", com as etapas "Baixando o código" (merge
//      --ff-only, ou checkout --detach com o HEAD destacado), "Instalando
//      dependências" (npm ci e npm --prefix web ci, que seguem o
//      package-lock.json sem reescrevê-lo) e "Gerando o app"
//      (npm run dist:mac). Concluído → "pronta".
//   3. Instalar: um script desacoplado (trocarAppDoMac.sh) espera o app
//      fechar, guarda o .app atual num backup na pasta temporária, copia o novo
//      com `ditto` e o abre; o app encerra o servidor e sai. Fechar o app com
//      a versão em "pronta" (ou "aguardando") também troca, sem reabrir.
// Verificação automática como no Windows (~10 s depois da janela e a cada
// 4 h). Um erro na busca automática (sem internet, pasta com alterações) só vai
// para o log; depois que a geração começou, um erro aparece sempre. Uma
// geração por vez.
//
// Este módulo NÃO carrega o Electron: os comandos, a troca do app e o
// registro de processos chegam por injeção (testável com falsos).
//
// Estado público (o de electron/atualizacao.js com dois campos a mais, sempre
// presentes, também no Windows):
//   situacao: ... | "aguardando"  // pronta, esperando os orquestradores terminarem
//   etapa: string | null          // no Mac, em "verificando" e "baixando"; null no Windows
//   orquestradoresTrabalhando: number | null  // só em "aguardando"
// No Mac, "progresso" em "baixando" é null (indeterminado).

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { ATRASO_DA_PRIMEIRA_VERIFICACAO_MS, INTERVALO_ENTRE_VERIFICACOES_MS, estadoInicial } = require("./atualizacao");

const INTERVALO_DA_ESPERA_MS = 15_000;

const ETAPA_PROCURANDO = "Procurando versão nova";
const ETAPA_CODIGO = "Baixando o código";
const ETAPA_DEPENDENCIAS = "Instalando dependências";
const ETAPA_APP = "Gerando o app";

const TEMPO_DO_GIT_MS = 2 * 60_000;
const TEMPO_DAS_DEPENDENCIAS_MS = 20 * 60_000;
const TEMPO_DA_GERACAO_MS = 30 * 60_000;

// Guardado da saída de cada comando (para o fim do log na mensagem de erro).
const LIMITE_DA_SAIDA = 64 * 1024;
const LIMITE_DO_ARQUIVO_DE_LOG = 5 * 1024 * 1024;

// ──────────────────────────────────────────────────────────────────────────
// Funções puras.
// ──────────────────────────────────────────────────────────────────────────
function commitCurto(commit) {
  return typeof commit === "string" && commit.trim() ? commit.trim().slice(0, 7) : null;
}

function versaoComCommit(versao, commit) {
  const curto = commitCurto(commit);
  const base = String(versao || "");
  return curto ? `${base} (${curto})` : base;
}

// As últimas linhas não vazias, até `limite` caracteres.
function fimDoLog(texto, linhas = 15, limite = 1500) {
  const fim = String(texto || "")
    .split(/\r?\n/)
    .map((linha) => linha.trimEnd())
    .filter((linha) => linha.length > 0)
    .slice(-linhas)
    .join("\n");
  return fim.length > limite ? fim.slice(-limite) : fim;
}

// "upstream" se existir, senão "origin"; null sem nenhum dos dois.
function remotoPreferido(remotos) {
  const lista = (Array.isArray(remotos) ? remotos : String(remotos || "").split(/\r?\n/)).map((nome) => String(nome).trim());
  if (lista.includes("upstream")) return "upstream";
  if (lista.includes("origin")) return "origin";
  return null;
}

// A pasta do código gravada pelo dist:mac, se ainda for um repositório git.
function pastaDoCodigoDoMac(pacote, ehRepositorio) {
  if (!pacote || typeof pacote.repositorioDoMac !== "string" || !pacote.repositorioDoMac.trim()) return null;
  const pasta = pacote.repositorioDoMac.trim();
  try {
    return ehRepositorio(pasta) ? pasta : null;
  } catch {
    return null;
  }
}

// Um repositório git (pasta .git, ou arquivo .git de um worktree).
function ehRepositorioGit(pasta) {
  return fs.existsSync(path.join(pasta, ".git"));
}

function caminhoDoAppGerado(pastaDoCodigo, nomeDoApp) {
  return path.join(pastaDoCodigo, "dist_electron", "mac-arm64", `${nomeDoApp}.app`);
}

// O ".app" que contém o executável (process.execPath), ou null.
function pastaDoAppPeloExecutavel(executavel) {
  const partes = String(executavel || "").split("/");
  for (let i = partes.length - 1; i > 0; i -= 1) {
    if (partes[i].endsWith(".app")) return partes.slice(0, i + 1).join("/");
  }
  return null;
}

function carimboDeData(data) {
  const dois = (n) => String(n).padStart(2, "0");
  return (
    `${data.getFullYear()}-${dois(data.getMonth() + 1)}-${dois(data.getDate())}-` +
    `${dois(data.getHours())}${dois(data.getMinutes())}${dois(data.getSeconds())}`
  );
}

function caminhoDoBackup(pastaTemporaria, nomeDoApp, data) {
  return path.join(pastaTemporaria, `${nomeDoApp} (backup ${carimboDeData(data)}).app`);
}

// Ambiente dos comandos: sem ELECTRON_RUN_AS_NODE (o npm e o electron-builder
// rodariam como o Node do Electron) e sem o git pedir senha no terminal.
function ambienteDosComandos(ambiente = process.env) {
  const copia = { ...ambiente };
  delete copia.ELECTRON_RUN_AS_NODE;
  copia.GIT_TERMINAL_PROMPT = "0";
  return copia;
}

function pidVivo(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (erro) {
    return Boolean(erro && erro.code === "EPERM");
  }
}

// Orquestradores com algum processo vivo no registro (processos-em-execucao.json:
// [{ pid, orquestradorId, sessaoId, iniciadoEm }]). Conta orquestradores, não
// processos: os subagentes de um mesmo orquestrador contam uma vez.
function contarOrquestradoresTrabalhando(processos, vivo = pidVivo) {
  const ids = new Set();
  for (const processo of Array.isArray(processos) ? processos : []) {
    if (!processo || typeof processo !== "object") continue;
    const { pid, orquestradorId } = processo;
    if (!Number.isInteger(pid) || pid <= 0 || !vivo(pid)) continue;
    ids.add(typeof orquestradorId === "string" && orquestradorId ? orquestradorId : `pid:${pid}`);
  }
  return ids.size;
}

// Sem arquivo (ou ilegível) não há ninguém trabalhando.
function lerProcessosEmExecucao(arquivo, lerArquivo = (caminho) => fs.readFileSync(caminho, "utf8")) {
  try {
    const conteudo = JSON.parse(lerArquivo(arquivo));
    return Array.isArray(conteudo) ? conteudo : [];
  } catch {
    return [];
  }
}

function detalheDoErro(erro) {
  if (erro == null) return "erro desconhecido";
  if (typeof erro === "string") return erro;
  return String(erro.message || erro);
}

// Completa um estado com os campos do contrato novo (no Windows chegam sem eles).
function completarEstado(estado) {
  return {
    ...estado,
    etapa: typeof estado.etapa === "string" ? estado.etapa : null,
    orquestradoresTrabalhando: Number.isInteger(estado.orquestradoresTrabalhando) ? estado.orquestradoresTrabalhando : null,
  };
}

const CAMPOS_DO_ESTADO = ["situacao", "versaoAtual", "versaoNova", "progresso", "mensagemDeErro", "etapa", "orquestradoresTrabalhando"];

function mesmoEstado(a, b) {
  return CAMPOS_DO_ESTADO.every((campo) => a[campo] === b[campo]);
}

function agendarComTimeout(funcao, atrasoMs) {
  const timer = setTimeout(funcao, atrasoMs);
  return () => clearTimeout(timer);
}

// ──────────────────────────────────────────────────────────────────────────
// Executor de comandos (o de verdade; os testes usam um falso).
// executar(comando, args, { cwd, timeoutMs }) → Promise<{ codigo, saida }>
//   codigo: o código de saída, ou null se não rodou ou estourou o tempo.
//   saida: stdout e stderr juntos (o fim, até LIMITE_DA_SAIDA).
// Nunca rejeita. A saída completa vai para `arquivoDeLog` (anexando; passando
// de ~5 MB, o atual vira .1).
// ──────────────────────────────────────────────────────────────────────────
function criarExecutorDeComandos({ arquivoDeLog = null, ambiente = () => ambienteDosComandos(process.env), gerarProcesso = spawn } = {}) {
  function escrever(texto) {
    if (!arquivoDeLog || !texto) return;
    try {
      fs.mkdirSync(path.dirname(arquivoDeLog), { recursive: true });
      if (fs.existsSync(arquivoDeLog) && fs.statSync(arquivoDeLog).size > LIMITE_DO_ARQUIVO_DE_LOG) {
        fs.rmSync(`${arquivoDeLog}.1`, { force: true });
        fs.renameSync(arquivoDeLog, `${arquivoDeLog}.1`);
      }
      fs.appendFileSync(arquivoDeLog, texto, "utf8");
    } catch {
      /* sem log a atualização segue */
    }
  }

  return function executar(comando, args = [], { cwd, timeoutMs = TEMPO_DO_GIT_MS } = {}) {
    return new Promise((resolver) => {
      let saida = "";
      let terminou = false;
      let estourou = false;
      let limite = null;
      const concluir = (codigo, extra = "") => {
        if (terminou) return;
        terminou = true;
        clearTimeout(limite);
        if (extra) {
          saida = `${saida}\n${extra}`.slice(-LIMITE_DA_SAIDA);
          escrever(`${extra}\n`);
        }
        escrever(`(código de saída: ${codigo === null ? "não concluiu" : codigo})\n`);
        resolver({ codigo, saida });
      };
      escrever(`\n${new Date().toISOString()} $ ${[comando, ...args].join(" ")}  (em ${cwd})\n`);

      let filho;
      try {
        // Grupo próprio: no tempo esgotado o npm cai junto com os filhos dele.
        filho = gerarProcesso(comando, args, { cwd, env: ambiente(), stdio: ["ignore", "pipe", "pipe"], detached: true });
      } catch (erro) {
        concluir(null, `não foi possível rodar ${comando}: ${detalheDoErro(erro)}`);
        return;
      }
      limite = setTimeout(() => {
        estourou = true;
        try {
          process.kill(-filho.pid, "SIGTERM");
        } catch {
          try {
            filho.kill("SIGTERM");
          } catch {
            /* já saiu */
          }
        }
      }, timeoutMs);
      const guardar = (pedaco) => {
        const texto = pedaco.toString("utf8");
        saida = (saida + texto).slice(-LIMITE_DA_SAIDA);
        escrever(texto);
      };
      if (filho.stdout) filho.stdout.on("data", guardar);
      if (filho.stderr) filho.stderr.on("data", guardar);
      filho.on("error", (erro) => concluir(null, `não foi possível rodar ${comando}: ${detalheDoErro(erro)}`));
      filho.on("close", (codigo) =>
        estourou ? concluir(null, `tempo esgotado (${Math.round(timeoutMs / 1000)} s); o comando foi interrompido.`) : concluir(codigo),
      );
    });
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Troca do app (instalar).
// ──────────────────────────────────────────────────────────────────────────
// Copia o trocarAppDoMac.sh para a pasta temporária (de dentro do app.asar o
// bash não o leria) e o roda desacoplado: sobrevive ao app fechando.
// reabrir: false → troca sem abrir o app depois (o usuário fechou o app).
function iniciarTrocaDoApp({
  pid,
  appAtual,
  appNovo,
  nomeDoApp,
  arquivoDeLog,
  reabrir = true,
  pastaTemporaria = os.tmpdir(),
  agora = new Date(),
  gerarProcesso = spawn,
  ambiente = ambienteDosComandos(process.env),
}) {
  const backup = caminhoDoBackup(pastaTemporaria, nomeDoApp, agora);
  const script = path.join(pastaTemporaria, `orquestrador-troca-do-app-${carimboDeData(agora)}.sh`);
  fs.writeFileSync(script, fs.readFileSync(path.join(__dirname, "trocarAppDoMac.sh"), "utf8"), { encoding: "utf8", mode: 0o755 });
  fs.mkdirSync(path.dirname(arquivoDeLog), { recursive: true });
  const saida = fs.openSync(arquivoDeLog, "a");
  try {
    const filho = gerarProcesso("/usr/bin/nohup", ["/bin/bash", script, String(pid), appAtual, appNovo, backup], {
      detached: true,
      stdio: ["ignore", saida, saida],
      env: reabrir ? ambiente : { ...ambiente, ORQUESTRADOR_TROCA_REABRIR: "0" },
    });
    filho.unref();
  } finally {
    fs.closeSync(saida);
  }
  return { script, backup };
}

// ──────────────────────────────────────────────────────────────────────────
// Serviço do Mac.
// ──────────────────────────────────────────────────────────────────────────
class ErroDaAtualizacao extends Error {
  // sempre: aparece na tela mesmo numa verificação automática.
  constructor(mensagem, { sempre = false } = {}) {
    super(mensagem);
    this.sempre = sempre;
  }
}

// pastaDoCodigo: o repositório de onde o app foi gerado (repositorioDoMac).
// commitDoApp: commitDoMac do package.json empacotado (null → o HEAD da pasta
//   na primeira verificação).
// executar: o executor de comandos (criarExecutorDeComandos ou um falso).
// instalarApp({ appGerado }): troca o app e fecha (lança se não conseguir).
// existe(caminho): o app gerado existe? (fs.existsSync).
// arquivoDoLog: citado nas mensagens de erro.
function criarServicoDeAtualizacaoDoMac({
  pastaDoCodigo,
  commitDoApp = null,
  versaoDoApp,
  nomeDoApp = "Orquestrador de Agentes",
  executar,
  instalarApp = () => {
    throw new Error("instalação indisponível");
  },
  existe = fs.existsSync,
  arquivoDoLog = null,
  ativo = true,
  registrar = () => {},
  aoMudar = () => {},
  agendar = agendarComTimeout,
} = {}) {
  const ligado = Boolean(ativo && pastaDoCodigo && typeof executar === "function");
  let commitBase = typeof commitDoApp === "string" && commitDoApp.trim() ? commitDoApp.trim() : null;
  let estado = completarEstado(estadoInicial(versaoComCommit(versaoDoApp, commitBase), ligado));
  let ciclo = null; // { manual, anterior, promessa }
  let instalando = false;
  let iniciado = false;
  let cancelarAgendamento = null;
  const appGerado = ligado ? caminhoDoAppGerado(pastaDoCodigo, nomeDoApp) : null;
  const ondeEstaOLog = arquivoDoLog ? ` Log completo: ${arquivoDoLog}` : "";

  const obter = () => ({ ...estado });

  function registrarSeguro(texto) {
    try {
      registrar(texto);
    } catch {
      /* sem log o serviço segue */
    }
  }

  function definir(parcial) {
    const novo = {
      versaoAtual: estado.versaoAtual,
      versaoNova: null,
      progresso: null,
      mensagemDeErro: null,
      etapa: null,
      orquestradoresTrabalhando: null,
      ...parcial,
    };
    if (mesmoEstado(novo, estado)) return;
    estado = novo;
    try {
      aoMudar(obter());
    } catch (erro) {
      registrarSeguro(`Falha ao avisar a tela sobre a atualização: ${detalheDoErro(erro)}`);
    }
  }

  async function git(args, { aceitarFalha = false } = {}) {
    const resultado = await executar("git", args, { cwd: pastaDoCodigo, timeoutMs: TEMPO_DO_GIT_MS });
    if (resultado.codigo !== 0 && !aceitarFalha) {
      throw new ErroDaAtualizacao(
        `O comando "git ${args.join(" ")}" falhou na pasta ${pastaDoCodigo}: ${fimDoLog(resultado.saida, 5, 500) || "sem detalhes"}`,
      );
    }
    return { codigo: resultado.codigo, saida: String(resultado.saida || "").trim() };
  }

  // Uma etapa da geração: falha → erro com a etapa e o fim do log.
  async function etapa(nome, comando, args, timeoutMs) {
    registrarSeguro(`${nome}: ${[comando, ...args].join(" ")} (em ${pastaDoCodigo}).`);
    const resultado = await executar(comando, args, { cwd: pastaDoCodigo, timeoutMs });
    if (resultado.codigo === 0) return;
    const fim = fimDoLog(resultado.saida);
    registrarSeguro(`Falha na etapa "${nome}" (${[comando, ...args].join(" ")}): ${fim || "sem saída"}`);
    throw new ErroDaAtualizacao(
      `Falha na etapa "${nome}" (${[comando, ...args].join(" ")}). Fim do log:\n${fim || "(sem saída)"}${ondeEstaOLog}`,
      { sempre: true },
    );
  }

  async function rodarCiclo(meu) {
    const remoto = remotoPreferido((await git(["remote"])).saida);
    if (!remoto) throw new ErroDaAtualizacao(`A pasta ${pastaDoCodigo} não tem o remoto "upstream" nem o "origin".`);
    const buscar = await git(["fetch", remoto, "main"], { aceitarFalha: true });
    if (buscar.codigo !== 0) {
      throw new ErroDaAtualizacao(
        `Não foi possível buscar a versão nova (git fetch ${remoto} main na pasta ${pastaDoCodigo}): ` +
          `${fimDoLog(buscar.saida, 5, 500) || "sem detalhes"}. Verifique a internet e o acesso ao repositório.`,
      );
    }
    const alvo = (await git(["rev-parse", "--verify", `${remoto}/main^{commit}`])).saida;
    if (!commitBase) {
      commitBase = (await git(["rev-parse", "--verify", "HEAD^{commit}"])).saida;
      estado = { ...estado, versaoAtual: versaoComCommit(versaoDoApp, commitBase) };
    }
    // Em dia: o mesmo commit, ou o app gerado já à frente do remoto.
    const contido = alvo === commitBase || (await git(["merge-base", "--is-ancestor", alvo, commitBase], { aceitarFalha: true })).codigo === 0;
    if (contido) {
      registrarSeguro(`Em dia com ${remoto}/main (${commitCurto(alvo)}).`);
      definir({ situacao: "em-dia" });
      return;
    }

    // Antes de mexer em qualquer coisa: a pasta limpa e a branch avançando direto.
    const pendentes = (await git(["status", "--porcelain", "--untracked-files=no"])).saida;
    if (pendentes) {
      throw new ErroDaAtualizacao(
        `A pasta ${pastaDoCodigo} tem alterações não commitadas em arquivos do repositório. ` +
          "Faça commit (ou descarte) e procure a atualização de novo; nada foi alterado.",
      );
    }
    const ramo = await git(["symbolic-ref", "-q", "--short", "HEAD"], { aceitarFalha: true });
    const branch = ramo.codigo === 0 && ramo.saida ? ramo.saida : null;
    if (branch) {
      const avanca = await git(["merge-base", "--is-ancestor", "HEAD", `${remoto}/main`], { aceitarFalha: true });
      if (avanca.codigo !== 0) {
        throw new ErroDaAtualizacao(
          `A branch ${branch} da pasta ${pastaDoCodigo} tem commits que não estão em ${remoto}/main e não avança direto ` +
            `(git merge --ff-only). Atualize a pasta à mão; nada foi alterado.`,
        );
      }
    }

    const versaoNova = commitCurto(alvo);
    registrarSeguro(`Versão nova em ${remoto}/main: ${versaoNova}. Gerando o app em segundo plano.`);
    meu.gerando = true;
    definir({ situacao: "baixando", versaoNova, etapa: ETAPA_CODIGO });
    await etapa(ETAPA_CODIGO, "git", branch ? ["merge", "--ff-only", `${remoto}/main`] : ["checkout", "--detach", `${remoto}/main`], TEMPO_DO_GIT_MS);

    definir({ situacao: "baixando", versaoNova, etapa: ETAPA_DEPENDENCIAS });
    await etapa(ETAPA_DEPENDENCIAS, "npm", ["ci"], TEMPO_DAS_DEPENDENCIAS_MS);
    await etapa(ETAPA_DEPENDENCIAS, "npm", ["--prefix", "web", "ci"], TEMPO_DAS_DEPENDENCIAS_MS);

    definir({ situacao: "baixando", versaoNova, etapa: ETAPA_APP });
    await etapa(ETAPA_APP, "npm", ["run", "dist:mac"], TEMPO_DA_GERACAO_MS);
    if (!existe(appGerado)) {
      throw new ErroDaAtualizacao(`O npm run dist:mac terminou, mas o app gerado não apareceu em ${appGerado}.${ondeEstaOLog}`, {
        sempre: true,
      });
    }
    registrarSeguro(`Versão ${versaoNova} gerada em ${appGerado}: instala ao reiniciar pelo botão.`);
    definir({ situacao: "pronta", versaoNova });
  }

  function aoFalhar(meu, erro) {
    const mensagem = detalheDoErro(erro);
    const mostrar = meu.manual || meu.gerando || Boolean(erro && erro.sempre);
    if (mostrar) {
      registrarSeguro(`Falha na atualização: ${mensagem}`);
      definir({ situacao: "erro", mensagemDeErro: mensagem });
      return;
    }
    registrarSeguro(`Falha na verificação automática (a tela não foi avisada): ${mensagem}`);
    const anterior = meu.anterior && meu.anterior.situacao !== "indisponivel" ? meu.anterior : { situacao: "em-dia" };
    definir({ ...anterior, versaoAtual: estado.versaoAtual });
  }

  // Dispara uma verificação e devolve o estado logo em seguida (não espera a
  // geração). manual: pedida pelo usuário (um erro aparece na tela).
  function verificar({ manual = false } = {}) {
    if (!ligado || estado.situacao === "pronta" || instalando) return obter();
    if (ciclo) {
      if (manual) ciclo.manual = true;
      return obter();
    }
    const meu = { manual, gerando: false, anterior: obter(), promessa: null };
    ciclo = meu;
    definir({ situacao: "verificando", etapa: ETAPA_PROCURANDO });
    meu.promessa = rodarCiclo(meu)
      .catch((erro) => aoFalhar(meu, erro))
      .finally(() => {
        if (ciclo === meu) ciclo = null;
      });
    return obter();
  }

  // A verificação (ou geração) em andamento, para quem precisa esperar (testes).
  function emAndamento() {
    return ciclo ? ciclo.promessa : Promise.resolve();
  }

  function verificacaoAutomatica() {
    cancelarAgendamento = agendar(verificacaoAutomatica, INTERVALO_ENTRE_VERIFICACOES_MS);
    try {
      verificar({ manual: false });
    } catch (erro) {
      registrarSeguro(`Falha na verificação automática: ${detalheDoErro(erro)}`);
    }
  }

  function iniciar() {
    if (!ligado || iniciado) return;
    iniciado = true;
    cancelarAgendamento = agendar(verificacaoAutomatica, ATRASO_DA_PRIMEIRA_VERIFICACAO_MS);
  }

  function parar() {
    if (cancelarAgendamento) cancelarAgendamento();
    cancelarAgendamento = null;
    iniciado = false;
  }

  // Só em "pronta": `antesDeInstalar` (o main encerra o servidor) e a troca do
  // app. Devolve true se a troca começou.
  function instalarAgora({ antesDeInstalar } = {}) {
    if (!ligado || estado.situacao !== "pronta" || instalando) return false;
    instalando = true;
    registrarSeguro(`Instalando a versão ${estado.versaoNova || "nova"} agora; o app reabre sozinho.`);
    try {
      if (typeof antesDeInstalar === "function") antesDeInstalar();
      instalarApp({ appGerado });
      return true;
    } catch (erro) {
      instalando = false;
      const mensagem =
        `Não foi possível iniciar a troca do app pela versão ${estado.versaoNova || "nova"} (${detalheDoErro(erro)}). ` +
        "Procure a atualização de novo para tentar outra vez.";
      registrarSeguro(`Falha na atualização: ${mensagem}`);
      definir({ situacao: "erro", mensagemDeErro: mensagem });
      return false;
    }
  }

  // O app está fechando com a versão em "pronta" (ou "aguardando", que por
  // dentro é "pronta"): troca sem reabrir, como o Windows instala ao fechar.
  // Não repete se o "Reiniciar agora" (ou um fechamento anterior) já trocou.
  // Devolve true se a troca começou.
  function instalarAoFechar() {
    if (!ligado || estado.situacao !== "pronta" || instalando) return false;
    instalando = true;
    registrarSeguro(`O app está fechando: instalando a versão ${estado.versaoNova || "nova"} sem reabrir.`);
    try {
      instalarApp({ appGerado, reabrir: false });
      return true;
    } catch (erro) {
      registrarSeguro(`Falha ao instalar a atualização ao fechar o app: ${detalheDoErro(erro)}`);
      return false;
    }
  }

  return { obter, verificar, iniciar, parar, instalarAgora, instalarAoFechar, emAndamento };
}

// ──────────────────────────────────────────────────────────────────────────
// Espera pelos orquestradores (Windows e Mac): envolve o serviço de dentro
// (o do electron-updater ou o do Mac).
//   instalarAgora({ forcar }) → { iniciou, orquestradoresTrabalhando }: sem
//     forcar e com orquestradores trabalhando, não reinicia.
//   instalarQuandoLivre(): "aguardando"; confere o registro a cada 15 s e
//     instala quando zerar.
//   cancelarEspera(): volta para "pronta".
//   instalarAoFechar(): o app está fechando; repassa ao serviço de dentro.
// O serviço de dentro deve receber `aoMudarDoServico` como o aoMudar dele e
// ser ligado com `ligar(servico)`.
// contarTrabalhando(): orquestradores trabalhando agora.
// instalar(): instala de verdade (o main encerra o servidor e chama o
//   instalarAgora do serviço de dentro); devolve (ou resolve) true se começou.
// ──────────────────────────────────────────────────────────────────────────
function criarEsperaDosOrquestradores({
  contarTrabalhando = () => 0,
  instalar = () => false,
  registrar = () => {},
  aoMudar = () => {},
  agendar = agendarComTimeout,
  intervaloMs = INTERVALO_DA_ESPERA_MS,
} = {}) {
  let servico = null;
  let espera = null; // { contagem, cancelar }
  let instalandoAgora = false;

  function registrarSeguro(texto) {
    try {
      registrar(texto);
    } catch {
      /* sem log segue */
    }
  }

  function completar(estado) {
    const base = { ...completarEstado(estado), orquestradoresTrabalhando: null };
    if (espera && base.situacao === "pronta") {
      return { ...base, situacao: "aguardando", orquestradoresTrabalhando: espera.contagem };
    }
    return base;
  }

  const situacaoDeDentro = () => (servico ? servico.obter().situacao : "indisponivel");
  const obter = () => completar(servico ? servico.obter() : estadoInicial("", false));

  function avisar(estado) {
    try {
      aoMudar(estado);
    } catch (erro) {
      registrarSeguro(`Falha ao avisar a tela sobre a atualização: ${detalheDoErro(erro)}`);
    }
  }

  function encerrarEspera() {
    if (!espera) return false;
    if (espera.cancelar) espera.cancelar();
    espera = null;
    return true;
  }

  function aoMudarDoServico(estado) {
    if (espera && estado && estado.situacao !== "pronta") encerrarEspera();
    avisar(completar(estado));
  }

  function contar() {
    try {
      const numero = Number(contarTrabalhando());
      return Number.isFinite(numero) && numero > 0 ? Math.floor(numero) : 0;
    } catch (erro) {
      registrarSeguro(`Não foi possível contar os orquestradores trabalhando: ${detalheDoErro(erro)}`);
      return 0;
    }
  }

  async function instalarAgora({ forcar = false } = {}) {
    const orquestradoresTrabalhando = contar();
    if (!forcar && orquestradoresTrabalhando > 0) return { iniciou: false, orquestradoresTrabalhando };
    if (!servico || situacaoDeDentro() !== "pronta" || instalandoAgora) return { iniciou: false, orquestradoresTrabalhando };
    instalandoAgora = true;
    if (encerrarEspera()) avisar(obter());
    let iniciou = false;
    try {
      iniciou = Boolean(await instalar());
    } catch (erro) {
      registrarSeguro(`Falha ao instalar a atualização: ${detalheDoErro(erro)}`);
    } finally {
      instalandoAgora = iniciou;
    }
    return { iniciou, orquestradoresTrabalhando };
  }

  function conferir() {
    if (!espera) return;
    espera.cancelar = null;
    const contagem = contar();
    if (contagem === 0) {
      registrarSeguro("Os orquestradores terminaram: instalando a atualização.");
      instalarAgora({ forcar: true });
      return;
    }
    if (contagem !== espera.contagem) {
      espera.contagem = contagem;
      avisar(obter());
    }
    espera.cancelar = agendar(conferir, intervaloMs);
  }

  function instalarQuandoLivre() {
    if (!servico || situacaoDeDentro() !== "pronta" || espera || instalandoAgora) return obter();
    const contagem = contar();
    if (contagem === 0) {
      instalarAgora({ forcar: true });
      return obter();
    }
    registrarSeguro(`Atualização pronta: instala quando ${contagem} orquestrador(es) terminarem.`);
    espera = { contagem, cancelar: agendar(conferir, intervaloMs) };
    avisar(obter());
    return obter();
  }

  function cancelarEspera() {
    if (encerrarEspera()) {
      registrarSeguro("Espera pelos orquestradores cancelada.");
      avisar(obter());
    }
    return obter();
  }

  return {
    ligar: (servicoDeDentro) => {
      servico = servicoDeDentro;
    },
    aoMudarDoServico,
    obter,
    verificar: (opcoes) => completar(servico ? servico.verificar(opcoes) : obter()),
    iniciar: () => servico && servico.iniciar(),
    parar: () => {
      encerrarEspera();
      if (servico) servico.parar();
    },
    instalarAgora,
    instalarQuandoLivre,
    cancelarEspera,
    // App fechando: encerra a espera e, se o serviço de dentro souber (o do
    // Mac; o electron-updater já instala sozinho ao fechar), instala sem
    // reabrir. Nada se o "Reiniciar agora" já disparou a instalação.
    instalarAoFechar: () => {
      encerrarEspera();
      if (!servico || instalandoAgora || typeof servico.instalarAoFechar !== "function") return false;
      try {
        return Boolean(servico.instalarAoFechar());
      } catch (erro) {
        registrarSeguro(`Falha ao instalar a atualização ao fechar o app: ${detalheDoErro(erro)}`);
        return false;
      }
    },
  };
}

module.exports = {
  ETAPA_APP,
  ETAPA_CODIGO,
  ETAPA_DEPENDENCIAS,
  ETAPA_PROCURANDO,
  INTERVALO_DA_ESPERA_MS,
  ambienteDosComandos,
  caminhoDoAppGerado,
  caminhoDoBackup,
  commitCurto,
  completarEstado,
  contarOrquestradoresTrabalhando,
  criarEsperaDosOrquestradores,
  criarExecutorDeComandos,
  criarServicoDeAtualizacaoDoMac,
  ehRepositorioGit,
  fimDoLog,
  iniciarTrocaDoApp,
  lerProcessosEmExecucao,
  pastaDoAppPeloExecutavel,
  pastaDoCodigoDoMac,
  pidVivo,
  remotoPreferido,
  versaoComCommit,
};
