"use strict";

// Motor nativo de transcrição: entrada do utilityProcess que roda o Whisper com
// o @huggingface/transformers sobre o onnxruntime-node (binding N-API: roda no
// Node do Electron sem rebuild), fora do processo principal e da tela.
//
// Quem sobe, religa e encerra este processo é electron/transcricaoNativa.js.
// Os modelos são baixados pelo principal (net.fetch); aqui o transformers só
// lê do disco (`env.allowRemoteModels = false`).
//
// Canais:
//   - process.parentPort (principal): recebe { tipo: "porta",
//     prioridadeDaEscuta } com a ponta do canal das mensagens da tela,
//     { tipo: "configurar", prioridadeDaEscuta } e as respostas aos pedidos de
//     modelo; envia { tipo: "modelo", pedido, repositorio, precisao,
//     dispositivo }, { tipo: "registro", texto }, { tipo: "pronto", origem,
//     motor, prioridade, mediaDoBaseMs } e { tipo: "ocioso", recebidas }.
//   - porta (MessagePortMain): o protocolo abaixo. O principal repassa as
//     mensagens da tela (com o id de "transcrever" trocado por um interno) e
//     devolve as respostas; a porta da tela não fecha quando este processo sai.
//
// Protocolo da porta (contrato com a tela):
//   tela → motor:
//     { tipo: "preparar", origem: "escuta" | "ditado", prioridade: "velocidade" | "precisao" }
//     { tipo: "transcrever", id, origem, audio: Float32Array (mono 16 kHz), idioma, descartavel }
//     { tipo: "descarregar" }
//   motor → tela:
//     { tipo: "motor", origem, motor: { dispositivo, modelo, precisao, nativo: true } }
//     { tipo: "baixando", origem, progresso, totalMb }
//     { tipo: "pronto", origem }
//     { tipo: "resultado", id, texto, segmentos: [{ texto, inicioS, fimS }], idioma, duracaoDaPassadaMs }
//     { tipo: "erro", id | null, mensagem, descartado?: true, indisponivel?: true }
//
// Escolha da escuta: carrega o base no melhor dispositivo, aquece e mede a
// mediana de 3 passadas de 5 s (B). Turbo se 7·B ≤ limite, small se 2,9·B ≤
// limite, senão base; limite de 1.000 ms na prioridade "velocidade" e de
// 2.500 ms na "precisao". Ditado: nunca o base; reaproveita o da escuta se for
// small ou turbo, senão small na CPU (fora da GPU que a escuta usa).
//
// Fila serial (a GPU é uma só): o ditado passa na frente da escuta; um pedido
// `descartavel` só entra com o motor parado e a fila vazia. Sem pedidos por
// 3 min (ou depois de "descarregar"), avisa o principal ("ocioso", com quantas
// mensagens recebeu); se nada estiver a caminho, ele encerra o processo e
// devolve a memória da GPU. O próximo pedido sobe outro processo.

const os = require("node:os");
const { REPOSITORIOS, nomeCurtoDoRepositorio } = require("./modelosDaTranscricao");

const TAXA_DE_AMOSTRAGEM = 16_000;
/** O Whisper olha no máximo 30 s de áudio de uma vez. */
const AMOSTRAS_NA_JANELA_DO_WHISPER = 30 * TAXA_DE_AMOSTRAGEM;
const OCIOSIDADE_MS = 3 * 60_000;
const IDIOMA_RESERVA = "portuguese";
const CODIGO_DO_IDIOMA_RESERVA = "pt";
const THREADS_DA_CPU = Math.max(1, Math.min(4, (os.cpus() || []).length || 4));

// Medição: 5 s de áudio e um número fixo de tokens (min = max), para que o
// tempo não dependa do que o Whisper "ouve" num sinal sintético. 25 tokens é
// o tamanho típico de 5 s de fala em português com os tokens de tempo.
const SEGUNDOS_DA_MEDICAO = 5;
const TOKENS_DA_MEDICAO = 25;
const PASSADAS_DA_MEDICAO = 3;

