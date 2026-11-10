import {
  BUSCA_DO_CORTE_MS,
  CortadorDeFala,
  DURACAO_MAXIMA_DA_FALA_MS,
  type EventoDeFala,
  LIMIAR_DE_FIM_DA_FALA,
  LIMIAR_DE_INICIO_DA_FALA,
  PRE_ROLL_MS,
  SILENCIO_PARA_FIM_MS,
  VOZ_MINIMA_MS,
} from "./CortadorDeFala";
import { AMOSTRAS_POR_JANELA_DO_VAD, DURACAO_DA_JANELA_DO_VAD_MS, type JanelasAnalisadas } from "./DetectorDeVoz";

const N = AMOSTRAS_POR_JANELA_DO_VAD;
const MS = DURACAO_DA_JANELA_DO_VAD_MS;
const AMOSTRAS_POR_MS = N / MS;

/**
 * Produz janelas com probabilidades escolhidas pelo teste. Cada amostra vale a
 * sua posição no fluxo (0, 1, 2…): dá para conferir de onde veio cada pedaço
 * de áudio e que nenhuma amostra se perdeu.
 */
class Fonte {
  private proxima = 0;

  janelas(probabilidades: readonly number[]): JanelasAnalisadas {
    const amostras = Float32Array.from({ length: probabilidades.length * N }, (_, i) => this.proxima + i);
    this.proxima += amostras.length;
    return { amostras, probabilidades };
  }
}

const repetir = (p: number, vezes: number): number[] => Array.from({ length: vezes }, () => p);

/** Passa as probabilidades em pedaços de `porChamada` janelas e junta os eventos. */
function alimentar(cortador: CortadorDeFala, fonte: Fonte, probabilidades: readonly number[], porChamada = 5): EventoDeFala[] {
  const eventos: EventoDeFala[] = [];
  for (let i = 0; i < probabilidades.length; i += porChamada) {
    eventos.push(...cortador.adicionar(fonte.janelas(probabilidades.slice(i, i + porChamada))));
  }
  return eventos;
}

/** Os eventos sem o áudio (só o tamanho dele), para comparar com toEqual. */
const resumo = (eventos: readonly EventoDeFala[]) =>
  eventos.map((evento) =>
    evento.tipo === "inicio"
      ? { tipo: "inicio", emMs: evento.emMs }
      : { tipo: "fim", motivo: evento.motivo, inicioMs: evento.inicioMs, emMs: evento.emMs, amostras: evento.audio.length },
  );

/** true se o áudio é a sequência contínua de amostras que começa em `primeira`. */
function ehContinuo(audio: Float32Array, primeira: number): boolean {
  for (let i = 0; i < audio.length; i++) if (audio[i] !== primeira + i) return false;
  return true;
}

function fins(eventos: readonly EventoDeFala[]): Extract<EventoDeFala, { tipo: "fim" }>[] {
  return eventos.filter((evento) => evento.tipo === "fim");
}

