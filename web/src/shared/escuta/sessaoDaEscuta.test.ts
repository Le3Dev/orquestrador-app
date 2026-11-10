import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ErroDaApi } from "../api/cliente";
import type { ClassificacaoDaEscuta, PedidoDeClassificacaoDaEscuta } from "../api/tipos";
import {
  type DescricaoDoMotor,
  type MotorDeTranscricao,
  type OpcoesDaPassada,
  type OrigemDaTranscricao,
  type ProgressoDoDownload,
  type ResultadoDaTranscricao,
  type SegmentoTranscrito,
  TranscricaoDescartada,
} from "../ditado/motor";
import type { CapturaDoAudio, OuvintesDaCaptura } from "./capturaDoAudio";
import { ControleDeDisparos, INTERVALO_MINIMO_MS } from "./ControleDeDisparos";
import { DURACAO_MAXIMA_DA_FALA_MS } from "./CortadorDeFala";
import { AMOSTRAS_POR_JANELA_DO_VAD, type DetectorDeVoz, type JanelasAnalisadas, TAXA_DE_AMOSTRAGEM } from "./DetectorDeVoz";
import { DURACAO_MAXIMA_DO_ENUNCIADO_MS, PAUSA_DO_ENUNCIADO_MS } from "./LegendaDaEscuta";
import { mensagemDaEscuta } from "./mensagemDaEscuta";
import { PerguntaDetectada } from "./PerguntaDetectada";
import {
  APARENCIA_PADRAO_DA_ESCUTA,
  type ArmazenamentoDasPreferencias,
  type IdiomaDaEscuta,
  PREFERENCIAS_PADRAO_DA_ESCUTA,
  type PreferenciasDaEscuta,
} from "./preferenciasDaEscuta";
import {
  AUDIO_NOVO_PARA_PASSADA_MS,
  controleSemPendente,
  type DependenciasDaSessao,
  ESPERA_APOS_CONFLITO_MS,
  ESPERA_PARA_DESLIGAR_MS,
  MAXIMO_DE_TRECHOS_NA_TELA,
  SessaoDaEscuta,
} from "./sessaoDaEscuta";
import type { OpcoesDaEscuta } from "./useEscuta";

// ---- Áudio ----

const AMOSTRAS_POR_MS = TAXA_DE_AMOSTRAGEM / 1000;
/** A captura de verdade entrega pedaços de 100 ms. */
const MS_POR_PEDACO = 100;
/** Silêncio que fecha a fala curta no cortador (16 janelas de 32 ms = 512 ms), com folga. */
const SILENCIO_DO_FIM_DA_FALA_MS = 600;

const voz = (ms: number): Float32Array => new Float32Array(ms * AMOSTRAS_POR_MS).fill(0.3);
const silencio = (ms: number): Float32Array => new Float32Array(ms * AMOSTRAS_POR_MS);
const duracaoMs = (audio: Float32Array): number => audio.length / AMOSTRAS_POR_MS;

/**
 * VAD falso: a janela com alguma amostra acima de 0,1 é voz (p = 0,9); senão,
 * silêncio (p = 0,02). Como o Silero, guarda o que não fecha uma janela.
 */
class DetectorDeVozFalso implements DetectorDeVoz {
  falha: Error | null = null;
  private resto = new Float32Array(0);

  readonly analisar = vi.fn((amostras: Float32Array): Promise<JanelasAnalisadas> => {
    if (this.falha !== null) return Promise.reject(this.falha);
    const todas = new Float32Array(this.resto.length + amostras.length);
    todas.set(this.resto);
    todas.set(amostras, this.resto.length);
    const alinhadas = todas.length - (todas.length % AMOSTRAS_POR_JANELA_DO_VAD);
    this.resto = todas.slice(alinhadas);
    const bloco = todas.slice(0, alinhadas);
    const probabilidades: number[] = [];
    for (let inicio = 0; inicio < alinhadas; inicio += AMOSTRAS_POR_JANELA_DO_VAD) {
      const janela = bloco.subarray(inicio, inicio + AMOSTRAS_POR_JANELA_DO_VAD);
      probabilidades.push(janela.some((amostra) => Math.abs(amostra) > 0.1) ? 0.9 : 0.02);
    }
    return Promise.resolve({ amostras: bloco, probabilidades });
  });

  readonly reiniciar = vi.fn(() => {
    this.resto = new Float32Array(0);
  });

  readonly encerrar = vi.fn(() => {
    this.resto = new Float32Array(0);
  });
}

// ---- Motor ----

interface PassadaNoMotor {
  readonly audio: Float32Array;
  readonly opcoes: OpcoesDaPassada;
  /** Quanto áudio (ms) a captura já tinha entregado quando a passada saiu. */
  readonly audioEntregueMs: number;
  readonly resolver: (resultado: ResultadoDaTranscricao) => void;
  readonly rejeitar: (erro: unknown) => void;
}

/** O que o motor falso faz com uma passada: responde, falha ou deixa esperando (o teste resolve depois). */
type Resposta = ResultadoDaTranscricao | Error | "esperar";

const segmento = (texto: string, inicioS: number, fimS: number): SegmentoTranscrito => ({ texto, inicioS, fimS });

/** Um resultado do motor; sem `segmentos`, o texto todo vira um segmento de 0 a `fimS`. */
function resultado(
  texto: string,
  extras: { readonly segmentos?: readonly SegmentoTranscrito[]; readonly fimS?: number; readonly idioma?: string } = {},
): ResultadoDaTranscricao {
  return {
    texto,
    segmentos: extras.segmentos ?? (texto.trim() === "" ? [] : [segmento(texto, 0, extras.fimS ?? 1)]),
    idioma: extras.idioma ?? "pt",
    duracaoDaPassadaMs: 40,
  };
}

const MOTOR_NATIVO: DescricaoDoMotor = { dispositivo: "dml", modelo: "whisper-base", precisao: "fp16", nativo: true };
const MOTOR_DA_RESERVA: DescricaoDoMotor = { dispositivo: "wasm", modelo: "whisper-base", precisao: "q8", nativo: false };

type OuvinteDoMotor = (origem: OrigemDaTranscricao, motor: DescricaoDoMotor | null) => void;
type OuvinteDoDownload = (origem: OrigemDaTranscricao, progresso: ProgressoDoDownload | null) => void;

class MotorFalso implements MotorDeTranscricao {
  /** O que o falso "ouve" na fala atual: cada passada devolve este texto, num segmento do tamanho do áudio. */
  texto = "";
  idioma = "pt";
  roteiro: (passada: PassadaNoMotor) => Resposta = (passada) =>
    resultado(this.texto, { fimS: duracaoMs(passada.audio) / 1000, idioma: this.idioma });
  preparo: () => Promise<DescricaoDoMotor> = () => Promise.resolve(MOTOR_NATIVO);
  descricao: DescricaoDoMotor | null = null;
  audioEntregue: () => number = () => 0;
  readonly passadas: PassadaNoMotor[] = [];
  readonly esperando: PassadaNoMotor[] = [];
  private readonly ouvintesDoMotor = new Set<OuvinteDoMotor>();
  private readonly ouvintesDoDownload = new Set<OuvinteDoDownload>();

  readonly transcrever = vi.fn<MotorDeTranscricao["transcrever"]>(
    (audio, opcoes) =>
      new Promise<ResultadoDaTranscricao>((resolver, rejeitar) => {
        const passada: PassadaNoMotor = { audio, opcoes, audioEntregueMs: this.audioEntregue(), resolver, rejeitar };
        this.passadas.push(passada);
        const resposta = this.roteiro(passada);
        if (resposta === "esperar") this.esperando.push(passada);
        else if (resposta instanceof Error) rejeitar(resposta);
        else resolver(resposta);
      }),
  );

  readonly preparar = vi.fn<MotorDeTranscricao["preparar"]>(() => this.preparo());

  readonly motorAtual = vi.fn<MotorDeTranscricao["motorAtual"]>((origem) => (origem === "escuta" ? this.descricao : null));

  aoMudarMotor(ouvinte: OuvinteDoMotor): () => void {
    this.ouvintesDoMotor.add(ouvinte);
    return () => {
      this.ouvintesDoMotor.delete(ouvinte);
    };
  }

  aoBaixar(ouvinte: OuvinteDoDownload): () => void {
    this.ouvintesDoDownload.add(ouvinte);
    return () => {
      this.ouvintesDoDownload.delete(ouvinte);
    };
  }

  avisarMotor(origem: OrigemDaTranscricao, motor: DescricaoDoMotor | null): void {
    for (const ouvinte of this.ouvintesDoMotor) ouvinte(origem, motor);
  }

  avisarDownload(origem: OrigemDaTranscricao, progresso: ProgressoDoDownload | null): void {
    for (const ouvinte of this.ouvintesDoDownload) ouvinte(origem, progresso);
  }

  get parciais(): PassadaNoMotor[] {
    return this.passadas.filter((passada) => passada.opcoes.descartavel === true);
  }

  get finais(): PassadaNoMotor[] {
    return this.passadas.filter((passada) => passada.opcoes.descartavel !== true);
  }

