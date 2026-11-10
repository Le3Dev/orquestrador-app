/**
 * Worker do ditado e da escuta: roda o Whisper no próprio computador, fora da
 * thread da tela. O modelo é baixado do Hugging Face na primeira vez e fica no
 * cache do navegador (ou do app); o áudio nunca sai da máquina.
 */
import { type AutomaticSpeechRecognitionPipeline, env, pipeline, Tensor } from "@huggingface/transformers";
import arquivoMjs from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url";
import arquivoWasm from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";

import type { PedidoDeTranscricao, RespostaDoTranscritor } from "./mensagens";

/** O Whisper olha no máximo 30 s de áudio de uma vez (16 kHz). */
const AMOSTRAS_NA_JANELA_DO_WHISPER = 30 * 16_000;

/** Sem conseguir detectar o idioma, a escuta transcreve como o ditado: em português. */
const IDIOMA_RESERVA = "portuguese";

env.allowLocalModels = false;
// O runtime vem junto com a tela, em vez de um CDN.
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.wasmPaths = { mjs: arquivoMjs, wasm: arquivoWasm };
}

function responder(resposta: RespostaDoTranscritor): void {
  self.postMessage(resposta);
}

/** Um pipeline por modelo, criado só no primeiro pedido que o usa. */
const carregando = new Map<string, Promise<AutomaticSpeechRecognitionPipeline>>();

function transcritor(modelo: string): Promise<AutomaticSpeechRecognitionPipeline> {
  const existente = carregando.get(modelo);
  if (existente !== undefined) return existente;
  const novo = pipeline("automatic-speech-recognition", modelo, {
    device: "wasm",
    dtype: "q8",
    progress_callback: (info) => {
      if (info.status === "progress_total") {
        responder({ tipo: "baixando", progresso: Math.round(info.progress) });
      }
    },
  }).catch((erro: unknown) => {
    // Sem isto, uma falha de rede no primeiro download valeria para sempre.
    carregando.delete(modelo);
    throw erro;
  });
  carregando.set(modelo, novo);
  return novo;
}

function ehRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null;
}

/** Do `generation_config` do Whisper: o token de início e o id de cada token de idioma ("<|pt|>" → id). */
function lerTokensDeIdioma(config: unknown): { inicio: number; idiomas: Map<number, string> } | null {
  if (!ehRegistro(config) || typeof config.decoder_start_token_id !== "number" || !ehRegistro(config.lang_to_id)) {
    return null;
  }
  const idiomas = new Map<number, string>();
  for (const [token, id] of Object.entries(config.lang_to_id)) {
    const codigo = /^<\|([a-z]{2,3}(?:_[a-z]+)?)\|>$/i.exec(token)?.[1];
    if (typeof id === "number" && codigo !== undefined) idiomas.set(id, codigo);
  }
  return idiomas.size > 0 ? { inicio: config.decoder_start_token_id, idiomas } : null;
}

/**
 * Detecta o idioma da fala como o Whisper original: um passo do decodificador
 * só com `<|startoftranscript|>` e, entre os tokens de idioma, o de maior
 * logit. Devolve o código ("pt", "en"...), que o pipeline aceita em `language`.
 *
 * Por que isto existe: no transformers.js 4.3.1, sem `language` o pipeline NÃO
 * detecta o idioma. `WhisperForConditionalGeneration._retrieve_init_tokens`
 * (src/models/whisper/modeling_whisper.js) tem um "TODO: Implement language
 * detection", avisa "No language specified - defaulting to English (en)." e
 * força `<|en|>`; com fala em português isso sai traduzido ou truncado.
 *
 * Custa uma passada a mais do codificador por trecho (o pipeline refaz a sua).
 */
async function detectarIdioma(asr: AutomaticSpeechRecognitionPipeline, audio: Float32Array): Promise<string> {
  const tokens = lerTokensDeIdioma(asr.model.generation_config);
  if (tokens === null) return IDIOMA_RESERVA;
  const entradas: unknown = await asr.processor(audio.subarray(0, AMOSTRAS_NA_JANELA_DO_WHISPER));
  if (!ehRegistro(entradas) || !(entradas.input_features instanceof Tensor)) return IDIOMA_RESERVA;
  const saida: unknown = await asr.model.forward({
    input_features: entradas.input_features,
    decoder_input_ids: new Tensor("int64", BigInt64Array.from([BigInt(tokens.inicio)]), [1, 1]),
  });
  if (!ehRegistro(saida) || !(saida.logits instanceof Tensor)) return IDIOMA_RESERVA;
  // logits: [1, 1, vocabulário] — só há uma posição, a do próximo token.
  const logits = saida.logits.data;
  let melhor: { codigo: string; valor: number } | null = null;
  for (const [id, codigo] of tokens.idiomas) {
    const valor = Number(logits[id]);
    if (Number.isFinite(valor) && (melhor === null || valor > melhor.valor)) melhor = { codigo, valor };
  }
  return melhor?.codigo ?? IDIOMA_RESERVA;
}

self.onmessage = async (evento: MessageEvent<PedidoDeTranscricao>) => {
  const { id, audio, idioma, modelo } = evento.data;
  try {
    const transcrever = await transcritor(modelo);
    let language: string = idioma ?? IDIOMA_RESERVA;
    if (idioma === null) {
      try {
        language = await detectarIdioma(transcrever, audio);
      } catch {
        // A detecção é um extra: se falhar, transcreve em português, como o ditado.
        language = IDIOMA_RESERVA;
      }
    }
    const saida = await transcrever(audio, {
      language,
      task: "transcribe",
      chunk_length_s: 30,
      stride_length_s: 5,
    });
    const texto = (Array.isArray(saida) ? saida.map((parte) => parte.text).join(" ") : saida.text).trim();
    responder({ tipo: "texto", id, texto });
  } catch (erro) {
    responder({ tipo: "erro", id, mensagem: erro instanceof Error ? erro.message : String(erro) });
  }
};
