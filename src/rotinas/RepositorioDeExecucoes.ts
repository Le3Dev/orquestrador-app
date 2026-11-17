import { ExecucaoDaRotina } from "./ExecucaoDaRotina";

/**
 * Porta: onde as execuções das Rotinas ficam guardadas. Quem busca recebe
 * sempre uma cópia: alterá-la só vale depois de `salvarExecucao`. Só as
 * últimas execuções de cada Rotina são guardadas; as ativas nunca saem.
 */
export interface RepositorioDeExecucoes {
  /** Da mais recente para a mais antiga. */
  daRotina(rotinaId: string): readonly ExecucaoDaRotina[];
  buscarExecucao(id: string): ExecucaoDaRotina | null;
  /** A execução da Rotina que roda ou espera aprovação (há no máximo uma). */
  ativaDaRotina(rotinaId: string): ExecucaoDaRotina | null;
  /** De todas as Rotinas: as que rodam e as que esperam aprovação. */
  ativas(): readonly ExecucaoDaRotina[];
  /** Execução de uma Rotina que já não existe é ignorada. */
  salvarExecucao(execucao: ExecucaoDaRotina): Promise<void>;
}
