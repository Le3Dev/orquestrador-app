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
 * A conexão de eventos dos terminais abertos: uma só para todos os
 * Orquestradores, recriada quando um terminal entra ou sai do canvas.
 *
 * Uma só, e não uma por terminal, porque o navegador abre no máximo 6
 * conexões HTTP/1.1 com o mesmo servidor e cada uma destas fica aberta para
 * sempre: com 4 terminais, mais o chat e os artefatos, nenhum outro pedido da
 * tela saía da fila e o app parecia travado.
 *
 * Quando a conexão cai, ela é fechada e recriada aqui a partir do último
 * evento de cada terminal (a reconexão do próprio navegador repetiria o
 * endereço antigo e reenviaria histórico que a tela já tem).
 */
export class ConexoesDeEventos {
  private ids: ReadonlySet<string> = new Set();
  private fonte: FonteDeEventos | null = null;
  private reabertura: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly ouvintes: OuvintesDasConexoes,
    private readonly criarFonte: (endereco: string) => FonteDeEventos = (endereco) => new EventSource(endereco),
  ) {}

  /** Acompanha exatamente estes terminais; sem mudança no conjunto, não mexe na conexão. */
  sincronizar(ids: ReadonlySet<string>): void {
    const sairam = [...this.ids].filter((id) => !ids.has(id));
    const entraram = [...ids].some((id) => !this.ids.has(id));
    if (sairam.length === 0 && !entraram) {
      return;
    }
    this.ids = new Set(ids);
    for (const id of sairam) {
      this.ouvintes.aoMudarSituacao(id, null);
    }
    if (this.ids.size === 0) {
      this.fechar();
    } else {
      this.abrir();
    }
  }

  /** O servidor voltou: se a conexão caiu, reabre na hora em vez de esperar. */
  reabrirAbandonadas(): void {
    if (this.ids.size > 0 && (this.fonte === null || this.fonte.readyState === FECHADA)) {
      this.abrir();
    }
  }

  fecharTodas(): void {
    this.fechar();
    this.ids = new Set();
  }

  private abrir(): void {
    this.fechar();

    const desdePorId = new Map([...this.ids].map((id) => [id, this.ouvintes.ultimaSequencia(id)] as const));
    const fonte = this.criarFonte(api.enderecoDosEventos(desdePorId));
    this.fonte = fonte;
    this.avisarTodos("conectando");

    fonte.onopen = () => {
      if (this.fonte === fonte) {
        this.avisarTodos("conectado");
      }
    };
    fonte.onerror = () => {
      if (this.fonte !== fonte) {
        return;
      }
      this.avisarTodos("reconectando");
      fonte.close();
      this.agendarReabertura();
    };
    fonte.onmessage = (mensagem) => {
      try {
        const { orquestradorId, evento } = JSON.parse(mensagem.data) as {
          orquestradorId: string;
          evento: EventoRegistrado;
        };
        if (this.fonte === fonte && this.ids.has(orquestradorId)) {
          this.ouvintes.aoReceber(orquestradorId, evento);
        }
      } catch (erro) {
        console.error("Evento inválido recebido do servidor:", erro);
      }
    };
    fonte.addEventListener("sinal", (mensagem) => {
      try {
        const { orquestradorId, sinal } = JSON.parse(mensagem.data) as { orquestradorId: string; sinal: SinalDeVida };
        if (this.fonte === fonte && this.ids.has(orquestradorId)) {
          this.ouvintes.aoSinal(orquestradorId, sinal);
        }
      } catch {
        // Um sinal malformado não importa: o próximo chega em instantes.
      }
    });
  }

  private avisarTodos(situacao: SituacaoDaConexao): void {
    for (const id of this.ids) {
      this.ouvintes.aoMudarSituacao(id, situacao);
    }
  }

  private agendarReabertura(): void {
    this.cancelarReabertura();
    this.reabertura = setTimeout(() => {
      this.reabertura = null;
      if (this.ids.size > 0) {
        this.abrir();
      }
    }, ESPERA_PARA_REABRIR_MS);
  }

  private cancelarReabertura(): void {
    if (this.reabertura !== null) {
      clearTimeout(this.reabertura);
      this.reabertura = null;
    }
  }

  private fechar(): void {
    this.cancelarReabertura();
    this.fonte?.close();
    this.fonte = null;
  }
}
