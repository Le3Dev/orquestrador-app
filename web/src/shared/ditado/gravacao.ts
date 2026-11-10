/** Taxa que o Whisper espera. */
export const TAXA_DO_WHISPER = 16_000;

/**
 * Abaixo deste nível (0 a 1, ver `nivelDaVoz`) o microfone está "mudo": uma sala
 * quieta com supressão de ruído fica perto de 0,05; a fala passa de 0,3.
 */
export const LIMIAR_DE_SILENCIO = 0.12;

/** Quanto tempo de nível abaixo do limiar até avisar que o microfone parece mudo. */
export const TEMPO_PARA_AVISAR_SILENCIO_MS = 3_000;

/** Do RMS da onda (0 a 1) para um nível de 0 a 1 que acompanha a percepção (raiz: a voz baixa ainda aparece). */
export function nivelDaVoz(rms: number): number {
  return Math.min(1, Math.sqrt(Math.max(0, rms)) * 2.2);
}

/** Uma gravação do microfone em andamento. */
export interface Gravacao {
  /** Para e devolve o áudio mono a 16 kHz (vazio se nada foi captado). */
  parar: () => Promise<Float32Array>;
  /** Para e joga o áudio fora. */
  descartar: () => void;
  /**
   * Nível da voz agora, de 0 a 1, lido do mesmo microfone que está gravando.
   * `null` se o navegador não deu como medir (a gravação segue normal).
   */
  nivel: () => number | null;
}

interface Medidor {
  nivel: () => number;
  parar: () => void;
}

/** Liga um AnalyserNode ao fluxo que já está aberto (sem abrir o microfone de novo e sem tocar o som). */
function criarMedidor(fluxo: MediaStream): Medidor | null {
  try {
    const contexto = new AudioContext();
    const fonte = contexto.createMediaStreamSource(fluxo);
    const analisador = contexto.createAnalyser();
    analisador.fftSize = 1024;
    fonte.connect(analisador);
    // Criado depois de esperar a permissão: o navegador pode ter deixado o contexto suspenso.
    void contexto.resume().catch(() => undefined);
    const amostras = new Float32Array(analisador.fftSize);
    let parado = false;
    return {
      nivel: () => {
        analisador.getFloatTimeDomainData(amostras);
        let soma = 0;
        for (const valor of amostras) soma += valor * valor;
        return nivelDaVoz(Math.sqrt(soma / amostras.length));
      },
      parar: () => {
        if (parado) return;
        parado = true;
        fonte.disconnect();
        void contexto.close().catch(() => undefined);
      },
    };
  } catch {
    // Medir o nível é um extra: sem ele, grava do mesmo jeito.
    return null;
  }
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
  const medidor = criarMedidor(fluxo);

  function soltarMicrofone(): void {
    medidor?.parar();
    for (const trilha of fluxo.getTracks()) trilha.stop();
  }

  return {
    nivel: () => medidor?.nivel() ?? null,
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
