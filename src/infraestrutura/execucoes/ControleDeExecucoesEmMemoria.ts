import { ControleDeExecucoes } from "../../orquestracao/ControleDeExecucoes";

export class ControleDeExecucoesEmMemoria implements ControleDeExecucoes {
  private readonly emAndamento = new Map<string, AbortController>();

  iniciar(orquestradorId: string): AbortSignal {
    const controle = new AbortController();
    this.emAndamento.set(orquestradorId, controle);
    return controle.signal;
  }

  cancelar(orquestradorId: string): boolean {
    const controle = this.emAndamento.get(orquestradorId);
    if (controle === undefined) {
      return false;
    }
    controle.abort();
    return true;
  }

  encerrar(orquestradorId: string): void {
    this.emAndamento.delete(orquestradorId);
  }

  /** Usado ao desligar o servidor, para não deixar processos do Claude Code órfãos. */
  cancelarTodas(): number {
    const total = this.emAndamento.size;
    for (const controle of this.emAndamento.values()) {
      controle.abort();
    }
    return total;
  }
}
