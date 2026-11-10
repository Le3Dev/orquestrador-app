"use strict";

// Modelos do Whisper para o motor nativo de transcrição (electron/transcritorNativo.js).
//
// O utilitário roda com `env.allowRemoteModels = false`: quem baixa é o
// processo principal, com o `net.fetch` do Electron (usa o repositório de
// certificados do sistema; o `fetch` do Node falha atrás do proxy corporativo
// que inspeciona TLS). Os arquivos ficam em <userData>/modelos-da-transcricao/
// <repo>/..., o mesmo layout que o transformers.js procura em `localModelPath`.
//
// Cada arquivo é baixado num ".parcial" e renomeado no fim; um ".parcial" que
// sobrou de uma tentativa anterior é retomado com `Range`.
//
// Lógica pura (lista de arquivos, caminhos, URLs) separada do download, que
// recebe o `buscar` (net.fetch) injetado para permitir teste sem Electron.

const fs = require("node:fs");
const path = require("node:path");

/** Nome curto do modelo → repositório no Hugging Face. */
const REPOSITORIOS = Object.freeze({
  base: "onnx-community/whisper-base",
  small: "onnx-community/whisper-small",
  turbo: "onnx-community/whisper-large-v3-turbo",
});

/** Sufixo do arquivo .onnx por precisão (DEFAULT_DTYPE_SUFFIX_MAPPING do transformers.js). */
const SUFIXOS_DA_PRECISAO = Object.freeze({
  fp32: "",
  fp16: "_fp16",
  q8: "_quantized",
  q4: "_q4",
});

/** Configurações que o pipeline de ASR do Whisper lê (modelo, gerador, processador e tokenizer). */
const ARQUIVOS_DE_CONFIGURACAO = Object.freeze([
  "config.json",
  "generation_config.json",
  "preprocessor_config.json",
  "tokenizer.json",
  "tokenizer_config.json",
]);

/** Sessões ONNX do Whisper no transformers.js (encoder + decoder com cache). */
const SESSOES_DO_WHISPER = Object.freeze(["encoder_model", "decoder_model_merged"]);

const SUBPASTA_DO_ONNX = "onnx";
const NOME_DA_PASTA = "modelos-da-transcricao";
const LIMITE_DE_PARTES_EXTERNAS = 100;
const MB = 1024 * 1024;

function nomeCurtoDoRepositorio(repositorio) {
  for (const [curto, repo] of Object.entries(REPOSITORIOS)) {
    if (repo === repositorio) return curto;
  }
  return null;
}

function sufixoDaPrecisao(precisao) {
  if (!Object.prototype.hasOwnProperty.call(SUFIXOS_DA_PRECISAO, precisao)) {
    throw new Error(`Precisão desconhecida: "${precisao}". Use uma de: ${Object.keys(SUFIXOS_DA_PRECISAO).join(", ")}.`);
  }
  return SUFIXOS_DA_PRECISAO[precisao];
}

// Quantas partes ".onnx_data" a sessão tem, como resolveExternalDataFormat do
// transformers.js: `use_external_data_format` do "transformers.js_config" (com
// o ajuste do dispositivo em device_config) pode ser booleano/número ou um
// mapa por arquivo ("encoder_model.onnx": true) ou por sessão.
function partesExternas(configuracao, nomeDoArquivo, sessao, dispositivo) {
  let ajustes = (configuracao && configuracao["transformers.js_config"]) || {};
  const porDispositivo = ajustes.device_config && dispositivo ? ajustes.device_config[dispositivo] : null;
  if (porDispositivo && typeof porDispositivo === "object") ajustes = { ...ajustes, ...porDispositivo };
  const formato = ajustes.use_external_data_format;
  if (!formato) return 0;
  let partes;
  if (typeof formato === "object") {
    if (Object.prototype.hasOwnProperty.call(formato, nomeDoArquivo)) partes = +formato[nomeDoArquivo];
    else if (Object.prototype.hasOwnProperty.call(formato, sessao)) partes = +formato[sessao];
    else partes = 0;
  } else {
    partes = +formato;
  }
  if (!Number.isFinite(partes) || partes <= 0) return 0;
  return Math.min(Math.floor(partes), LIMITE_DE_PARTES_EXTERNAS);
}