const LIMITE_DA_PRIORIDADE_MS = Object.freeze({ velocidade: 1000, precisao: 2500 });
const FATOR_DO_MODELO = Object.freeze({ turbo: 7, small: 2.9 });
const MODELOS_DO_DITADO = Object.freeze(["small", "turbo"]);
const PRIORIDADE_PADRAO = "velocidade";

// ──────────────────────────────────────────────────────────────────────────
// Regras puras (testadas em transcritorNativo.test.js).
// ──────────────────────────────────────────────────────────────────────────

/** Ordem de tentativa dos dispositivos por plataforma. */
function dispositivosDaPlataforma(plataforma) {
  if (plataforma === "win32") return ["webgpu", "dml", "cpu"];
  if (plataforma === "darwin") return ["webgpu", "cpu"];
  return ["cpu"];
}

/**
 * Precisões a tentar, em ordem: WebGPU fp16; DML fp32; CPU fp32 com q8 de
 * reserva para o base e o small. O turbo na CPU vai direto no q8 (em fp32 são
 * 3,1 GB de download e de memória).
 */
function precisoesDoDispositivo(dispositivo, modelo = null) {
  if (dispositivo === "webgpu") return ["fp16"];
  if (dispositivo === "dml") return ["fp32"];
  if (modelo === "turbo") return ["q8"];
  return ["fp32", "q8"];
}

function prioridadeValida(prioridade) {
  return Object.prototype.hasOwnProperty.call(LIMITE_DA_PRIORIDADE_MS, prioridade) ? prioridade : PRIORIDADE_PADRAO;
}

/**
 * Modelo da escuta a partir de B (mediana da passada do base, em ms).
 * @returns {"turbo" | "small" | "base"}
 */
function escolherModeloDaEscuta(mediaDoBaseMs, prioridade = PRIORIDADE_PADRAO) {
  const limite = LIMITE_DA_PRIORIDADE_MS[prioridadeValida(prioridade)];
  if (!Number.isFinite(mediaDoBaseMs) || mediaDoBaseMs <= 0) return "base";
  if (FATOR_DO_MODELO.turbo * mediaDoBaseMs <= limite) return "turbo";
  if (FATOR_DO_MODELO.small * mediaDoBaseMs <= limite) return "small";
  return "base";
}

/**
 * Motor do ditado: reaproveita o da escuta (small ou turbo) ou small na CPU.
 * @param {{ modelo: string } | null} motorDaEscuta  modelo = nome curto
 * @returns {{ reaproveitar: true } | { reaproveitar: false, modelo: "small", dispositivo: "cpu" }}
 */
function escolherMotorDoDitado(motorDaEscuta) {
  if (motorDaEscuta && MODELOS_DO_DITADO.includes(motorDaEscuta.modelo)) return { reaproveitar: true };
  return { reaproveitar: false, modelo: "small", dispositivo: "cpu" };
}

function mediana(valores) {
  const ordenados = [...valores].filter(Number.isFinite).sort((a, b) => a - b);
  if (ordenados.length === 0) return NaN;
  const meio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 === 1 ? ordenados[meio] : (ordenados[meio - 1] + ordenados[meio]) / 2;
}

/**
 * Idioma pedido pela tela → o que passar ao Whisper.
 * "portuguese" → português ("pt"); "automatico" → detectar; um código ("en",
 * "pt"...) ou nome é repassado como está. Vazio/inválido → português.
 * @returns {{ detectar: true } | { detectar: false, language: string, codigo: string }}
 */
function idiomaDoPedido(idioma) {
  if (idioma === "automatico") return { detectar: true };
  if (typeof idioma !== "string" || idioma.trim() === "" || idioma === IDIOMA_RESERVA) {
    return { detectar: false, language: IDIOMA_RESERVA, codigo: CODIGO_DO_IDIOMA_RESERVA };
  }
  const limpo = idioma.trim();
  return { detectar: false, language: limpo, codigo: limpo };
}

