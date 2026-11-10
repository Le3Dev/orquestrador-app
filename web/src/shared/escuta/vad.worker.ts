/**
 * Worker do detector de voz da escuta: roda o Silero VAD v5 (ONNX, ~2 MB, MIT)
 * no próprio computador, fora da thread da tela. O modelo vem junto com a
 * tela (`modelos/silero_vad_v5.onnx`); nada é baixado da internet.
 *
 * Segue o `OnnxWrapper` oficial do Silero v5 (snakers4/silero-vad): janelas de
 * 512 amostras a 16 kHz, cada uma com as últimas 64 amostras da anterior na
 * frente (entrada de 576), o estado `[2, 1, 128]` levado de uma chamada para a
 * outra e `sr` int64 = 16000.
 */
import * as ort from "onnxruntime-web/webgpu";
import arquivoMjs from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url";
import arquivoWasm from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";

import { AMOSTRAS_POR_JANELA_DO_VAD, TAXA_DE_AMOSTRAGEM } from "./DetectorDeVoz";
import type { PedidoAoVad, RespostaDoVad } from "./DetectorDeVozSilero";
import urlDoModelo from "./modelos/silero_vad_v5.onnx?url";

/** Amostras da janela anterior que vão na frente de cada janela (64 a 16 kHz). */
export const AMOSTRAS_DE_CONTEXTO_DO_SILERO = 64;

const FORMATO_DO_ESTADO: readonly number[] = [2, 1, 128];
const TAMANHO_DO_ESTADO = 2 * 1 * 128;
const ENTRADAS_DO_MODELO = ["input", "state", "sr"] as const;
const SAIDAS_DO_MODELO = ["output", "stateN"] as const;

/** O pedaço do onnxruntime que o Silero usa: o do worker, ou o de Node no teste de integração. */
export type RuntimeOnnx = Pick<typeof ort, "InferenceSession" | "Tensor">;

function lerFloat32(valor: { readonly data: unknown } | undefined, nome: string): Float32Array {
  const dados = valor?.data;
  if (!(dados instanceof Float32Array)) throw new Error(`O detector de voz não devolveu "${nome}" em float32.`);
  return dados;
}

/**
 * O Silero com o estado entre janelas (contexto de 64 amostras e estado
 * `[2, 1, 128]`). Uma instância por fluxo de áudio.
 */
export class SileroVad {
  private estado = new Float32Array(TAMANHO_DO_ESTADO);
  private contexto = new Float32Array(AMOSTRAS_DE_CONTEXTO_DO_SILERO);
  private readonly taxa: ort.Tensor;

  private constructor(
    private readonly runtime: RuntimeOnnx,
    private readonly sessao: ort.InferenceSession,
  ) {
    this.taxa = new runtime.Tensor("int64", BigInt64Array.from([BigInt(TAXA_DE_AMOSTRAGEM)]), []);
  }

  /** Abre o modelo (os bytes do `.onnx`) e confere se as entradas e saídas são as do Silero v5. */
  static async carregar(runtime: RuntimeOnnx, modelo: Uint8Array): Promise<SileroVad> {
    const sessao = await runtime.InferenceSession.create(modelo, { executionProviders: ["wasm"] });
    const faltando = [
      ...ENTRADAS_DO_MODELO.filter((nome) => !sessao.inputNames.includes(nome)),
      ...SAIDAS_DO_MODELO.filter((nome) => !sessao.outputNames.includes(nome)),
    ];
    if (faltando.length > 0) {
      await sessao.release();
      throw new Error(`O modelo do detector de voz não é o Silero v5 esperado (falta: ${faltando.join(", ")}).`);
    }
    return new SileroVad(runtime, sessao);
  }

