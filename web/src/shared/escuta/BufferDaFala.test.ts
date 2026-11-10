import { BufferDaFala } from "./BufferDaFala";

const AMOSTRAS_POR_MS = 16;

/** Amostras que valem a própria posição (a partir de `inicio`), para conferir o que ficou. */
function rampa(quantidade: number, inicio = 0): Float32Array {
  return Float32Array.from({ length: quantidade }, (_, i) => inicio + i);
}

function ehContinuo(audio: Float32Array, primeira: number): boolean {
  for (let i = 0; i < audio.length; i++) if (audio[i] !== primeira + i) return false;
  return true;
}

describe("BufferDaFala", () => {
  it("começa vazio, no instante dado", () => {
    const buffer = new BufferDaFala(1_000);
    expect(buffer.inicioMs).toBe(1_000);
    expect(buffer.fimMs).toBe(1_000);
    expect(buffer.duracaoMs).toBe(0);
    expect(buffer.audio().length).toBe(0);
    expect(new BufferDaFala().inicioMs).toBe(0);
  });

  it("acrescentar avança o fim pelo número de amostras", () => {
    const buffer = new BufferDaFala(1_000);
    buffer.acrescentar(rampa(100 * AMOSTRAS_POR_MS));
    buffer.acrescentar(rampa(50 * AMOSTRAS_POR_MS, 100 * AMOSTRAS_POR_MS));
    expect(buffer.inicioMs).toBe(1_000);
    expect(buffer.fimMs).toBe(1_150);
    expect(buffer.duracaoMs).toBe(150);
    expect(ehContinuo(buffer.audio(), 0)).toBe(true);
  });

  it("copia a entrada e devolve cópias do áudio", () => {
    const buffer = new BufferDaFala();
    const entrada = rampa(320);
    buffer.acrescentar(entrada);
    entrada.fill(-1);
    const audio = buffer.audio();
    expect(ehContinuo(audio, 0)).toBe(true);
    audio.fill(-2);
    expect(ehContinuo(buffer.audio(), 0)).toBe(true);
  });

  it("apararAte descarta o começo e mantém o relógio absoluto", () => {
    const buffer = new BufferDaFala(2_000);
    buffer.acrescentar(rampa(1_000 * AMOSTRAS_POR_MS));
    buffer.apararAte(2_250);
    expect(buffer.inicioMs).toBe(2_250);
    expect(buffer.fimMs).toBe(3_000);
    expect(buffer.duracaoMs).toBe(750);
    expect(ehContinuo(buffer.audio(), 250 * AMOSTRAS_POR_MS)).toBe(true);

    // O que chega depois continua no relógio de antes.
    buffer.acrescentar(rampa(100 * AMOSTRAS_POR_MS, 1_000 * AMOSTRAS_POR_MS));
    expect(buffer.fimMs).toBe(3_100);
    expect(ehContinuo(buffer.audio(), 250 * AMOSTRAS_POR_MS)).toBe(true);
  });

  it("apararAte fora do intervalo para na borda", () => {
    const buffer = new BufferDaFala(500);
    buffer.acrescentar(rampa(100 * AMOSTRAS_POR_MS));
    buffer.apararAte(100);
    expect(buffer.inicioMs).toBe(500);
    expect(buffer.duracaoMs).toBe(100);

    buffer.apararAte(10_000);
    expect(buffer.inicioMs).toBe(600);
    expect(buffer.fimMs).toBe(600);
    expect(buffer.audio().length).toBe(0);
  });

  it("apararAte arredonda para a amostra mais perto", () => {
    const buffer = new BufferDaFala();
    buffer.acrescentar(rampa(1_000));
    buffer.apararAte(10.03); // 160,48 amostras → 160
    expect(buffer.audio()[0]).toBe(160);
    expect(buffer.inicioMs).toBe(10);
  });

  it("aguenta falas longas, aparando e acrescentando sem perder amostras", () => {
    const buffer = new BufferDaFala();
    const pedaco = 500 * AMOSTRAS_POR_MS;
    let enviadas = 0;
    for (let i = 0; i < 60; i++) {
      buffer.acrescentar(rampa(pedaco, enviadas));
      enviadas += pedaco;
      if (i % 4 === 3) buffer.apararAte(buffer.fimMs - 1_000);
    }
    expect(buffer.fimMs).toBe(30_000);
    expect(buffer.duracaoMs).toBe(1_000);
    expect(ehContinuo(buffer.audio(), enviadas - 1_000 * AMOSTRAS_POR_MS)).toBe(true);

    // Sem aparar: cresce além da capacidade inicial.
    const longo = new BufferDaFala();
    for (let i = 0; i < 30; i++) longo.acrescentar(rampa(pedaco, i * pedaco));
    expect(longo.duracaoMs).toBe(15_000);
    expect(ehContinuo(longo.audio(), 0)).toBe(true);
  });

  it("limpar esvazia; o relógio continua do fim ou recomeça no instante dado", () => {
    const buffer = new BufferDaFala(1_000);
    buffer.acrescentar(rampa(200 * AMOSTRAS_POR_MS));
    buffer.limpar();
    expect(buffer.inicioMs).toBe(1_200);
    expect(buffer.fimMs).toBe(1_200);
    expect(buffer.audio().length).toBe(0);

    buffer.acrescentar(rampa(16));
    buffer.limpar(5_000);
    expect(buffer.inicioMs).toBe(5_000);
    expect(buffer.duracaoMs).toBe(0);
    buffer.acrescentar(rampa(16, 7));
    expect(buffer.fimMs).toBe(5_001);
    expect(ehContinuo(buffer.audio(), 7)).toBe(true);
  });

  it("recusa tempos inválidos", () => {
    expect(() => new BufferDaFala(Number.NaN)).toThrow(/inválido/);
    const buffer = new BufferDaFala();
    expect(() => buffer.apararAte(Number.POSITIVE_INFINITY)).toThrow(/inválido/);
    expect(() => buffer.limpar(Number.NaN)).toThrow(/inválido/);
  });
});