/** Saída do pipeline (com return_timestamps) → { texto, segmentos }. */
function segmentosDaSaida(saida, duracaoS) {
  const partes = Array.isArray(saida) ? saida : [saida];
  const texto = partes
    .map((parte) => (parte && typeof parte.text === "string" ? parte.text : ""))
    .join(" ")
    .trim();
  const segmentos = [];
  for (const parte of partes) {
    for (const trecho of (parte && Array.isArray(parte.chunks) ? parte.chunks : [])) {
      const textoDoTrecho = typeof trecho.text === "string" ? trecho.text.trim() : "";
      if (!textoDoTrecho) continue;
      const [inicio, fim] = Array.isArray(trecho.timestamp) ? trecho.timestamp : [null, null];
      const inicioS = Number.isFinite(inicio) ? inicio : 0;
      const fimS = Number.isFinite(fim) ? fim : Math.max(inicioS, duracaoS);
      segmentos.push({ texto: textoDoTrecho, inicioS: arredondar(inicioS), fimS: arredondar(fimS) });
    }
  }
  return { texto, segmentos };
}

function arredondar(segundos) {
  return Math.round(segundos * 100) / 100;
}

/** Áudio que chegou pela porta → Float32Array (aceita o buffer cru ou um array). */
function paraAudio(valor) {
  if (valor instanceof Float32Array) return valor;
  if (valor instanceof ArrayBuffer) return new Float32Array(valor);
  if (ArrayBuffer.isView(valor)) {
    const bytes = new Uint8Array(valor.buffer, valor.byteOffset, valor.byteLength - (valor.byteLength % 4));
    // Float32Array exige deslocamento múltiplo de 4: fora disso, copia.
    return valor.byteOffset % 4 === 0 ? new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4) : new Float32Array(bytes.slice().buffer);
  }
  if (Array.isArray(valor)) return Float32Array.from(valor);
  return null;
}

/**
 * Fila serial com prioridade: o ditado passa na frente da escuta (mantendo a
 * ordem dentro de cada origem); um item `descartavel` só entra com a fila
 * vazia e nada em andamento.
 *
 * @param {{ aoFicarOciosa?: () => void, aoOcupar?: () => void }} [ganchos]
 */