/**
 * Arquivos de um modelo numa precisão, relativos à raiz do repositório.
 * Sem a `configuracao` (config.json ainda não baixado), não há como saber das
 * partes ".onnx_data": a lista sai só com as configurações e os .onnx.
 *
 * @param {{ precisao: string, configuracao?: object|null, dispositivo?: string|null }} p
 * @returns {string[]}
 */
function arquivosDoModelo({ precisao, configuracao = null, dispositivo = null }) {
  const sufixo = sufixoDaPrecisao(precisao);
  const arquivos = [...ARQUIVOS_DE_CONFIGURACAO];
  for (const sessao of SESSOES_DO_WHISPER) {
    const nome = `${sessao}${sufixo}.onnx`;
    arquivos.push(`${SUBPASTA_DO_ONNX}/${nome}`);
    const partes = partesExternas(configuracao, nome, sessao, dispositivo);
    for (let i = 0; i < partes; i++) {
      arquivos.push(`${SUBPASTA_DO_ONNX}/${nome}_data${i === 0 ? "" : `_${i}`}`);
    }
  }
  return arquivos;
}

function pastaDosModelos(pastaDoUsuario) {
  return path.join(pastaDoUsuario, NOME_DA_PASTA);
}

// Só repositório conhecido e arquivo sem "..": o pedido vem de outro processo.
function validarRepositorio(repositorio) {
  if (nomeCurtoDoRepositorio(repositorio) === null) {
    throw new Error(`Modelo desconhecido: "${repositorio}".`);
  }
}

function validarArquivo(arquivo) {
  if (typeof arquivo !== "string" || arquivo.length === 0 || arquivo.startsWith("/") || arquivo.split("/").some((parte) => parte === ".." || parte === "" || parte.includes("\\"))) {
    throw new Error(`Arquivo de modelo inválido: "${arquivo}".`);
  }
}

function urlDoArquivo(repositorio, arquivo) {
  validarRepositorio(repositorio);
  validarArquivo(arquivo);
  return `https://huggingface.co/${repositorio}/resolve/main/${arquivo}`;
}

function caminhoDoArquivo(pasta, repositorio, arquivo) {
  validarRepositorio(repositorio);
  validarArquivo(arquivo);
  return path.join(pasta, ...repositorio.split("/"), ...arquivo.split("/"));
}

function paraMb(bytes) {
  return Math.round((bytes / MB) * 10) / 10;
}

function tamanhoLocal(caminho) {
  try {
    return fs.statSync(caminho).size;
  } catch {
    return 0;
  }
}

function existe(caminho) {
  try {
    return fs.statSync(caminho).isFile();
  } catch {
    return false;
  }
}

function numeroDoCabecalho(resposta, nome) {
  const valor = resposta.headers.get(nome);
  if (valor === null || valor === "") return null;
  const numero = Number(valor);
  return Number.isFinite(numero) && numero >= 0 ? numero : null;
}

// Tamanhos pela API de árvore do Hugging Face (um pedido por pasta), para os
// arquivos que faltam. O HEAD não basta: o net.fetch segue o redirecionamento
// e perde o x-linked-size, e os JSON chegam comprimidos, sem content-length.
async function tamanhosPelaApi(buscar, repositorio, arquivos) {
  const tamanhos = new Map();
  const pastas = [...new Set(arquivos.map((arquivo) => (arquivo.includes("/") ? arquivo.slice(0, arquivo.lastIndexOf("/")) : "")))];
  await Promise.all(
    pastas.map(async (pasta) => {
      try {
        const resposta = await buscar(`https://huggingface.co/api/models/${repositorio}/tree/main${pasta ? `/${pasta}` : ""}`);
        if (!resposta.ok) return;
        const itens = await resposta.json();
        if (!Array.isArray(itens)) return;
        for (const item of itens) {
          const tamanho = item && item.lfs && Number.isFinite(item.lfs.size) ? item.lfs.size : item && item.size;
          if (item && item.type === "file" && typeof item.path === "string" && Number.isFinite(tamanho) && tamanho >= 0) {
            tamanhos.set(item.path, tamanho);
          }
        }
      } catch {
        /* sem API: fica o HEAD */
      }
    }),
  );
  return tamanhos;
}