  /** A próxima passada que ficou esperando o teste. */
  proximaEsperando(): PassadaNoMotor {
    const passada = this.esperando.shift();
    if (passada === undefined) throw new Error("nenhuma passada esperando no motor");
    return passada;
  }
}

// ---- Montagem ----

interface OpcoesDoTeste {
  readonly avisoVisto?: boolean;
  readonly automatico?: boolean;
  readonly automaticoManual?: boolean;
  readonly idioma?: IdiomaDaEscuta;
  readonly falhaNaCaptura?: Error;
  /** Agendador próprio; sem ele, vale o padrão (setTimeout, falso no vi.useFakeTimers). */
  readonly agendar?: DependenciasDaSessao["agendar"];
}

function montar(opcoes: OpcoesDoTeste = {}) {
  let preferencias: PreferenciasDaEscuta = {
    ...PREFERENCIAS_PADRAO_DA_ESCUTA,
    automatico: opcoes.automatico ?? true,
    automaticoManual: opcoes.automaticoManual ?? false,
    avisoVisto: opcoes.avisoVisto ?? true,
    idioma: opcoes.idioma ?? "portuguese",
  };
  const armazenamento: ArmazenamentoDasPreferencias = {
    ler: () => preferencias,
    gravar: vi.fn((novas: PreferenciasDaEscuta) => {
      preferencias = novas;
    }),
  };

  const capturas: { ouvintes: OuvintesDaCaptura; parar: ReturnType<typeof vi.fn> }[] = [];
  const iniciarCaptura = vi.fn(async (ouvintes: OuvintesDaCaptura): Promise<CapturaDoAudio> => {
    if (opcoes.falhaNaCaptura !== undefined) throw opcoes.falhaNaCaptura;
    const parar = vi.fn();
    capturas.push({ ouvintes, parar });
    return { parar };
  });

  let audioEntregueMs = 0;
  const detector = new DetectorDeVozFalso();
  const motor = new MotorFalso();
  motor.audioEntregue = () => audioEntregueMs;

  const respostas: (ClassificacaoDaEscuta | Error)[] = [];
  const classificar = vi.fn<(pedido: PedidoDeClassificacaoDaEscuta, sinal?: AbortSignal) => Promise<ClassificacaoDaEscuta>>(
    async () => {
      const resposta = respostas.shift() ?? { ehPergunta: false, pergunta: null };
      if (resposta instanceof Error) throw resposta;
      return resposta;
    },
  );

  /** O instante (relógio) de cada envio que chegou ao chat. */
  const instantesDosEnvios: number[] = [];
  const enviar = vi.fn<(texto: string) => Promise<void>>(async () => {
    instantesDosEnvios.push(Date.now());
  });
  const preencherComposer = vi.fn<(texto: string) => void>();

  // O relógio e o agendador padrão (Date.now e setTimeout) são os falsos do vi.useFakeTimers.
  const sessao = new SessaoDaEscuta({
    iniciarCaptura,
    detectorDeVoz: detector,
    motor,
    classificar,
    agora: () => Date.now(),
    preferencias: armazenamento,
    ...(opcoes.agendar === undefined ? {} : { agendar: opcoes.agendar }),
  });

  let atuais: OpcoesDaEscuta = {
    modoInvisivelAtivo: false,
    escutaManualLigada: false,
    escutaDisponivel: true,
    chatLivre: true,
    autorizacaoAtiva: false,
    enviar,
    preencherComposer,
  };
  const opcoesDaTela = (mudanca: Partial<OpcoesDaEscuta>) => {
    atuais = { ...atuais, ...mudanca };
    sessao.atualizarOpcoes(atuais);
  };

  const ultimaCaptura = () => {
    const captura = capturas.at(-1);
    if (captura === undefined) throw new Error("nenhuma captura iniciada");
    return captura;
  };

  /** Entrega o áudio à captura atual em pedaços de 100 ms, com o relógio andando junto (tempo real). */
  const tocar = async (audio: Float32Array) => {
    const { ouvintes } = ultimaCaptura();
    const amostrasPorPedaco = MS_POR_PEDACO * AMOSTRAS_POR_MS;
    for (let inicio = 0; inicio < audio.length; inicio += amostrasPorPedaco) {
      const pedaco = audio.subarray(inicio, inicio + amostrasPorPedaco);
      audioEntregueMs += duracaoMs(pedaco);
      ouvintes.aoReceberAmostras(pedaco);
      await vi.advanceTimersByTimeAsync(duracaoMs(pedaco));
    }
  };

  /**
   * Uma fala curta em que o motor ouve `texto`: 1 s de voz (uma passada
   * parcial) e o silêncio que fecha a fala (a final). O enunciado continua
   * aberto: a próxima fala entra nele.
   */
  const falarSemPausa = async (texto: string) => {
    motor.texto = texto;
    await tocar(voz(1_000));
    await tocar(silencio(SILENCIO_DO_FIM_DA_FALA_MS));
  };

  /** A fala curta seguida da pausa que fecha o enunciado: cada `falar` é um enunciado. */
  const falar = async (texto: string) => {
    await falarSemPausa(texto);
    await tocar(silencio(PAUSA_DO_ENUNCIADO_MS));
  };

  /**
   * A fala entregue de uma vez, sem o relógio andar (para muitas falas
   * seguidas), com silêncio bastante depois para a próxima fala abrir outro
   * enunciado. O último fica aberto até o relógio andar a pausa.
   */
  const falarDeUmaVez = async (texto: string) => {
    motor.texto = texto;
    const { ouvintes } = ultimaCaptura();
    audioEntregueMs += 3_500;
    ouvintes.aoReceberAmostras(voz(1_000));
    ouvintes.aoReceberAmostras(silencio(2_500));
    await vi.advanceTimersByTimeAsync(0);
  };

  const entrar = async () => {
    opcoesDaTela({ modoInvisivelAtivo: true });
    await vi.advanceTimersByTimeAsync(0);
  };

  return {
    sessao,
    armazenamento,
    preferencias: () => preferencias,
    iniciarCaptura,
    capturas,
    ultimaCaptura,
    detector,
    motor,
    classificar,
    respostas,
    enviar,
    instantesDosEnvios,
    preencherComposer,
    opcoesDaTela,
    tocar,
    falar,
    falarSemPausa,
    falarDeUmaVez,
    entrar,
  };
}

/** Pergunta com o sinal forte (termina em "?", 4+ palavras, começa por "Como"): não passa pelo servidor. */
const PERGUNTA = "Como inverter uma lista ligada?";
/** Candidata sem o sinal forte (começa por "Me"): vai à classificação no servidor. */
const CANDIDATA = "Me explica como inverter uma lista ligada?";
const pergunta = (texto: string): ClassificacaoDaEscuta => ({ ehPergunta: true, pergunta: texto });
const mensagemEsperada = (texto: string, contexto: string): string =>
  mensagemDaEscuta(PerguntaDetectada.criar({ pergunta: texto, contexto, detectadaEmMs: 0 }));

/**
 * Fala corrida, sem pontuação: cada palavra é dita num instante (ms de áudio
 * entregue desde a montagem) e cada passada "ouve" as palavras já ditas.
 */
function ouvirAoLongo(motor: MotorFalso, palavras: readonly (readonly [string, number])[]): void {
  motor.roteiro = (passada) =>
    resultado(
      palavras
        .filter(([, ditaEmMs]) => ditaEmMs <= passada.audioEntregueMs)
        .map(([palavra]) => palavra)
        .join(" "),
      { fimS: duracaoMs(passada.audio) / 1000 },
    );
}

/** As palavras do texto, ditas a cada `intervaloMs` a partir de `inicioMs`. */
const ditas = (texto: string, inicioMs: number, intervaloMs = 300): [string, number][] =>
  texto.split(" ").map((palavra, posicao) => [palavra, inicioMs + posicao * intervaloMs]);

