/**
 * A fila serial de transcrição, com as regras de prioridade entre o ditado e a
 * escuta. Uma só implementação para os dois motores: a reserva no navegador
 * (worker do Whisper) e o motor nativo (utilitário do Electron). Cada um diz só
 * como começar um pedido; a ordem e os descartes são decididos aqui.
 */
import type { OrigemDaTranscricao, ResultadoDaTranscricao } from "./motor";

/** A escuta deixa no máximo isto de pedidos esperando; o mais antigo sai quando chega outro. */
export const MAXIMO_DE_PEDIDOS_DA_ESCUTA_ESPERANDO = 2;

/**
 * Sem transcrição (nem ditado nem escuta) por este tempo, o motor descarrega o
 * modelo para devolver a memória. O próximo pedido carrega de novo, do cache
 * local, sem baixar outra vez.
 */
export const TEMPO_PARA_DESCARREGAR_O_DITADO_MS = 3 * 60_000;

/**
 * Pedido da escuta jogado fora porque a fila dela encheu (o computador não
 * acompanha a fala). Não é falha: quem pediu pode ignorar em silêncio.
 */
export class TranscricaoDescartada extends Error {
  constructor() {
    super("A transcrição foi descartada: chegaram trechos mais novos da escuta.");
    this.name = "TranscricaoDescartada";
  }
}

export interface PedidoDaFila {
  readonly id: number;
  /** Áudio mono a 16 kHz. */
  readonly audio: Float32Array;
  readonly origem: OrigemDaTranscricao;
  /** Como veio em `OpcoesDaPassada.idioma`: "portuguese", "automatico" ou um código ("pt", "en"...). */
  readonly idioma: string;
  /** Passada parcial da escuta: só entra com a fila vazia e sai quando chega um trecho final. */
  readonly descartavel: boolean;
  readonly resolver: (resultado: ResultadoDaTranscricao) => void;
  readonly rejeitar: (erro: Error) => void;
}

/** O motor por trás da fila. */
export interface ExecutorDaFila {
  /** false: ainda não dá para começar (ex.: porta reconectando); a fila espera o próximo `processar()`. */
  pronto(): boolean;
  /** Começa o pedido. Se lançar, o pedido é rejeitado com o erro e a fila segue. */
  iniciar(pedido: PedidoDaFila): void;
  /** Chamado a cada volta da fila (para contar a ociosidade). */
  aoAndar?(): void;
}

/**
 * Um pedido por vez (pedidos simultâneos disputam a mesma máquina e todos
 * demoram). O ditado passa na frente dos pedidos da escuta que ainda não
 * começaram; a escuta tem no máximo `MAXIMO_DE_PEDIDOS_DA_ESCUTA_ESPERANDO`
 * esperando, e a passada descartável só entra com a fila vazia.
 */
export class FilaDeTranscricao {
  private emAndamento: PedidoDaFila | null = null;
  private esperando: PedidoDaFila[] = [];

  constructor(private readonly executor: ExecutorDaFila) {}

  /** O pedido que o motor está transcrevendo agora, ou null. */
  get atual(): PedidoDaFila | null {
    return this.emAndamento;
  }

  /** true com pedido em andamento ou esperando. */
  get ocupada(): boolean {
    return this.emAndamento !== null || this.esperando.length > 0;
  }

  adicionar(pedido: PedidoDaFila): void {
    this.enfileirar(pedido);
    this.processar();
  }

  /** Começa o próximo pedido, se não houver um em andamento e o motor estiver pronto. */
  processar(): void {
    while (this.emAndamento === null && this.esperando.length > 0 && this.executor.pronto()) {
      const proximo = this.esperando.shift();
      if (proximo === undefined) break;
      try {
        this.executor.iniciar(proximo);
        this.emAndamento = proximo;
      } catch (erro) {
        proximo.rejeitar(erro instanceof Error ? erro : new Error(String(erro)));
      }
    }
    this.executor.aoAndar?.();
  }