// Tamanho do arquivo remoto pelo HEAD: x-linked-size (arquivos LFS do Hugging
// Face) ou content-length, depois de seguir o redirecionamento. null se não souber.
async function tamanhoRemoto(buscar, url) {
  try {
    const resposta = await buscar(url, { method: "HEAD" });
    if (!resposta.ok) return null;
    return numeroDoCabecalho(resposta, "x-linked-size") ?? numeroDoCabecalho(resposta, "content-length");
  } catch {
    return null;
  }
}

// Baixa um arquivo para `destino`, via "<destino>.parcial", retomando o que já
// existe. `aoReceber(bytes)` recebe cada pedaço (negativo quando o servidor
// ignora o Range e o arquivo recomeça do zero).
async function baixarArquivo({ buscar, url, destino, aoReceber = () => {} }) {
  const parcial = `${destino}.parcial`;
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  let inicio = tamanhoLocal(parcial);
  const resposta = await buscar(url, inicio > 0 ? { headers: { Range: `bytes=${inicio}-` } } : {});
  if (resposta.status === 416 && inicio > 0) {
    // O ".parcial" não bate com o arquivo remoto: recomeça do zero.
    fs.rmSync(parcial, { force: true });
    aoReceber(-inicio);
    return baixarArquivo({ buscar, url, destino, aoReceber });
  }
  if (!resposta.ok || !resposta.body) {
    throw new Error(`O download de ${url} falhou (HTTP ${resposta.status}).`);
  }
  // O net.fetch entrega o corpo já descomprimido, mas o content-length é o do
  // corpo comprimido (os JSON do Hugging Face vêm em gzip): aí ele não serve
  // para conferir, e um pedaço comprimido não continua um ".parcial".
  const codificacao = (resposta.headers.get("content-encoding") || "identity").trim().toLowerCase();
  const comprimida = codificacao !== "" && codificacao !== "identity";
  if (comprimida && inicio > 0 && resposta.status === 206) {
    await resposta.body.cancel().catch(() => {});
    fs.rmSync(parcial, { force: true });
    aoReceber(-inicio);
    return baixarArquivo({ buscar, url, destino, aoReceber });
  }
  const anexar = inicio > 0 && resposta.status === 206;
  if (!anexar && inicio > 0) {
    aoReceber(-inicio);
    inicio = 0;
  }
  const esperado = comprimida ? null : numeroDoCabecalho(resposta, "content-length");
  const arquivo = await fs.promises.open(parcial, anexar ? "a" : "w");
  let recebidos = 0;
  try {
    const leitor = resposta.body.getReader();
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      await arquivo.write(value);
      recebidos += value.byteLength;
      aoReceber(value.byteLength);
    }
  } finally {
    await arquivo.close();
  }
  if (esperado !== null && recebidos !== esperado) {
    throw new Error(`O download de ${url} veio incompleto (${recebidos} de ${esperado} bytes); tente de novo para retomar.`);
  }
  fs.renameSync(parcial, destino);
}

/**
 * Garante os arquivos de um modelo numa precisão em `pasta`, baixando o que
 * falta. Antes de baixar, informa o total em MB (progresso 0); depois, o
 * progresso de 0 a 100. Sem nada a baixar, não chama `aoProgredir`.
 *
 * @param {object} p
 * @param {string} p.repositorio  ex.: "onnx-community/whisper-base"
 * @param {string} p.precisao     "fp32" | "fp16" | "q8" | "q4"
 * @param {string|null} [p.dispositivo]
 * @param {string} p.pasta        <userData>/modelos-da-transcricao
 * @param {(url: string, opcoes?: object) => Promise<Response>} p.buscar  net.fetch
 * @param {(estado: { progresso: number, totalMb: number|null }) => void} [p.aoProgredir]
 * @returns {Promise<{ baixados: string[] }>}
 */
