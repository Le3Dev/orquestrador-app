/**
 * Worker do ditado: roda o Whisper no próprio computador, fora da thread da
 * tela. O modelo é baixado do Hugging Face na primeira vez e fica no cache do
 * navegador (ou do app); o áudio nunca sai da máquina.
 */
import { type AutomaticSpeechRecognitionPipeline, env, pipeline } from "@huggingface/transformers";
import arquivoMjs from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url";
import arquivoWasm from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";

import type { PedidoDeTranscricao, RespostaDoTranscritor } from "./mensagens";

/** Multilíngue e bom em português; em q8 são cerca de 250 MB. */
const MODELO = "onnx-community/whisper-small";

env.allowLocalModels = false;
// O runtime vem junto com a tela, em vez de um CDN.
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.wasmPaths = { mjs: arquivoMjs, wasm: arquivoWasm };
}

function responder(resposta: RespostaDoTranscritor): void {
  self.postMessage(resposta);
}

let carregando: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

function transcritor(): Promise<AutomaticSpeechRecognitionPipeline> {
  carregando ??= pipeline("automatic-speech-recognition", MODELO, {
    device: "wasm",
    dtype: "q8",
    progress_callback: (info) => {
      if (info.status === "progress_total") {
        responder({ tipo: "baixando", progresso: Math.round(info.progress) });
      }
    },
  }).catch((erro: unknown) => {
    // Sem isto, uma falha de rede no primeiro download valeria para sempre.
    carregando = null;
    throw erro;
  });
  return carregando;
}

self.onmessage = async (evento: MessageEvent<PedidoDeTranscricao>) => {
  const { id, audio } = evento.data;
  try {
    const transcrever = await transcritor();
    const saida = await transcrever(audio, {
      language: "portuguese",
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
