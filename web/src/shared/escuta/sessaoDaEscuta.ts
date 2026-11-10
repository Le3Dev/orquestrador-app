import { api, ErroDaApi } from "../api/cliente";
import type { ClassificacaoDaEscuta, PedidoDeClassificacaoDaEscuta } from "../api/tipos";
import {
  type DescricaoDoMotor,
  type MotorDeTranscricao,
  motorDeTranscricao,
  type ProgressoDoDownload,
  type ResultadoDaTranscricao,
  TranscricaoDescartada,
} from "../ditado/motor";
import { BufferDaFala } from "./BufferDaFala";
import { type CapturaDoAudio, iniciarCapturaDoAudio, type OuvintesDaCaptura } from "./capturaDoAudio";
import { ConfirmadorDeTranscricao, fimDoUltimoSegmentoConfirmado } from "./ConfirmadorDeTranscricao";
import { ControleDeDisparos } from "./ControleDeDisparos";
import { CortadorDeFala, type EventoDeFala } from "./CortadorDeFala";
import { DetectorDePergunta } from "./DetectorDePergunta";
import { type DetectorDeVoz, type JanelasAnalisadas, TAXA_DE_AMOSTRAGEM } from "./DetectorDeVoz";
import { DetectorDeVozSilero } from "./DetectorDeVozSilero";
import { DURACAO_DO_CONTEXTO_MS, JanelaDeTranscricao } from "./JanelaDeTranscricao";
import { type FalaDaLegenda, type FraseDaLegenda, LegendaDaEscuta } from "./LegendaDaEscuta";
import { mensagemDaEscuta } from "./mensagemDaEscuta";
import { PerguntaDetectada } from "./PerguntaDetectada";
import {
  type AparenciaDaEscuta,
  aparenciaValida,
  type ArmazenamentoDasPreferencias,
  type IdiomaDaEscuta,
  type PreferenciasDaEscuta,
  preferenciasNoNavegador,
  type PrioridadeDoMotor,
} from "./preferenciasDaEscuta";
import { TrechoTranscrito } from "./TrechoTranscrito";
import type { OpcoesDaEscuta, SituacaoDaEscuta, TrechoNaTela } from "./useEscuta";

export type { FraseDaLegenda } from "./LegendaDaEscuta";

/** Quantas linhas da transcrição a tela mostra. */
export const LINHAS_NA_TELA = 6;

/** Quantos trechos finais a sessão guarda para a conversa; passando disto, os mais antigos saem. */
export const MAXIMO_DE_TRECHOS_NA_TELA = 200;

/**
 * Durante a fala, uma passada parcial (descartável) sai quando há ao menos
 * isto de áudio novo desde a anterior e nenhuma passada está em andamento:
 * a cadência se adapta à velocidade do motor.
 */
export const AUDIO_NOVO_PARA_PASSADA_MS = 1_000;

/**
 * Ao sair do modo invisível, a captura espera isto antes de ser desligada (o
 * áudio que chega nesse meio-tempo é ignorado). Cobre a remontagem do chat
 * rápido, em que o modo aparece desligado por um instante até a consulta ao
 * processo principal responder: sem a espera, a captura cairia e precisaria
 * de um novo clique para voltar.
 */
export const ESPERA_PARA_DESLIGAR_MS = 1_000;

/**
 * Depois de um 409 (o servidor diz que o chat está ocupado, mas a tela ainda o
 * via livre), a pendente espera o chat ficar livre; se a tela não perceber a
 * mudança, tenta de novo após este tempo.
 */
export const ESPERA_APOS_CONFLITO_MS = 5_000;

/** Um retrato da escuta para a tela. Imutável: cada mudança gera um novo. */
export interface EstadoDaEscuta {
  readonly situacao: SituacaoDaEscuta;
  readonly progressoDoDownload: number | null;
  readonly linhas: readonly string[];
  /** A fala em andamento: o confirmado dela mais o parcial; null quando não há fala em andamento. */
  readonly linhaProvisoria: string | null;
  /** As falas confirmadas. */
  readonly trechos: readonly TrechoNaTela[];
  readonly automatico: boolean;
  readonly erro: string | null;
  readonly ultimaPergunta: string | null;
  readonly legenda: { readonly frases: readonly FraseDaLegenda[]; readonly parcial: string | null };
  readonly motor: { readonly dispositivo: "webgpu" | "dml" | "cpu" | "wasm"; readonly modelo: string; readonly precisao: string; readonly nativo: boolean } | null;
  readonly download: { readonly progresso: number; readonly totalMb: number | null } | null;
  readonly ultimaPerguntaEnviada: { readonly pergunta: string; readonly enviadaEmMs: number } | null;
  readonly preferenciasDaTela: { readonly idioma: "portuguese" | "automatico"; readonly prioridadeDoMotor: "velocidade" | "precisao"; readonly aparencia: { readonly tamanhoDaFonte: number; readonly opacidade: number; readonly compacto: boolean } };
}

/** O que a sessão usa de fora; os testes trocam por falsos. */
export interface DependenciasDaSessao {
  iniciarCaptura(ouvintes: OuvintesDaCaptura): Promise<CapturaDoAudio>;
  /** O VAD (Silero), que dá a probabilidade de voz de cada janela do áudio. */
  detectorDeVoz: DetectorDeVoz;
  motor: MotorDeTranscricao;
  classificar(pedido: PedidoDeClassificacaoDaEscuta, sinal?: AbortSignal): Promise<ClassificacaoDaEscuta>;
  /** Relógio em ms (o mesmo para os trechos e para o controle de disparos). */
  agora(): number;
  /** Agenda `acao` daqui a `ms`; devolve o cancelamento. */
  agendar(acao: () => void, ms: number): () => void;
  preferencias: ArmazenamentoDasPreferencias;
}

