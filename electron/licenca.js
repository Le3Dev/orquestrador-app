"use strict";

// Licença por assinatura (Stripe) via SERVIÇO DE LICENÇAS próprio.
// Roda no processo MAIN do Electron; o preload expõe estas funções à tela de
// ativação via IPC.
//
// Modelo: o serviço emite um TOKEN assinado com Ed25519, preso a esta máquina
// e com validade curta (até 7 dias). O app guarda a chave e o token em
// `licenca.json` e confere a assinatura com a CHAVE PÚBLICA (pode ficar no
// código: sem a chave privada do servidor ninguém forja um token). Sem rede, o
// app abre enquanto o token guardado for válido, for desta máquina e o relógio
// não tiver voltado.
//
// Como em atualizacao.js, o serviço é criado com dependências injetadas
// (fetch, relógio, pasta, configuração), o que o deixa testável sem Electron.
// No fim do arquivo há um serviço padrão, ligado ao config.js, para o main.js.

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

const MENSAGENS = {
  "sem-licenca": "Este computador ainda não tem uma licença ativada.",
  "sem-configuracao": "App sem configuração de licença. Reinstale o aplicativo ou fale com o suporte.",
  "chave-vazia": "Informe a chave de licença.",
  "chave-invalida": "Chave de licença inválida. Confira se digitou corretamente.",
  "assinatura-inativa": "A assinatura desta licença não está ativa. Renove a assinatura para continuar usando o app.",
  "limite-de-maquinas": "Esta licença já está ativada no número máximo de computadores. Desative em outro computador antes.",
  "maquina-nao-ativada": "Esta licença não está ativada neste computador. Ative-a novamente.",
  "pedido-invalido": "Pedido de ativação inválido. Confira a chave digitada.",
  "offline": "Sem conexão com o servidor de licenças. Verifique a internet e tente de novo.",
  "token-invalido": "A licença guardada neste computador é inválida. Ative-a novamente.",
  "outra-maquina": "A licença guardada foi ativada em outro computador. Ative-a novamente neste.",
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
  // Formato: { chave, token, ultimaHoraVista }. `token` some quando o servidor
  // recusa (a chave fica para reativar com um clique).
  function lerArquivo() {
    if (!arquivoDeLicenca || !fs.existsSync(arquivoDeLicenca)) return null;
    try {
      const dados = JSON.parse(fs.readFileSync(arquivoDeLicenca, "utf8"));
      if (!dados || typeof dados !== "object" || typeof dados.chave !== "string" || !dados.chave) return null;
      return {
        chave: dados.chave,
        token: typeof dados.token === "string" ? dados.token : null,
        ultimaHoraVista: Number.isFinite(dados.ultimaHoraVista) ? dados.ultimaHoraVista : 0,
      };
    } catch {
      return null; // corrompido/adulterado: trata como sem licença
    }
  }

  function gravarArquivo(dados) {
    if (!arquivoDeLicenca) return;
    try {
      fs.mkdirSync(path.dirname(arquivoDeLicenca), { recursive: true });
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
      const resposta = await fetchInjetado(`${urlBase}/v1/licencas/${rota}`, {
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

  function resumo(payload) {
    return payload
      ? { plano: payload.plano || null, expiraEm: payload.expiraEm, pagaAte: payload.pagaAte ?? null }
      : {};
  }

  // ── ativar ─────────────────────────────────────────────────────────────
  async function ativar(chaveDigitada) {
    const chave = String(chaveDigitada || "").trim().toUpperCase();
    if (!chave) return { ok: false, motivo: "chave-vazia", mensagem: MENSAGENS["chave-vazia"] };
    if (!configurado()) {
      const r = resultadoSemConfiguracao();
      return { ok: false, motivo: r.motivo, mensagem: r.mensagem };
    }

    let resposta;
    try {
      resposta = await postar("ativar", { chave, maquina: { id: idDaMaquina(), nome: nomeDaMaquina() } });
    } catch (erro) {
      log("licenca", `Falha de rede ao ativar: ${erro.message || erro}`);
      return { ok: false, motivo: "offline", mensagem: MENSAGENS.offline };
    }

    if (resposta.status !== 200 || typeof resposta.json.token !== "string") {
      const motivo = resposta.json.motivo || (resposta.status >= 500 ? "offline" : "pedido-invalido");
      return {
        ok: false,
        motivo,
        mensagem: mensagemDoMotivo(motivo, resposta.json.erro) ,
      };
    }

    const conferido = conferirToken(resposta.json.token);
    if (!conferido.payload) {
      log("licenca", `Token recebido na ativação foi rejeitado (${conferido.motivo}).`);
      return { ok: false, motivo: conferido.motivo, mensagem: "O servidor devolveu uma licença inválida. Tente de novo ou fale com o suporte." };
    }

    gravarArquivo({ chave, token: resposta.json.token, ultimaHoraVista: agora() });
    return { ok: true, mensagem: "Licença ativada.", status: status() };
  }

  // ── validar ────────────────────────────────────────────────────────────
  // Resultado: { ok, motivo, online, mensagem?, plano?, expiraEm?, pagaAte?, avisoOffline? }.
  async function validar() {
    if (!configurado()) return resultadoSemConfiguracao();
    const arquivo = lerArquivo();
    if (!arquivo) return { ok: false, motivo: "sem-licenca", online: false, mensagem: MENSAGENS["sem-licenca"] };

    let resposta = null;
    try {
      resposta = await postar("validar", { chave: arquivo.chave, maquina: { id: idDaMaquina() } });
    } catch (erro) {
      log("licenca", `Sem rede para validar (${erro.message || erro}); usando o token guardado.`);
    }

    if (resposta && resposta.status === 200 && typeof resposta.json.token === "string") {
      const conferido = conferirToken(resposta.json.token);
      if (conferido.payload) {
        gravarArquivo({
          chave: arquivo.chave,
          token: resposta.json.token,
          ultimaHoraVista: Math.max(arquivo.ultimaHoraVista, agora()),
        });
        return { ok: true, motivo: "valida", online: true, ...resumo(conferido.payload) };
      }
      log("licenca", `Token recebido na validação foi rejeitado (${conferido.motivo}).`);
      apagarToken(arquivo);
      return { ok: false, motivo: conferido.motivo, online: true, mensagem: MENSAGENS[conferido.motivo] };
    }

    if (resposta && resposta.status === 403) {
      const motivo = resposta.json.motivo || "assinatura-inativa";
      apagarToken(arquivo);
      return { ok: false, motivo, online: true, mensagem: mensagemDoMotivo(motivo, resposta.json.erro) };
    }

    // Sem rede, timeout, 5xx ou resposta inesperada: confia no token guardado.
    return validarOffline(arquivo);
  }

  function apagarToken(arquivo) {
    gravarArquivo({ chave: arquivo.chave, token: null, ultimaHoraVista: Math.max(arquivo.ultimaHoraVista, agora()) });
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

  // ── desativar ──────────────────────────────────────────────────────────
  async function desativar() {
    const arquivo = lerArquivo();
    if (arquivo && configurado()) {
      try {
        await postar("desativar", { chave: arquivo.chave, maquina: { id: idDaMaquina() } });
      } catch (erro) {
        log("licenca", `Não foi possível avisar o servidor da desativação: ${erro.message || erro}`);
      }
    }
    apagarArquivo();
    return { ok: true, mensagem: arquivo ? "Licença desativada neste computador." : "Nenhuma licença ativa neste computador." };
  }

  // ── status (sem rede) ──────────────────────────────────────────────────
  function status() {
    const arquivo = lerArquivo();
    const base = { ativada: false, plano: null, expiraEm: null, pagaAte: null, nomeDaMaquina: nomeDaMaquina() };
    if (!arquivo || !arquivo.token || !configurado()) return base;
    const conferido = conferirToken(arquivo.token);
    if (!conferido.payload) return base;
    return { ...base, ativada: true, ...resumo(conferido.payload) };
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
    ativar,
    validar,
    desativar,
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

function iniciar(pastaDoUsuario, { log } = {}) {
  if (servicoPadrao) servicoDoPadraoParar();
  servicoPadrao = criarServicoDeLicenca({
    pastaDoUsuario,
    urlDoServicoDeLicencas: config.urlDoServicoDeLicencas,
    chavePublicaDaLicenca: config.chavePublicaDaLicenca,
    tempoLimiteDaChamadaMs: config.tempoLimiteDaChamadaMs,
    intervaloDeRevalidacaoMs: config.intervaloDeRevalidacaoMs,
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
  ativar: (chave) => usar().ativar(chave),
  validar: () => usar().validar(),
  desativar: () => usar().desativar(),
  status: () => usar().status(),
  liberadoParaAbrir: () => usar().liberadoParaAbrir(),
  iniciarRevalidacaoPeriodica: (opcoes) => usar().iniciarRevalidacaoPeriodica(opcoes),
  pararRevalidacao: () => usar().pararRevalidacao(),
};
