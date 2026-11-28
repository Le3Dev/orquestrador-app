/**
 * O aviso sonoro da pergunta pendente: dois tons curtos e baixos, gerados na
 * hora pelo Web Audio (sem arquivo de áudio). Só toca se a preferência
 * "Som ao receber uma pergunta" estiver ligada; quem decide é o chamador.
 */

/** Volume (0 a 1) de cada tom: baixo de propósito. */
const VOLUME = 0.04;
/** Os dois tons (Hz) e quando cada um começa (s). */
const TONS: readonly (readonly [number, number])[] = [
  [660, 0],
  [880, 0.13],
];

let contexto: AudioContext | null = null;

/** Toca o aviso uma vez. Sem Web Audio (ou com o áudio bloqueado), não faz nada. */
export function tocarSomDaPergunta(): void {
  try {
    const Contexto =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Contexto === undefined) {
      return;
    }
    contexto ??= new Contexto();
    const audio = contexto;
    if (audio.state === "suspended") {
      void audio.resume().catch(() => undefined);
    }
    const t = audio.currentTime;
    for (const [frequencia, atraso] of TONS) {
      const oscilador = audio.createOscillator();
      const ganho = audio.createGain();
      oscilador.type = "sine";
      oscilador.frequency.value = frequencia;
      ganho.gain.setValueAtTime(0, t + atraso);
      ganho.gain.linearRampToValueAtTime(VOLUME, t + atraso + 0.02);
      ganho.gain.exponentialRampToValueAtTime(0.0001, t + atraso + 0.22);
      oscilador.connect(ganho).connect(audio.destination);
      oscilador.start(t + atraso);
      oscilador.stop(t + atraso + 0.25);
    }
  } catch {
    // O som é só um reforço: falhar em silêncio.
  }
}
