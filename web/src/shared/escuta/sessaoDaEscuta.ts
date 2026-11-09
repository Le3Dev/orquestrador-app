import { api, ErroDaApi } from "../api/cliente";
import type { ClassificacaoDaEscuta, PedidoDeClassificacaoDaEscuta } from "../api/tipos";
import { TranscricaoDescartada, type Transcrever, transcrever as transcreverNoWhisper } from "../ditado/transcritor";
import { type CapturaDoAudio, iniciarCapturaDoAudio, type OuvintesDaCaptura } from "./capturaDoAudio";
import { ControleDeDisparos } from "./ControleDeDisparos";
import { CortadorDeTrechos, type TrechoDeAudio } from "./CortadorDeTrechos";
import { DetectorDePergunta } from "./DetectorDePergunta";
import { DURACAO_DO_CONTEXTO_MS, JanelaDeTranscricao } from "./JanelaDeTranscricao";
import { mensagemDaEscuta } from "./mensagemDaEscuta";
import { PerguntaDetectada } from "./PerguntaDetectada";
import { type ArmazenamentoDasPreferencias, type PreferenciasDaEscuta, preferenciasNoNavegador } from "./preferenciasDaEscuta";
import { TrechoTranscrito } from "./TrechoTranscrito";
import type { OpcoesDaEscuta, SituacaoDaEscuta } from "./useEscuta";

/** Quantas linhas da transcrição a tela mostra. */
export const LINHAS_NA_TELA = 6;

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
  readonly automatico: boolean;
  readonly erro: string | null;
  readonly ultimaPergunta: string | null;
}