async function baixarModelo({ repositorio, precisao, dispositivo = null, pasta, buscar, aoProgredir = () => {} }) {
  validarRepositorio(repositorio);
  sufixoDaPrecisao(precisao);
  const baixados = [];

  // O config.json vem antes: é ele que diz se há partes ".onnx_data".
  const caminhoDaConfiguracao = caminhoDoArquivo(pasta, repositorio, "config.json");
  if (!existe(caminhoDaConfiguracao)) {
    await baixarArquivo({ buscar, url: urlDoArquivo(repositorio, "config.json"), destino: caminhoDaConfiguracao });
    baixados.push("config.json");
  }
  let configuracao = null;
  try {
    configuracao = JSON.parse(fs.readFileSync(caminhoDaConfiguracao, "utf8"));
  } catch (erro) {
    fs.rmSync(caminhoDaConfiguracao, { force: true });
    throw new Error(`O config.json de ${repositorio} está corrompido e foi apagado; tente de novo. (${erro.message || erro})`);
  }

  const faltando = arquivosDoModelo({ precisao, configuracao, dispositivo }).filter(
    (arquivo) => !existe(caminhoDoArquivo(pasta, repositorio, arquivo)),
  );
  if (faltando.length === 0) return { baixados };

  const pelaApi = await tamanhosPelaApi(buscar, repositorio, faltando);
  const tamanhos = await Promise.all(
    faltando.map((arquivo) => (pelaApi.has(arquivo) ? pelaApi.get(arquivo) : tamanhoRemoto(buscar, urlDoArquivo(repositorio, arquivo)))),
  );
  // Com algum tamanho desconhecido, o total é o do que se conhece (os .onnx,
  // que são quase tudo); o progresso conta só esses arquivos.
  const conhecidos = tamanhos.filter((tamanho) => tamanho !== null);
  const total = conhecidos.length > 0 ? conhecidos.reduce((soma, tamanho) => soma + tamanho, 0) : null;
  const totalMb = total === null ? null : paraMb(total);

  // O que já está nos ".parciais" conta como baixado.
  let feitos = faltando.reduce(
    (soma, arquivo, i) =>
      tamanhos[i] === null ? soma : soma + Math.min(tamanhoLocal(`${caminhoDoArquivo(pasta, repositorio, arquivo)}.parcial`), tamanhos[i]),
    0,
  );
  let ultimoProgresso = -1;
  const progresso = () => (total ? Math.max(0, Math.min(100, Math.floor((feitos / total) * 100))) : 0);
  const avisar = (forcar = false) => {
    const atual = progresso();
    if (!forcar && atual === ultimoProgresso) return;
    ultimoProgresso = atual;
    aoProgredir({ progresso: atual, totalMb });
  };
  avisar(true);

  for (const [i, arquivo] of faltando.entries()) {
    const conta = tamanhos[i] !== null;
    await baixarArquivo({
      buscar,
      url: urlDoArquivo(repositorio, arquivo),
      destino: caminhoDoArquivo(pasta, repositorio, arquivo),
      aoReceber: (bytes) => {
        if (!conta) return;
        feitos += bytes;
        avisar();
      },
    });
    baixados.push(arquivo);
  }
  if (ultimoProgresso !== 100) {
    ultimoProgresso = 100;
    aoProgredir({ progresso: 100, totalMb });
  }
  return { baixados };
}

module.exports = {
  ARQUIVOS_DE_CONFIGURACAO,
  REPOSITORIOS,
  SUFIXOS_DA_PRECISAO,
  arquivosDoModelo,
  baixarArquivo,
  baixarModelo,
  caminhoDoArquivo,
  nomeCurtoDoRepositorio,
  partesExternas,
  pastaDosModelos,
  sufixoDaPrecisao,
  urlDoArquivo,
};
