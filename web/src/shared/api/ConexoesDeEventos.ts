import { api } from "./cliente";
import type { EventoRegistrado, SinalDeVida } from "./tipos";

export type SituacaoDaConexao = "conectando" | "conectado" | "reconectando";

/** O mínimo de um `EventSource` que usamos — permite trocar por um falso nos testes. */
export interface FonteDeEventos {
  readonly readyState: number;
  onopen: ((evento: Event) => unknown) | null;
  onerror: ((evento: Event) => unknown) | null;
  onmessage: ((evento: MessageEvent<string>) => unknown) | null;
  addEventListener(tipo: "sinal", ouvinte: (evento: MessageEvent<string>) => void): void;
  close(): void;
}

export interface OuvintesDasConexoes {
  aoReceber: (orquestradorId: string, evento: EventoRegistrado) => void;
  /** Sinal de vida: passageiro, não passa pelo histórico. */
  aoSinal: (orquestradorId: string, sinal: SinalDeVida) => void;
  aoMudarSituacao: (orquestradorId: string, situacao: SituacaoDaConexao | null) => void;
  /** Última sequência já aplicada na tela, para retomar dali. */
  ultimaSequencia: (orquestradorId: string) => number;
}

/** Igual a `EventSource.CLOSED`, sem depender do objeto global (ausente nos testes). */
const FECHADA = 2;
export const ESPERA_PARA_REABRIR_MS = 3_000;

/**
 * As conexões de eventos dos terminais abertos — uma por Orquestrador.
 *
 * O navegador reconecta sozinho quando a conexão cai, mas desiste de vez se
 * receber uma resposta de erro (é o que acontece em desenvolvimento, quando o
 * proxy do Vite responde 500 porque o servidor está fora). Nesses casos a
 * conexão é recriada aqui, a partir do último evento recebido.
 */
export class ConexoesDeEventos {
  private readonly fontes = new Map<string, FonteDeEventos>();
  private readonly reaberturas = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly ouvintes: OuvintesDasConexoes,
    private readonly criarFonte: (endereco: string) => FonteDeEventos = (endereco) => new EventSource(endereco),
  ) {}

  /** Abre as conexões que faltam e fecha as dos terminais que saíram do canvas. */
  sincronizar(ids: ReadonlySet<string>): void {
    for (const id of [...this.fontes.keys()]) {
      if (!ids.has(id)) {
        this.fechar(id);
        this.ouvintes.aoMudarSituacao(id, null);
      }
    }
    for (const id of ids) {
      if (!this.fontes.has(id)) {
        this.abrir(id);
      }
    }
  }

  /** O servidor voltou: reabre na hora as conexões que o navegador abandonou. */
  reabrirAbandonadas(): void {
    for (const [id, fonte] of this.fontes) {
      if (fonte.readyState === FECHADA) {
        this.abrir(id);
      }
    }
  }

  fecharTodas(): void {
    for (const id of [...this.fontes.keys()]) {
      this.fechar(id);
    }
  }

  private abrir(id: string): void {
    this.cancelarReabertura(id);
    this.fontes.get(id)?.close();

    const fonte = this.criarFonte(api.enderecoDosEventos(id, this.ouvintes.ultimaSequencia(id)));
    this.fontes.set(id, fonte);
    this.ouvintes.aoMudarSituacao(id, "conectando");

    fonte.onopen = () => this.ouvintes.aoMudarSituacao(id, "conectado");
    fonte.onerror = () => {
      this.ouvintes.aoMudarSituacao(id, "reconectando");
      if (fonte.readyState === FECHADA && this.fontes.get(id) === fonte) {
        this.agendarReabertura(id);
      }
    };
    fonte.onmessage = (mensagem) => {
      try {
        this.ouvintes.aoReceber(id, JSON.parse(mensagem.data) as EventoRegistrado);
      } catch (erro) {
        console.error("Evento inválido recebido do servidor:", erro);
      }
    };
    fonte.addEventListener("sinal", (mensagem) => {
      try {
        this.ouvintes.aoSinal(id, JSON.parse(mensagem.data) as SinalDeVida);
      } catch {
        // Um sinal malformado não importa: o próximo chega em instantes.
      }
    });
  }

  private agendarReabertura(id: string): void {
    this.cancelarReabertura(id);
    this.reaberturas.set(
      id,
      setTimeout(() => {
        this.reaberturas.delete(id);
        if (this.fontes.has(id)) {
          this.abrir(id);
        }
      }, ESPERA_PARA_REABRIR_MS),
    );
  }

  private cancelarReabertura(id: string): void {
    const agendada = this.reaberturas.get(id);
    if (agendada !== undefined) {
      clearTimeout(agendada);
      this.reaberturas.delete(id);
    }
  }

  private fechar(id: string): void {
    this.cancelarReabertura(id);
    this.fontes.get(id)?.close();
    this.fontes.delete(id);
  }
}
