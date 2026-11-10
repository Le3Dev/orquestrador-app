import { AMOSTRAS_POR_JANELA_DO_VAD, type DetectorDeVoz, type JanelasAnalisadas } from "./DetectorDeVoz";

/** Pedido da tela ao worker do Silero (`vad.worker.ts`). */
export type PedidoAoVad =
  /** `amostras` tem um número inteiro de janelas e é transferida ao worker. */
  | { readonly tipo: "analisar"; readonly id: number; readonly amostras: Float32Array }
  | { readonly tipo: "reiniciar" };

/** Resposta do worker do Silero; sai na mesma ordem dos pedidos. */
export type RespostaDoVad =
  /** `amostras` é o mesmo áudio do pedido, transferido de volta. */
  | {
      readonly tipo: "probabilidades";
      readonly id: number;
      readonly amostras: Float32Array;
      readonly probabilidades: readonly number[];
    }
  | { readonly tipo: "erro"; readonly id: number; readonly mensagem: string };

/** O mínimo de um Worker que o detector usa (um falso nos testes). */
export interface TrabalhadorDoVad {
  onmessage: ((evento: MessageEvent<RespostaDoVad>) => void) | null;
  onerror: ((evento: ErrorEvent) => void) | null;
  postMessage(pedido: PedidoAoVad, transferir: Transferable[]): void;
  terminate(): void;
}

interface PedidoPendente {
  readonly id: number;
  /** false para os pedidos que não fecharam nenhuma janela: respondidos aqui, na vez deles. */
  readonly noTrabalhador: boolean;
  readonly resolver: (janelas: JanelasAnalisadas) => void;
  readonly rejeitar: (erro: Error) => void;
}

const NENHUMA_PROBABILIDADE: readonly number[] = Object.freeze([]);

function semJanelas(): JanelasAnalisadas {
  return Object.freeze({ amostras: new Float32Array(0), probabilidades: NENHUMA_PROBABILIDADE });
}

/** O worker de verdade, carregado pelo Vite como módulo. */
export function criarTrabalhadorDoVad(): TrabalhadorDoVad {
  return new Worker(new URL("./vad.worker.ts", import.meta.url), { type: "module" });
}

/**
 * Adaptador da porta `DetectorDeVoz` sobre o Silero VAD v5, que roda num
 * worker (`vad.worker.ts`). Junta as amostras em janelas de 512, guarda o
 * resto para o pedido seguinte e responde as análises na ordem em que foram
 * pedidas (uma fila: o worker processa uma por vez).
 *
 * O worker é criado na primeira análise com uma janela inteira. Depois de
 * `encerrar()`, a análise seguinte cria outro, com o estado zerado.
 */
export class DetectorDeVozSilero implements DetectorDeVoz {
  private trabalhador: TrabalhadorDoVad | null = null;
  /** Amostras recebidas que ainda não completam uma janela (sempre menos de 512). */
  private resto = new Float32Array(0);
  private proximoId = 1;
  private pendentes: PedidoPendente[] = [];

  constructor(private readonly criarTrabalhador: () => TrabalhadorDoVad = criarTrabalhadorDoVad) {}

  analisar(amostras: Float32Array): Promise<JanelasAnalisadas> {
    const total = this.resto.length + amostras.length;
    const alinhadas = total - (total % AMOSTRAS_POR_JANELA_DO_VAD);
    const bloco = new Float32Array(alinhadas);
    const doResto = Math.min(this.resto.length, alinhadas);
    bloco.set(this.resto.subarray(0, doResto));
    bloco.set(amostras.subarray(0, alinhadas - doResto), doResto);
    const novoResto = new Float32Array(total - alinhadas);
    novoResto.set(this.resto.subarray(doResto));
    novoResto.set(amostras.subarray(alinhadas - doResto), this.resto.length - doResto);
    this.resto = novoResto;

    const id = this.proximoId++;
    return new Promise<JanelasAnalisadas>((resolver, rejeitar) => {
      if (alinhadas === 0) {
        // Nada para o modelo; ainda assim responde só depois dos pedidos anteriores.
        if (this.pendentes.length === 0) resolver(semJanelas());
        else this.pendentes.push({ id, noTrabalhador: false, resolver, rejeitar });
        return;
      }
      try {
        this.obterTrabalhador().postMessage({ tipo: "analisar", id, amostras: bloco }, [bloco.buffer]);
        this.pendentes.push({ id, noTrabalhador: true, resolver, rejeitar });
      } catch (erro) {
        rejeitar(erro instanceof Error ? erro : new Error(String(erro)));
      }
    });
  }

  /**
   * Descarta o resto guardado e zera o estado do modelo. As análises já
   * pedidas ainda são respondidas (com o estado anterior); as seguintes
   * começam do zero.
   */
  reiniciar(): void {
    this.resto = new Float32Array(0);
    this.trabalhador?.postMessage({ tipo: "reiniciar" }, []);
  }

  encerrar(): void {
    this.resto = new Float32Array(0);
    const trabalhador = this.trabalhador;
    this.trabalhador = null;
    trabalhador?.terminate();
    this.rejeitarTodos(new Error("O detector de voz foi encerrado."));
  }

  private obterTrabalhador(): TrabalhadorDoVad {
    if (this.trabalhador !== null) return this.trabalhador;
    const novo = this.criarTrabalhador();
    novo.onmessage = (evento) => {
      if (this.trabalhador !== novo) return;
      this.receber(evento.data);
    };
    novo.onerror = (evento) => {
      // O worker nem subiu (ex.: falha ao carregar o script): ninguém espera para sempre.
      if (this.trabalhador !== novo) return;
      this.trabalhador = null;
      novo.terminate();
      this.rejeitarTodos(new Error(evento.message || "O detector de voz falhou ao iniciar."));
    };
    this.trabalhador = novo;
    return novo;
  }

  private receber(resposta: RespostaDoVad): void {
    const atual = this.pendentes[0];
    if (atual === undefined || !atual.noTrabalhador || atual.id !== resposta.id) return;
    this.pendentes.shift();
    if (resposta.tipo === "probabilidades") {
      atual.resolver(
        Object.freeze({ amostras: resposta.amostras, probabilidades: Object.freeze([...resposta.probabilidades]) }),
      );
    } else {
      atual.rejeitar(new Error(resposta.mensagem));
    }
    // Os pedidos sem janelas que esperavam este são respondidos agora, em ordem.
    while (this.pendentes[0] !== undefined && !this.pendentes[0].noTrabalhador) {
      this.pendentes.shift()?.resolver(semJanelas());
    }
  }

  private rejeitarTodos(erro: Error): void {
    const afetados = this.pendentes;
    this.pendentes = [];
    for (const pedido of afetados) pedido.rejeitar(erro);
  }
}
