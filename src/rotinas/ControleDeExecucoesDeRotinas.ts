import { ExecucaoDaRotina } from "./ExecucaoDaRotina";

interface ExecucaoViva {
  /** A instância que o condutor altera: cancelar e interromper mexem nela, não numa cópia do repositório. */
  execucao: ExecucaoDaRotina;
  controlador: AbortController;
  conclusao: Promise<void>;
}

/**
 * Registro das execuções que estão rodando agora neste processo: a instância
 * viva de cada uma e o sinal que a aborta. É o único estado em memória das
 * Rotinas; fica fora do serviço, que não guarda estado.
 *
 * Execução que espera aprovação não está aqui: ninguém a conduz até o usuário
 * decidir.
 */
export class ControleDeExecucoesDeRotinas {
  private readonly vivas = new Map<string, ExecucaoViva>();

  /**
   * Passa a conduzir a execução com `tarefa`. A tarefa começa logo, mas só
   * depois deste método voltar. Uma falha dela é registrada e não escapa.
   */
  iniciar(execucao: ExecucaoDaRotina, tarefa: (sinal: AbortSignal) => Promise<void>): void {
    const controlador = new AbortController();
    const viva: ExecucaoViva = { execucao, controlador, conclusao: Promise.resolve() };
    this.vivas.set(execucao.id, viva);
    viva.conclusao = Promise.resolve()
      .then(() => tarefa(controlador.signal))
      .catch((erro: unknown) => {
        console.error(`[rotinas] Falha ao conduzir a execução "${execucao.id}":`, erro);
      })
      .finally(() => {
        if (this.vivas.get(execucao.id) === viva) {
          this.vivas.delete(execucao.id);
        }
      });
  }

  buscar(execucaoId: string): ExecucaoDaRotina | null {
    return this.vivas.get(execucaoId)?.execucao ?? null;
  }

  daRotina(rotinaId: string): readonly ExecucaoDaRotina[] {
    return this.todas().filter((execucao) => execucao.rotinaId === rotinaId);
  }

  todas(): readonly ExecucaoDaRotina[] {
    return [...this.vivas.values()].map((viva) => viva.execucao);
  }

  /** Aborta o sinal da execução; ela sai do registro quando o condutor terminar. */
  abortar(execucaoId: string): void {
    this.vivas.get(execucaoId)?.controlador.abort();
  }

  /** Resolve quando todos os condutores que rodam agora tiverem terminado. */
  async aguardarTodas(): Promise<void> {
    await Promise.all([...this.vivas.values()].map((viva) => viva.conclusao));
  }
}