/** O que a sessão usa de fora; os testes trocam por falsos. */
export interface DependenciasDaSessao {
  iniciarCaptura(ouvintes: OuvintesDaCaptura): Promise<CapturaDoAudio>;
  transcrever: Transcrever;
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
    transcrever: transcreverNoWhisper,
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

/** Um trecho que pode ser pedido, esperando a vez de ir ao servidor. */
interface Candidata {
  readonly trecho: string;
  /** A transcrição dos 60 s antes do trecho (o servidor a usa para dar sentido a ele). */
  readonly contexto: string;
}

function mensagemDe(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

function mensagemDoErroDeTranscricao(erro: unknown): string {
  const mensagem = mensagemDe(erro);
  if (/fetch|network|Failed to load|download/i.test(mensagem)) {
    return "Não foi possível baixar o modelo de voz da escuta. Confira a internet; a escuta tenta de novo no próximo trecho.";
  }
  return `A transcrição da escuta falhou: ${mensagem}`;
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
 * A escuta do áudio do computador no modo invisível: captura → cortador de
 * trechos → Whisper → janela de transcrição → (com o automático) detector e
 * classificação no servidor → controle de disparos → chat rápido.
 *
 * Vive fora do React (há uma instância do módulo, `sessaoDaEscuta`), para
 * sobreviver à remontagem do chat rápido; a tela a observa por `assinar` e
 * `instantaneo` (compatíveis com `useSyncExternalStore`) e lhe passa as opções
 * mais recentes por `atualizarOpcoes`. Nenhum áudio vai para o disco; da
 * transcrição, só a janela dos últimos 2 min fica na memória.
 */
export class SessaoDaEscuta {
  private readonly dependencias: DependenciasDaSessao;
  private readonly ouvintes = new Set<() => void>();
  private estado: EstadoDaEscuta;

  private opcoes: OpcoesDaEscuta | null = null;
  private fase: Fase = "parada";
  private preferencias: PreferenciasDaEscuta;
  private erro: string | null = null;
  private progresso: number | null = null;
  private ultimaPergunta: string | null = null;

  private janela = JanelaDeTranscricao.vazia();
  private linhas: readonly string[] = Object.freeze([]);
  private controle = ControleDeDisparos.inicial();
  private readonly cortador = new CortadorDeTrechos();

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
    const automatico = !this.preferencias.automatico;
    this.guardarPreferencias({ ...this.preferencias, automatico });
    if (!automatico) {
      // Desligado, nada é classificado nem enviado: o que estava a caminho para aqui.
      this.cancelarClassificacao();
      this.cancelarTimer();
      this.controle = controleSemPendente(this.controle);
    }
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

  /** Fora do modo invisível: para tudo e esquece a transcrição. */
  private desligarTudo(): void {
    this.pararCaptura();
    this.fase = "parada";
    this.trocarJanela(JanelaDeTranscricao.vazia());
    this.erro = null;
    this.ultimaPergunta = null;
    this.ocupadoPorConflito = false;
  }

  private async iniciarCaptura(): Promise<void> {
    this.pararCaptura();
    const geracao = this.geracao;
    this.fase = "iniciando";
    this.erro = null;
    this.emitir();
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

  private aoEncerrarCaptura(motivo: string, geracao: number): void {
    if (geracao !== this.geracao) return;
    this.pararCaptura();
    this.fase = "erro";
    this.erro = motivo;
    this.emitir();
  }

  /**
   * Desliga a captura e tudo o que dependia dela: cortador, classificação,
   * timer e pendente. Transcrições já no Whisper terminam, mas são ignoradas.
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
    this.cortador.reiniciar();
    this.cancelarClassificacao();
    this.cancelarTimer();
    this.controle = controleSemPendente(this.controle);
    this.progresso = null;
  }

  // ---- Áudio → texto ----

  private receberAmostras(amostras: Float32Array, geracao: number): void {
    // Na espera para desligar (modo já desligado), o áudio não é ouvido.
    if (geracao !== this.geracao || this.fase !== "escutando" || !this.modoEstaAtivo()) return;
    let trechos: TrechoDeAudio[];
    try {
      trechos = this.cortador.adicionar(amostras);
    } catch {
      return;
    }
    for (const trecho of trechos) void this.transcreverTrecho(trecho, geracao);
  }

  private async transcreverTrecho(trecho: TrechoDeAudio, geracao: number): Promise<void> {
    const inicioMs = this.inicioDaCapturaMs + trecho.inicioMs;
    const fimMs = this.inicioDaCapturaMs + trecho.fimMs;
    let texto: string;
    try {
      texto = await this.dependencias.transcrever(trecho.amostras, (progresso) => this.aoBaixar(progresso, geracao), {
        idioma: "automatico",
        origem: "escuta",
      });
    } catch (erro) {
      // Descartada: a fila da escuta encheu e chegaram trechos mais novos; não é falha.
      if (erro instanceof TranscricaoDescartada || geracao !== this.geracao) return;
      this.progresso = null;
      this.erro = mensagemDoErroDeTranscricao(erro);
      this.emitir();
      return;
    }
    if (geracao !== this.geracao) return;
    this.progresso = null;
    this.registrarTexto(texto, inicioMs, fimMs);
    this.emitir();
  }

  private aoBaixar(progresso: number, geracao: number): void {
    if (geracao !== this.geracao) return;
    this.progresso = progresso < 100 ? Math.max(0, Math.round(progresso)) : null;
    this.emitir();
  }

  private registrarTexto(texto: string, inicioMs: number, fimMs: number): void {
    const limpo = texto.replace(/\s+/g, " ").trim();
    if (limpo === "" || DetectorDePergunta.ehAlucinacao(limpo)) return;
    let trecho: TrechoTranscrito;
    try {
      trecho = TrechoTranscrito.criar({ texto: limpo, inicioMs, fimMs });
    } catch {
      return;
    }
    // O contexto da classificação é o que veio antes do trecho, não ele mesmo.
    const contextoAnterior = this.janela.contexto(DURACAO_DO_CONTEXTO_MS, inicioMs);
    this.trocarJanela(this.janela.com(trecho).semAntigos(this.dependencias.agora()));
    if (this.preferencias.automatico && DetectorDePergunta.avaliar(limpo).candidata) {
      this.pedirClassificacao({ trecho: limpo, contexto: contextoAnterior });
    }
  }

  // ---- Texto → pergunta ----

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
      if (controlador.signal.aborted || geracao !== this.geracao || !this.preferencias.automatico) return;
      if (resposta.ehPergunta) {
        const reescrita = resposta.pergunta?.trim() ?? "";
        const pergunta = PerguntaDetectada.criar({
          pergunta: reescrita !== "" ? reescrita : candidata.trecho,
          contexto: this.janela.contexto(DURACAO_DO_CONTEXTO_MS),
          detectadaEmMs: this.dependencias.agora(),
        });
        this.decidir(pergunta);
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
        if (proxima !== null && !falhou && this.preferencias.automatico) void this.classificar(proxima);
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
    if (this.controle.pendente === null || !this.preferencias.automatico || this.fase === "parada" || !this.modoEstaAtivo()) {
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

  private modoEstaAtivo(): boolean {
    return this.opcoes !== null && modoAtivo(this.opcoes);
  }

  private chatLivre(): boolean {
    return this.opcoes?.chatLivre === true && !this.ocupadoPorConflito && this.modoEstaAtivo();
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

  private guardarPreferencias(preferencias: PreferenciasDaEscuta): void {
    this.preferencias = Object.freeze({ ...preferencias });
    try {
      this.dependencias.preferencias.gravar(this.preferencias);
    } catch {
      // Sem onde gravar: vale enquanto a tela estiver aberta.
    }
  }

  private situacao(): SituacaoDaEscuta {
    const opcoes = this.opcoes;
    if (opcoes === null || !opcoes.escutaDisponivel) return "indisponivel";
    if (!opcoes.modoInvisivelAtivo) return "desligada";
    switch (this.fase) {
      case "parada":
        return "desligada";
      case "escutando":
        return this.progresso !== null ? "baixando-modelo" : "escutando";
      default:
        return this.fase;
    }
  }

  private montarEstado(): EstadoDaEscuta {
    return Object.freeze({
      situacao: this.situacao(),
      progressoDoDownload: this.progresso,
      linhas: this.linhas,
      automatico: this.preferencias.automatico,
      erro: this.erro,
      ultimaPergunta: this.ultimaPergunta,
    });
  }

  /** Troca o retrato só se algo mudou (o `useSyncExternalStore` compara por referência) e avisa a tela. */
  private emitir(): void {
    const novo = this.montarEstado();
    const atual = this.estado;
    if (
      novo.situacao === atual.situacao &&
      novo.progressoDoDownload === atual.progressoDoDownload &&
      novo.linhas === atual.linhas &&
      novo.automatico === atual.automatico &&
      novo.erro === atual.erro &&
      novo.ultimaPergunta === atual.ultimaPergunta
    ) {
      return;
    }
    this.estado = novo;
    for (const ouvinte of [...this.ouvintes]) ouvinte();
  }
}

function modoAtivo(opcoes: OpcoesDaEscuta): boolean {
  return opcoes.modoInvisivelAtivo && opcoes.escutaDisponivel;
}

/** A escuta da tela: uma só, que sobrevive à remontagem do chat rápido (como o worker do ditado). */
export const sessaoDaEscuta = new SessaoDaEscuta();