  /** Entrega o resultado do pedido em andamento; false se `id` não é o dele (resposta atrasada). */
  resolver(id: number, resultado: ResultadoDaTranscricao): boolean {
    const atual = this.retirarEmAndamento(id);
    if (atual === null) return false;
    atual.resolver(resultado);
    this.processar();
    return true;
  }

  /** Rejeita o pedido em andamento; false se `id` não é o dele. */
  rejeitar(id: number, erro: Error): boolean {
    const atual = this.retirarEmAndamento(id);
    if (atual === null) return false;
    atual.rejeitar(erro);
    this.processar();
    return true;
  }

  /** Rejeita todos (em andamento e esperando) e esvazia a fila. */
  rejeitarTodos(erro: Error): void {
    const afetados = this.emAndamento === null ? this.esperando : [this.emAndamento, ...this.esperando];
    this.emAndamento = null;
    this.esperando = [];
    for (const pedido of afetados) pedido.rejeitar(erro);
    this.executor.aoAndar?.();
  }

  /**
   * O motor perdeu o pedido em andamento (ex.: a porta fechou): ele volta para
   * a frente da fila e recomeça no próximo `processar()`.
   */
  devolverEmAndamento(): void {
    if (this.emAndamento === null) return;
    this.esperando.unshift(this.emAndamento);
    this.emAndamento = null;
  }

  private retirarEmAndamento(id: number): PedidoDaFila | null {
    const atual = this.emAndamento;
    if (atual === null || atual.id !== id) return null;
    this.emAndamento = null;
    return atual;
  }

  private enfileirar(pedido: PedidoDaFila): void {
    if (pedido.origem === "ditado") {
      // Na frente da escuta, mas atrás de outro ditado que já esperava.
      const primeiroDaEscuta = this.esperando.findIndex((item) => item.origem === "escuta");
      if (primeiroDaEscuta < 0) this.esperando.push(pedido);
      else this.esperando.splice(primeiroDaEscuta, 0, pedido);
      return;
    }
    if (pedido.descartavel) {
      // Só entra com a fila vazia; havendo qualquer pedido esperando, pula (não enfileira).
      if (this.esperando.length > 0) pedido.rejeitar(new TranscricaoDescartada());
      else this.esperando.push(pedido);
      return;
    }
    // Um trecho final da escuta nunca espera atrás de uma descartável que ainda não começou.
    const descartaveis = this.esperando.filter((item) => item.descartavel);
    if (descartaveis.length > 0) {
      this.esperando = this.esperando.filter((item) => !item.descartavel);
      for (const descartavel of descartaveis) descartavel.rejeitar(new TranscricaoDescartada());
    }
    this.esperando.push(pedido);
    const daEscuta = this.esperando.filter((item) => item.origem === "escuta");
    if (daEscuta.length > MAXIMO_DE_PEDIDOS_DA_ESCUTA_ESPERANDO) {
      const maisAntigo = daEscuta[0];
      if (maisAntigo !== undefined) {
        this.esperando = this.esperando.filter((item) => item !== maisAntigo);
        maisAntigo.rejeitar(new TranscricaoDescartada());
      }
    }
  }
}

/**
 * Conta a ociosidade do motor: depois de `TEMPO_PARA_DESCARREGAR_O_DITADO_MS`
 * com `ocioso()` verdadeiro, chama `descarregar`. Cada `reiniciar` recomeça do zero.
 */
export class CronometroDeDescarga {
  private cronometro: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly ocioso: () => boolean,
    private readonly descarregar: () => void,
  ) {}

  reiniciar(): void {
    this.parar();
    if (!this.ocioso()) return;
    this.cronometro = setTimeout(() => {
      this.cronometro = null;
      if (this.ocioso()) this.descarregar();
    }, TEMPO_PARA_DESCARREGAR_O_DITADO_MS);
  }

  parar(): void {
    if (this.cronometro !== null) {
      clearTimeout(this.cronometro);
      this.cronometro = null;
    }
  }
}
