import { ControleDeExecucoes, MotivoDoCancelamento } from "../../orquestracao/ControleDeExecucoes";

/**
 * Quem congela e descongela os processos de um Orquestrador (o registro dos
 * processos, ver ADR-49). Sem ele, nada é congelado e a pausa vira retomada.
 */
export interface CongeladorDeProcessos {
  congelar(orquestradorId: string): boolean;
  descongelar(orquestradorId: string): boolean;
}

export class ControleDeExecucoesEmMemoria implements ControleDeExecucoes {
  private readonly emAndamento = new Map<string, AbortController>();

  constructor(private readonly congelador: CongeladorDeProcessos | null = null) {}

  iniciar(orquestradorId: string): AbortSignal {
    const controle = new AbortController();
    this.emAndamento.set(orquestradorId, controle);
    return controle.signal;
  }

  cancelar(orquestradorId: string, motivo?: MotivoDoCancelamento): boolean {
    const controle = this.emAndamento.get(orquestradorId);
    if (controle === undefined) {
      return false;
    }
    // Um processo congelado não trata o pedido de parada: continua antes.
    this.descongelar(orquestradorId);
    // O motivo vira o `reason` do sinal: é por ele que o motor e o serviço
    // distinguem o silêncio (ADR-36) de um cancelamento do usuário.
    if (motivo === undefined) {
      controle.abort();
    } else {
      controle.abort(motivo);
    }
    return true;
  }

  encerrar(orquestradorId: string): void {
    this.emAndamento.delete(orquestradorId);
  }

  congelar(orquestradorId: string): boolean {
    if (!this.emAndamento.has(orquestradorId)) {
      return false;
    }
    return this.congelador?.congelar(orquestradorId) ?? false;
  }

  descongelar(orquestradorId: string): boolean {
    return this.congelador?.descongelar(orquestradorId) ?? false;
  }

  /** Usado ao desligar o servidor, para não deixar processos do Claude Code órfãos. */
  cancelarTodas(): number {
    const total = this.emAndamento.size;
    for (const [orquestradorId, controle] of this.emAndamento) {
      this.descongelar(orquestradorId);
      controle.abort();
    }
    return total;
  }
}