describe("SessaoDaEscuta", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("começa indisponível e fica desligada fora do modo invisível", () => {
    const t = montar();
    expect(t.sessao.instantaneo().situacao).toBe("indisponivel");
    t.opcoesDaTela({});
    expect(t.sessao.instantaneo().situacao).toBe("desligada");
    t.opcoesDaTela({ modoInvisivelAtivo: true, escutaDisponivel: false });
    expect(t.sessao.instantaneo().situacao).toBe("indisponivel");
    expect(t.iniciarCaptura).not.toHaveBeenCalled();
  });

  describe("passadas no motor", () => {
    it("durante a fala, sai uma passada descartável a cada ~1 s de áudio novo", async () => {
      const t = montar({ automatico: false });
      await t.entrar();
      t.motor.texto = "um dois três";
      await t.tocar(voz(4_500));

      const parciais = t.motor.parciais;
      expect(parciais).toHaveLength(4);
      expect(t.motor.finais).toHaveLength(0);
      for (const passada of parciais) {
        expect(passada.opcoes).toEqual({ origem: "escuta", idioma: "portuguese", descartavel: true });
      }
      const instantes = parciais.map((passada) => passada.audioEntregueMs);
      expect(instantes[0]).toBeGreaterThanOrEqual(AUDIO_NOVO_PARA_PASSADA_MS);
      for (let i = 1; i < instantes.length; i++) {
        const intervalo = (instantes[i] ?? 0) - (instantes[i - 1] ?? 0);
        expect(intervalo).toBeGreaterThanOrEqual(AUDIO_NOVO_PARA_PASSADA_MS);
        expect(intervalo).toBeLessThanOrEqual(AUDIO_NOVO_PARA_PASSADA_MS + 200);
      }
    });

    it("com uma passada no motor não sai outra: a cadência acompanha a velocidade do motor", async () => {
      const t = montar({ automatico: false });
      await t.entrar();
      t.motor.roteiro = () => "esperar";
      await t.tocar(voz(3_500));
      expect(t.motor.parciais).toHaveLength(1);

      t.motor.proximaEsperando().resolver(resultado("Hoje vamos"));
      await t.tocar(voz(100));
      expect(t.motor.parciais).toHaveLength(2);
      // A seguinte leva todo o áudio que juntou enquanto o motor trabalhava (nada foi confirmado nem aparado).
      expect(duracaoMs(t.motor.parciais[1]?.audio ?? new Float32Array(0))).toBeGreaterThan(3_000);
    });

    it("passada descartada ou com falha não muda nada nem mostra erro; a próxima sai normalmente", async () => {
      const t = montar({ automatico: false });
      await t.entrar();
      const falhas: Resposta[] = [new TranscricaoDescartada(), new Error("o motor engasgou")];
      t.motor.roteiro = (passada) =>
        falhas.shift() ?? resultado("Hoje vamos falar", { fimS: duracaoMs(passada.audio) / 1000 });

      await t.tocar(voz(2_300));
      expect(t.motor.parciais).toHaveLength(2);
      expect(t.sessao.instantaneo()).toMatchObject({ erro: null, linhaProvisoria: null, legenda: { frases: [], emAndamento: null } });

      await t.tocar(voz(1_000));
      expect(t.motor.parciais).toHaveLength(3);
      expect(t.sessao.instantaneo()).toMatchObject({
        erro: null,
        linhaProvisoria: "Hoje vamos falar",
        legenda: { frases: [], emAndamento: { confirmado: "", parcial: "Hoje vamos falar" } },
      });
    });

    it("confirmação por concordância: o confirmado cresce no enunciado (sem dividir na pontuação), o resto é o parcial e o buffer é aparado", async () => {
      const t = montar({ automatico: false });
      await t.entrar();
      t.motor.roteiro = () => "esperar";

      // 1ª passada: nada confirmado ainda, tudo é parcial.
      await t.tocar(voz(1_100));
      t.motor.proximaEsperando().resolver(resultado("Hoje vamos falar", { fimS: 1 }));
      await vi.advanceTimersByTimeAsync(0);
      expect(t.sessao.instantaneo()).toMatchObject({
        legenda: { frases: [], emAndamento: { confirmado: "", parcial: "Hoje vamos falar" } },
        linhaProvisoria: "Hoje vamos falar",
        trechos: [],
        linhas: [],
      });

      // 2ª: concorda nas três primeiras palavras, que ficam confirmadas (o enunciado continua aberto).
      await t.tocar(voz(1_100));
      t.motor.proximaEsperando().resolver(
        resultado("Hoje vamos falar de listas. E depois", {
          segmentos: [segmento("Hoje vamos falar de listas.", 0, 1.6), segmento("E depois", 1.6, 2.1)],
        }),
      );
      await vi.advanceTimersByTimeAsync(0);
      let estado = t.sessao.instantaneo();
      expect(estado.legenda.frases).toEqual([]);
      expect(estado.legenda.emAndamento).toMatchObject({ confirmado: "Hoje vamos falar", parcial: "de listas. E depois" });

      // 3ª: o ponto final não fecha nada; todo o confirmado fica no enunciado aberto.
      await t.tocar(voz(1_100));
      const terceira = t.motor.proximaEsperando();
      terceira.resolver(
        resultado("Hoje vamos falar de listas. E depois filas", {
          segmentos: [segmento("Hoje vamos falar de listas.", 0, 1.6), segmento("E depois filas", 1.6, 3.2)],
        }),
      );
      await vi.advanceTimersByTimeAsync(0);
      estado = t.sessao.instantaneo();
      expect(estado.legenda.frases).toEqual([]);
      expect(estado.legenda.emAndamento).toEqual({
        id: "enunciado-1",
        confirmado: "Hoje vamos falar de listas. E depois",
        parcial: "filas",
        inicioMs: 1_000_000,
      });
      expect(estado.linhaProvisoria).toBe("Hoje vamos falar de listas. E depois filas");
      expect(estado.linhas).toEqual([]);

      // O primeiro segmento ficou todo confirmado: o buffer perde os 1,6 s dele e a 4ª passada só leva o resto.
      await t.tocar(voz(1_100));
      const quarta = t.motor.proximaEsperando();
      expect(duracaoMs(quarta.audio)).toBeLessThan(duracaoMs(terceira.audio));
      expect(duracaoMs(quarta.audio)).toBeCloseTo(quarta.audioEntregueMs - 1_600, -2);

      // A fala acaba: a passada final (não descartável) leva o que restou depois do aparo.
      await t.tocar(silencio(SILENCIO_DO_FIM_DA_FALA_MS));
      const final = t.motor.proximaEsperando();
      expect(final.opcoes).toEqual({ origem: "escuta", idioma: "portuguese", descartavel: false });
      expect(duracaoMs(final.audio)).toBeGreaterThan(duracaoMs(quarta.audio));
      expect(duracaoMs(final.audio)).toBeLessThanOrEqual(final.audioEntregueMs - 1_600);

      // A 4ª chega atrasada (a fala já fechou): é ignorada.
      quarta.resolver(resultado("texto velho que não vale", { fimS: 2.7 }));
      await vi.advanceTimersByTimeAsync(0);
      expect(t.sessao.instantaneo().legenda.emAndamento?.parcial).toBe("filas");

      // O texto final confirma o resto: o parcial some, a fala vira um trecho e o enunciado espera a pausa.
      final.resolver(resultado("E depois filas e pilhas.", { fimS: 3.2 }));
      await vi.advanceTimersByTimeAsync(0);
      const completo = "Hoje vamos falar de listas. E depois filas e pilhas.";
      estado = t.sessao.instantaneo();
      expect(estado.legenda.frases).toEqual([]);
      expect(estado.legenda.emAndamento).toMatchObject({ id: "enunciado-1", confirmado: completo, parcial: "" });
      expect(estado.linhaProvisoria).toBe(completo);
      expect(estado.trechos.map((trecho) => trecho.texto)).toEqual([completo]);
      expect(estado.linhas).toEqual([]);

      // A pausa fecha o enunciado, com o mesmo id, e ele entra na janela.
      await vi.advanceTimersByTimeAsync(PAUSA_DO_ENUNCIADO_MS);
      estado = t.sessao.instantaneo();
      expect(estado.legenda.frases.map((frase) => [frase.id, frase.texto])).toEqual([["enunciado-1", completo]]);
      expect(estado.legenda.emAndamento).toBeNull();
      expect(estado.linhaProvisoria).toBeNull();
      expect(estado.linhas).toEqual([completo]);
    });

    it("no fim da fala, a passada final (não descartável) completa o enunciado; a pausa o fecha e alimenta trechos e linhas", async () => {
      const t = montar({ automatico: false });
      await t.entrar();
      await t.falar("Bom dia a todos, vamos começar.");
      expect(t.motor.finais).toHaveLength(1);
      expect(t.motor.finais[0]?.opcoes).toEqual({ origem: "escuta", idioma: "portuguese", descartavel: false });
      const estado = t.sessao.instantaneo();
      expect(estado.legenda).toMatchObject({ frases: [{ id: "enunciado-1", texto: "Bom dia a todos, vamos começar." }], emAndamento: null });
      expect(estado.trechos.map((trecho) => trecho.texto)).toEqual(["Bom dia a todos, vamos começar."]);
      expect(estado.linhas).toEqual(["Bom dia a todos, vamos começar."]);
    });

    it("passada de uma fala que já fechou ou de uma captura anterior é ignorada", async () => {
      const t = montar({ automatico: false });
      await t.entrar();
      t.motor.roteiro = () => "esperar";
      await t.tocar(voz(1_100));
      t.sessao.pausar();
      t.motor.proximaEsperando().resolver(resultado("texto velho"));
      await vi.advanceTimersByTimeAsync(0);
      expect(t.sessao.instantaneo()).toMatchObject({ linhaProvisoria: null, legenda: { frases: [], emAndamento: null } });
    });

    it("idioma automático: a primeira passada de cada fala pede detecção e as seguintes repassam o código", async () => {
      const t = montar({ idioma: "automatico", automatico: false });
      await t.entrar();
      t.motor.idioma = "en";
      t.motor.texto = "We will talk about linked lists today";
      await t.tocar(voz(2_500));
      expect(t.motor.parciais.map((passada) => passada.opcoes.idioma)).toEqual(["automatico", "en"]);
      await t.tocar(silencio(SILENCIO_DO_FIM_DA_FALA_MS));
      expect(t.motor.finais.map((passada) => passada.opcoes.idioma)).toEqual(["en"]);

      // Na fala seguinte, detecta de novo.
      const antes = t.motor.parciais.length;
      await t.tocar(voz(1_200));
      expect(t.motor.parciais.slice(antes).map((passada) => passada.opcoes.idioma)).toEqual(["automatico"]);
    });

    it("com o português fixo, toda passada pede portuguese", async () => {
      const t = montar({ automatico: false });
      await t.entrar();
      t.motor.idioma = "en";
      await t.falar("Bom dia a todos, vamos começar.");
      expect(t.motor.passadas.length).toBeGreaterThanOrEqual(2);
      expect(new Set(t.motor.passadas.map((passada) => passada.opcoes.idioma))).toEqual(new Set(["portuguese"]));
    });

    it("alucinação do Whisper é descartada", async () => {
      const t = montar();
      await t.entrar();
      await t.falar("Obrigado.");
      await t.falar("   ");
      expect(t.sessao.instantaneo()).toMatchObject({ linhas: [], trechos: [], legenda: { frases: [], emAndamento: null } });
      expect(t.classificar).not.toHaveBeenCalled();
    });
  });

  describe("enunciados (falas completas entre pausas)", () => {
    it("fala longa sem pontuação fica num enunciado só, sem dividir por tempo nem cortar palavra, e fecha na pausa", async () => {
      const t = montar({ automatico: false });
      await t.entrar();
      // Fala de ~7,4 s: cabe numa fala só (até DURACAO_MAXIMA_DA_FALA_MS, 8 s, com o silêncio do fim).
      const palavras = Array.from({ length: 24 }, (_, posicao) => `palavra${posicao + 1}`);
      ouvirAoLongo(t.motor, ditas(palavras.join(" "), 300));
      await t.tocar(voz(6_500));
      const noMeio = t.sessao.instantaneo().legenda;
      expect(noMeio.frases).toEqual([]);
      expect(noMeio.emAndamento).toMatchObject({ id: "enunciado-1", inicioMs: 1_000_000 });
      await t.tocar(voz(900));
      await t.tocar(silencio(SILENCIO_DO_FIM_DA_FALA_MS));

      let estado = t.sessao.instantaneo();
      expect(estado.trechos.map((trecho) => trecho.texto)).toEqual([palavras.join(" ")]);
      expect(estado.legenda.frases).toEqual([]);
      expect(estado.legenda.emAndamento).toMatchObject({ id: "enunciado-1", confirmado: palavras.join(" "), parcial: "" });

      await t.tocar(silencio(PAUSA_DO_ENUNCIADO_MS));
      estado = t.sessao.instantaneo();
      expect(estado.legenda.emAndamento).toBeNull();
      // Nenhuma palavra cortada, perdida ou repetida.
      expect(estado.legenda.frases).toMatchObject([{ id: "enunciado-1", texto: palavras.join(" "), pergunta: false }]);
    });

    it("falas seguidas (pausa menor que a do enunciado) entram no mesmo enunciado; cada fala continua um trecho", async () => {
      const t = montar({ automatico: false });
      await t.entrar();
      await t.falarSemPausa("Pessoal, eu queria saber");
      await t.falarSemPausa("como funciona um heap");
      let estado = t.sessao.instantaneo();
      expect(estado.legenda.frases).toEqual([]);
      expect(estado.legenda.emAndamento).toMatchObject({ id: "enunciado-1", confirmado: "Pessoal, eu queria saber como funciona um heap" });
      expect(estado.trechos.map((trecho) => trecho.texto)).toEqual(["Pessoal, eu queria saber", "como funciona um heap"]);

      await t.tocar(silencio(PAUSA_DO_ENUNCIADO_MS));
      estado = t.sessao.instantaneo();
      expect(estado.legenda.frases.map((frase) => [frase.id, frase.texto])).toEqual([
        ["enunciado-1", "Pessoal, eu queria saber como funciona um heap"],
      ]);
      expect(estado.linhas).toEqual(["Pessoal, eu queria saber como funciona um heap"]);

      // Depois da pausa, a fala seguinte abre outro enunciado.
      await t.falar("Vamos para o próximo assunto.");
      expect(t.sessao.instantaneo().legenda.frases.map((frase) => frase.id)).toEqual(["enunciado-1", "enunciado-3"]);
    });

    it("a pausa do enunciado é agendada pelo agendar da sessão e cancelada quando uma fala nova começa", async () => {
      const agendados: { readonly acao: () => void; readonly ms: number; cancelado: boolean }[] = [];
      const agendar: DependenciasDaSessao["agendar"] = (acao, ms) => {
        const agendado = { acao, ms, cancelado: false };
        agendados.push(agendado);
        return () => {
          agendado.cancelado = true;
        };
      };
      const pausas = () => agendados.filter((agendado) => agendado.ms === PAUSA_DO_ENUNCIADO_MS);
      const t = montar({ automatico: false, agendar });
      await t.entrar();

      await t.falarSemPausa("Bom dia a todos");
      expect(pausas()).toHaveLength(1);
      expect(pausas()[0]?.cancelado).toBe(false);
      // A fala seguinte cancela a pausa da anterior.
      await t.falarSemPausa("vamos começar");
      expect(pausas()).toHaveLength(2);
      expect(pausas()[0]?.cancelado).toBe(true);
      expect(pausas()[1]?.cancelado).toBe(false);

      // O relógio andando não fecha nada: quem fecha é o agendar.
      await t.tocar(silencio(3_000));
      expect(t.sessao.instantaneo().legenda.frases).toEqual([]);
      pausas()[1]?.acao();
      expect(t.sessao.instantaneo().legenda).toEqual({
        frases: [expect.objectContaining({ id: "enunciado-1", texto: "Bom dia a todos vamos começar" })],
        emAndamento: null,
      });
    });

    it("só fecha depois da passada final: se a pausa vence antes do resultado, fecha assim que ele chega", async () => {
      const t = montar({ automatico: false });
      await t.entrar();
      t.motor.roteiro = (passada) =>
        passada.opcoes.descartavel === true ? resultado("Bom dia a todos", { fimS: duracaoMs(passada.audio) / 1000 }) : "esperar";
      await t.falarSemPausa("Bom dia a todos");
      const final = t.motor.proximaEsperando();

      await t.tocar(silencio(PAUSA_DO_ENUNCIADO_MS + 500));
      let estado = t.sessao.instantaneo();
      expect(estado.legenda.frases).toEqual([]);
      expect(estado.legenda.emAndamento).toMatchObject({ id: "enunciado-1", confirmado: "", parcial: "Bom dia a todos" });

      final.resolver(resultado("Bom dia a todos."));
      await vi.advanceTimersByTimeAsync(0);
      estado = t.sessao.instantaneo();
      expect(estado.legenda.frases).toMatchObject([{ id: "enunciado-1", texto: "Bom dia a todos." }]);
      expect(estado.legenda.emAndamento).toBeNull();
      expect(estado.linhas).toEqual(["Bom dia a todos."]);
    });

    it("fala contínua: as falas curtas (até 8 s, cada uma um trecho) ficam no mesmo enunciado até a duração máxima", async () => {
      const t = montar({ automatico: false });
      await t.entrar();
      t.motor.texto = "fala corrida sem pausa";
      await t.tocar(voz(15_000));
      // Já houve corte de fala, mas o enunciado continua um só.
      expect(t.sessao.instantaneo().trechos.length).toBeGreaterThanOrEqual(2);
      expect(t.sessao.instantaneo().legenda.frases).toEqual([]);

      await t.tocar(voz(13_000));
      const { trechos, legenda } = t.sessao.instantaneo();
      for (const trecho of trechos) {
        expect(trecho.fimMs - trecho.inicioMs).toBeLessThanOrEqual(DURACAO_MAXIMA_DA_FALA_MS);
      }
      // Cada fala começa onde a anterior foi cortada.
      trechos.slice(1).forEach((trecho, posicao) => {
        expect(trecho.inicioMs).toBe(trechos[posicao]?.fimMs);
      });
      // O enunciado fechou no fim da fala que passou da duração máxima, com o texto de todas as falas dele.
      const [enunciado] = legenda.frases;
      expect(legenda.frases).toHaveLength(1);
      if (enunciado === undefined) throw new Error("o enunciado não fechou");
      expect(enunciado.fimMs - enunciado.inicioMs).toBeGreaterThanOrEqual(DURACAO_MAXIMA_DO_ENUNCIADO_MS);
      expect(enunciado.fimMs - enunciado.inicioMs).toBeLessThan(DURACAO_MAXIMA_DO_ENUNCIADO_MS + DURACAO_MAXIMA_DA_FALA_MS);
      const falasDoEnunciado = trechos.filter((trecho) => trecho.fimMs <= enunciado.fimMs);
      expect(falasDoEnunciado.length).toBeGreaterThanOrEqual(3);
      expect(enunciado.texto).toBe(falasDoEnunciado.map((trecho) => trecho.texto).join(" "));
      // A fala seguinte já está noutro enunciado.
      expect(legenda.emAndamento?.id).not.toBe(enunciado.id);
    });

    it("o enunciado em andamento mostra o confirmado e o parcial", async () => {
      const t = montar({ automatico: false });
      await t.entrar();
      ouvirAoLongo(t.motor, ditas("hoje vamos falar de estruturas de dados", 300));
      await t.tocar(voz(2_300));
      const { emAndamento } = t.sessao.instantaneo().legenda;
      expect(emAndamento).not.toBeNull();
      expect(emAndamento?.confirmado).not.toBe("");
      expect(emAndamento?.parcial).not.toBe("");
      expect(`${emAndamento?.confirmado} ${emAndamento?.parcial}`).toBe(t.sessao.instantaneo().linhaProvisoria);
    });
  });

  describe("motor e download", () => {
    it("ao começar, prepara o motor da escuta com a prioridade escolhida e mostra qual é", async () => {
      const t = montar();
      expect(t.sessao.instantaneo().motor).toBeNull();
      await t.entrar();
      expect(t.motor.preparar).toHaveBeenCalledWith("escuta", "velocidade");
      expect(t.sessao.instantaneo().motor).toEqual(MOTOR_NATIVO);
    });

    it("a troca de motor da escuta aparece no estado; a do ditado não", async () => {
      const t = montar();
      await t.entrar();
      t.motor.avisarMotor("escuta", MOTOR_DA_RESERVA);
      expect(t.sessao.instantaneo().motor).toEqual(MOTOR_DA_RESERVA);
      t.motor.avisarMotor("ditado", MOTOR_NATIVO);
      expect(t.sessao.instantaneo().motor).toEqual(MOTOR_DA_RESERVA);
    });

    it("mostra o download do modelo da escuta e some quando ele acaba", async () => {
      const t = montar();
      await t.entrar();
      t.motor.avisarDownload("escuta", { progresso: 42.4, totalMb: 75 });
      expect(t.sessao.instantaneo()).toMatchObject({
        situacao: "baixando-modelo",
        progressoDoDownload: 42,
        download: { progresso: 42.4, totalMb: 75 },
      });
      t.motor.avisarDownload("ditado", { progresso: 10, totalMb: 75 });
      expect(t.sessao.instantaneo().download).toEqual({ progresso: 42.4, totalMb: 75 });

      t.motor.avisarDownload("escuta", { progresso: 100, totalMb: 75 });
      expect(t.sessao.instantaneo()).toMatchObject({ situacao: "escutando", progressoDoDownload: null, download: null });
    });

    it("mudar a prioridade escutando prepara o motor de novo e guarda a preferência", async () => {
      const t = montar();
      await t.entrar();
      t.sessao.mudarPrioridadeDoMotor("precisao");
      expect(t.motor.preparar).toHaveBeenLastCalledWith("escuta", "precisao");
      expect(t.preferencias().prioridadeDoMotor).toBe("precisao");
      expect(t.sessao.instantaneo().preferenciasDaTela.prioridadeDoMotor).toBe("precisao");
    });

    it("motor que não prepara mostra o erro, sem derrubar a escuta", async () => {
      const t = montar();
      t.motor.preparo = () => Promise.reject(new Error("sem GPU"));
      await t.entrar();
      expect(t.sessao.instantaneo()).toMatchObject({
        situacao: "escutando",
        erro: "O motor de transcrição da escuta não pôde ser preparado: sem GPU",
      });
    });
  });

  describe("preferências da tela", () => {
    it("começam nos padrões e mudam com idioma e aparência (limitada às bordas), gravadas no armazenamento", () => {
      const t = montar();
      expect(t.sessao.instantaneo().preferenciasDaTela).toEqual({
        idioma: "portuguese",
        prioridadeDoMotor: "velocidade",
        aparencia: APARENCIA_PADRAO_DA_ESCUTA,
      });

      t.sessao.mudarIdioma("automatico");
      t.sessao.mudarAparencia({ tamanhoDaFonte: 40 });
      t.sessao.mudarAparencia({ opacidade: 0.1, compacto: true });
      expect(t.sessao.instantaneo().preferenciasDaTela).toEqual({
        idioma: "automatico",
        prioridadeDoMotor: "velocidade",
        aparencia: { tamanhoDaFonte: 22, opacidade: 0.4, compacto: true },
      });
      expect(t.preferencias()).toMatchObject({ idioma: "automatico", aparencia: { tamanhoDaFonte: 22, opacidade: 0.4, compacto: true } });
    });

    it("a mesma escolha não regrava nem troca o retrato", () => {
      const t = montar();
      const retrato = t.sessao.instantaneo();
      t.sessao.mudarIdioma("portuguese");
      t.sessao.mudarPrioridadeDoMotor("velocidade");
      t.sessao.mudarAparencia({ tamanhoDaFonte: 14 });
      expect(t.armazenamento.gravar).not.toHaveBeenCalled();
      expect(t.sessao.instantaneo()).toBe(retrato);
    });
  });

  describe("pergunta", () => {
    it("candidata sem o sinal forte → classificação → envio do texto de mensagemDaEscuta; o enunciado fica marcado", async () => {
      const t = montar();
      await t.entrar();
      t.respostas.push(pergunta(PERGUNTA));
      await t.falar(CANDIDATA);

      expect(t.classificar).toHaveBeenCalledTimes(1);
      expect(t.classificar).toHaveBeenCalledWith({ trecho: CANDIDATA }, expect.any(AbortSignal));
      expect(t.enviar).toHaveBeenCalledWith(mensagemEsperada(PERGUNTA, CANDIDATA));
      const estado = t.sessao.instantaneo();
      expect(estado.ultimaPergunta).toBe(PERGUNTA);
      expect(estado.ultimaPerguntaEnviada).toEqual({ pergunta: PERGUNTA, enviadaEmMs: t.instantesDosEnvios[0] });
      expect(estado.linhas).toEqual([CANDIDATA]);
      expect(estado.trechos.map((trecho) => trecho.texto)).toEqual([CANDIDATA]);
      expect(estado.legenda.frases).toMatchObject([{ texto: CANDIDATA, pergunta: true }]);
    });

    it("enunciado que passa a terminar em ? com o sinal forte vira pergunta na hora, sem o servidor e sem esperar a pausa", async () => {
      const t = montar();
      await t.entrar();
      const hipoteses = ["Qual a complexidade do quicksort?"];
      t.motor.roteiro = (passada) =>
        resultado(hipoteses.shift() ?? "Qual a complexidade do quicksort? E o", { fimS: duracaoMs(passada.audio) / 1000 });
      // Duas passadas parciais: a segunda confirma até o "?" (o resto ainda é parcial).
      await t.tocar(voz(2_300));

      expect(t.classificar).not.toHaveBeenCalled();
      expect(t.enviar).toHaveBeenCalledTimes(1);
      expect(t.enviar).toHaveBeenCalledWith(
        mensagemEsperada("Qual a complexidade do quicksort?", "Qual a complexidade do quicksort?"),
      );
      let estado = t.sessao.instantaneo();
      expect(estado.trechos).toEqual([]); // a fala nem terminou
      expect(estado.linhaProvisoria).toBe("Qual a complexidade do quicksort? E o");
      expect(estado.legenda.frases).toEqual([]);
      expect(estado.legenda.emAndamento).toMatchObject({ id: "enunciado-1", confirmado: "Qual a complexidade do quicksort?", parcial: "E o" });
      expect(estado.ultimaPerguntaEnviada).toEqual({
        pergunta: "Qual a complexidade do quicksort?",
        enviadaEmMs: t.instantesDosEnvios[0],
      });

      // O texto continua sem terminar em "?": no fechamento, não é avaliado de novo; a marca de pergunta fica.
      await t.tocar(silencio(SILENCIO_DO_FIM_DA_FALA_MS + PAUSA_DO_ENUNCIADO_MS));
      estado = t.sessao.instantaneo();
      expect(estado.legenda.frases).toMatchObject([
        { id: "enunciado-1", texto: "Qual a complexidade do quicksort? E o", pergunta: true },
      ]);
      expect(t.enviar).toHaveBeenCalledTimes(1);
      expect(t.classificar).not.toHaveBeenCalled();
    });

    it("a pergunta é avaliada no texto inteiro do enunciado ao fechar: falas seguidas viram uma pergunta só", async () => {
      const t = montar();
      await t.entrar();
      const inteiro = "pessoal agora eu queria saber qual a melhor forma de fazer isso";
      t.respostas.push(pergunta("Qual a melhor forma de fazer isso?"));
      await t.falarSemPausa("pessoal agora eu queria saber");
      await t.falarSemPausa("qual a melhor forma de fazer isso");
      // O enunciado ainda está aberto (e não termina em "?"): nada foi avaliado.
      expect(t.classificar).not.toHaveBeenCalled();

      await t.tocar(silencio(PAUSA_DO_ENUNCIADO_MS));
      expect(t.classificar).toHaveBeenCalledTimes(1);
      expect(t.classificar).toHaveBeenCalledWith({ trecho: inteiro }, expect.any(AbortSignal));
      expect(t.enviar).toHaveBeenCalledTimes(1);
      expect(t.enviar).toHaveBeenCalledWith(mensagemEsperada("Qual a melhor forma de fazer isso?", inteiro));
      expect(t.sessao.instantaneo().legenda.frases).toMatchObject([{ id: "enunciado-1", texto: inteiro, pergunta: true }]);
    });

    it("interrogativa no meio, sem ?, também vai ao servidor no fechamento", async () => {
      const t = montar();
      await t.entrar();
      t.respostas.push(pergunta("Quando sai a versão nova?"));
      await t.falar("pessoal eu queria saber quando sai a versão nova");
      expect(t.classificar).toHaveBeenCalledWith({ trecho: "pessoal eu queria saber quando sai a versão nova" }, expect.any(AbortSignal));
      expect(t.enviar).toHaveBeenCalledTimes(1);
    });

    it("o ? antecipa a avaliação, sem repetir no fechamento; o texto que continua só é avaliado de novo se também terminar em ?", async () => {
      const t = montar();
      await t.entrar();
      await t.falarSemPausa(CANDIDATA);
      // Terminou em "?": vai ao servidor sem esperar a pausa.
      expect(t.classificar).toHaveBeenCalledTimes(1);
      expect(t.classificar).toHaveBeenLastCalledWith({ trecho: CANDIDATA }, expect.any(AbortSignal));

      await t.falarSemPausa("e depois a gente vê isso");
      expect(t.classificar).toHaveBeenCalledTimes(1);

      await t.falarSemPausa("E o que é um heap?");
      const inteiro = `${CANDIDATA} e depois a gente vê isso E o que é um heap?`;
      expect(t.classificar).toHaveBeenCalledTimes(2);
      expect(t.classificar).toHaveBeenLastCalledWith({ trecho: inteiro }, expect.any(AbortSignal));

      await t.tocar(silencio(PAUSA_DO_ENUNCIADO_MS));
      expect(t.classificar).toHaveBeenCalledTimes(2);
      expect(t.sessao.instantaneo().legenda.frases).toMatchObject([{ id: "enunciado-1", texto: inteiro }]);
    });

    it("enunciados separados por uma pausa longa são avaliados cada um sozinho", async () => {
      const t = montar();
      await t.entrar();
      await t.falar("pessoal agora eu queria saber se");
      await t.falar("a melhor forma de fazer isso");
      expect(t.sessao.instantaneo().legenda.frases.map((frase) => frase.texto)).toEqual([
        "pessoal agora eu queria saber se",
        "a melhor forma de fazer isso",
      ]);
      expect(t.classificar).not.toHaveBeenCalled();
    });

    it("o enunciado fechado vira contexto: manda à classificação os 60 s anteriores ao enunciado, e nada mais antigo", async () => {
      const t = montar();
      await t.entrar();
      await t.falar("Vamos falar de estruturas de dados hoje.");
      await t.falar("Me diz a complexidade da busca binária?");
      expect(t.classificar).toHaveBeenLastCalledWith(
        { trecho: "Me diz a complexidade da busca binária?", contexto: "Vamos falar de estruturas de dados hoje." },
        expect.any(AbortSignal),
      );

      // Mais de 60 s de silêncio: o que veio antes já não é contexto.
      t.ultimaCaptura().ouvintes.aoReceberAmostras(silencio(61_000));
      await vi.advanceTimersByTimeAsync(0);
      await t.falar("Me fala como funciona um heap?");
      expect(t.classificar).toHaveBeenLastCalledWith({ trecho: "Me fala como funciona um heap?" }, expect.any(AbortSignal));
    });

    it("com alterações autorizadas, a pergunta vai para o campo de mensagem, não é enviada", async () => {
      const t = montar();
      t.opcoesDaTela({ autorizacaoAtiva: true });
      await t.entrar();
      await t.falar(PERGUNTA);
      expect(t.enviar).not.toHaveBeenCalled();
      expect(t.preencherComposer).toHaveBeenCalledWith(expect.stringContaining(PERGUNTA));
      expect(t.sessao.instantaneo().ultimaPergunta).toBe(PERGUNTA);
    });

    it("409 no envio: a pergunta volta a ser a pendente e sai quando o chat fica livre", async () => {
      const t = montar();
      await t.entrar();
      t.enviar.mockRejectedValueOnce(new ErroDaApi("O chat está respondendo.", 409));
      await t.falar(PERGUNTA);
      expect(t.enviar).toHaveBeenCalledTimes(1);
      expect(t.sessao.instantaneo().erro).toBeNull();

      t.opcoesDaTela({ chatLivre: false });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(t.enviar).toHaveBeenCalledTimes(1);

      t.opcoesDaTela({ chatLivre: true });
      await vi.advanceTimersByTimeAsync(0);
      expect(t.enviar).toHaveBeenCalledTimes(2);
      expect(t.enviar.mock.calls[1]?.[0]).toBe(t.enviar.mock.calls[0]?.[0]);
    });

    it("409 sem a tela perceber o chat ocupado: tenta de novo depois de uma espera, não em laço", async () => {
      const t = montar();
      await t.entrar();
      t.enviar.mockRejectedValueOnce(new ErroDaApi("ocupado", 409));
      // Termina em "?": a pergunta sai no fim da fala, sem esperar a pausa do enunciado.
      await t.falarSemPausa(PERGUNTA);
      expect(t.enviar).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(ESPERA_APOS_CONFLITO_MS - 1_000);
      expect(t.enviar).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(t.enviar).toHaveBeenCalledTimes(2);
    });

    it("chat ocupado: guarda só a mais recente e envia quando ele fica livre", async () => {
      const t = montar();
      t.opcoesDaTela({ chatLivre: false });
      await t.entrar();
      t.respostas.push(pergunta("Como funciona um heap?"));
      await t.falar("Qual a complexidade do quicksort?"); // sinal forte
      await t.falar("E como funciona um heap?"); // pelo servidor
      expect(t.enviar).not.toHaveBeenCalled();

      t.opcoesDaTela({ chatLivre: true });
      await vi.advanceTimersByTimeAsync(0);
      expect(t.enviar).toHaveBeenCalledTimes(1);
      expect(t.enviar.mock.calls[0]?.[0]).toContain("Pergunta detectada na escuta: Como funciona um heap?");
    });

    it("respeita o intervalo de 8 s entre envios: a seguinte sai quando ele vence", async () => {
      expect(INTERVALO_MINIMO_MS).toBe(8_000);
      const t = montar();
      await t.entrar();
      await t.falar("Qual a complexidade do quicksort?");
      expect(t.enviar).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(2_000);
      await t.falar("Como funciona um heap na prática?");
      expect(t.enviar).toHaveBeenCalledTimes(1);

      const falta = (t.instantesDosEnvios[0] ?? 0) + INTERVALO_MINIMO_MS - Date.now();
      expect(falta).toBeGreaterThan(100);
      await vi.advanceTimersByTimeAsync(falta - 50);
      expect(t.enviar).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(100);
      expect(t.enviar).toHaveBeenCalledTimes(2);
      expect(t.enviar.mock.calls[1]?.[0]).toContain("Como funciona um heap na prática?");
    });

    it("descarta a pergunta repetida", async () => {
      const t = montar();
      await t.entrar();
      await t.falar(PERGUNTA);
      await vi.advanceTimersByTimeAsync(30_000);
      await t.falar(PERGUNTA);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(t.enviar).toHaveBeenCalledTimes(1);
    });

    it("com o automático desligado, só transcreve: nada é classificado nem enviado, nem pelo sinal forte", async () => {
      const t = montar();
      await t.entrar();
      t.sessao.alternarAutomatico();
      expect(t.sessao.instantaneo().automatico).toBe(false);
      expect(t.preferencias().automatico).toBe(false);

      await t.falar("Qual a complexidade da busca binária?");
      await t.falar(CANDIDATA);
      const estado = t.sessao.instantaneo();
      expect(estado.linhas).toEqual(["Qual a complexidade da busca binária?", CANDIDATA]);
      expect(estado.legenda.frases.every((frase) => !frase.pergunta)).toBe(true);
      expect(t.classificar).not.toHaveBeenCalled();
      expect(t.enviar).not.toHaveBeenCalled();
    });

    it("desligar o automático durante a classificação não envia a resposta dela", async () => {
      const t = montar();
      await t.entrar();
      let responder: (resposta: ClassificacaoDaEscuta) => void = () => undefined;
      t.classificar.mockImplementationOnce(
        () =>
          new Promise<ClassificacaoDaEscuta>((resolver) => {
            responder = resolver;
          }),
      );
      await t.falar(CANDIDATA);
      t.sessao.alternarAutomatico();
      responder(pergunta(PERGUNTA));
      await vi.advanceTimersByTimeAsync(0);
      expect(t.enviar).not.toHaveBeenCalled();
    });

    it("uma candidata nova durante a classificação substitui a que esperava", async () => {
      const t = montar();
      await t.entrar();
      let responder: (resposta: ClassificacaoDaEscuta) => void = () => undefined;
      t.classificar.mockImplementationOnce(
        () =>
          new Promise<ClassificacaoDaEscuta>((resolver) => {
            responder = resolver;
          }),
      );
      await t.falar("Me fala a complexidade do quicksort?");
      await t.falar("E o que é um heap?");
      await t.falar("E o que é uma trie?");
      expect(t.classificar).toHaveBeenCalledTimes(1);

      responder({ ehPergunta: false, pergunta: null });
      await vi.advanceTimersByTimeAsync(0);
      expect(t.classificar).toHaveBeenCalledTimes(2);
      expect(t.classificar.mock.calls[1]?.[0].trecho).toBe("E o que é uma trie?");
    });
  });

  describe("escuta manual", () => {
    it("liga a escuta fora do modo invisível, com o automático desligado de início", async () => {
      const t = montar();
      t.opcoesDaTela({ escutaManualLigada: true });
      await vi.advanceTimersByTimeAsync(0);
      expect(t.sessao.instantaneo()).toMatchObject({ situacao: "escutando", automatico: false });

      t.respostas.push(pergunta(PERGUNTA));
      await t.falar(CANDIDATA);
      expect(t.classificar).not.toHaveBeenCalled();
      expect(t.sessao.instantaneo().linhas).toEqual([CANDIDATA]);

      t.opcoesDaTela({ escutaManualLigada: false });
      await vi.advanceTimersByTimeAsync(ESPERA_PARA_DESLIGAR_MS);
      expect(t.sessao.instantaneo().situacao).toBe("desligada");
    });

    it("sem escuta disponível não escuta", async () => {
      const t = montar();
      t.opcoesDaTela({ escutaManualLigada: true, escutaDisponivel: false });
      await vi.advanceTimersByTimeAsync(0);
      expect(t.sessao.instantaneo().situacao).toBe("indisponivel");
      expect(t.iniciarCaptura).not.toHaveBeenCalled();
    });

    it("o automático é separado por contexto, e o modo invisível tem prioridade", () => {
      const t = montar();
      t.opcoesDaTela({ escutaManualLigada: true });
      t.sessao.alternarAutomatico();
      expect(t.sessao.instantaneo().automatico).toBe(true);
      expect(t.preferencias()).toMatchObject({ automatico: true, automaticoManual: true });

      t.opcoesDaTela({ modoInvisivelAtivo: true });
      t.sessao.alternarAutomatico();
      expect(t.sessao.instantaneo().automatico).toBe(false);
      expect(t.preferencias()).toMatchObject({ automatico: false, automaticoManual: true });

      t.opcoesDaTela({ modoInvisivelAtivo: false });
      expect(t.sessao.instantaneo().automatico).toBe(true);
    });

    it("com o automático ligado, classifica e envia", async () => {
      const t = montar({ automaticoManual: true });
      t.opcoesDaTela({ escutaManualLigada: true });
      await vi.advanceTimersByTimeAsync(0);
      t.respostas.push(pergunta(PERGUNTA));
      await t.falar(CANDIDATA);
      expect(t.enviar).toHaveBeenCalledTimes(1);
    });

    it("o aviso da primeira vez vale também para ela", () => {
      const t = montar({ avisoVisto: false });
      t.opcoesDaTela({ escutaManualLigada: true });
      expect(t.sessao.instantaneo().situacao).toBe("aguardando-aviso");
      expect(t.iniciarCaptura).not.toHaveBeenCalled();
    });
  });

  describe("trechos e legenda", () => {
    it("as falas confirmadas vão para a conversa, ficam ao desligar e só limparTrechos as apaga", async () => {
      const t = montar();
      await t.entrar();
      await t.falar("Bom dia a todos, vamos começar.");
      await t.falar("Hoje falamos de listas ligadas.");
      const { trechos } = t.sessao.instantaneo();
      expect(trechos.map((trecho) => trecho.texto)).toEqual(["Bom dia a todos, vamos começar.", "Hoje falamos de listas ligadas."]);
      expect(new Set(trechos.map((trecho) => trecho.id)).size).toBe(2);
      expect(trechos[0]?.inicioMs).toBeGreaterThanOrEqual(1_000_000);
      expect(trechos[0]?.fimMs).toBeGreaterThan(trechos[0]?.inicioMs ?? 0);

      t.opcoesDaTela({ modoInvisivelAtivo: false });
      await vi.advanceTimersByTimeAsync(ESPERA_PARA_DESLIGAR_MS);
      expect(t.sessao.instantaneo()).toMatchObject({ situacao: "desligada", linhas: [], legenda: { frases: [], emAndamento: null } });
      expect(t.sessao.instantaneo().trechos).toHaveLength(2);

      t.sessao.limparTrechos();
      expect(t.sessao.instantaneo().trechos).toEqual([]);
    });

    it("limparTrechos (o /clear) apaga também as frases da legenda; a frase em andamento continua", async () => {
      const t = montar({ automatico: false });
      await t.entrar();
      await t.falar("Bom dia a todos, vamos começar.");
      await t.falar("Hoje falamos de listas ligadas.");
      t.motor.texto = "E depois filas";
      await t.tocar(voz(2_300));
      const antes = t.sessao.instantaneo();
      expect(antes.legenda.frases).toHaveLength(2);
      expect(antes.legenda.emAndamento).not.toBeNull();

      t.sessao.limparTrechos();
      const depois = t.sessao.instantaneo();
      expect(depois.trechos).toEqual([]);
      expect(depois.legenda.frases).toEqual([]);
      expect(depois.legenda.emAndamento).toEqual(antes.legenda.emAndamento);

      // Sem fala em andamento (a pausa fechou o enunciado), a legenda fica vazia.
      await t.tocar(silencio(SILENCIO_DO_FIM_DA_FALA_MS + PAUSA_DO_ENUNCIADO_MS));
      t.sessao.limparTrechos();
      expect(t.sessao.instantaneo().legenda).toEqual({ frases: [], emAndamento: null });
    });

    it("guarda no máximo 200 trechos e 200 enunciados: os mais antigos saem", async () => {
      const t = montar({ automatico: false });
      await t.entrar();
      for (let i = 0; i < 202; i++) await t.falarDeUmaVez(`Trecho número ${i} da aula de hoje.`);
      await vi.advanceTimersByTimeAsync(PAUSA_DO_ENUNCIADO_MS);
      const { trechos, legenda } = t.sessao.instantaneo();
      expect(trechos).toHaveLength(MAXIMO_DE_TRECHOS_NA_TELA);
      expect(trechos[0]?.texto).toBe("Trecho número 2 da aula de hoje.");
      expect(legenda.frases).toHaveLength(200);
      expect(legenda.frases[0]?.texto).toBe("Trecho número 2 da aula de hoje.");
      expect(legenda.frases.at(-1)?.texto).toBe("Trecho número 201 da aula de hoje.");
    });
  });

  describe("erros", () => {
    it("erro na classificação aparece e a escuta continua, sem tentar a que esperava em seguida", async () => {
      const t = montar();
      await t.entrar();
      t.respostas.push(new ErroDaApi("O Claude Code não respondeu.", 502));
      await t.falar("Me fala a complexidade do quicksort?");
      expect(t.sessao.instantaneo()).toMatchObject({
        erro: "A escuta não conseguiu avaliar a pergunta: O Claude Code não respondeu.",
        situacao: "escutando",
      });

      t.sessao.descartarErro();
      t.respostas.push(pergunta("O que é um heap?"));
      await t.falar("E o que é um heap?");
      expect(t.enviar).toHaveBeenCalledTimes(1);
    });

    it("erro no envio aparece e a escuta continua", async () => {
      const t = montar();
      await t.entrar();
      t.enviar.mockRejectedValueOnce(new ErroDaApi("Falha interna.", 500));
      await t.falar(PERGUNTA);
      expect(t.sessao.instantaneo()).toMatchObject({
        erro: "A pergunta da escuta não foi enviada: Falha interna.",
        situacao: "escutando",
      });
    });

    it("falha na passada final aparece como erro; sem rede, a mensagem fala do download do modelo", async () => {
      const t = montar({ automatico: false });
      await t.entrar();
      t.motor.roteiro = (passada) => (passada.opcoes.descartavel === true ? resultado("") : new Error("o processo nativo caiu"));
      await t.falar("Bom dia a todos.");
      expect(t.sessao.instantaneo()).toMatchObject({
        erro: "A transcrição da escuta falhou: o processo nativo caiu",
        situacao: "escutando",
      });

      t.sessao.descartarErro();
      t.motor.roteiro = (passada) => (passada.opcoes.descartavel === true ? resultado("") : new Error("Failed to fetch"));
      await t.falar("Bom dia a todos.");
      expect(t.sessao.instantaneo().erro).toMatch(/baixar o modelo de voz da escuta/);
    });

    it("passada final descartada pela fila é ignorada em silêncio", async () => {
      const t = montar();
      await t.entrar();
      t.motor.roteiro = (passada) => (passada.opcoes.descartavel === true ? resultado("") : new TranscricaoDescartada());
      await t.falar("Bom dia a todos.");
      expect(t.sessao.instantaneo().erro).toBeNull();
    });

    it("falha no detector de voz para a captura e mostra o erro; retomar tenta de novo", async () => {
      const t = montar();
      await t.entrar();
      const captura = t.ultimaCaptura();
      t.detector.falha = new Error("modelo corrompido");
      captura.ouvintes.aoReceberAmostras(voz(100));
      await vi.advanceTimersByTimeAsync(0);
      expect(t.sessao.instantaneo()).toMatchObject({
        situacao: "erro",
        erro: "O detector de voz da escuta falhou: modelo corrompido",
      });
      expect(captura.parar).toHaveBeenCalled();

      t.detector.falha = null;
      t.sessao.retomar();
      await vi.advanceTimersByTimeAsync(0);
      expect(t.iniciarCaptura).toHaveBeenCalledTimes(2);
      expect(t.sessao.instantaneo().situacao).toBe("escutando");
    });

    it("erro ao iniciar a captura vira situação de erro; descartar deixa pausada e retomar tenta de novo", async () => {
      const t = montar({ falhaNaCaptura: new Error("A captura do áudio não foi liberada. Clique em retomar no indicador da escuta.") });
      await t.entrar();
      expect(t.sessao.instantaneo()).toMatchObject({
        situacao: "erro",
        erro: "A captura do áudio não foi liberada. Clique em retomar no indicador da escuta.",
      });

      t.sessao.descartarErro();
      expect(t.sessao.instantaneo()).toMatchObject({ situacao: "pausada", erro: null });
      t.sessao.retomar();
      await vi.advanceTimersByTimeAsync(0);
      expect(t.iniciarCaptura).toHaveBeenCalledTimes(2);
    });

    it("o erro do motor que chega depois não substitui o da captura", async () => {
      const t = montar({ falhaNaCaptura: new Error("A captura falhou.") });
      t.motor.preparo = () =>
        new Promise<DescricaoDoMotor>((_resolver, rejeitar) => {
          setTimeout(() => rejeitar(new Error("sem GPU")), 10);
        });
      await t.entrar();
      await vi.advanceTimersByTimeAsync(10);
      expect(t.sessao.instantaneo()).toMatchObject({ situacao: "erro", erro: "A captura falhou." });
    });

    it("a captura que termina sozinha vira erro", async () => {
      const t = montar();
      await t.entrar();
      t.ultimaCaptura().ouvintes.aoEncerrar("A captura terminou.");
      expect(t.sessao.instantaneo()).toMatchObject({ situacao: "erro", erro: "A captura terminou." });
    });
  });

  describe("ciclo de vida", () => {
    it("sair do modo para tudo: captura, VAD, transcrição em memória e envios", async () => {
      const t = montar();
      await t.entrar();
      await t.falar("Bom dia a todos, vamos começar.");
      const captura = t.ultimaCaptura();
      const analises = t.detector.analisar.mock.calls.length;

      t.opcoesDaTela({ modoInvisivelAtivo: false });
      expect(t.sessao.instantaneo().situacao).toBe("desligada");
      // Áudio que chega na espera para desligar não é ouvido.
      captura.ouvintes.aoReceberAmostras(voz(1_000));
      expect(t.detector.analisar).toHaveBeenCalledTimes(analises);

      await vi.advanceTimersByTimeAsync(ESPERA_PARA_DESLIGAR_MS);
      expect(captura.parar).toHaveBeenCalled();
      expect(t.detector.encerrar).toHaveBeenCalled();
      expect(t.sessao.instantaneo()).toMatchObject({
        situacao: "desligada",
        linhas: [],
        linhaProvisoria: null,
        legenda: { frases: [], emAndamento: null },
        erro: null,
        ultimaPergunta: null,
        ultimaPerguntaEnviada: null,
      });
      expect(t.sessao.instantaneo().trechos).toHaveLength(1);
    });

    it("voltar ao modo antes da espera (remontagem do chat) mantém a mesma captura", async () => {
      const t = montar();
      await t.entrar();
      t.opcoesDaTela({ modoInvisivelAtivo: false });
      await vi.advanceTimersByTimeAsync(ESPERA_PARA_DESLIGAR_MS / 2);
      await t.entrar();
      await vi.advanceTimersByTimeAsync(ESPERA_PARA_DESLIGAR_MS);
      expect(t.iniciarCaptura).toHaveBeenCalledTimes(1);
      expect(t.ultimaCaptura().parar).not.toHaveBeenCalled();
      expect(t.sessao.instantaneo().situacao).toBe("escutando");
    });

    it("na primeira vez, o aviso bloqueia a captura até ser confirmado", async () => {
      const t = montar({ avisoVisto: false });
      await t.entrar();
      expect(t.sessao.instantaneo().situacao).toBe("aguardando-aviso");
      expect(t.iniciarCaptura).not.toHaveBeenCalled();

      t.sessao.confirmarAviso();
      await vi.advanceTimersByTimeAsync(0);
      expect(t.iniciarCaptura).toHaveBeenCalledTimes(1);
      expect(t.preferencias().avisoVisto).toBe(true);
      expect(t.sessao.instantaneo().situacao).toBe("escutando");
    });

    it("recusar o aviso não escuta nesta entrada; retomar mostra o aviso de novo", async () => {
      const t = montar({ avisoVisto: false });
      await t.entrar();
      t.sessao.recusarAviso();
      expect(t.sessao.instantaneo().situacao).toBe("pausada");
      expect(t.iniciarCaptura).not.toHaveBeenCalled();
      expect(t.preferencias().avisoVisto).toBe(false);

      t.sessao.retomar();
      expect(t.sessao.instantaneo().situacao).toBe("aguardando-aviso");
      expect(t.iniciarCaptura).not.toHaveBeenCalled();
    });

    it("pausar libera a captura e zera o VAD; retomar captura de novo", async () => {
      const t = montar();
      await t.entrar();
      const primeira = t.ultimaCaptura();
      t.sessao.pausar();
      expect(primeira.parar).toHaveBeenCalled();
      expect(t.detector.reiniciar).toHaveBeenCalled();
      expect(t.sessao.instantaneo().situacao).toBe("pausada");

      primeira.ouvintes.aoReceberAmostras(voz(1_000));
      expect(t.detector.analisar).not.toHaveBeenCalled();

      t.sessao.retomar();
      await vi.advanceTimersByTimeAsync(0);
      expect(t.iniciarCaptura).toHaveBeenCalledTimes(2);
      expect(t.sessao.instantaneo().situacao).toBe("escutando");
    });

    it("pausar fecha o enunciado aberto como está (na legenda e na janela), sem avaliar a pergunta", async () => {
      const t = montar();
      await t.entrar();
      await t.falarSemPausa("pessoal eu queria saber qual a melhor forma");
      expect(t.sessao.instantaneo().legenda.emAndamento).toMatchObject({ id: "enunciado-1" });

      t.sessao.pausar();
      const estado = t.sessao.instantaneo();
      expect(estado.legenda).toEqual({
        frases: [expect.objectContaining({ id: "enunciado-1", texto: "pessoal eu queria saber qual a melhor forma", pergunta: false })],
        emAndamento: null,
      });
      expect(estado.linhas).toEqual(["pessoal eu queria saber qual a melhor forma"]);
      // A pausa que estava agendada não fecha nada de novo nem avalia depois.
      await vi.advanceTimersByTimeAsync(PAUSA_DO_ENUNCIADO_MS * 2);
      expect(t.sessao.instantaneo().legenda.frases).toHaveLength(1);
      expect(t.classificar).not.toHaveBeenCalled();
    });

    it("só avisa os assinantes quando o retrato muda, e o retrato é estável entre mudanças", async () => {
      const t = montar();
      const ouvinte = vi.fn();
      const cancelar = t.sessao.assinar(ouvinte);
      t.opcoesDaTela({});
      const retrato = t.sessao.instantaneo();
      t.opcoesDaTela({ chatLivre: true });
      expect(t.sessao.instantaneo()).toBe(retrato);
      const chamadas = ouvinte.mock.calls.length;
      await t.entrar();
      expect(ouvinte.mock.calls.length).toBeGreaterThan(chamadas);
      expect(Object.isFrozen(t.sessao.instantaneo())).toBe(true);
      cancelar();
    });
  });
});