function dependenciasPadrao(): DependenciasDaSessao {
  return {
    iniciarCaptura: (ouvintes) => iniciarCapturaDoAudio(ouvintes),
    detectorDeVoz: new DetectorDeVozSilero(),
    motor: motorDeTranscricao,
    classificar: (pedido, sinal) => api.classificarNaEscuta(pedido, sinal),
    agora: () => Date.now(),
    agendar: (acao, ms) => {
      const id = setTimeout(acao, ms);
      return () => clearTimeout(id);
    },
    preferencias: preferenciasNoNavegador,
  };
}

/** Em que pé está a captura (o modo invisível e a disponibilidade vêm das opções). */
type Fase = "parada" | "aguardando-aviso" | "iniciando" | "escutando" | "pausada" | "erro";

/** Uma frase que pode ser pedido, esperando a vez de ir ao servidor. */
interface Candidata {
  readonly trecho: string;
  /** A transcrição dos 60 s antes da frase (o servidor a usa para dar sentido a ela). */
  readonly contexto: string;
  /** A frase da legenda, para marcá-la se for pergunta. */
  readonly idDaFrase: string;
}

/**
 * A fala que o cortador anunciou e ainda não fechou. Os tempos são no relógio
 * do cortador (ms de áudio desde o começo da captura).
 */
interface FalaEmAndamento {
  /** Sobe a cada fala: resultados de uma fala que já fechou são ignorados. */
  readonly epoca: number;
  readonly inicioMs: number;
  /** O áudio da fala que ainda vai para o motor (o começo confirmado é aparado). */
  readonly buffer: BufferDaFala;
  confirmador: ConfirmadorDeTranscricao;
  /** O idioma que a primeira passada detectou (com o idioma automático); null antes dela. */
  idioma: string | null;
  /** Até onde ia o áudio da última passada pedida. */
  fimDaUltimaPassadaMs: number;
}

const LEGENDA_VAZIA: EstadoDaEscuta["legenda"] = Object.freeze({ frases: Object.freeze([]), parcial: null });

const msParaAmostras = (ms: number): number => Math.max(0, Math.round((ms * TAXA_DE_AMOSTRAGEM) / 1000));

const limparTexto = (texto: string): string => texto.replace(/\s+/g, " ").trim();