function criarFila({ aoFicarOciosa = () => {}, aoOcupar = () => {} } = {}) {
  const pendentes = [];
  let emAndamento = null;

  async function rodar() {
    while (pendentes.length > 0) {
      emAndamento = pendentes.shift();
      try {
        await emAndamento.executar();
      } catch {
        /* cada item trata (e responde) o próprio erro */
      } finally {
        emAndamento = null;
      }
    }
    aoFicarOciosa();
  }

  return {
    /** @returns {boolean} false quando o item descartável foi recusado. */
    adicionar(item) {
      if (item.descartavel && (emAndamento !== null || pendentes.length > 0)) return false;
      if (item.origem === "ditado") {
        const primeiroDeOutraOrigem = pendentes.findIndex((pendente) => pendente.origem !== "ditado");
        if (primeiroDeOutraOrigem < 0) pendentes.push(item);
        else pendentes.splice(primeiroDeOutraOrigem, 0, item);
      } else {
        pendentes.push(item);
      }
      aoOcupar();
      if (emAndamento === null && pendentes.length === 1) void rodar();
      return true;
    },
    /** Tira da fila (sem executar) os pendentes que satisfazem o predicado. */
    descartar(predicado) {
      const removidos = [];
      for (let i = pendentes.length - 1; i >= 0; i--) {
        if (predicado(pendentes[i])) removidos.unshift(...pendentes.splice(i, 1));
      }
      return removidos;
    },
    ociosa: () => emAndamento === null && pendentes.length === 0,
    get tamanho() {
      return pendentes.length + (emAndamento ? 1 : 0);
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Idioma automático: como web/src/shared/ditado/transcritor.worker.ts.
// No transformers.js 4.3.1, sem `language` o pipeline força inglês; por isso
// um passo do decodificador só com <|startoftranscript|> e, entre os tokens de
// idioma, o de maior logit.
// ──────────────────────────────────────────────────────────────────────────
function ehRegistro(valor) {
  return typeof valor === "object" && valor !== null;
}

function lerTokensDeIdioma(configuracao) {
  if (!ehRegistro(configuracao) || typeof configuracao.decoder_start_token_id !== "number" || !ehRegistro(configuracao.lang_to_id)) {
    return null;
  }
  const idiomas = new Map();
  for (const [token, id] of Object.entries(configuracao.lang_to_id)) {
    const codigo = /^<\|([a-z]{2,3}(?:_[a-z]+)?)\|>$/i.exec(token)?.[1];
    if (typeof id === "number" && codigo !== undefined) idiomas.set(id, codigo);
  }
  return idiomas.size > 0 ? { inicio: configuracao.decoder_start_token_id, idiomas } : null;
}

async function detectarIdioma(Tensor, asr, audio) {
  const tokens = lerTokensDeIdioma(asr.model.generation_config);
  if (tokens === null) return CODIGO_DO_IDIOMA_RESERVA;
  const entradas = await asr.processor(audio.subarray(0, AMOSTRAS_NA_JANELA_DO_WHISPER));
  if (!ehRegistro(entradas) || !(entradas.input_features instanceof Tensor)) return CODIGO_DO_IDIOMA_RESERVA;
  const saida = await asr.model.forward({
    input_features: entradas.input_features,
    decoder_input_ids: new Tensor("int64", BigInt64Array.from([BigInt(tokens.inicio)]), [1, 1]),
  });
  try {
    if (!ehRegistro(saida) || !(saida.logits instanceof Tensor)) return CODIGO_DO_IDIOMA_RESERVA;
    const logits = saida.logits.data;
    let melhor = null;
    for (const [id, codigo] of tokens.idiomas) {
      const valor = Number(logits[id]);
      if (Number.isFinite(valor) && (melhor === null || valor > melhor.valor)) melhor = { codigo, valor };
    }
    return melhor?.codigo ?? CODIGO_DO_IDIOMA_RESERVA;
  } finally {
    // No WebGPU o cache do decodificador (present.*) volta como buffer da GPU:
    // sem dispose, cada detecção vazaria memória de vídeo.
    descartarTensores(saida);
  }
}

function descartarTensores(saida) {
  if (!ehRegistro(saida)) return;
  for (const valor of Object.values(saida)) {
    if (valor && typeof valor.dispose === "function") {
      try {
        valor.dispose();
      } catch {
        /* já liberado */
      }
    }
  }
}

// 5 s de um sinal sintético determinístico (tom + ruído leve) para aquecer e medir.
function audioDaMedicao() {
  const amostras = new Float32Array(SEGUNDOS_DA_MEDICAO * TAXA_DE_AMOSTRAGEM);
  let semente = 12345;
  for (let i = 0; i < amostras.length; i++) {
    semente = (semente * 1103515245 + 12345) & 0x7fffffff;
    const ruido = (semente / 0x7fffffff - 0.5) * 0.01;
    amostras[i] = Math.sin((2 * Math.PI * 220 * i) / TAXA_DE_AMOSTRAGEM) * 0.05 + ruido;
  }
  return amostras;
}

function mensagemDoErro(erro) {
  return erro instanceof Error ? erro.message : String(erro);
}

// ──────────────────────────────────────────────────────────────────────────
// Motor (só dentro do utilityProcess).
// ──────────────────────────────────────────────────────────────────────────
function iniciarMotor(parentPort, { pastaDosModelos, plataforma = process.platform } = {}) {
  const portas = new Set();
  const pedidosDeModelo = new Map(); // pedido → { resolver, rejeitar, aoProgredir }
  let proximoPedidoDeModelo = 1;
  let transformers = null;
  let carregandoTransformers = null;
  let mensagensRecebidas = 0; // vai no "ocioso": o principal confere se nada está a caminho
  let relogioDeOciosidade = null;
  let prioridadeDaEscuta = PRIORIDADE_PADRAO;

  /** Pipelines carregados: chave "repo|dispositivo|precisao" → entrada. */
  const entradas = new Map();
  const estado = {
    medicao: null, // { dispositivo, mediaDoBaseMs }
    escuta: null, // { entrada, prioridade }
    ditado: null, // entrada
  };

  const fila = criarFila({
    aoOcupar: () => clearTimeout(relogioDeOciosidade),
    aoFicarOciosa: armarRelogioDeOciosidade,
  });

  function registrar(texto) {
    try {
      parentPort.postMessage({ tipo: "registro", texto });
    } catch {
      /* principal fora do ar */
    }
  }

  function enviar(porta, mensagem) {
    if (!porta || !portas.has(porta)) return;
    try {
      porta.postMessage(mensagem);
    } catch (erro) {
      registrar(`Falha ao responder à tela: ${mensagemDoErro(erro)}`);
    }
  }

  function armarRelogioDeOciosidade() {
    clearTimeout(relogioDeOciosidade);
    relogioDeOciosidade = setTimeout(() => {
      if (fila.ociosa()) pedirEncerramento("3 min sem pedidos");
    }, OCIOSIDADE_MS);
  }

  // O principal decide: se chegou alguma mensagem que ele mandou depois deste
  // aviso, ignora e o processo segue atendendo.
  function pedirEncerramento(motivo) {
    registrar(`Motor ocioso (${motivo}); pedindo o encerramento para liberar a memória.`);
    try {
      parentPort.postMessage({ tipo: "ocioso", recebidas: mensagensRecebidas });
    } catch {
      /* principal fora do ar */
    }
  }

  async function carregarTransformers() {
    if (transformers) return transformers;
    if (!carregandoTransformers) {
      carregandoTransformers = (async () => {
        // O build CommonJS primeiro: o require() do Electron lê de dentro do
        // app.asar e carrega os .node do app.asar.unpacked (onnxruntime-node,
        // sharp), o que o carregador de ESM não garante.
        let modulo;
        try {
          modulo = require("@huggingface/transformers");
        } catch (erroDoRequire) {
          registrar(`require() do transformers falhou (${mensagemDoErro(erroDoRequire)}); tentando import().`);
          modulo = await import("@huggingface/transformers");
        }
        const { env } = modulo;
        env.allowRemoteModels = false;
        env.allowLocalModels = true;
        env.localModelPath = pastaDosModelos;
        env.useFSCache = false;
        env.useBrowserCache = false;
        if (modulo.LogLevel && typeof modulo.LogLevel.ERROR === "number") env.logLevel = modulo.LogLevel.ERROR;
        transformers = modulo;
        return modulo;
      })().catch((erro) => {
        carregandoTransformers = null;
        throw erro;
      });
    }
    return carregandoTransformers;
  }

  // Pede ao principal os arquivos do modelo (baixa só o que falta).
  function garantirArquivos(repositorio, precisao, dispositivo, aoProgredir) {
    const pedido = proximoPedidoDeModelo++;
    return new Promise((resolver, rejeitar) => {
      pedidosDeModelo.set(pedido, { resolver, rejeitar, aoProgredir });
      parentPort.postMessage({ tipo: "modelo", pedido, repositorio, precisao, dispositivo });
    });
  }

  function motorDaEntrada(entrada) {
    return { dispositivo: entrada.dispositivo, modelo: entrada.repositorio, precisao: entrada.precisao, nativo: true };
  }

  async function descartarPipeline(asr) {
    if (!asr) return;
    try {
      await asr.dispose();
    } catch (erro) {
      registrar(`Falha ao liberar um modelo: ${mensagemDoErro(erro)}`);
    }
  }

  async function liberarSemUso() {
    for (const [chave, entrada] of entradas) {
      if (estado.escuta?.entrada === entrada || estado.ditado === entrada) continue;
      if (estado.medicao?.entrada === entrada && estado.escuta === null) continue;
      entradas.delete(chave);
      await descartarPipeline(entrada.asr);
      registrar(`Modelo liberado: ${entrada.repositorio} (${entrada.dispositivo}, ${entrada.precisao}).`);
    }
  }

  async function medirPassada(asr) {
    const inicio = performance.now();
    await asr(audioDaMedicao(), {
      language: IDIOMA_RESERVA,
      task: "transcribe",
      min_new_tokens: TOKENS_DA_MEDICAO,
      max_new_tokens: TOKENS_DA_MEDICAO,
    });
    return performance.now() - inicio;
  }

  // Carrega um modelo num dispositivo (precisões em ordem) e aquece com a
  // primeira passada. Erro de download não tenta outra precisão: sobe direto.
  async function carregarNoDispositivo(curto, dispositivo, avisar) {
    const repositorio = REPOSITORIOS[curto];
    let ultimoErro = null;
    for (const precisao of precisoesDoDispositivo(dispositivo, curto)) {
      const chave = `${repositorio}|${dispositivo}|${precisao}`;
      const existente = entradas.get(chave);
      if (existente) return existente;
      let asr = null;
      try {
        try {
          await garantirArquivos(repositorio, precisao, dispositivo, avisar.baixando);
        } catch (erro) {
          erro.doDownload = true;
          throw erro;
        }
        const { pipeline } = await carregarTransformers();
        const inicio = performance.now();
        asr = await pipeline("automatic-speech-recognition", repositorio, {
          device: dispositivo,
          dtype: precisao,
          session_options: { intraOpNumThreads: THREADS_DA_CPU },
        });
        const carga = performance.now() - inicio;
        const aquecimento = await medirPassada(asr);
        registrar(
          `${curto} carregado em ${dispositivo} ${precisao} (carga ${Math.round(carga)} ms, primeira passada ${Math.round(aquecimento)} ms).`,
        );
        const entrada = { chave, curto, repositorio, dispositivo, precisao, asr };
        entradas.set(chave, entrada);
        return entrada;
      } catch (erro) {
        await descartarPipeline(asr);
        if (erro && erro.doDownload) throw erro;
        ultimoErro = erro;
        registrar(`${curto} falhou em ${dispositivo} ${precisao}: ${mensagemDoErro(erro)}`);
      }
    }
    throw ultimoErro || new Error(`Nenhuma precisão disponível para ${dispositivo}.`);
  }

  // Base no melhor dispositivo (com queda para o próximo) + B.
  async function medirBase(avisar) {
    let ultimoErro = null;
    for (const dispositivo of dispositivosDaPlataforma(plataforma)) {
      try {
        const entrada = await carregarNoDispositivo("base", dispositivo, avisar);
        const passadas = [];
        for (let i = 0; i < PASSADAS_DA_MEDICAO; i++) passadas.push(await medirPassada(entrada.asr));
        const mediaDoBaseMs = Math.round(mediana(passadas));
        registrar(`B (base em ${dispositivo} ${entrada.precisao}): ${mediaDoBaseMs} ms [${passadas.map(Math.round).join(", ")}].`);
        return { dispositivo, entrada, mediaDoBaseMs };
      } catch (erro) {
        if (erro && erro.doDownload) throw erro;
        ultimoErro = erro;
      }
    }
    throw new Error(`Nenhum dispositivo conseguiu rodar o Whisper: ${mensagemDoErro(ultimoErro)}`);
  }

  function avisosPara(porta, origem) {
    return {
      baixando: ({ progresso, totalMb }) => enviar(porta, { tipo: "baixando", origem, progresso, totalMb }),
      pronto: (entrada, extras = {}) => {
        enviar(porta, { tipo: "motor", origem, motor: motorDaEntrada(entrada) });
        enviar(porta, { tipo: "pronto", origem });
        parentPort.postMessage({ tipo: "pronto", origem, motor: motorDaEntrada(entrada), ...extras });
      },
    };
  }

  async function prepararEscuta(prioridade, avisar) {
    prioridade = prioridadeValida(prioridade);
    prioridadeDaEscuta = prioridade;
    if (estado.escuta && estado.escuta.prioridade === prioridade) {
      avisar.pronto(estado.escuta.entrada, { prioridade, mediaDoBaseMs: estado.medicao?.mediaDoBaseMs ?? null });
      return estado.escuta.entrada;
    }
    if (!estado.medicao) estado.medicao = await medirBase(avisar);
    const { dispositivo, mediaDoBaseMs } = estado.medicao;
    const alvo = escolherModeloDaEscuta(mediaDoBaseMs, prioridade);
    registrar(`Escolha da escuta (${prioridade}, B ${mediaDoBaseMs} ms): ${alvo} em ${dispositivo}.`);
    let entrada = null;
    if (alvo !== "base") {
      try {
        entrada = await carregarNoDispositivo(alvo, dispositivo, avisar);
      } catch (erro) {
        if (erro && erro.doDownload) throw erro;
        registrar(`${alvo} não rodou em ${dispositivo}; a escuta fica com o base.`);
      }
    }
    if (!entrada) entrada = await carregarNoDispositivo("base", dispositivo, avisar);
    estado.escuta = { entrada, prioridade };
    estado.medicao.entrada = null;
    await liberarSemUso();
    avisar.pronto(entrada, { prioridade, mediaDoBaseMs });
    return entrada;
  }

  async function prepararDitado(avisar) {
    const daEscuta = estado.escuta?.entrada || null;
    const escolha = escolherMotorDoDitado(daEscuta ? { modelo: daEscuta.curto } : null);
    if (escolha.reaproveitar) {
      estado.ditado = daEscuta;
    } else if (!estado.ditado || !MODELOS_DO_DITADO.includes(estado.ditado.curto)) {
      estado.ditado = await carregarNoDispositivo(escolha.modelo, escolha.dispositivo, avisar);
    }
    await liberarSemUso();
    avisar.pronto(estado.ditado);
    return estado.ditado;
  }

  function preparar(porta, origem, prioridade) {
    const avisar = avisosPara(porta, origem);
    return origem === "ditado" ? prepararDitado(avisar) : prepararEscuta(prioridade, avisar);
  }

  async function transcrever(porta, pedido) {
    const { id, origem } = pedido;
    const audio = paraAudio(pedido.audio);
    if (!audio || audio.length === 0) {
      enviar(porta, { tipo: "erro", id, mensagem: "Áudio vazio ou em formato inesperado (esperado Float32Array mono 16 kHz)." });
      return;
    }
    // Sem "preparar" antes: prepara agora (avisando motor e pronto).
    let entrada = origem === "ditado" ? estado.ditado : estado.escuta?.entrada;
    if (!entrada) entrada = await preparar(porta, origem, prioridadeDaEscuta);

    const { Tensor } = await carregarTransformers();
    const inicio = performance.now();
    const pedidoDeIdioma = idiomaDoPedido(pedido.idioma);
    let language;
    let codigo;
    if (pedidoDeIdioma.detectar) {
      try {
        codigo = await detectarIdioma(Tensor, entrada.asr, audio);
      } catch (erro) {
        registrar(`Detecção de idioma falhou (${mensagemDoErro(erro)}); transcrevendo em português.`);
        codigo = CODIGO_DO_IDIOMA_RESERVA;
      }
      language = codigo;
    } else {
      language = pedidoDeIdioma.language;
      codigo = pedidoDeIdioma.codigo;
    }
    const saida = await entrada.asr(audio, {
      language,
      task: "transcribe",
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
    });
    const duracaoDaPassadaMs = Math.round(performance.now() - inicio);
    const { texto, segmentos } = segmentosDaSaida(saida, audio.length / TAXA_DE_AMOSTRAGEM);
    enviar(porta, { tipo: "resultado", id, texto, segmentos, idioma: codigo, duracaoDaPassadaMs });
  }

  async function descarregar() {
    estado.escuta = null;
    estado.ditado = null;
    estado.medicao = null;
    await liberarSemUso();
    // Este item ainda conta na fila: só ele nela = nada mais esperando.
    if (fila.tamanho <= 1) pedirEncerramento("pedido da tela");
  }

  function aoMensagemDaTela(porta, dados) {
    mensagensRecebidas += 1;
    if (!ehRegistro(dados)) return;
    if (dados.tipo === "preparar") {
      const origem = dados.origem === "ditado" ? "ditado" : "escuta";
      fila.adicionar({
        origem,
        porta,
        executar: () =>
          preparar(porta, origem, dados.prioridade).catch((erro) => {
            registrar(`Falha ao preparar (${origem}): ${mensagemDoErro(erro)}`);
            enviar(porta, { tipo: "erro", id: null, mensagem: `Não foi possível preparar a transcrição: ${mensagemDoErro(erro)}` });
          }),
      });
      return;
    }
    if (dados.tipo === "transcrever") {
      const id = typeof dados.id === "number" ? dados.id : null;
      const origem = dados.origem === "ditado" ? "ditado" : "escuta";
      const aceito = fila.adicionar({
        origem,
        porta,
        descartavel: dados.descartavel === true,
        executar: () =>
          transcrever(porta, { ...dados, id, origem }).catch((erro) => {
            registrar(`Falha ao transcrever (${origem}): ${mensagemDoErro(erro)}`);
            enviar(porta, { tipo: "erro", id, mensagem: `A transcrição falhou: ${mensagemDoErro(erro)}` });
          }),
      });
      if (!aceito) enviar(porta, { tipo: "erro", id, mensagem: "Motor ocupado; trecho descartado.", descartado: true });
      return;
    }
    if (dados.tipo === "descarregar") {
      fila.adicionar({ origem: "escuta", porta, executar: descarregar });
    }
  }

  function adotarPorta(porta) {
    if (!porta) return;
    portas.add(porta);
    porta.on("message", (evento) => aoMensagemDaTela(porta, evento.data));
    porta.on("close", () => {
      portas.delete(porta);
      fila.descartar((item) => item.porta === porta);
    });
    porta.start();
  }

  function aoMensagemDoPrincipal(evento) {
    const dados = evento && evento.data;
    if (!ehRegistro(dados)) return;
    if (dados.tipo === "porta") {
      // A prioridade vem junto: chega antes de qualquer mensagem da porta.
      if (typeof dados.prioridadeDaEscuta === "string") prioridadeDaEscuta = prioridadeValida(dados.prioridadeDaEscuta);
      adotarPorta(evento.ports && evento.ports[0]);
      return;
    }
    if (dados.tipo === "configurar") {
      if (typeof dados.prioridadeDaEscuta === "string") prioridadeDaEscuta = prioridadeValida(dados.prioridadeDaEscuta);
      return;
    }
    const pendente = pedidosDeModelo.get(dados.pedido);
    if (!pendente) return;
    if (dados.tipo === "modelo:progresso") {
      if (pendente.aoProgredir) pendente.aoProgredir({ progresso: dados.progresso, totalMb: dados.totalMb ?? null });
    } else if (dados.tipo === "modelo:pronto") {
      pedidosDeModelo.delete(dados.pedido);
      pendente.resolver();
    } else if (dados.tipo === "modelo:erro") {
      pedidosDeModelo.delete(dados.pedido);
      pendente.rejeitar(new Error(dados.mensagem || "Falha ao baixar o modelo."));
    }
  }

  parentPort.on("message", aoMensagemDoPrincipal);
  // Um processo que nunca recebe pedido também sai.
  armarRelogioDeOciosidade();
  registrar(`Motor nativo no ar (pid ${process.pid}, ${plataforma}, ${THREADS_DA_CPU} threads de CPU).`);
  return { aoMensagemDoPrincipal, aoMensagemDaTela, fila };
}

// Dentro do utilityProcess o Electron expõe process.parentPort; nos testes não.
if (process.parentPort) {
  // Estado desconhecido depois de um erro não tratado: registra e sai; o
  // principal conta a queda e religa (ou desiste na segunda seguida).
  process.on("uncaughtException", (erro) => {
    try {
      process.parentPort.postMessage({ tipo: "registro", texto: `Erro não tratado: ${erro?.stack || erro}` });
    } catch {
      /* sem principal */
    }
    setTimeout(() => process.exit(1), 100);
  });
  iniciarMotor(process.parentPort, { pastaDosModelos: process.env.ORQUESTRADOR_PASTA_DOS_MODELOS || "" });
}

module.exports = {
  LIMITE_DA_PRIORIDADE_MS,
  OCIOSIDADE_MS,
  criarFila,
  dispositivosDaPlataforma,
  escolherModeloDaEscuta,
  escolherMotorDoDitado,
  idiomaDoPedido,
  iniciarMotor,
  lerTokensDeIdioma,
  mediana,
  paraAudio,
  precisoesDoDispositivo,
  segmentosDaSaida,
  nomeCurtoDoRepositorio,
};