describe("controleSemPendente", () => {
  const criar = (texto: string, ms: number) => PerguntaDetectada.criar({ pergunta: texto, contexto: "", detectadaEmMs: ms });

  it("tira a pendente e mantém as recentes e o último envio", () => {
    let controle = ControleDeDisparos.inicial();
    controle = controle.avaliar(criar("qual a complexidade do quicksort", 0), 0, true).controle;
    controle = controle.avaliar(criar("como funciona um heap", 25_000), 25_000, true).controle;
    controle = controle.avaliar(criar("o que é uma trie", 30_000), 30_000, true).controle;
    expect(controle.pendente).not.toBeNull();

    const refeito = controleSemPendente(controle);
    expect(refeito.pendente).toBeNull();
    expect(refeito.ultimoDisparoMs).toBe(controle.ultimoDisparoMs);
    expect(refeito.recentes).toEqual(controle.recentes);
  });

  it("pode tirar uma pergunta das recentes (o envio que falhou)", () => {
    let controle = ControleDeDisparos.inicial();
    controle = controle.avaliar(criar("qual a complexidade do quicksort", 0), 0, true).controle;
    controle = controle.avaliar(criar("como funciona um heap", 25_000), 25_000, true).controle;
    const refeito = controleSemPendente(controle, { normalizada: "como funciona um heap", enviadaEmMs: 25_000 });
    expect(refeito.recentes.map((recente) => recente.normalizada)).toEqual(["qual a complexidade do quicksort"]);
    expect(refeito.ultimoDisparoMs).toBe(0);
  });
});
