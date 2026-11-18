"use strict";

// Licença por assinatura (Stripe) via SERVIÇO DE LICENÇAS próprio, com login
// por e-mail + código de 6 dígitos (teste grátis de 7 dias no primeiro login).
// Roda no processo MAIN do Electron; o preload expõe estas funções à tela de
// entrada via IPC.
//
// Modelo: o login devolve uma SESSÃO (segredo, guardada cifrada) e um TOKEN
// assinado com Ed25519, preso a esta máquina e de validade curta. O app guarda
// e-mail, sessão cifrada e token em `licenca.json` e confere a assinatura com a
// CHAVE PÚBLICA (a privada fica só no serviço, repositório privado
// Le3Dev/orquestrador-licencas). Sem rede, o app abre enquanto o token guardado
// for válido, desta máquina e o relógio não tiver voltado.
//
// Como em atualizacao.js, o serviço é criado com dependências injetadas
// (fetch, relógio, pasta, cifra, configuração), o que o deixa testável sem
// Electron. No fim do arquivo há um serviço padrão, ligado ao config.js.

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execSync } = require("node:child_process");

const config = require("./config");

// Tolerância do relógio: abaixo disso, "voltar no tempo" não bloqueia
// (ajuste automático de horário, horário de verão, etc.).
const TOLERANCIA_DO_RELOGIO_MS = 10 * 60 * 1000;
const VERSAO_DO_TOKEN = 1;
const TAMANHO_MAXIMO_DO_NOME = 80;
// Offline com o token vencendo em menos que isso: a tela avisa para conectar.
const AVISO_DE_VENCIMENTO_MS = 48 * 60 * 60 * 1000;

const UM_DIA_MS = 24 * 60 * 60 * 1000;

const MENSAGENS = {
  "sem-licenca": "Entre com seu e-mail para usar o app neste computador.",
  "sem-configuracao": "App sem configuração de licença. Reinstale o aplicativo ou fale com o suporte.",
  "email-invalido": "Informe um e-mail válido.",
  "codigo-vazio": "Informe o código de 6 dígitos enviado ao seu e-mail.",
  "muitas-tentativas": "Muitas tentativas. Aguarde alguns minutos e tente de novo.",
  "codigo-invalido": "Código incorreto. Confira e tente de novo.",
  "codigo-expirado": "O código expirou. Peça um novo código.",
  "teste-ja-usado": "O teste grátis deste e-mail já foi usado. Assine para continuar.",
  "teste-expirado": "Seu teste grátis terminou. Assine com o mesmo e-mail para continuar.",
  "maquina-substituida": "Sua conta foi usada em outro computador. Entre de novo para usar aqui.",
  "assinatura-inativa": "A assinatura desta conta não está ativa. Renove a assinatura para continuar usando o app.",
  "sessao-invalida": "Sua sessão não é mais válida. Entre de novo.",
  "limite-de-maquinas": "Este e-mail já está em uso em outro computador.",
  "pedido-invalido": "Pedido inválido. Confira os dados e tente de novo.",
  "offline": "Sem conexão com o servidor de licenças. Verifique a internet e tente de novo.",
  "token-invalido": "A licença guardada neste computador é inválida. Entre de novo.",
  "outra-maquina": "A licença guardada foi emitida para outro computador. Entre de novo neste.",
  "token-expirado": "A licença expirou e não foi possível renová-la. Conecte-se à internet e tente de novo.",
  "relogio-alterado": "O relógio do computador foi alterado. Acerte a data e a hora e abra o app de novo.",
};

function mensagemDoMotivo(motivo, mensagemDoServidor) {
  return mensagemDoServidor || MENSAGENS[motivo] || "Não foi possível validar a licença.";
}

// ──────────────────────────────────────────────────────────────────────────
// Token: JWS compacto, header {"alg":"EdDSA"}, assinatura Ed25519.
// ──────────────────────────────────────────────────────────────────────────
function decodificarBase64Url(texto) {
  return Buffer.from(String(texto), "base64url");
}

