import { comecarGravacao, LIMIAR_DE_SILENCIO, nivelDaVoz } from "./gravacao";

/** Um microfone, um MediaRecorder e um Web Audio falsos: contam o que foi aberto e fechado. */
function prepararAudioFalso(amostra: number) {
  const trilha = { stop: vi.fn() };
  const fluxo = { getTracks: () => [trilha] } as unknown as MediaStream;
  const pedirMicrofone = vi.fn(() => Promise.resolve(fluxo));
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: pedirMicrofone } });

  class GravadorFalso {
    state = "recording";
    mimeType = "audio/webm";
    ondataavailable: unknown = null;
    onstop: (() => void) | null = null;
    start = vi.fn();
    stop = vi.fn(() => {
      this.state = "inactive";
      this.onstop?.();
    });
  }
  vi.stubGlobal("MediaRecorder", GravadorFalso);

  const fonte = { connect: vi.fn(), disconnect: vi.fn() };
  const criarFonte = vi.fn(() => fonte);
  const fechar = vi.fn(() => Promise.resolve());
  const contextos: unknown[] = [];
  class ContextoFalso {
    constructor() {
      contextos.push(this);
    }
    createMediaStreamSource = criarFonte;
    createAnalyser = () => ({
      fftSize: 0,
      getFloatTimeDomainData: (destino: Float32Array) => destino.fill(amostra),
    });
    resume = vi.fn(() => Promise.resolve());
    close = fechar;
  }
  vi.stubGlobal("AudioContext", ContextoFalso);
  return { trilha, fluxo, pedirMicrofone, fonte, criarFonte, fechar, contextos };
}

describe("nivelDaVoz", () => {
  it("fica entre 0 e 1 e cresce com o volume", () => {
    expect(nivelDaVoz(0)).toBe(0);
    expect(nivelDaVoz(-1)).toBe(0);
    expect(nivelDaVoz(1)).toBe(1);
    expect(nivelDaVoz(0.05)).toBeGreaterThan(nivelDaVoz(0.01));
  });

  it("sala quieta fica abaixo do limiar de silêncio e fala normal fica acima", () => {
    expect(nivelDaVoz(0.001)).toBeLessThan(LIMIAR_DE_SILENCIO);
    expect(nivelDaVoz(0.03)).toBeGreaterThan(LIMIAR_DE_SILENCIO);
  });
});

describe("comecarGravacao: nível da voz", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("mede no mesmo fluxo do microfone, abrindo o microfone uma vez só", async () => {
    const audio = prepararAudioFalso(0.1);
    const gravacao = await comecarGravacao();

    expect(audio.pedirMicrofone).toHaveBeenCalledTimes(1);
    expect(audio.criarFonte).toHaveBeenCalledWith(audio.fluxo);
    expect(audio.contextos).toHaveLength(1);
    // O analisador não vai para as caixas de som (nada de eco da própria voz).
    expect(audio.fonte.connect).toHaveBeenCalledTimes(1);
    // Onda constante de 0,1: RMS 0,1.
    expect(gravacao.nivel()).toBeCloseTo(nivelDaVoz(0.1), 5);
    gravacao.descartar();
  });

  it("silêncio total dá nível 0", async () => {
    prepararAudioFalso(0);
    const gravacao = await comecarGravacao();
    expect(gravacao.nivel()).toBe(0);
    gravacao.descartar();
  });

  it("descartar solta o microfone e fecha o analisador, uma vez só", async () => {
    const audio = prepararAudioFalso(0.1);
    const gravacao = await comecarGravacao();
    gravacao.descartar();
    gravacao.descartar();
    expect(audio.trilha.stop).toHaveBeenCalled();
    expect(audio.fonte.disconnect).toHaveBeenCalledTimes(1);
    expect(audio.fechar).toHaveBeenCalledTimes(1);
  });

  it("sem Web Audio, grava do mesmo jeito e o nível é null", async () => {
    prepararAudioFalso(0.1);
    vi.stubGlobal(
      "AudioContext",
      class {
        constructor() {
          throw new Error("sem áudio");
        }
      },
    );
    const gravacao = await comecarGravacao();
    expect(gravacao.nivel()).toBeNull();
    gravacao.descartar();
  });
});
