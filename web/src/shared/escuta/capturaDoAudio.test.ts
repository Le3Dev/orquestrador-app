import { describe, expect, it, vi } from "vitest";

import {
  CODIGO_DO_PROCESSADOR,
  type DependenciasDaCaptura,
  iniciarCapturaDoAudio,
  MENSAGEM_CAPTURA_ENCERRADA,
  MENSAGEM_SEM_AUDIO,
  mensagemDoErroDeCaptura,
  NOME_DO_PROCESSADOR,
} from "./capturaDoAudio";

class TrilhaFalsa {
  readyState: "live" | "ended" = "live";
  readonly stop = vi.fn(() => {
    this.readyState = "ended";
  });
  private readonly ouvintes = new Set<() => void>();
  constructor(readonly kind: "audio" | "video") {}
  addEventListener(_tipo: string, ouvinte: () => void): void {
    this.ouvintes.add(ouvinte);
  }
  removeEventListener(_tipo: string, ouvinte: () => void): void {
    this.ouvintes.delete(ouvinte);
  }
  terminar(): void {
    this.readyState = "ended";
    for (const ouvinte of [...this.ouvintes]) ouvinte();
  }
}

function fluxoFalso(trilhas: TrilhaFalsa[]): MediaStream {
  return {
    getTracks: () => trilhas,
    getAudioTracks: () => trilhas.filter((trilha) => trilha.kind === "audio"),
    getVideoTracks: () => trilhas.filter((trilha) => trilha.kind === "video"),
  } as unknown as MediaStream;
}

function montar(opcoes: { trilhas?: TrilhaFalsa[]; falhaAoPedir?: unknown; falhaNoModulo?: unknown } = {}) {
  const audio = new TrilhaFalsa("audio");
  const video = new TrilhaFalsa("video");
  const trilhas = opcoes.trilhas ?? [video, audio];
  const porta = { onmessage: null as ((evento: MessageEvent<unknown>) => void) | null, close: vi.fn() };
  const no = { port: porta, disconnect: vi.fn() };
  const origem = { connect: vi.fn(), disconnect: vi.fn() };
  const contexto = {
    state: "suspended" as AudioContextState,
    audioWorklet: {
      addModule: vi.fn(async () => {
        if (opcoes.falhaNoModulo !== undefined) throw opcoes.falhaNoModulo;
      }),
    },
    createMediaStreamSource: vi.fn(() => origem),
    resume: vi.fn(async () => {
      contexto.state = "running";
    }),
    close: vi.fn(async () => {
      contexto.state = "closed";
    }),
  };
  const getDisplayMedia = vi.fn(async () => {
    if (opcoes.falhaAoPedir !== undefined) throw opcoes.falhaAoPedir;
    return fluxoFalso(trilhas);
  });
  const blobs: Blob[] = [];
  const dependencias: DependenciasDaCaptura = {
    mediaDevices: { getDisplayMedia },
    criarContexto: vi.fn(() => contexto as unknown as AudioContext),
    criarNoDoProcessador: vi.fn(() => no as unknown as AudioWorkletNode),
    criarUrl: vi.fn((blob: Blob) => {
      blobs.push(blob);
      return "blob:processador";
    }),
    revogarUrl: vi.fn(),
  };
  const ouvintes = { aoReceberAmostras: vi.fn<(amostras: Float32Array) => void>(), aoEncerrar: vi.fn<(motivo: string) => void>() };
  return { audio, video, porta, no, origem, contexto, getDisplayMedia, dependencias, ouvintes, blobs };
}

