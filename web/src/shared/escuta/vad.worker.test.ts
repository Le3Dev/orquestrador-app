import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as ortDoNode from "onnxruntime-web";

import { AMOSTRAS_POR_JANELA_DO_VAD, TAXA_DE_AMOSTRAGEM } from "./DetectorDeVoz";
import { SileroVad } from "./vad.worker";

// Teste de integração: o Silero de verdade, no onnxruntime-web de Node (o mesmo
// runtime em WASM do worker; só muda de onde o arquivo .wasm é lido).
const MODELO = resolve(__dirname, "modelos/silero_vad_v5.onnx");
/** Fala gravada da medição da escuta. Fica fora do git (pasta dados/): sem ela, o teste é pulado. */
const FALA_GRAVADA = resolve(__dirname, "../../../../dados/medicoes/escuta/audios/clipe-03.wav");

const CARGA_MS = 60_000;

function amostras(ms: number): number {
  return (ms * TAXA_DE_AMOSTRAGEM) / 1000;
}

/** Só janelas inteiras, como o adaptador entrega ao worker. */
function alinhar(audio: Float32Array): Float32Array {
  return audio.subarray(0, audio.length - (audio.length % AMOSTRAS_POR_JANELA_DO_VAD));
}

/**
 * "Voz" sintética: fundamental de ~140 Hz com vibrato lento, 8 harmônicos e
 * envoltória silábica de 4 Hz. O Silero a reconhece como fala.
 */
function vozSintetica(ms: number): Float32Array {
  const audio = new Float32Array(amostras(ms));
  for (let i = 0; i < audio.length; i++) {
    const t = i / TAXA_DE_AMOSTRAGEM;
    const f0 = 140 + 30 * Math.sin(2 * Math.PI * 0.7 * t);
    const envoltoria = Math.max(0, Math.sin(2 * Math.PI * 4 * t));
    let valor = 0;
    for (let h = 1; h <= 8; h++) valor += Math.sin(2 * Math.PI * f0 * h * t) / h;
    audio[i] = 0.15 * envoltoria * valor;
  }
  return audio;
}

/** WAV PCM de 16 bits, mono, 16 kHz. */
function lerWav(caminho: string): Float32Array {
  const bytes = readFileSync(caminho);
  let posicao = 12;
  while (posicao + 8 <= bytes.length) {
    const bloco = bytes.toString("ascii", posicao, posicao + 4);
    const tamanho = bytes.readUInt32LE(posicao + 4);
    if (bloco === "data") {
      const audio = new Float32Array(Math.floor(tamanho / 2));
      for (let i = 0; i < audio.length; i++) audio[i] = bytes.readInt16LE(posicao + 8 + 2 * i) / 32_768;
      return audio;
    }
    posicao += 8 + tamanho + (tamanho % 2);
  }
  throw new Error(`WAV sem bloco "data": ${caminho}`);
}

const maximo = (valores: readonly number[]): number => Math.max(...valores);
const media = (valores: readonly number[]): number => valores.reduce((soma, valor) => soma + valor, 0) / valores.length;

describe("vad.worker: SileroVad com o modelo de verdade", () => {
  let silero: SileroVad;

  beforeAll(async () => {
    ortDoNode.env.wasm.numThreads = 1;
    silero = await SileroVad.carregar(ortDoNode, new Uint8Array(readFileSync(MODELO)));
  }, CARGA_MS);

  beforeEach(() => silero.reiniciar());

  it("uma probabilidade entre 0 e 1 por janela de 512 amostras", async () => {
    const probabilidades = await silero.analisar(new Float32Array(10 * AMOSTRAS_POR_JANELA_DO_VAD));
    expect(probabilidades).toHaveLength(10);
    for (const p of probabilidades) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  it("silêncio dá probabilidade baixa", async () => {
    const probabilidades = await silero.analisar(alinhar(new Float32Array(amostras(2_000))));
    expect(maximo(probabilidades)).toBeLessThan(0.1);
  });

  it("voz sintética faz a probabilidade subir acima do limiar de início", async () => {
    const silencio = await silero.analisar(alinhar(new Float32Array(amostras(1_000))));
    const voz = await silero.analisar(alinhar(vozSintetica(2_000)));
    expect(maximo(silencio)).toBeLessThan(0.1);
    expect(maximo(voz)).toBeGreaterThan(0.8);
    expect(media(voz)).toBeGreaterThan(media(silencio) + 0.3);
  });

  it("o estado passa de uma chamada para a outra, e reiniciar o zera", async () => {
    const audio = alinhar(vozSintetica(1_000));
    const deUmaVez = await silero.analisar(audio);
    silero.reiniciar();
    const metade = 15 * AMOSTRAS_POR_JANELA_DO_VAD;
    const emDuasVezes = [...(await silero.analisar(audio.subarray(0, metade))), ...(await silero.analisar(audio.subarray(metade)))];
    expect(emDuasVezes).toHaveLength(deUmaVez.length);
    emDuasVezes.forEach((p, i) => expect(p).toBeCloseTo(deUmaVez[i] ?? Number.NaN, 5));
  });

  it("recusa amostras que não fecham janelas", async () => {
    await expect(silero.analisar(new Float32Array(AMOSTRAS_POR_JANELA_DO_VAD + 1))).rejects.toThrow(/não fecham janelas/);
  });

  it.skipIf(!existsSync(FALA_GRAVADA))("fala gravada: silêncio no começo e voz depois", async () => {
    const probabilidades = await silero.analisar(alinhar(lerWav(FALA_GRAVADA)));
    expect(maximo(probabilidades.slice(5, 20))).toBeLessThan(0.1);
    expect(maximo(probabilidades)).toBeGreaterThan(0.9);
    expect(media(probabilidades)).toBeGreaterThan(0.5);
  });
});