// Devolve o payload quando a assinatura confere; senão null. Nunca lança.
function conferirAssinatura(token, chavePublicaPem) {
  try {
    if (typeof token !== "string" || !chavePublicaPem) return null;
    const partes = token.split(".");
    if (partes.length !== 3) return null;
    const [cabecalho, corpo, assinatura] = partes;
    const dadosDoCabecalho = JSON.parse(decodificarBase64Url(cabecalho).toString("utf8"));
    if (!dadosDoCabecalho || dadosDoCabecalho.alg !== "EdDSA") return null;
    const confere = crypto.verify(
      null,
      Buffer.from(`${cabecalho}.${corpo}`),
      chavePublicaPem,
      decodificarBase64Url(assinatura),
    );
    if (!confere) return null;
    const payload = JSON.parse(decodificarBase64Url(corpo).toString("utf8"));
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
}

function sha256Hex(texto) {
  return crypto.createHash("sha256").update(texto).digest("hex");
}

// ──────────────────────────────────────────────────────────────────────────
// Identidade da máquina (leituras reais, trocáveis nos testes).
// ──────────────────────────────────────────────────────────────────────────
function primeiroMacFisico() {
  const interfaces = os.networkInterfaces();
  for (const nome of Object.keys(interfaces)) {
    for (const rede of interfaces[nome] || []) {
      if (!rede.internal && rede.mac && rede.mac !== "00:00:00:00:00:00") return rede.mac;
    }
  }
  return "sem-mac";
}

function lerMachineGuidDoWindows() {
  if (process.platform !== "win32") return "";
  try {
    const saida = execSync(
      'reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
      { encoding: "utf8", windowsHide: true, timeout: 4000 },
    );
    const m = saida.match(/MachineGuid\s+REG_SZ\s+([\w-]+)/i);
    return m ? m[1] : "";
  } catch {
    return "";
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Serviço.
// ──────────────────────────────────────────────────────────────────────────
function criarServicoDeLicenca({
  fetch: fetchInjetado = (...a) => fetch(...a),
  agora = () => Date.now(),
  pastaDoUsuario,
  urlDoServicoDeLicencas,
  chavePublicaDaLicenca,
  cifrar = (texto) => texto,
  decifrar = (texto) => texto,
  lerMachineGuid = lerMachineGuidDoWindows,
  nomeDoComputador = () => os.hostname(),
  lerMacFisico = primeiroMacFisico,
  tempoLimiteDaChamadaMs = 15000,
  intervaloDeRevalidacaoMs = 24 * 60 * 60 * 1000,
  agendar = (fn, ms) => setInterval(fn, ms),
  cancelarAgendamento = (h) => clearInterval(h),
  log = () => {},
} = {}) {
  const arquivoDeLicenca = pastaDoUsuario ? path.join(pastaDoUsuario, "licenca.json") : null;
  const urlBase = String(urlDoServicoDeLicencas || "").replace(/\/+$/, "");
  let idDaMaquinaEmCache = null;
  let temporizador = null;

  function configurado() {
    return Boolean(urlBase && chavePublicaDaLicenca);
  }

  function resultadoSemConfiguracao() {
    log("licenca", "App sem configuração de licença (urlDoServicoDeLicencas/chavePublicaDaLicenca vazias): bloqueado.");
    return { ok: false, motivo: "sem-configuracao", online: false, mensagem: MENSAGENS["sem-configuracao"] };
  }

  // id = sha256 do MachineGuid; sem ele (Mac/erro), sha256 de hostname::MAC.
  function idDaMaquina() {
    if (idDaMaquinaEmCache) return idDaMaquinaEmCache;
    let guid = "";
    try {
      guid = String(lerMachineGuid() || "").trim();
    } catch {
      guid = "";
    }
    idDaMaquinaEmCache = guid
      ? sha256Hex(guid)
      : sha256Hex(`${nomeDoComputador()}::${lerMacFisico()}`);
    return idDaMaquinaEmCache;
  }

  function nomeDaMaquina() {
    return String(nomeDoComputador() || "").slice(0, TAMANHO_MAXIMO_DO_NOME);
  }

  // ── Arquivo local ──────────────────────────────────────────────────────
  // Formato: { email, sessao (cifrada), token, ultimaHoraVista }. Quando o
  // servidor recusa, `token` e `sessao` somem e o e-mail fica para preencher a
  // tela. Arquivo no formato antigo (`chave`, sem e-mail) = não conectado.
  function lerArquivo() {
    if (!arquivoDeLicenca || !fs.existsSync(arquivoDeLicenca)) return null;
    try {
      const dados = JSON.parse(fs.readFileSync(arquivoDeLicenca, "utf8"));
      if (!dados || typeof dados !== "object" || typeof dados.email !== "string" || !dados.email) return null;
      let sessao = null;
      if (typeof dados.sessao === "string" && dados.sessao) {
        try {
          sessao = decifrar(dados.sessao) || null;
        } catch (erro) {
          log("licenca", `Não foi possível decifrar a sessão guardada: ${erro.message || erro}`);
        }
      }
      return {
        email: dados.email,
        sessao,
        token: typeof dados.token === "string" ? dados.token : null,
        ultimaHoraVista: Number.isFinite(dados.ultimaHoraVista) ? dados.ultimaHoraVista : 0,
      };
    } catch {
      return null; // corrompido/adulterado: trata como sem licença
    }
  }

  function gravarArquivo({ email, sessao, token, ultimaHoraVista }) {
    if (!arquivoDeLicenca) return;
    try {
      fs.mkdirSync(path.dirname(arquivoDeLicenca), { recursive: true });
      const dados = {
        email,
        sessao: sessao ? cifrar(sessao) : null,
        token: token || null,
        ultimaHoraVista,
      };
      fs.writeFileSync(arquivoDeLicenca, JSON.stringify(dados, null, 2), "utf8");
    } catch (erro) {
      log("licenca", `Não foi possível gravar a licença local: ${erro.message || erro}`);
    }
  }

  function apagarArquivo() {
    try {
      if (arquivoDeLicenca) fs.rmSync(arquivoDeLicenca, { force: true });
    } catch (erro) {
      log("licenca", `Não foi possível apagar a licença local: ${erro.message || erro}`);
    }
  }

  // Confere assinatura, versão, máquina e prazo. { payload } ou { motivo }.
  function conferirToken(token) {
    const payload = conferirAssinatura(token, chavePublicaDaLicenca);
    if (!payload || payload.v !== VERSAO_DO_TOKEN) return { motivo: "token-invalido" };
    if (payload.maquina !== idDaMaquina()) return { motivo: "outra-maquina" };
    if (!Number.isFinite(payload.expiraEm) || payload.expiraEm <= agora()) return { motivo: "token-expirado" };
    return { payload };
  }

  // ── HTTP ───────────────────────────────────────────────────────────────
  async function postar(rota, corpo) {
    const controlador = new AbortController();
    const limite = setTimeout(() => controlador.abort(), tempoLimiteDaChamadaMs);
    try {
      const resposta = await fetchInjetado(`${urlBase}${rota}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(corpo),
        signal: controlador.signal,
      });
      const json = await resposta.json().catch(() => ({}));
      return { status: resposta.status, json: json || {} };
    } finally {
      clearTimeout(limite);
    }
  }

  function normalizarEmail(email) {
    return String(email || "").trim().toLowerCase();
  }

  function diasRestantes(pagaAte) {
    return Math.max(0, Math.ceil((pagaAte - agora()) / UM_DIA_MS));
  }

  function resumo(payload) {
    if (!payload) return {};
    const dados = { plano: payload.plano || null, expiraEm: payload.expiraEm, pagaAte: payload.pagaAte ?? null };
    if (payload.plano === "teste" && Number.isFinite(payload.pagaAte)) {
      dados.diasRestantesDoTeste = diasRestantes(payload.pagaAte);
    }
    return dados;
  }

  function falha(motivo, mensagemDoServidor, extra = {}) {
    return { ok: false, motivo, mensagem: mensagemDoMotivo(motivo, mensagemDoServidor), ...extra };
  }

  // ── pedirCodigo ────────────────────────────────────────────────────────
  async function pedirCodigo(emailDigitado) {
    const email = normalizarEmail(emailDigitado);
    if (!email) return falha("email-invalido");
    if (!configurado()) {
      const r = resultadoSemConfiguracao();
      return { ok: false, motivo: r.motivo, mensagem: r.mensagem };
    }
    let resposta;
    try {
      resposta = await postar("/v1/entrar/codigo", { email });
    } catch (erro) {
      log("licenca", `Falha de rede ao pedir o código: ${erro.message || erro}`);
      return falha("offline");
    }
    if (resposta.status === 200 && resposta.json.ok === true) {
      return { ok: true, mensagem: "Código enviado. Confira seu e-mail." };
    }
    const motivo = resposta.json.motivo || (resposta.status >= 500 ? "offline" : "pedido-invalido");
    return falha(motivo, resposta.json.erro);
  }

  // ── entrar ─────────────────────────────────────────────────────────────
  // Em `limite-de-maquinas` o código NÃO é gasto: a tela pergunta e reenvia com
  // substituirOutraMaquina: true.
  async function entrar({ email: emailDigitado, codigo: codigoDigitado, substituirOutraMaquina } = {}) {
    const email = normalizarEmail(emailDigitado);
    const codigo = String(codigoDigitado || "").replace(/\s+/g, "");
    if (!email) return falha("email-invalido");
    if (!codigo) return falha("codigo-vazio");
    if (!configurado()) {
      const r = resultadoSemConfiguracao();
      return { ok: false, motivo: r.motivo, mensagem: r.mensagem };
    }

    const corpo = { email, codigo, maquina: { id: idDaMaquina(), nome: nomeDaMaquina() } };
    if (substituirOutraMaquina === true) corpo.substituirOutraMaquina = true;

    let resposta;
    try {
      resposta = await postar("/v1/entrar/confirmar", corpo);
    } catch (erro) {
      log("licenca", `Falha de rede ao entrar: ${erro.message || erro}`);
      return falha("offline");
    }

    const json = resposta.json;
    if (resposta.status !== 200 || typeof json.token !== "string" || typeof json.sessao !== "string") {
      const motivo = json.motivo || (resposta.status >= 500 ? "offline" : "pedido-invalido");
      if (motivo === "limite-de-maquinas") {
        return falha(motivo, json.erro, { outraMaquina: json.outraMaquina || null });
      }
      return falha(motivo, json.erro);
    }

    const conferido = conferirToken(json.token);
    if (!conferido.payload) {
      log("licenca", `Token recebido ao entrar foi rejeitado (${conferido.motivo}).`);
      return { ok: false, motivo: conferido.motivo, mensagem: "O servidor devolveu uma licença inválida. Tente de novo ou fale com o suporte." };
    }

    gravarArquivo({
      email: normalizarEmail(json.email) || email,
      sessao: json.sessao,
      token: json.token,
      ultimaHoraVista: agora(),
    });
    return { ok: true, mensagem: "Pronto! Você entrou.", status: status() };
  }

  // ── validar ────────────────────────────────────────────────────────────
  // Resultado: { ok, motivo, online, mensagem?, plano?, expiraEm?, pagaAte?, avisoOffline? }.
  async function validar() {
    if (!configurado()) return resultadoSemConfiguracao();
    const arquivo = lerArquivo();
    if (!arquivo || !arquivo.sessao) {
      return { ok: false, motivo: "sem-licenca", online: false, mensagem: MENSAGENS["sem-licenca"] };
    }

    let resposta = null;
    try {
      resposta = await postar("/v1/licencas/validar", { sessao: arquivo.sessao, maquina: { id: idDaMaquina() } });
    } catch (erro) {
      log("licenca", `Sem rede para validar (${erro.message || erro}); usando o token guardado.`);
    }

    if (resposta && resposta.status === 200 && typeof resposta.json.token === "string") {
      const conferido = conferirToken(resposta.json.token);
      if (conferido.payload) {
        gravarArquivo({
          ...arquivo,
          token: resposta.json.token,
          ultimaHoraVista: Math.max(arquivo.ultimaHoraVista, agora()),
        });
        return { ok: true, motivo: "valida", online: true, ...resumo(conferido.payload) };
      }
      log("licenca", `Token recebido na validação foi rejeitado (${conferido.motivo}).`);
      desconectarMantendoEmail(arquivo);
      return { ok: false, motivo: conferido.motivo, online: true, mensagem: MENSAGENS[conferido.motivo] };
    }

    if (resposta && resposta.status === 403) {
      const motivo = resposta.json.motivo || "assinatura-inativa";
      desconectarMantendoEmail(arquivo);
      return { ok: false, motivo, online: true, mensagem: mensagemDoMotivo(motivo, resposta.json.erro) };
    }

    // Sem rede, timeout, 5xx ou resposta inesperada: confia no token guardado.
    return validarOffline(arquivo);
  }

  // Apaga token e sessão; o e-mail fica para preencher a tela de entrada.
  function desconectarMantendoEmail(arquivo) {
    gravarArquivo({
      email: arquivo.email,
      sessao: null,
      token: null,
      ultimaHoraVista: Math.max(arquivo.ultimaHoraVista, agora()),
    });
  }

  function validarOffline(arquivo) {
    if (!arquivo.token) {
      return { ok: false, motivo: "sem-licenca", online: false, mensagem: MENSAGENS["sem-licenca"] };
    }
    const conferido = conferirToken(arquivo.token);
    if (!conferido.payload) {
      return { ok: false, motivo: conferido.motivo, online: false, mensagem: MENSAGENS[conferido.motivo] };
    }
    const agoraMs = agora();
    if (agoraMs < arquivo.ultimaHoraVista - TOLERANCIA_DO_RELOGIO_MS) {
      return { ok: false, motivo: "relogio-alterado", online: false, mensagem: MENSAGENS["relogio-alterado"] };
    }
    gravarArquivo({ ...arquivo, ultimaHoraVista: Math.max(arquivo.ultimaHoraVista, agoraMs) });
    const restante = conferido.payload.expiraEm - agoraMs;
    return {
      ok: true,
      motivo: "offline",
      online: false,
      ...resumo(conferido.payload),
      ...(restante < AVISO_DE_VENCIMENTO_MS
        ? { avisoOffline: "Sem conexão com o servidor de licenças. Conecte-se à internet em breve para renovar a licença." }
        : {}),
    };
  }

  // ── sair ───────────────────────────────────────────────────────────────
  // Avisa o servidor (libera o computador) e apaga o arquivo, mesmo offline.
  async function sair() {
    const arquivo = lerArquivo();
    if (arquivo && arquivo.sessao && configurado()) {
      try {
        await postar("/v1/sair", { sessao: arquivo.sessao, maquina: { id: idDaMaquina() } });
      } catch (erro) {
        log("licenca", `Não foi possível avisar o servidor da saída: ${erro.message || erro}`);
      }
    }
    apagarArquivo();
    return { ok: true, mensagem: arquivo ? "Você saiu deste computador." : "Nenhuma conta conectada neste computador." };
  }

  // ── status (sem rede) ──────────────────────────────────────────────────
  function status() {
    const arquivo = lerArquivo();
    const base = {
      conectado: false,
      email: arquivo ? arquivo.email : null,
      plano: null,
      expiraEm: null,
      pagaAte: null,
      nomeDaMaquina: nomeDaMaquina(),
    };
    if (!arquivo || !arquivo.sessao || !arquivo.token || !configurado()) return base;
    const conferido = conferirToken(arquivo.token);
    if (!conferido.payload) return base;
    return { ...base, conectado: true, ...resumo(conferido.payload) };
  }

  async function liberadoParaAbrir() {
    const detalhe = await validar();
    return { liberado: detalhe.ok, detalhe };
  }

  // ── revalidação com o app aberto ───────────────────────────────────────
  function pararRevalidacao() {
    if (temporizador) cancelarAgendamento(temporizador);
    temporizador = null;
  }

  function iniciarRevalidacaoPeriodica({ aoBloquear } = {}) {
    pararRevalidacao();
    let emAndamento = false;
    temporizador = agendar(async () => {
      if (emAndamento) return;
      emAndamento = true;
      try {
        const detalhe = await validar();
        if (!detalhe.ok) {
          pararRevalidacao();
          if (typeof aoBloquear === "function") aoBloquear(detalhe);
        }
      } catch (erro) {
        log("licenca", `Falha na revalidação periódica: ${erro.message || erro}`);
      } finally {
        emAndamento = false;
      }
    }, intervaloDeRevalidacaoMs);
    if (temporizador && typeof temporizador.unref === "function") temporizador.unref();
    return pararRevalidacao;
  }

  return {
    pedirCodigo,
    entrar,
    validar,
    sair,
    status,
    liberadoParaAbrir,
    iniciarRevalidacaoPeriodica,
    pararRevalidacao,
    idDaMaquina,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Serviço padrão, ligado ao config.js (usado pelo main.js).
// ──────────────────────────────────────────────────────────────────────────
let servicoPadrao = null;

function iniciar(pastaDoUsuario, { log, cifrar, decifrar } = {}) {
  if (servicoPadrao) servicoDoPadraoParar();
  servicoPadrao = criarServicoDeLicenca({
    pastaDoUsuario,
    urlDoServicoDeLicencas: config.urlDoServicoDeLicencas,
    chavePublicaDaLicenca: config.chavePublicaDaLicenca,
    tempoLimiteDaChamadaMs: config.tempoLimiteDaChamadaMs,
    intervaloDeRevalidacaoMs: config.intervaloDeRevalidacaoMs,
    ...(cifrar && decifrar ? { cifrar, decifrar } : {}),
    log,
  });
  return servicoPadrao;
}

function servicoDoPadraoParar() {
  try {
    servicoPadrao.pararRevalidacao();
  } catch {
    /* nada a parar */
  }
}

function usar() {
  if (!servicoPadrao) throw new Error("Serviço de licença não iniciado.");
  return servicoPadrao;
}

module.exports = {
  criarServicoDeLicenca,
  conferirAssinatura,
  mensagemDoMotivo,
  TOLERANCIA_DO_RELOGIO_MS,
  iniciar,
  pedirCodigo: (email) => usar().pedirCodigo(email),
  entrar: (dados) => usar().entrar(dados),
  validar: () => usar().validar(),
  sair: () => usar().sair(),
  status: () => usar().status(),
  liberadoParaAbrir: () => usar().liberadoParaAbrir(),
  iniciarRevalidacaoPeriodica: (opcoes) => usar().iniciarRevalidacaoPeriodica(opcoes),
  pararRevalidacao: () => usar().pararRevalidacao(),
};
