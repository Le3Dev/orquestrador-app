/** Taxa que o Whisper espera. */
export const TAXA_DO_WHISPER = 16_000;

/** Uma gravação do microfone em andamento. */
export interface Gravacao {
  /** Para e devolve o áudio mono a 16 kHz (vazio se nada foi captado). */
  parar: () => Promise<Float32Array>;
  /** Para e joga o áudio fora. */
  descartar: () => void;
}

/** Pede o microfone e começa a gravar. Rejeita se a pessoa negar ou não houver microfone. */
export async function comecarGravacao(): Promise<Gravacao> {
  const fluxo = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  const gravador = new MediaRecorder(fluxo);
  const pedacos: Blob[] = [];
  gravador.ondataavailable = (evento) => {
    if (evento.data.size > 0) pedacos.push(evento.data);
  };
  gravador.start();

  function soltarMicrofone(): void {
    for (const trilha of fluxo.getTracks()) trilha.stop();
  }

  return {
    parar: () =>
      new Promise<Float32Array>((resolver, rejeitar) => {
        gravador.onstop = () => {
          soltarMicrofone();
          const audio = new Blob(pedacos, { type: gravador.mimeType });
          decodificarPara16k(audio).then(resolver, rejeitar);
        };
        gravador.stop();
      }),
    descartar: () => {
      gravador.onstop = null;
      if (gravador.state !== "inactive") gravador.stop();
      soltarMicrofone();
    },
  };
}

/** Decodifica o áudio gravado (webm/opus, mp4…) para mono a 16 kHz. */
async function decodificarPara16k(audio: Blob): Promise<Float32Array> {
  if (audio.size === 0) return new Float32Array(0);
  const contexto = new AudioContext({ sampleRate: TAXA_DO_WHISPER });
  try {
    const decodificado = await contexto.decodeAudioData(await audio.arrayBuffer());
    // Cópia: o áudio vai ser transferido ao worker, e o buffer do AudioBuffer não pode.
    if (decodificado.numberOfChannels === 1) return new Float32Array(decodificado.getChannelData(0));
    // Mais de um canal: média deles.
    const mono = new Float32Array(decodificado.length);
    for (let canal = 0; canal < decodificado.numberOfChannels; canal++) {
      const dados = decodificado.getChannelData(canal);
      for (let i = 0; i < mono.length; i++) mono[i] = (mono[i] ?? 0) + (dados[i] ?? 0) / decodificado.numberOfChannels;
    }
    return mono;
  } finally {
    void contexto.close();
  }
}