describe("CortadorDeFala", () => {
  it("constantes combinadas", () => {
    expect(LIMIAR_DE_INICIO_DA_FALA).toBe(0.5);
    expect(LIMIAR_DE_FIM_DA_FALA).toBe(0.35);
    expect(SILENCIO_PARA_FIM_MS).toBe(350);
    expect(PRE_ROLL_MS).toBe(200);
    expect(VOZ_MINIMA_MS).toBe(250);
    expect(DURACAO_MAXIMA_DA_FALA_MS).toBe(8_000);
    expect(BUSCA_DO_CORTE_MS).toBe(2_000);
    expect(MS).toBe(32);
  });

  it("silêncio puro não gera evento", () => {
    const cortador = new CortadorDeFala();
    expect(alimentar(cortador, new Fonte(), repetir(0.1, 200))).toEqual([]);
    expect(cortador.encerrar()).toEqual([]);
  });

  it("histerese: começa com p ≥ 0,5, continua com p ≥ 0,35 e termina após 350 ms abaixo disso", () => {
    const cortador = new CortadorDeFala();
    const fonte = new Fonte();
    // 10 janelas de silêncio, 1 a 0,6, 20 a 0,4 (só a histerese segura) e 11 de silêncio.
    const eventos = alimentar(cortador, fonte, [...repetir(0.1, 10), 0.6, ...repetir(0.4, 20), ...repetir(0.1, 11)]);
    // Começo: janela 10 (320 ms) menos 200 ms de pre-roll; fim: depois da 11ª janela de silêncio.
    expect(resumo(eventos)).toEqual([
      { tipo: "inicio", emMs: 120 },
      { tipo: "fim", motivo: "silencio", inicioMs: 120, emMs: 42 * MS, amostras: (42 * MS - 120) * AMOSTRAS_POR_MS },
    ]);
    const fim = fins(eventos)[0];
    expect(fim !== undefined && ehContinuo(fim.audio, 120 * AMOSTRAS_POR_MS)).toBe(true);
    expect(cortador.emAndamento).toBe(false);
  });

  it("p abaixo de 0,5 não começa fala, mesmo acima do limiar de fim", () => {
    const cortador = new CortadorDeFala();
    expect(alimentar(cortador, new Fonte(), repetir(0.45, 100))).toEqual([]);
    expect(cortador.emAndamento).toBe(false);
  });

  it("anuncia a fala só quando junta 250 ms de voz", () => {
    const cortador = new CortadorDeFala();
    const fonte = new Fonte();
    expect(cortador.adicionar(fonte.janelas(repetir(0.1, 10)))).toEqual([]);
    // 7 janelas de voz = 224 ms: ainda não.
    expect(cortador.adicionar(fonte.janelas(repetir(0.9, 7)))).toEqual([]);
    expect(cortador.emAndamento).toBe(false);
    expect(cortador.inicioDaFalaMs).toBeNull();
    expect(cortador.audioDaFala().length).toBe(0);
    // A 8ª (256 ms) anuncia, com o começo no passado.
    expect(resumo(cortador.adicionar(fonte.janelas([0.9])))).toEqual([{ tipo: "inicio", emMs: 120 }]);
    expect(cortador.emAndamento).toBe(true);
    expect(cortador.inicioDaFalaMs).toBe(120);
  });

  it("a voz para anunciar soma janelas separadas por silêncio curto", () => {
    const cortador = new CortadorDeFala();
    const eventos = alimentar(cortador, new Fonte(), [...repetir(0.1, 10), ...repetir(0.9, 4), ...repetir(0.1, 5), ...repetir(0.9, 4)]);
    expect(resumo(eventos)).toEqual([{ tipo: "inicio", emMs: 120 }]);
  });

  it("pre-roll: 200 ms antes da primeira voz, ou o que houver no começo do fluxo", () => {
    const longo = new CortadorDeFala();
    alimentar(longo, new Fonte(), [...repetir(0.1, 50), ...repetir(0.9, 8)]);
    expect(longo.inicioDaFalaMs).toBe(50 * MS - PRE_ROLL_MS);
    const audio = longo.audioDaFala();
    expect(audio.length).toBe(PRE_ROLL_MS * AMOSTRAS_POR_MS + 8 * N);
    expect(ehContinuo(audio, 50 * N - PRE_ROLL_MS * AMOSTRAS_POR_MS)).toBe(true);

    const curto = new CortadorDeFala();
    alimentar(curto, new Fonte(), [...repetir(0.1, 2), ...repetir(0.9, 8)]);
    expect(curto.inicioDaFalaMs).toBe(0);
    expect(curto.audioDaFala().length).toBe(10 * N);
  });

  it("fala com menos de 250 ms de voz é descartada sem evento", () => {
    const cortador = new CortadorDeFala();
    const fonte = new Fonte();
    expect(alimentar(cortador, fonte, [...repetir(0.1, 10), ...repetir(0.9, 7), ...repetir(0.1, 30)])).toEqual([]);
    expect(cortador.emAndamento).toBe(false);
    // A seguinte funciona normalmente, com pre-roll tirado do silêncio depois da descartada.
    const eventos = alimentar(cortador, fonte, [...repetir(0.9, 10), ...repetir(0.1, 11)]);
    expect(resumo(eventos)).toEqual([
      { tipo: "inicio", emMs: 47 * MS - PRE_ROLL_MS },
      { tipo: "fim", motivo: "silencio", inicioMs: 47 * MS - PRE_ROLL_MS, emMs: 68 * MS, amostras: (68 * MS - 47 * MS + PRE_ROLL_MS) * AMOSTRAS_POR_MS },
    ]);
  });

  it("silêncio de 320 ms no meio não corta a fala; o de 352 ms corta", () => {
    const cortador = new CortadorDeFala();
    const eventos = alimentar(cortador, new Fonte(), [
      ...repetir(0.1, 10),
      ...repetir(0.9, 20),
      ...repetir(0.1, 10),
      ...repetir(0.9, 20),
      ...repetir(0.1, 10),
    ]);
    expect(resumo(eventos)).toEqual([{ tipo: "inicio", emMs: 120 }]);
    expect(cortador.emAndamento).toBe(true);
    expect(resumo(cortador.adicionar(new Fonte().janelas([0.1])))).toMatchObject([{ tipo: "fim", motivo: "silencio", emMs: 71 * MS }]);
  });

  it("fala longa é cortada na janela de menor probabilidade dos últimos 2 s, sem perder amostras", () => {
    const cortador = new CortadorDeFala();
    const fonte = new Fonte();
    // A fala começa na janela 10 (áudio desde 1_920, com o pre-roll) e passa de 8 s na janela 253.
    const probabilidades = [...repetir(0.1, 10), ...repetir(0.9, 244)];
    probabilidades[150] = 0.01; // vale mais fundo, mas fora dos últimos 2 s: não serve
    probabilidades[220] = 0.2; // o vale dentro dos últimos 2 s
    probabilidades[240] = 0.3;
    const eventos = alimentar(cortador, fonte, probabilidades, 7);
    expect(resumo(eventos)).toEqual([
      { tipo: "inicio", emMs: 120 },
      { tipo: "fim", motivo: "duracao_maxima", inicioMs: 120, emMs: 221 * MS, amostras: 221 * N - 1_920 },
      { tipo: "inicio", emMs: 221 * MS },
    ]);
    const primeira = fins(eventos)[0];
    expect(primeira !== undefined && ehContinuo(primeira.audio, 1_920)).toBe(true);

    // A fala seguinte já tem as janelas 221 a 253 e segue até o silêncio.
    expect(cortador.inicioDaFalaMs).toBe(221 * MS);
    expect(ehContinuo(cortador.audioDaFala(), 221 * N)).toBe(true);
    expect(cortador.audioDaFala().length).toBe(33 * N);
    const resto = alimentar(cortador, fonte, [...repetir(0.9, 5), ...repetir(0.1, 11)]);
    const segunda = fins(resto)[0];
    expect(resumo(resto)).toEqual([
      { tipo: "fim", motivo: "silencio", inicioMs: 221 * MS, emMs: 270 * MS, amostras: 49 * N },
    ]);
    expect(segunda !== undefined && ehContinuo(segunda.audio, 221 * N)).toBe(true);
  });

  it("fala longa sem vale corta no começo da busca e nunca passa de 8 s", () => {
    const cortador = new CortadorDeFala();
    const eventos = alimentar(cortador, new Fonte(), repetir(0.9, 2_000), 50);
    const cortes = fins(eventos);
    expect(cortes.length).toBeGreaterThanOrEqual(2);
    // Passa de 8 s na janela 250; sem vale, corta depois da primeira janela da busca (250 − 62 + 1 = 189).
    expect(cortes[0]?.emMs).toBe(190 * MS);
    for (const corte of cortes) {
      expect(corte.motivo).toBe("duracao_maxima");
      expect(corte.emMs - corte.inicioMs).toBeLessThanOrEqual(DURACAO_MAXIMA_DA_FALA_MS + MS);
    }
    // Cada fala começa exatamente onde a anterior terminou.
    const inicios = eventos.filter((evento) => evento.tipo === "inicio").map((evento) => evento.emMs);
    expect(inicios.slice(1)).toEqual(cortes.map((corte) => corte.emMs));
  });

  it("encerrar entrega a fala anunciada e recomeça o pre-roll; o relógio continua", () => {
    const cortador = new CortadorDeFala();
    const fonte = new Fonte();
    alimentar(cortador, fonte, [...repetir(0.1, 10), ...repetir(0.9, 12)]);
    expect(resumo(cortador.encerrar())).toEqual([
      { tipo: "fim", motivo: "encerramento", inicioMs: 120, emMs: 22 * MS, amostras: (22 * MS - 120) * AMOSTRAS_POR_MS },
    ]);
    expect(cortador.emAndamento).toBe(false);
    expect(cortador.agoraMs).toBe(22 * MS);
    expect(cortador.encerrar()).toEqual([]);

    // Sem pre-roll de antes da pausa: a próxima fala começa na primeira janela de voz.
    alimentar(cortador, fonte, repetir(0.9, 8));
    expect(cortador.inicioDaFalaMs).toBe(22 * MS);
  });

  it("encerrar descarta a fala ainda não anunciada", () => {
    const cortador = new CortadorDeFala();
    alimentar(cortador, new Fonte(), [...repetir(0.1, 10), ...repetir(0.9, 5)]);
    expect(cortador.encerrar()).toEqual([]);
  });

  it("relógio pelas amostras recebidas; reiniciar zera tudo", () => {
    const cortador = new CortadorDeFala();
    const fonte = new Fonte();
    expect(cortador.agoraMs).toBe(0);
    alimentar(cortador, fonte, [...repetir(0.1, 10), ...repetir(0.9, 10)]);
    expect(cortador.agoraMs).toBe(20 * MS);
    expect(cortador.emAndamento).toBe(true);
    cortador.reiniciar();
    expect(cortador.agoraMs).toBe(0);
    expect(cortador.emAndamento).toBe(false);
    expect(cortador.encerrar()).toEqual([]);
    // Recomeça do zero: sem pre-roll, a fala começa em 0.
    alimentar(cortador, new Fonte(), repetir(0.9, 8));
    expect(cortador.inicioDaFalaMs).toBe(0);
  });

  it("não guarda a entrada e audioDaFala devolve uma cópia", () => {
    const cortador = new CortadorDeFala();
    const janelas = new Fonte().janelas(repetir(0.9, 10));
    cortador.adicionar(janelas);
    janelas.amostras.fill(-1);
    const audio = cortador.audioDaFala();
    expect(ehContinuo(audio, 0)).toBe(true);
    audio.fill(-2);
    expect(ehContinuo(cortador.audioDaFala(), 0)).toBe(true);
  });

  it("recusa janelas desalinhadas", () => {
    const cortador = new CortadorDeFala();
    expect(() => cortador.adicionar({ amostras: new Float32Array(N + 1), probabilidades: [0.9] })).toThrow(/desalinhadas/);
  });
});
