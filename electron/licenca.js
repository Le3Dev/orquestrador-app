"use strict";

// Ativação ONLINE de licença via API pública do Lemon Squeezy, com GRACE
// PERIOD offline. Roda no processo MAIN do Electron (tem acesso a Node, rede e
// ao disco do usuário). O preload expõe estas funções à SPA via IPC.
//
// Não há backend próprio nem API secreta: os endpoints de licença da Lemon
// Squeezy se autenticam com a própria license_key digitada pelo usuário.

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execSync } = require("node:child_process");

const config = require("./config");

// Pasta de dados do usuário é injetada no init() (vem de app.getPath).
let arquivoDeLicenca = null;

function iniciar(pastaDadosUsuario) {
  arquivoDeLicenca = path.join(pastaDadosUsuario, "licenca.json");
}

// ──────────────────────────────────────────────────────────────────────────
// Fingerprint de hardware — identifica a máquina para o instance_name.
// Combina sinais estáveis: hostname, 1º MAC físico e (no Windows) o MachineGuid
// do registro. Hash SHA-256 para não expor os dados crus.
// ──────────────────────────────────────────────────────────────────────────
function primeiroMacEstavel() {
  const interfaces = os.networkInterfaces();
  for (const nome of Object.keys(interfaces)) {
    for (const rede of interfaces[nome] || []) {
      if (!rede.internal && rede.mac && rede.mac !== "00:00:00:00:00:00") {
        return rede.mac;
      }
    }
  }
  return "sem-mac";
}

function machineGuidWindows() {
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

function fingerprintDaMaquina() {
  const sinais = [os.hostname(), primeiroMacEstavel(), machineGuidWindows()].join("::");
  return crypto.createHash("sha256").update(sinais).digest("hex");
}

// Nome amigável + fingerprint para o instance_name no Lemon Squeezy.
function instanceName() {
  return `${os.hostname()}-${fingerprintDaMaquina().slice(0, 12)}`;
}

// ──────────────────────────────────────────────────────────────────────────
// Persistência local (JSON em app.getPath('userData')).
// ──────────────────────────────────────────────────────────────────────────
function lerCache() {
  if (!arquivoDeLicenca || !fs.existsSync(arquivoDeLicenca)) return null;
  try {
    return JSON.parse(fs.readFileSync(arquivoDeLicenca, "utf8"));
  } catch {
    return null;
  }
}

function gravarCache(dados) {
  if (!arquivoDeLicenca) return;
  fs.mkdirSync(path.dirname(arquivoDeLicenca), { recursive: true });
  fs.writeFileSync(arquivoDeLicenca, JSON.stringify(dados, null, 2), "utf8");
}

function apagarCache() {
  if (arquivoDeLicenca && fs.existsSync(arquivoDeLicenca)) {
    fs.rmSync(arquivoDeLicenca, { force: true });
  }
}

// ──────────────────────────────────────────────────────────────────────────
// HTTP para a Lemon Squeezy (fetch nativo do Node 18+/Electron).
// ──────────────────────────────────────────────────────────────────────────
async function postLemon(url, campos) {
  const corpo = new URLSearchParams(campos).toString();
  const controlador = new AbortController();
  const limite = setTimeout(() => controlador.abort(), config.requestTimeoutMs);
  try {
    const resposta = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: corpo,
      signal: controlador.signal,
    });
    const json = await resposta.json().catch(() => ({}));
    return { ok: resposta.ok, status: resposta.status, json };
  } finally {
    clearTimeout(limite);
  }
}

// Confere, quando configurado, que a licença é da loja/produto esperados.
function pertenceAoProduto(json) {
  const meta = json && json.meta ? json.meta : {};
  if (config.expectedStoreId != null && Number(meta.store_id) !== Number(config.expectedStoreId)) {
    return false;
  }
  if (config.expectedProductId != null && Number(meta.product_id) !== Number(config.expectedProductId)) {
    return false;
  }
  return true;
}

// ──────────────────────────────────────────────────────────────────────────
// activate — vincula esta máquina à chave e guarda o instance_id localmente.
// ──────────────────────────────────────────────────────────────────────────
async function activate(licenseKey) {
  const key = (licenseKey || "").trim();
  if (!key) {
    return { ok: false, motivo: "chave-vazia", mensagem: "Informe a chave de licença." };
  }

  let resposta;
  try {
    resposta = await postLemon(config.endpoints.activate, {
      license_key: key,
      instance_name: instanceName(),
    });
  } catch (erro) {
    return { ok: false, motivo: "offline", mensagem: "Sem conexão para ativar. Verifique a internet e tente de novo." };
  }

  const json = resposta.json || {};
  // A API responde activated:true quando deu certo (mesmo com HTTP 200).
  if (!resposta.ok || json.activated !== true || !json.instance || !json.instance.id) {
    const mensagem = json.error || "Não foi possível ativar essa chave. Confira a chave e o limite de ativações.";
    return { ok: false, motivo: "recusada", mensagem };
  }

  if (!pertenceAoProduto(json)) {
    // Desfaz a ativação indevida para não gastar um slot da chave.
    try {
      await postLemon(config.endpoints.deactivate, { license_key: key, instance_id: json.instance.id });
    } catch {
      /* ignora: nada a fazer offline */
    }
    return { ok: false, motivo: "produto-incorreto", mensagem: "Essa chave não pertence a este produto." };
  }

  gravarCache({
    licenseKey: key,
    instanceId: json.instance.id,
    ultimaValidacaoOk: new Date().toISOString(),
    meta: json.meta || null,
  });

  return { ok: true, mensagem: "Licença ativada.", status: resumirStatus() };
}