  /** Probabilidade de voz (0 a 1) de cada janela de 512 amostras, em ordem. */
  async analisar(amostras: Float32Array): Promise<number[]> {
    if (amostras.length % AMOSTRAS_POR_JANELA_DO_VAD !== 0) {
      throw new Error(`O detector de voz recebeu ${amostras.length} amostras, que não fecham janelas de ${AMOSTRAS_POR_JANELA_DO_VAD}.`);
    }
    const probabilidades: number[] = [];
    const entrada = new Float32Array(AMOSTRAS_DE_CONTEXTO_DO_SILERO + AMOSTRAS_POR_JANELA_DO_VAD);
    for (let inicio = 0; inicio < amostras.length; inicio += AMOSTRAS_POR_JANELA_DO_VAD) {
      entrada.set(this.contexto);
      entrada.set(amostras.subarray(inicio, inicio + AMOSTRAS_POR_JANELA_DO_VAD), AMOSTRAS_DE_CONTEXTO_DO_SILERO);
      const saida = await this.sessao.run({
        input: new this.runtime.Tensor("float32", entrada, [1, entrada.length]),
        state: new this.runtime.Tensor("float32", this.estado, FORMATO_DO_ESTADO),
        sr: this.taxa,
      });
      const probabilidade = lerFloat32(saida.output, "output")[0];
      if (probabilidade === undefined) throw new Error('O detector de voz devolveu "output" vazio.');
      probabilidades.push(probabilidade);
      this.estado = Float32Array.from(lerFloat32(saida.stateN, "stateN"));
      this.contexto = entrada.slice(entrada.length - AMOSTRAS_DE_CONTEXTO_DO_SILERO);
    }
    return probabilidades;
  }

  /** Zera o estado e o contexto, como no começo de um áudio novo. */
  reiniciar(): void {
    this.estado = new Float32Array(TAMANHO_DO_ESTADO);
    this.contexto = new Float32Array(AMOSTRAS_DE_CONTEXTO_DO_SILERO);
  }
}

// O runtime vem junto com a tela, em vez de um CDN (os mesmos arquivos do Whisper).
// Uma thread basta para um modelo deste tamanho e não disputa a CPU com o Whisper.
ort.env.wasm.wasmPaths = { mjs: arquivoMjs, wasm: arquivoWasm };
ort.env.wasm.numThreads = 1;

let instancia: SileroVad | null = null;
let carregando: Promise<SileroVad> | null = null;

function silero(): Promise<SileroVad> {
  if (carregando !== null) return carregando;
  carregando = (async () => {
    const resposta = await fetch(urlDoModelo);
    if (!resposta.ok) throw new Error(`Não foi possível carregar o modelo do detector de voz (HTTP ${resposta.status}).`);
    const vad = await SileroVad.carregar(ort, new Uint8Array(await resposta.arrayBuffer()));
    instancia = vad;
    return vad;
  })().catch((erro: unknown) => {
    // Sem isto, uma falha ao carregar valeria para sempre.
    carregando = null;
    throw erro;
  });
  return carregando;
}

function responder(resposta: RespostaDoVad, transferir: Transferable[] = []): void {
  self.postMessage(resposta, { transfer: transferir });
}

async function processar(pedido: PedidoAoVad): Promise<void> {
  if (pedido.tipo === "reiniciar") {
    // Sem modelo carregado não há estado a zerar.
    instancia?.reiniciar();
    return;
  }
  try {
    const probabilidades = await (await silero()).analisar(pedido.amostras);
    responder({ tipo: "probabilidades", id: pedido.id, amostras: pedido.amostras, probabilidades }, [pedido.amostras.buffer]);
  } catch (erro) {
    responder({ tipo: "erro", id: pedido.id, mensagem: erro instanceof Error ? erro.message : String(erro) });
  }
}

/** Um pedido por vez, na ordem de chegada: o estado do modelo passa de uma janela para a seguinte. */
let fila: Promise<void> = Promise.resolve();

self.onmessage = (evento: MessageEvent<PedidoAoVad>) => {
  const pedido = evento.data;
  fila = fila.then(() => processar(pedido));
};
