import {
  AMOSTRAS_POR_QUADRO,
  CAUDA_MS,
  CortadorDeTrechos,
  DURACAO_MAXIMA_DO_TRECHO_MS,
  LIMIAR_MINIMO,
  PRE_ROLL_MS,
  SILENCIO_PARA_CORTAR_MS,
  TAXA_DE_AMOSTRAGEM,
  VOZ_MINIMA_MS,
  type TrechoDeAudio,
} from "./CortadorDeTrechos";

const AMOSTRAS_POR_MS = TAXA_DE_AMOSTRAGEM / 1000;

function silencio(ms: number): Float32Array {
  return new Float32Array(ms * AMOSTRAS_POR_MS);
}

/** Senoide de 220 Hz: RMS = amplitude / √2. */
function senoide(ms: number, amplitude = 0.3): Float32Array {
  const amostras = new Float32Array(ms * AMOSTRAS_POR_MS);
  for (let i = 0; i < amostras.length; i++) amostras[i] = amplitude * Math.sin((2 * Math.PI * 220 * i) / TAXA_DE_AMOSTRAGEM);
  return amostras;
}

/** Ruído uniforme determinístico (gerador congruente linear). */
function ruido(ms: number, amplitude: number, semente = 1): Float32Array {
  const amostras = new Float32Array(ms * AMOSTRAS_POR_MS);
  let estado = semente;
  for (let i = 0; i < amostras.length; i++) {
    estado = (estado * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    amostras[i] = amplitude * ((estado / 4_294_967_296) * 2 - 1);
  }
  return amostras;
}

function juntar(...partes: Float32Array[]): Float32Array {
  const total = partes.reduce((soma, parte) => soma + parte.length, 0);
  const resultado = new Float32Array(total);
  let posicao = 0;
  for (const parte of partes) {
    resultado.set(parte, posicao);
    posicao += parte.length;
  }
  return resultado;
}

/** Comparação rápida de amostras (o `toEqual` profundo é lento demais para centenas de milhares). */
function mesmasAmostras(a: Float32Array, b: Float32Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Tempos e tamanho de cada trecho, para comparar com toEqual. */
const resumo = (trechos: readonly TrechoDeAudio[]) =>
  trechos.map((t) => ({ inicioMs: t.inicioMs, fimMs: t.fimMs, amostras: t.amostras.length }));

/** Passa o áudio todo de uma vez e encerra. */
function cortarTudo(audio: Float32Array): TrechoDeAudio[] {
  const cortador = new CortadorDeTrechos();
  return [...cortador.adicionar(audio), ...cortador.encerrar()];
}

describe("CortadorDeTrechos", () => {
  it("constantes combinadas", () => {
    expect(TAXA_DE_AMOSTRAGEM).toBe(16_000);
    expect(AMOSTRAS_POR_QUADRO).toBe(480);
    expect(SILENCIO_PARA_CORTAR_MS).toBe(500);
    expect(DURACAO_MAXIMA_DO_TRECHO_MS).toBe(8_000);
    expect(LIMIAR_MINIMO).toBeCloseTo(0.01);
  });

  it("silêncio puro não gera trecho", () => {
    expect(cortarTudo(silencio(5_000))).toEqual([]);
    expect(cortarTudo(ruido(5_000, 0.005))).toEqual([]);
  });

  it("voz seguida de 500 ms de silêncio gera um trecho, com os tempos certos", () => {
    // O corte vem no 17º quadro sem voz (510 ms), o múltiplo de 30 ms mais perto de 500 ms.
    const entrada = juntar(silencio(990), senoide(1_200), silencio(SILENCIO_PARA_CORTAR_MS + 10));
    const cortador = new CortadorDeTrechos();
    const trechos = cortador.adicionar(entrada);

    expect(trechos).toHaveLength(1);
    const [trecho] = trechos as [TrechoDeAudio];
    // Começa PRE_ROLL_MS antes da voz e termina CAUDA_MS depois dela.
    expect(trecho.inicioMs).toBe(990 - PRE_ROLL_MS);
    expect(trecho.fimMs).toBe(990 + 1_200 + CAUDA_MS);
    expect(trecho.amostras.length).toBe((trecho.fimMs - trecho.inicioMs) * AMOSTRAS_POR_MS);
    // As amostras são as da entrada, a partir do começo do pre-roll.
    const inicio = trecho.inicioMs * AMOSTRAS_POR_MS;
    expect(mesmasAmostras(trecho.amostras, entrada.slice(inicio, inicio + trecho.amostras.length))).toBe(true);
    expect(cortador.emAndamento).toBe(false);
    expect(cortador.encerrar()).toEqual([]);
  });

  it("450 ms de silêncio não corta", () => {
    const cortador = new CortadorDeTrechos();
    expect(cortador.adicionar(juntar(silencio(990), senoide(1_200), silencio(450)))).toEqual([]);
    expect(cortador.emAndamento).toBe(true);
  });

  it("dois trechos separados por silêncio saem separados", () => {
    const trechos = cortarTudo(juntar(silencio(300), senoide(900), silencio(1_500), senoide(600), silencio(900)));
    expect(trechos.map((t) => [t.inicioMs, t.fimMs])).toEqual([
      [300 - PRE_ROLL_MS, 300 + 900 + CAUDA_MS],
      [2_700 - PRE_ROLL_MS, 2_700 + 600 + CAUDA_MS],
    ]);
  });

  it("voz contínua de 40 s gera trechos de no máximo 8 s, sem perder amostras", () => {
    const entrada = juntar(senoide(40_000), silencio(1_000));
    const trechos = cortarTudo(entrada);
    // 8 s em quadros inteiros de 30 ms são 266 quadros (7,98 s).
    const MAXIMO = 7_980;

    expect(trechos.length).toBe(5);
    for (const trecho of trechos) expect(trecho.fimMs - trecho.inicioMs).toBeLessThanOrEqual(DURACAO_MAXIMA_DO_TRECHO_MS);
    expect(trechos.map((t) => t.inicioMs)).toEqual([0, MAXIMO, 2 * MAXIMO, 3 * MAXIMO, 4 * MAXIMO]);
    expect(trechos[0]?.fimMs).toBe(MAXIMO);
    expect(trechos[1]?.fimMs).toBe(2 * MAXIMO);
    // Os dois primeiros, colados, são exatamente o começo da entrada.
    const colados = juntar(...trechos.slice(0, 2).map((t) => t.amostras));
    expect(mesmasAmostras(colados, entrada.slice(0, 2 * MAXIMO * AMOSTRAS_POR_MS))).toBe(true);
  });

  it("parcialEmAndamento devolve uma cópia do que já se ouviu do trecho, sem mexer no cortador", () => {
    const cortador = new CortadorDeTrechos();
    expect(cortador.parcialEmAndamento()).toBeNull();
    // Pouca voz ainda: nada a transcrever.
    cortador.adicionar(juntar(silencio(510), senoide(240)));
    expect(cortador.parcialEmAndamento()).toBeNull();

    const entrada = juntar(senoide(1_500), silencio(120));
    cortador.adicionar(entrada);
    expect(cortador.emAndamento).toBe(true);
    const parcial = cortador.parcialEmAndamento();
    expect(parcial).not.toBeNull();
    // Do começo do trecho (voz de 240 ms + o que veio) até a voz mais a cauda disponível.
    expect(parcial?.inicioMs).toBe(510 - PRE_ROLL_MS);
    expect(parcial?.fimMs).toBe(510 + 240 + 1_500 + 120);
    // É uma cópia: alterar não afeta o trecho que sai depois.
    parcial?.amostras.fill(0);
    const [final] = cortador.adicionar(silencio(SILENCIO_PARA_CORTAR_MS)) as [TrechoDeAudio];
    expect(final.amostras.some((valor) => valor !== 0)).toBe(true);
    expect(cortador.parcialEmAndamento()).toBeNull();
  });

  it("ruído curto (menos de 400 ms de voz) é descartado", () => {
    expect(VOZ_MINIMA_MS).toBe(400);
    expect(cortarTudo(juntar(silencio(510), ruido(300, 0.5), silencio(1_000)))).toEqual([]);
    expect(cortarTudo(juntar(silencio(510), senoide(390), silencio(1_000)))).toEqual([]);
    expect(cortarTudo(juntar(silencio(510), senoide(420), silencio(1_000)))).toHaveLength(1);
  });

  it("ruído alto também conta como voz", () => {
    expect(cortarTudo(juntar(silencio(510), ruido(1_200, 0.4), silencio(1_000)))).toHaveLength(1);
  });

  it("o limiar se adapta ao ruído de fundo", () => {
    const fundo = senoide(3_000, 0.011); // RMS ≈ 0,0078, abaixo do limiar mínimo
    const vozBaixa = senoide(1_200, 0.02); // RMS ≈ 0,014, acima do limiar mínimo
    // Sem ruído de fundo, a voz baixa já passa do limiar mínimo...
    expect(cortarTudo(juntar(silencio(3_000), vozBaixa, silencio(1_000)))).toHaveLength(1);
    // ...mas com o fundo o piso de ruído sobe e ela fica abaixo de 3 × ruído.
    expect(cortarTudo(juntar(fundo, vozBaixa, silencio(1_000)))).toEqual([]);
    // Voz de verdade continua passando por cima do fundo.
    expect(cortarTudo(juntar(fundo, senoide(1_200, 0.3), silencio(1_000)))).toHaveLength(1);
  });

  it("pedaços de tamanhos variados dão o mesmo resultado que um pedaço único", () => {
    const entrada = juntar(
      ruido(500, 0.003, 7),
      senoide(1_500),
      silencio(800),
      ruido(2_000, 0.3, 11),
      silencio(900),
      senoide(16_000),
      silencio(200),
    );
    const deUmaVez = cortarTudo(entrada);

    const cortador = new CortadorDeTrechos();
    const emPedacos: TrechoDeAudio[] = [];
    const tamanhos = [1, 13, 479, 480, 481, 1_024, 4_096, 7, 2_000];
    let posicao = 0;
    for (let i = 0; posicao < entrada.length; i++) {
      const tamanho = tamanhos[i % tamanhos.length] ?? 1;
      emPedacos.push(...cortador.adicionar(entrada.slice(posicao, posicao + tamanho)));
      posicao += tamanho;
    }
    emPedacos.push(...cortador.encerrar());

    expect(deUmaVez.length).toBe(4);
    expect(resumo(emPedacos)).toEqual(resumo(deUmaVez));
    emPedacos.forEach((trecho, i) => {
      const esperado = deUmaVez[i];
      expect(esperado !== undefined && mesmasAmostras(trecho.amostras, esperado.amostras)).toBe(true);
    });
  });

  it("encerrar devolve o trecho em andamento, inclusive as amostras que não fecham um quadro", () => {
    const cortador = new CortadorDeTrechos();
    expect(cortador.adicionar(juntar(silencio(300), senoide(1_000)))).toEqual([]);
    const trechos = cortador.encerrar();
    expect(trechos).toHaveLength(1);
    expect(trechos[0]?.inicioMs).toBe(300 - PRE_ROLL_MS);
    expect(trechos[0]?.fimMs).toBe(1_300);
    expect(cortador.emAndamento).toBe(false);
    expect(cortador.encerrar()).toEqual([]);
    // O relógio continua depois de encerrar.
    const depois = cortador.adicionar(juntar(senoide(600), silencio(1_000)));
    expect(depois[0]?.inicioMs).toBe(1_300);
  });

  it("reiniciar zera o relógio e descarta o trecho em andamento", () => {
    const cortador = new CortadorDeTrechos();
    cortador.adicionar(juntar(silencio(1_000), senoide(1_000)));
    cortador.reiniciar();
    expect(cortador.emAndamento).toBe(false);
    expect(cortador.encerrar()).toEqual([]);
    cortador.reiniciar();
    const trechos = cortador.adicionar(juntar(senoide(600), silencio(1_000)));
    expect(trechos[0]?.inicioMs).toBe(0);
  });

  it("as amostras devolvidas não são o mesmo buffer da entrada", () => {
    const entrada = juntar(silencio(300), senoide(1_000), silencio(1_000));
    const [trecho] = new CortadorDeTrechos().adicionar(entrada);
    expect(trecho).toBeDefined();
    if (trecho === undefined) return;
    expect(trecho.amostras.buffer).not.toBe(entrada.buffer);
    const antes = trecho.amostras[PRE_ROLL_MS * AMOSTRAS_POR_MS + 10];
    entrada.fill(0);
    expect(trecho.amostras[PRE_ROLL_MS * AMOSTRAS_POR_MS + 10]).toBe(antes);
    expect(antes).not.toBe(0);
  });
});