function mensagemDe(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

function mensagemDoErroDeTranscricao(erro: unknown, prefixo = "A transcrição da escuta falhou"): string {
  const mensagem = mensagemDe(erro);
  if (/fetch|network|Failed to load|download/i.test(mensagem)) {
    return "Não foi possível baixar o modelo de voz da escuta. Confira a internet; a escuta tenta de novo na próxima fala.";
  }
  return `${prefixo}: ${mensagem}`;
}

/** O download como a tela mostra: null quando acabou (100%) ou não há. */
function downloadNaTela(progresso: ProgressoDoDownload | null): EstadoDaEscuta["download"] {
  if (progresso === null || !(progresso.progresso < 100)) return null;
  return Object.freeze({ progresso: Math.max(0, progresso.progresso), totalMb: progresso.totalMb });
}

function preferenciasDaTelaDe(preferencias: PreferenciasDaEscuta): EstadoDaEscuta["preferenciasDaTela"] {
  return Object.freeze({
    idioma: preferencias.idioma,
    prioridadeDoMotor: preferencias.prioridadeDoMotor,
    aparencia: preferencias.aparencia,
  });
}

/**
 * O mesmo controle sem a pendente (e, se pedido, sem uma pergunta registrada
 * como enviada). O `ControleDeDisparos` não oferece isso; aqui ele é refeito
 * só pela API pública, reavaliando as recentes na ordem e no instante em que
 * foram enviadas. Como duas recentes sempre distam ao menos o intervalo
 * mínimo, todas voltam como envios, e o último envio fica o mesmo.
 */
export function controleSemPendente(
  controle: ControleDeDisparos,
  excluir?: { readonly normalizada: string; readonly enviadaEmMs: number },
): ControleDeDisparos {
  let refeito = ControleDeDisparos.inicial();
  for (const recente of controle.recentes) {
    if (excluir !== undefined && recente.normalizada === excluir.normalizada && recente.enviadaEmMs === excluir.enviadaEmMs) {
      continue;
    }
    try {
      const pergunta = PerguntaDetectada.criar({ pergunta: recente.normalizada, contexto: "", detectadaEmMs: recente.enviadaEmMs });
      refeito = refeito.avaliar(pergunta, recente.enviadaEmMs, true).controle;
    } catch {
      // Uma recente que não vira pergunta (vazia) não serve para achar repetidas: fica de fora.
    }
  }
  return refeito;
}

/**
 * A escuta do áudio do computador em tempo real: captura (pedaços de 100 ms)
 * → VAD Silero → cortador de fala → buffer da fala → motor de transcrição
 * (passadas parciais a cada ~1 s de áudio novo e uma final no fim da fala) →
 * confirmador por concordância → legenda (frases confirmadas e parcial),
 * janela de transcrição e trechos da conversa → (com o automático) detector
 * de pergunta, a cada frase que fecha → atalho do sinal forte ou classificação
 * no servidor → controle de disparos → chat rápido.
 *
 * Vive fora do React (há uma instância do módulo, `sessaoDaEscuta`), para
 * sobreviver à remontagem do chat rápido; a tela a observa por `assinar` e
 * `instantaneo` (compatíveis com `useSyncExternalStore`) e lhe passa as opções
 * mais recentes por `atualizarOpcoes`. Nenhum áudio vai para o disco; da
 * transcrição, ficam na memória a janela dos últimos 2 min, as últimas 200
 * frases da legenda e os trechos da conversa.
 */
export class SessaoDaEscuta {
  private readonly dependencias: DependenciasDaSessao;
  private readonly ouvintes = new Set<() => void>();
  private estado: EstadoDaEscuta;

  private opcoes: OpcoesDaEscuta | null = null;
  private fase: Fase = "parada";
  private preferencias: PreferenciasDaEscuta;
  private preferenciasDaTela: EstadoDaEscuta["preferenciasDaTela"];
  private erro: string | null = null;
  private ultimaPergunta: string | null = null;
  private ultimaPerguntaEnviada: EstadoDaEscuta["ultimaPerguntaEnviada"] = null;
  private motor: DescricaoDoMotor | null = null;
  private download: EstadoDaEscuta["download"] = null;
  /** Sobe a cada `preparar`: a resposta de um preparo antigo não sobrescreve a do mais novo. */
  private preparo = 0;

  private janela = JanelaDeTranscricao.vazia();
  private linhas: readonly string[] = Object.freeze([]);
  private trechosNaTela: readonly TrechoNaTela[] = Object.freeze([]);
  private proximoIdDoTrecho = 1;
  private legenda = LegendaDaEscuta.vazia();
  private legendaNaTela: EstadoDaEscuta["legenda"] = LEGENDA_VAZIA;
  private controle = ControleDeDisparos.inicial();

  private readonly cortador = new CortadorDeFala();
  private fala: FalaEmAndamento | null = null;
  private proximaEpoca = 1;
  /** Passadas da geração atual ainda no motor; a parcial só sai com zero. */
  private passadasEmVoo = 0;
  /** As passadas finais terminam na ordem das falas: cada uma espera a anterior. */
  private ultimaFinal: Promise<void> = Promise.resolve();
  /**
   * Fala cortada por duração máxima: a seguinte começa no mesmo ms, mas o
   * áudio até aqui (relógio do cortador) já foi confirmado na anterior.
   */
  private continuacaoMs: number | null = null;

  /** Muda a cada parada: respostas atrasadas de uma captura anterior são ignoradas. */
  private geracao = 0;
  private captura: CapturaDoAudio | null = null;
  /** Momento (no relógio) em que a captura atual começou; os tempos do cortador contam a partir dele. */
  private inicioDaCapturaMs = 0;
  private classificacao: AbortController | null = null;
  private candidataEsperando: Candidata | null = null;
  private cancelarTimerDaPendente: (() => void) | null = null;
  private cancelarDesligamento: (() => void) | null = null;
  /** O servidor respondeu 409: o chat conta como ocupado até a tela ver a mudança (ou até a espera vencer). */
  private ocupadoPorConflito = false;

  constructor(dependencias: Partial<DependenciasDaSessao> = {}) {
    this.dependencias = { ...dependenciasPadrao(), ...dependencias };
    this.preferencias = this.dependencias.preferencias.ler();
    this.preferenciasDaTela = preferenciasDaTelaDe(this.preferencias);
    try {
      this.motor = this.dependencias.motor.motorAtual("escuta");
      this.dependencias.motor.aoMudarMotor((origem, motor) => {
        if (origem !== "escuta") return;
        this.motor = motor;
        this.emitir();
      });
      this.dependencias.motor.aoBaixar((origem, progresso) => {
        if (origem !== "escuta") return;
        this.download = downloadNaTela(progresso);
        this.emitir();
      });
    } catch {
      // Sem os avisos do motor, a tela só não mostra qual motor está em uso nem o download.
    }
    this.estado = this.montarEstado();
  }

  // ---- Para o useSyncExternalStore ----

  readonly assinar = (ouvinte: () => void): (() => void) => {
    this.ouvintes.add(ouvinte);
    return () => {
      this.ouvintes.delete(ouvinte);
    };
  };

  readonly instantaneo = (): EstadoDaEscuta => this.estado;

  // ---- O que a tela informa ----

  /** Recebe o estado mais recente da tela; entra, sai, ou retoma a pendente conforme a mudança. */
  readonly atualizarOpcoes = (novas: OpcoesDaEscuta): void => {
    const anteriores = this.opcoes;
    this.opcoes = novas;
    const estavaAtivo = anteriores !== null && modoAtivo(anteriores);
    const estaAtivo = modoAtivo(novas);
    if (estaAtivo && !estavaAtivo) this.aoEntrarNoModo();
    else if (!estaAtivo && estavaAtivo) this.aoSairDoModo();

    // A tela viu o chat ocupado: a trava do 409 já não é necessária, basta esperar ele ficar livre.
    if (anteriores?.chatLivre === true && !novas.chatLivre) this.ocupadoPorConflito = false;
    if (novas.chatLivre && anteriores?.chatLivre !== true) this.tentarPendente();
    this.emitir();
  };

  // ---- Ações da tela ----

  readonly alternarAutomatico = (): void => {
    // Atua na preferência do contexto atual: modo invisível ou escuta manual.
    const automatico = !this.automaticoAtual();
    this.guardarPreferencias(
      this.contextoInvisivel()
        ? { ...this.preferencias, automatico }
        : { ...this.preferencias, automaticoManual: automatico },
    );
    if (!automatico) {
      // Desligado, nada é classificado nem enviado: o que estava a caminho para aqui.
      this.cancelarClassificacao();
      this.cancelarTimer();
      this.controle = controleSemPendente(this.controle);
    }
    this.emitir();
  };

  /** Português fixo ou idioma detectado a cada fala; vale a partir da próxima passada. */
  readonly mudarIdioma = (idioma: IdiomaDaEscuta): void => {
    if (idioma === this.preferencias.idioma) return;
    this.guardarPreferencias({ ...this.preferencias, idioma });
    this.emitir();
  };

  /** Velocidade ou precisão; escutando, o motor é preparado de novo com a nova prioridade. */
  readonly mudarPrioridadeDoMotor = (prioridadeDoMotor: PrioridadeDoMotor): void => {
    if (prioridadeDoMotor === this.preferencias.prioridadeDoMotor) return;
    this.guardarPreferencias({ ...this.preferencias, prioridadeDoMotor });
    if (this.fase === "escutando" || this.fase === "iniciando") this.prepararMotor();
    this.emitir();
  };

  /** Muda parte da aparência da legenda; valores fora dos limites vão para a borda. */
  readonly mudarAparencia = (aparencia: Partial<AparenciaDaEscuta>): void => {
    const nova = aparenciaValida({ ...this.preferencias.aparencia, ...aparencia });
    const atual = this.preferencias.aparencia;
    if (nova.tamanhoDaFonte === atual.tamanhoDaFonte && nova.opacidade === atual.opacidade && nova.compacto === atual.compacto) {
      return;
    }
    this.guardarPreferencias({ ...this.preferencias, aparencia: nova });
    this.emitir();
  };

  readonly pausar = (): void => {
    if (this.fase !== "escutando" && this.fase !== "iniciando") return;
    this.pararCaptura();
    this.fase = "pausada";
    this.emitir();
  };

  /** Recomeça a captura (o clique é o gesto que o `getDisplayMedia` exige). */
  readonly retomar = (): void => {
    if (this.opcoes === null || !modoAtivo(this.opcoes)) return;
    if (this.fase !== "pausada" && this.fase !== "erro") return;
    this.erro = null;
    if (!this.preferencias.avisoVisto) {
      this.fase = "aguardando-aviso";
      this.emitir();
      return;
    }
    void this.iniciarCaptura();
  };

  readonly descartarErro = (): void => {
    this.erro = null;
    // Sem a mensagem, a captura que falhou fica como pausada: retomar tenta de novo.
    if (this.fase === "erro") this.fase = "pausada";
    this.emitir();
  };

  readonly confirmarAviso = (): void => {
    if (this.fase !== "aguardando-aviso") return;
    this.guardarPreferencias({ ...this.preferencias, avisoVisto: true });
    void this.iniciarCaptura();
  };

  /** Não escuta nesta entrada no modo invisível (fica pausada; retomar mostra o aviso de novo). */
  readonly recusarAviso = (): void => {
    if (this.fase !== "aguardando-aviso") return;
    this.fase = "pausada";
    this.emitir();
  };

  /** Esquece os trechos da conversa (a tela chama no /clear). A janela de 2 min e a legenda não mudam. */
  readonly limparTrechos = (): void => {
    if (this.trechosNaTela.length === 0) return;
    this.trechosNaTela = Object.freeze([]);
    this.emitir();
  };

  // ---- Ciclo de vida ----

  private aoEntrarNoModo(): void {
    if (this.cancelarDesligamento !== null) {
      // Voltou antes da espera vencer (remontagem): segue de onde estava.
      this.cancelarDesligamento();
      this.cancelarDesligamento = null;
      this.tentarPendente();
      return;
    }
    this.erro = null;
    if (!this.preferencias.avisoVisto) {
      this.fase = "aguardando-aviso";
      return;
    }
    void this.iniciarCaptura();
  }

  private aoSairDoModo(): void {
    this.cancelarDesligamento?.();
    this.cancelarDesligamento = this.dependencias.agendar(() => {
      this.cancelarDesligamento = null;
      this.desligarTudo();
      this.emitir();
    }, ESPERA_PARA_DESLIGAR_MS);
  }

  /**
   * Com a escuta desligada: para tudo, libera o VAD e esquece a janela de
   * 2 min e a legenda (os trechos da conversa ficam até `limparTrechos`).
   */
  private desligarTudo(): void {
    this.pararCaptura();
    try {
      this.dependencias.detectorDeVoz.encerrar();
    } catch {
      // Já estava encerrado.
    }
    this.fase = "parada";
    this.trocarJanela(JanelaDeTranscricao.vazia());
    this.trocarLegenda(LegendaDaEscuta.vazia());
    this.erro = null;
    this.ultimaPergunta = null;
    this.ultimaPerguntaEnviada = null;
    this.ocupadoPorConflito = false;
  }

  private async iniciarCaptura(): Promise<void> {
    this.pararCaptura();
    const geracao = this.geracao;
    this.fase = "iniciando";
    this.erro = null;
    this.emitir();
    // O motor carrega e aquece enquanto a captura sobe.
    this.prepararMotor();
    try {
      const captura = await this.dependencias.iniciarCaptura({
        aoReceberAmostras: (amostras) => this.receberAmostras(amostras, geracao),
        aoEncerrar: (motivo) => this.aoEncerrarCaptura(motivo, geracao),
      });
      if (geracao !== this.geracao) {
        // Pausou ou saiu enquanto a captura subia.
        captura.parar();
        return;
      }
      this.captura = captura;
      this.cortador.reiniciar();
      this.inicioDaCapturaMs = this.dependencias.agora();
      this.fase = "escutando";
    } catch (erro) {
      if (geracao !== this.geracao) return;
      this.fase = "erro";
      this.erro = mensagemDe(erro);
    }
    this.emitir();
  }

  /** Pede ao motor que carregue o modelo da escuta com a prioridade escolhida. */
  private prepararMotor(): void {
    const preparo = ++this.preparo;
    let preparando: Promise<DescricaoDoMotor>;
    try {
      preparando = this.dependencias.motor.preparar("escuta", this.preferencias.prioridadeDoMotor);
    } catch (erro) {
      preparando = Promise.reject(erro instanceof Error ? erro : new Error(String(erro)));
    }
    preparando.then(
      (motor) => {
        if (preparo !== this.preparo) return;
        this.motor = motor;
        this.emitir();
      },
      (erro: unknown) => {
        // Parada, pausada ou já com erro (ex.: a captura falhou), a mensagem do motor não substitui a da tela.
        if (preparo !== this.preparo || (this.fase !== "iniciando" && this.fase !== "escutando")) return;
        this.erro = mensagemDoErroDeTranscricao(erro, "O motor de transcrição da escuta não pôde ser preparado");
        this.emitir();
      },
    );
  }

  private aoEncerrarCaptura(motivo: string, geracao: number): void {
    if (geracao !== this.geracao) return;
    this.pararCaptura();
    this.fase = "erro";
    this.erro = motivo;
    this.emitir();
  }

  /**
   * Desliga a captura e tudo o que dependia dela: VAD, cortador, fala em
   * andamento, classificação, timer e pendente. Passadas já no motor
   * terminam, mas são ignoradas; o que a fala em andamento já tinha
   * confirmado fica na legenda.
   */
  private pararCaptura(): void {
    this.geracao++;
    const captura = this.captura;
    this.captura = null;
    try {
      captura?.parar();
    } catch {
      // Já estava parada.
    }
    try {
      this.dependencias.detectorDeVoz.reiniciar();
    } catch {
      // Sem o VAD de pé, não há o que zerar.
    }
    this.cortador.reiniciar();
    this.fala = null;
    this.passadasEmVoo = 0;
    this.ultimaFinal = Promise.resolve();
    this.continuacaoMs = null;
    this.trocarLegenda(this.legenda.semFalaAberta());
    this.cancelarClassificacao();
    this.cancelarTimer();
    this.controle = controleSemPendente(this.controle);
  }

  // ---- Áudio → falas ----

  /** A captura (ou o VAD) é desta geração e a escuta está de fato ouvindo. */
  private ouvindo(geracao: number): boolean {
    // Na espera para desligar (modo já desligado), o áudio não é ouvido.
    return geracao === this.geracao && this.fase === "escutando" && this.modoEstaAtivo();
  }

  private receberAmostras(amostras: Float32Array, geracao: number): void {
    if (!this.ouvindo(geracao)) return;
    let analise: Promise<JanelasAnalisadas>;
    try {
      analise = this.dependencias.detectorDeVoz.analisar(amostras);
    } catch (erro) {
      this.falhaNoDetector(erro, geracao);
      return;
    }
    // O VAD responde na ordem dos pedidos: as janelas chegam ao cortador em sequência.
    analise.then(
      (janelas) => this.receberJanelas(janelas, geracao),
      (erro: unknown) => this.falhaNoDetector(erro, geracao),
    );
  }

  /** Sem VAD não há escuta: para a captura e mostra o erro; retomar tenta de novo (com um VAD novo). */
  private falhaNoDetector(erro: unknown, geracao: number): void {
    if (geracao !== this.geracao) return;
    this.pararCaptura();
    this.fase = "erro";
    this.erro = `O detector de voz da escuta falhou: ${mensagemDe(erro)}`;
    this.emitir();
  }

  private receberJanelas(janelas: JanelasAnalisadas, geracao: number): void {
    if (!this.ouvindo(geracao)) return;
    const antesMs = this.cortador.agoraMs;
    let eventos: readonly EventoDeFala[];
    try {
      eventos = this.cortador.adicionar(janelas);
    } catch {
      return;
    }
    for (const evento of eventos) {
      if (evento.tipo === "inicio") this.abrirFala(evento.emMs);
      else this.fecharFala(evento, geracao);
    }
    const fala = this.fala;
    if (fala === null || !this.cortador.emAndamento) return;
    this.completarBuffer(fala, janelas.amostras, antesMs);
    if (this.passadasEmVoo === 0 && fala.buffer.fimMs - fala.fimDaUltimaPassadaMs >= AUDIO_NOVO_PARA_PASSADA_MS) {
      void this.passadaParcial(fala, geracao);
    }
  }

  /** "inicio": buffer e confirmador novos. O áudio da fala entra no buffer logo depois (`completarBuffer`). */
  private abrirFala(emMs: number): void {
    const continuacao = this.continuacaoMs;
    this.continuacaoMs = null;
    const inicioDoBufferMs = continuacao !== null && continuacao > emMs ? continuacao : emMs;
    this.fala = {
      epoca: this.proximaEpoca++,
      inicioMs: emMs,
      buffer: new BufferDaFala(inicioDoBufferMs),
      confirmador: ConfirmadorDeTranscricao.vazio(),
      idioma: null,
      fimDaUltimaPassadaMs: inicioDoBufferMs,
    };
  }

  /**
   * Leva ao buffer o áudio da fala até o relógio do cortador: do lote que
   * acabou de chegar ou, logo depois do "inicio" (cujo começo, com o
   * pre-roll, ficou em lotes anteriores), de todo o áudio da fala.
   */
  private completarBuffer(fala: FalaEmAndamento, lote: Float32Array, antesMs: number): void {
    const desdeMs = fala.buffer.fimMs;
    if (desdeMs >= this.cortador.agoraMs) return;
    if (desdeMs >= antesMs) {
      fala.buffer.acrescentar(lote.subarray(msParaAmostras(desdeMs - antesMs)));
      return;
    }
    const inicioDaFalaMs = this.cortador.inicioDaFalaMs ?? desdeMs;
    fala.buffer.acrescentar(this.cortador.audioDaFala().subarray(msParaAmostras(desdeMs - inicioDaFalaMs)));
  }

  /** O idioma de uma passada: português fixo, ou "automatico" até a primeira passada da fala detectar um. */
  private idiomaDaPassada(fala: FalaEmAndamento): string {
    if (this.preferencias.idioma !== "automatico") return "portuguese";
    return fala.idioma ?? "automatico";
  }

  private lembrarIdioma(fala: FalaEmAndamento, idioma: string): void {
    const codigo = idioma.trim();
    if (this.preferencias.idioma !== "automatico" || fala.idioma !== null) return;
    if (codigo === "" || codigo === "automatico") return;
    fala.idioma = codigo;
  }

  /**
   * Passada parcial (descartável) sobre o buffer: a hipótese vai ao
   * confirmador, o confirmado à legenda e o buffer é aparado até o fim do
   * último segmento todo confirmado. Descartada ou com falha, nada muda: a
   * próxima passada (ou a final) cuida do resto.
   */
  private async passadaParcial(fala: FalaEmAndamento, geracao: number): Promise<void> {
    const audio = fala.buffer.audio();
    const inicioDoAudioMs = fala.buffer.inicioMs;
    const fimDoAudioMs = fala.buffer.fimMs;
    fala.fimDaUltimaPassadaMs = fimDoAudioMs;
    this.passadasEmVoo++;
    let resultado: ResultadoDaTranscricao | null = null;
    try {
      resultado = await this.dependencias.motor.transcrever(audio, {
        origem: "escuta",
        idioma: this.idiomaDaPassada(fala),
        descartavel: true,
      });
    } catch {
      // Descartada (chegou áudio mais novo na fila) ou com falha: a passada final cuida do resto.
    }
    if (geracao !== this.geracao) return;
    this.passadasEmVoo--;
    // Atrasada: a fala já fechou (a final vale por ela).
    if (resultado === null || this.fala !== fala) return;

    const texto = limparTexto(resultado.texto);
    if (DetectorDePergunta.ehAlucinacaoConhecida(texto)) return;
    this.lembrarIdioma(fala, resultado.idioma);
    const passada = fala.confirmador.comHipotese(texto);
    fala.confirmador = passada.confirmador;
    const fimS = fimDoUltimoSegmentoConfirmado(resultado.segmentos, passada.confirmadoNaHipotese);
    if (fimS !== null) fala.buffer.apararAte(inicioDoAudioMs + fimS * 1000);

    const mudanca = this.legenda.comConfirmado(
      this.falaNaLegenda(fala),
      passada.confirmador.confirmado,
      passada.parcial,
      this.relogio(fimDoAudioMs),
    );
    this.trocarLegenda(mudanca.legenda);
    this.aoFecharFrases(mudanca.fechadasAgora);
    this.emitir();
  }

  /**
   * "fim": passada final (não descartável) com o que restou no buffer, tirado
   * do áudio do evento (que vai até o fim de verdade da fala). As finais
   * terminam na ordem das falas.
   */
  private fecharFala(evento: Extract<EventoDeFala, { tipo: "fim" }>, geracao: number): void {
    const fala = this.fala;
    this.fala = null;
    if (fala === null) return;
    const inicioDoRestoMs = Math.min(Math.max(fala.buffer.inicioMs, evento.inicioMs), evento.emMs);
    const resto = evento.audio.slice(msParaAmostras(inicioDoRestoMs - evento.inicioMs));
    if (evento.motivo === "duracao_maxima") this.continuacaoMs = Math.max(evento.emMs, fala.buffer.inicioMs);

    type Desfecho = { readonly resultado: ResultadoDaTranscricao | null; readonly erro: unknown };
    let transcricao: Promise<Desfecho>;
    if (resto.length === 0) {
      transcricao = Promise.resolve({ resultado: null, erro: null });
    } else {
      try {
        transcricao = this.dependencias.motor
          .transcrever(resto, { origem: "escuta", idioma: this.idiomaDaPassada(fala), descartavel: false })
          .then(
            (resultado): Desfecho => ({ resultado, erro: null }),
            (erro: unknown): Desfecho => ({ resultado: null, erro }),
          );
      } catch (erro) {
        transcricao = Promise.resolve({ resultado: null, erro });
      }
    }

    this.passadasEmVoo++;
    const anterior = this.ultimaFinal;
    this.ultimaFinal = (async () => {
      const desfecho = await transcricao;
      await anterior;
      if (geracao !== this.geracao) return;
      this.passadasEmVoo--;
      this.concluirFala(fala, evento, desfecho.resultado, desfecho.erro);
    })();
  }

  /** O texto final confirma o resto da fala: as frases fecham e a fala vira um trecho da conversa. */
  private concluirFala(
    fala: FalaEmAndamento,
    evento: Extract<EventoDeFala, { tipo: "fim" }>,
    resultado: ResultadoDaTranscricao | null,
    erro: unknown,
  ): void {
    // Descartada não é falha (a final não deveria ser); com falha, fica o que já estava confirmado.
    if (erro !== null && !(erro instanceof TranscricaoDescartada)) this.erro = mensagemDoErroDeTranscricao(erro);
    const texto = resultado === null ? "" : limparTexto(resultado.texto);
    const final = fala.confirmador.finalizar(DetectorDePergunta.ehAlucinacaoConhecida(texto) ? "" : texto);
    fala.confirmador = final.confirmador.paraNovaFala();
    const confirmado = final.confirmador.confirmado;
    const inicioMs = this.relogio(evento.inicioMs);
    const fimMs = this.relogio(evento.emMs);

    const mudanca = this.legenda.comFimDaFala(this.falaNaLegenda(fala), confirmado, fimMs);
    this.trocarLegenda(mudanca.legenda);
    this.registrarTrecho(confirmado, inicioMs, fimMs);
    this.aoFecharFrases(mudanca.fechadasAgora);
    this.emitir();
  }

  /** A fala vira um trecho da conversa (o bloco "ouvido"), se não for alucinação. */
  private registrarTrecho(texto: string, inicioMs: number, fimMs: number): void {
    const limpo = limparTexto(texto);
    if (limpo === "" || DetectorDePergunta.ehAlucinacao(limpo)) return;
    this.trechosNaTela = Object.freeze(
      [...this.trechosNaTela, { id: `trecho-${this.proximoIdDoTrecho++}`, texto: limpo, inicioMs, fimMs }].slice(
        -MAXIMO_DE_TRECHOS_NA_TELA,
      ),
    );
  }

  // ---- Frases → pergunta ----

  /**
   * Cada frase que fecha entra na janela de transcrição e, com o automático,
   * é avaliada na hora (sem esperar o fim da fala): com o sinal forte vira
   * pergunta direto; senão, se for candidata, vai ao servidor.
   */
  private aoFecharFrases(frases: readonly FraseDaLegenda[]): void {
    for (const frase of frases) {
      if (DetectorDePergunta.ehAlucinacaoConhecida(frase.texto)) continue;
      let trecho: TrechoTranscrito;
      try {
        trecho = TrechoTranscrito.criar({ texto: frase.texto, inicioMs: frase.inicioMs, fimMs: frase.fimMs });
      } catch {
        continue;
      }
      // O contexto da classificação é o que veio antes da frase, não ela mesma.
      const contextoAnterior = this.janela.contexto(DURACAO_DO_CONTEXTO_MS, frase.inicioMs);
      this.trocarJanela(this.janela.com(trecho).semAntigos(this.dependencias.agora()));
      if (!this.automaticoAtual()) continue;
      const avaliacao = DetectorDePergunta.avaliar(frase.texto);
      if (!avaliacao.candidata) continue;
      if (avaliacao.sinalForte) this.perguntaDetectada(frase.texto, frase.id);
      else this.pedirClassificacao({ trecho: frase.texto, contexto: contextoAnterior, idDaFrase: frase.id });
    }
  }

  /** Marca a frase na legenda e leva a pergunta ao controle de disparos. */
  private perguntaDetectada(texto: string, idDaFrase: string): void {
    this.trocarLegenda(this.legenda.comPergunta(idDaFrase));
    let pergunta: PerguntaDetectada;
    try {
      pergunta = PerguntaDetectada.criar({
        pergunta: texto,
        contexto: this.janela.contexto(DURACAO_DO_CONTEXTO_MS),
        detectadaEmMs: this.dependencias.agora(),
      });
    } catch {
      return;
    }
    this.decidir(pergunta);
  }

  /** No máximo uma classificação por vez; uma candidata nova substitui a que esperava. */
  private pedirClassificacao(candidata: Candidata): void {
    if (this.classificacao !== null) {
      this.candidataEsperando = candidata;
      return;
    }
    void this.classificar(candidata);
  }

  private async classificar(candidata: Candidata): Promise<void> {
    const controlador = new AbortController();
    this.classificacao = controlador;
    const geracao = this.geracao;
    let falhou = false;
    try {
      const pedido: PedidoDeClassificacaoDaEscuta =
        candidata.contexto === "" ? { trecho: candidata.trecho } : { trecho: candidata.trecho, contexto: candidata.contexto };
      const resposta = await this.dependencias.classificar(pedido, controlador.signal);
      if (controlador.signal.aborted || geracao !== this.geracao || !this.automaticoAtual()) return;
      if (resposta.ehPergunta) {
        const reescrita = resposta.pergunta?.trim() ?? "";
        this.perguntaDetectada(reescrita !== "" ? reescrita : candidata.trecho, candidata.idDaFrase);
        this.emitir();
      }
    } catch (erro) {
      if (controlador.signal.aborted || geracao !== this.geracao) return;
      falhou = true;
      const detalhe = erro instanceof ErroDaApi ? erro.message : mensagemDe(erro);
      this.erro = `A escuta não conseguiu avaliar a pergunta: ${detalhe}`;
      this.emitir();
    } finally {
      if (this.classificacao === controlador) {
        this.classificacao = null;
        const proxima = this.candidataEsperando;
        this.candidataEsperando = null;
        // Depois de uma falha (ex.: 502), não tenta de novo em seguida: a que esperava é descartada.
        if (proxima !== null && !falhou && this.automaticoAtual()) void this.classificar(proxima);
      }
    }
  }

  private cancelarClassificacao(): void {
    this.classificacao?.abort();
    this.classificacao = null;
    this.candidataEsperando = null;
  }

  // ---- Pergunta → chat ----

  private decidir(pergunta: PerguntaDetectada): void {
    const agora = this.dependencias.agora();
    const { decisao, controle } = this.controle.avaliar(pergunta, agora, this.chatLivre());
    this.controle = controle;
    if (decisao === "enviar") void this.disparar(pergunta, agora);
    else if (decisao === "guardar" || decisao === "aguardar_intervalo") this.tentarPendente();
  }

  /** Manda a pendente se já pode; senão agenda a próxima tentativa (ou espera o chat ficar livre). */
  private readonly tentarPendente = (): void => {
    this.cancelarTimer();
    if (this.controle.pendente === null || !this.automaticoAtual() || this.fase === "parada" || !this.modoEstaAtivo()) {
      return;
    }
    const agora = this.dependencias.agora();
    const { pergunta, controle } = this.controle.retirarPendente(agora, this.chatLivre());
    this.controle = controle;
    if (pergunta !== null) {
      void this.disparar(pergunta, agora);
      return;
    }
    const espera = this.controle.msAteLiberar(agora);
    if (espera > 0) {
      this.cancelarTimerDaPendente = this.dependencias.agendar(this.tentarPendente, espera);
    } else if (this.ocupadoPorConflito) {
      this.cancelarTimerDaPendente = this.dependencias.agendar(() => {
        this.cancelarTimerDaPendente = null;
        this.ocupadoPorConflito = false;
        this.tentarPendente();
      }, ESPERA_APOS_CONFLITO_MS);
    }
    // Senão, o chat está ocupado: `atualizarOpcoes` tenta de novo quando ele ficar livre.
  };

  /** Envia (ou, com alterações autorizadas, põe no campo de mensagem) a pergunta. */
  private async disparar(pergunta: PerguntaDetectada, enviadaEmMs: number): Promise<void> {
    const opcoes = this.opcoes;
    if (opcoes === null) return;
    const texto = mensagemDaEscuta(pergunta);
    this.ultimaPergunta = pergunta.pergunta;
    this.ultimaPerguntaEnviada = Object.freeze({ pergunta: pergunta.pergunta, enviadaEmMs });
    this.emitir();

    if (opcoes.autorizacaoAtiva) {
      // Com alterações autorizadas (ADR-25), nada sai sem a pessoa conferir e apertar Enter.
      try {
        opcoes.preencherComposer(texto);
      } catch (erro) {
        this.erro = `A pergunta da escuta não foi para o campo de mensagem: ${mensagemDe(erro)}`;
        this.emitir();
      }
      return;
    }

    const geracao = this.geracao;
    try {
      await opcoes.enviar(texto);
    } catch (erro) {
      if (geracao !== this.geracao) return;
      if (erro instanceof ErroDaApi && erro.status === 409) {
        this.devolverAPendente(pergunta, enviadaEmMs);
        return;
      }
      this.erro = `A pergunta da escuta não foi enviada: ${mensagemDe(erro)}`;
      this.emitir();
    }
  }

  /**
   * O chat estava ocupado (409): a pergunta volta a ser a pendente, sem contar
   * como enviada (senão seria descartada como repetida). Se já chegou outra
   * pendente depois, fica a mais recente.
   */
  private devolverAPendente(pergunta: PerguntaDetectada, enviadaEmMs: number): void {
    const agora = this.dependencias.agora();
    const maisNova = this.controle.pendente;
    let controle = controleSemPendente(this.controle, { normalizada: pergunta.normalizada, enviadaEmMs });
    controle = controle.avaliar(pergunta, agora, false).controle;
    if (maisNova !== null) controle = controle.avaliar(maisNova, agora, false).controle;
    this.controle = controle;
    this.ocupadoPorConflito = true;
    this.tentarPendente();
  }

  // ---- Auxiliares ----

  /** O modo invisível tem prioridade: com ele ligado, vale a preferência dele mesmo com a escuta manual ligada. */
  private contextoInvisivel(): boolean {
    return this.opcoes?.modoInvisivelAtivo === true || this.opcoes === null;
  }

  /** O automático do contexto atual (modo invisível ou escuta manual). */
  private automaticoAtual(): boolean {
    return this.contextoInvisivel() ? this.preferencias.automatico : this.preferencias.automaticoManual;
  }

  private modoEstaAtivo(): boolean {
    return this.opcoes !== null && modoAtivo(this.opcoes);
  }

  private chatLivre(): boolean {
    return this.opcoes?.chatLivre === true && !this.ocupadoPorConflito && this.modoEstaAtivo();
  }

  /** Um instante do relógio do cortador (ms de áudio desde o começo da captura) no relógio da sessão. */
  private relogio(msDoCortador: number): number {
    return this.inicioDaCapturaMs + msDoCortador;
  }

  private falaNaLegenda(fala: FalaEmAndamento): FalaDaLegenda {
    return { numero: fala.epoca, inicioMs: this.relogio(fala.inicioMs) };
  }

  private cancelarTimer(): void {
    this.cancelarTimerDaPendente?.();
    this.cancelarTimerDaPendente = null;
  }

  private trocarJanela(janela: JanelaDeTranscricao): void {
    if (janela === this.janela) return;
    this.janela = janela;
    this.linhas = Object.freeze([...janela.ultimasLinhas(LINHAS_NA_TELA)]);
  }

  private trocarLegenda(legenda: LegendaDaEscuta): void {
    if (legenda === this.legenda) return;
    this.legenda = legenda;
    this.legendaNaTela =
      legenda.frases.length === 0 && legenda.parcial === null
        ? LEGENDA_VAZIA
        : Object.freeze({ frases: legenda.frases, parcial: legenda.parcial });
  }

  private guardarPreferencias(preferencias: PreferenciasDaEscuta): void {
    this.preferencias = Object.freeze({ ...preferencias });
    this.preferenciasDaTela = preferenciasDaTelaDe(this.preferencias);
    try {
      this.dependencias.preferencias.gravar(this.preferencias);
    } catch {
      // Sem onde gravar: vale enquanto a tela estiver aberta.
    }
  }

  private situacao(): SituacaoDaEscuta {
    const opcoes = this.opcoes;
    if (opcoes === null || !opcoes.escutaDisponivel) return "indisponivel";
    if (!modoAtivo(opcoes)) return "desligada";
    switch (this.fase) {
      case "parada":
        return "desligada";
      case "escutando":
        return this.download !== null ? "baixando-modelo" : "escutando";
      default:
        return this.fase;
    }
  }

  private montarEstado(): EstadoDaEscuta {
    return Object.freeze({
      situacao: this.situacao(),
      progressoDoDownload: this.download === null ? null : Math.round(this.download.progresso),
      linhas: this.linhas,
      linhaProvisoria: this.legenda.falaEmAndamento,
      trechos: this.trechosNaTela,
      automatico: this.automaticoAtual(),
      erro: this.erro,
      ultimaPergunta: this.ultimaPergunta,
      legenda: this.legendaNaTela,
      motor: this.motor,
      download: this.download,
      ultimaPerguntaEnviada: this.ultimaPerguntaEnviada,
      preferenciasDaTela: this.preferenciasDaTela,
    });
  }

  /** Troca o retrato só se algo mudou (o `useSyncExternalStore` compara por referência) e avisa a tela. */
  private emitir(): void {
    const novo = this.montarEstado();
    const atual = this.estado;
    const campos = Object.keys(novo) as (keyof EstadoDaEscuta)[];
    if (campos.every((campo) => novo[campo] === atual[campo])) return;
    this.estado = novo;
    for (const ouvinte of [...this.ouvintes]) ouvinte();
  }
}

function modoAtivo(opcoes: OpcoesDaEscuta): boolean {
  return opcoes.escutaDisponivel && (opcoes.modoInvisivelAtivo || opcoes.escutaManualLigada);
}

/** A escuta da tela: uma só, que sobrevive à remontagem do chat rápido (como o worker do ditado). */
export const sessaoDaEscuta = new SessaoDaEscuta();