describe("iniciarCapturaDoAudio", () => {
  it("pede tela com áudio, para o vídeo na hora e liga o worklet a 16 kHz em mono", async () => {
    const t = montar();
    await iniciarCapturaDoAudio(t.ouvintes, t.dependencias);

    expect(t.getDisplayMedia).toHaveBeenCalledWith({ audio: true, video: true });
    expect(t.video.stop).toHaveBeenCalled();
    expect(t.audio.stop).not.toHaveBeenCalled();
    expect(t.dependencias.criarContexto).toHaveBeenCalledWith({ sampleRate: 16_000 });
    expect(t.contexto.audioWorklet.addModule).toHaveBeenCalledWith("blob:processador");
    expect(t.dependencias.criarNoDoProcessador).toHaveBeenCalledWith(
      t.contexto,
      NOME_DO_PROCESSADOR,
      expect.objectContaining({ numberOfOutputs: 0, channelCount: 1, channelCountMode: "explicit" }),
    );
    expect(t.origem.connect).toHaveBeenCalledWith(t.no);
    expect(t.contexto.resume).toHaveBeenCalled();
    expect(t.blobs).toHaveLength(1);
    expect(CODIGO_DO_PROCESSADOR).toContain(`registerProcessor("${NOME_DO_PROCESSADOR}"`);
  });

  it("repassa os pedaços Float32 do worklet e ignora o resto", async () => {
    const t = montar();
    await iniciarCapturaDoAudio(t.ouvintes, t.dependencias);
    const pedaco = new Float32Array([0.1, 0.2]);
    t.porta.onmessage?.({ data: pedaco } as MessageEvent<unknown>);
    t.porta.onmessage?.({ data: "lixo" } as MessageEvent<unknown>);
    expect(t.ouvintes.aoReceberAmostras).toHaveBeenCalledTimes(1);
    expect(t.ouvintes.aoReceberAmostras).toHaveBeenCalledWith(pedaco);
  });

  it("parar desliga trilhas, nós, contexto e URL; e pode ser chamado de novo", async () => {
    const t = montar();
    const captura = await iniciarCapturaDoAudio(t.ouvintes, t.dependencias);
    captura.parar();
    captura.parar();
    expect(t.audio.stop).toHaveBeenCalled();
    expect(t.origem.disconnect).toHaveBeenCalledTimes(1);
    expect(t.no.disconnect).toHaveBeenCalledTimes(1);
    expect(t.porta.close).toHaveBeenCalled();
    expect(t.porta.onmessage).toBeNull();
    expect(t.contexto.close).toHaveBeenCalledTimes(1);
    expect(t.dependencias.revogarUrl).toHaveBeenCalledWith("blob:processador");
    expect(t.ouvintes.aoEncerrar).not.toHaveBeenCalled();
  });

  it("quando a trilha de áudio termina, para tudo e avisa aoEncerrar", async () => {
    const t = montar();
    await iniciarCapturaDoAudio(t.ouvintes, t.dependencias);
    t.audio.terminar();
    expect(t.ouvintes.aoEncerrar).toHaveBeenCalledWith(MENSAGEM_CAPTURA_ENCERRADA);
    expect(t.contexto.close).toHaveBeenCalled();
  });

  it("sem trilha de áudio, para tudo e lança erro claro", async () => {
    const video = new TrilhaFalsa("video");
    const t = montar({ trilhas: [video] });
    await expect(iniciarCapturaDoAudio(t.ouvintes, t.dependencias)).rejects.toThrow(MENSAGEM_SEM_AUDIO);
    expect(video.stop).toHaveBeenCalled();
    expect(t.dependencias.criarContexto).not.toHaveBeenCalled();
  });

  it("captura recusada vira a mensagem de liberar pelo indicador", async () => {
    const t = montar({ falhaAoPedir: new DOMException("negado", "NotAllowedError") });
    await expect(iniciarCapturaDoAudio(t.ouvintes, t.dependencias)).rejects.toThrow(
      "A captura do áudio não foi liberada. Clique em retomar no indicador da escuta.",
    );
  });

  it("falha ao carregar o worklet desfaz o que já foi montado", async () => {
    const t = montar({ falhaNoModulo: new Error("módulo inválido") });
    await expect(iniciarCapturaDoAudio(t.ouvintes, t.dependencias)).rejects.toThrow(
      "A captura do áudio do computador falhou: módulo inválido",
    );
    expect(t.audio.stop).toHaveBeenCalled();
    expect(t.contexto.close).toHaveBeenCalled();
    expect(t.dependencias.revogarUrl).toHaveBeenCalled();
  });

  it("sem getDisplayMedia, avisa que a captura não é oferecida", async () => {
    const t = montar();
    await expect(
      iniciarCapturaDoAudio(t.ouvintes, { ...t.dependencias, mediaDevices: undefined }),
    ).rejects.toThrow(/não oferece a captura do áudio do sistema/);
  });
});

describe("mensagemDoErroDeCaptura", () => {
  it.each([
    ["NotSupportedError", /não oferece/],
    ["InvalidStateError", /precisa de um clique/],
    ["NotReadableError", /não pôde ser lido/],
    ["NotFoundError", /Nenhuma fonte/],
  ])("%s tem mensagem legível", (nome, esperado) => {
    expect(mensagemDoErroDeCaptura(new DOMException("x", nome))).toMatch(esperado);
  });

  it("outros erros levam a mensagem original", () => {
    expect(mensagemDoErroDeCaptura(new Error("boom"))).toBe("A captura do áudio do computador falhou: boom");
  });
});