// ──────────────────────────────────────────────────────────────────────────
// validate — revalida online; cai no grace period offline quando sem rede.
// Retorna { ok, motivo, online, graceRestanteDias }.
// ──────────────────────────────────────────────────────────────────────────
async function validate() {
  const cache = lerCache();
  if (!cache || !cache.licenseKey || !cache.instanceId) {
    return { ok: false, motivo: "sem-licenca", online: false };
  }

  let resposta;
  try {
    resposta = await postLemon(config.endpoints.validate, {
      license_key: cache.licenseKey,
      instance_id: cache.instanceId,
    });
  } catch {
    // Offline: libera se ainda estiver dentro do grace period.
    return avaliarGrace(cache);
  }

  const json = resposta.json || {};
  if (resposta.ok && json.valid === true) {
    gravarCache({ ...cache, ultimaValidacaoOk: new Date().toISOString(), meta: json.meta || cache.meta });
    return { ok: true, motivo: "valida", online: true };
  }

  // Resposta do servidor dizendo que a licença não vale mais (expirada,
  // revogada, instância desativada): bloqueia de imediato, sem grace.
  return { ok: false, motivo: "invalida", online: true, mensagem: json.error || "Licença inválida ou expirada." };
}

// Decide, offline, se o grace period ainda cobre a abertura do app.
function avaliarGrace(cache) {
  const base = cache.ultimaValidacaoOk ? Date.parse(cache.ultimaValidacaoOk) : NaN;
  if (Number.isNaN(base)) {
    return { ok: false, motivo: "sem-validacao-previa", online: false };
  }
  const diasPassados = (Date.now() - base) / 86_400_000;
  const restante = config.gracePeriodDays - diasPassados;
  if (restante > 0) {
    return { ok: true, motivo: "grace", online: false, graceRestanteDias: Math.ceil(restante) };
  }
  return { ok: false, motivo: "grace-expirado", online: false };
}

// ──────────────────────────────────────────────────────────────────────────
// deactivate — libera o slot desta máquina e apaga o cache local.
// ──────────────────────────────────────────────────────────────────────────
async function deactivate() {
  const cache = lerCache();
  if (!cache || !cache.licenseKey || !cache.instanceId) {
    apagarCache();
    return { ok: true, mensagem: "Nenhuma licença ativa nesta máquina." };
  }

  try {
    await postLemon(config.endpoints.deactivate, {
      license_key: cache.licenseKey,
      instance_id: cache.instanceId,
    });
  } catch {
    // Mesmo offline, limpamos o cache local; o slot some no painel ou expira.
  }
  apagarCache();
  return { ok: true, mensagem: "Licença desativada nesta máquina." };
}

// ──────────────────────────────────────────────────────────────────────────
// status — leitura rápida do estado local (sem rede), para a UI.
// ──────────────────────────────────────────────────────────────────────────
function resumirStatus() {
  const cache = lerCache();
  if (!cache || !cache.licenseKey || !cache.instanceId) {
    return { ativada: false };
  }
  const base = cache.ultimaValidacaoOk ? Date.parse(cache.ultimaValidacaoOk) : NaN;
  let graceRestanteDias = null;
  if (!Number.isNaN(base)) {
    graceRestanteDias = Math.max(0, Math.ceil(config.gracePeriodDays - (Date.now() - base) / 86_400_000));
  }
  return {
    ativada: true,
    instanceName: instanceName(),
    ultimaValidacaoOk: cache.ultimaValidacaoOk || null,
    graceRestanteDias,
  };
}

function status() {
  return resumirStatus();
}

// Usado no startup do main: existe licença local E ela passa (online ou grace)?
async function liberadoParaAbrir() {
  const resultado = await validate();
  return { liberado: resultado.ok, detalhe: resultado };
}

module.exports = {
  iniciar,
  activate,
  validate,
  deactivate,
  status,
  liberadoParaAbrir,
  fingerprintDaMaquina,
  instanceName,
};
