/** Um processo lançado (direta ou indiretamente) pelo Claude de um turno. */
export interface ProcessoFilho {
  pid: number;
  comando: string;
  /** % de CPU no momento do diagnóstico. */
  cpu: number;
  /** Há quanto tempo o processo está rodando. */
  haMs: number;
}

/**
 * Retrato do Claude de um turno que ficou em silêncio: se ele ainda vive, se
 * está ocupado (dele ou de um comando que lançou) e se as transcrições da
 * sessão continuam crescendo. Com isso o serviço distingue "trabalhando
 * calado" (um `npm test` longo) de "travado".
 */
export interface DiagnosticoDoClaude {
  processoVivo: boolean;
  /** % de CPU do processo do Claude (só ele). */
  cpuDoClaude: number;
  /** Descendentes do processo do Claude, do mais ocupado ao menos. `comando` encurtado (até ~80 caracteres, sem caminhos longos de node_modules). */
  filhos: ProcessoFilho[];
  /** Tamanho ou data das transcrições da sessão e dos subagentes mudou desde o diagnóstico anterior do mesmo alvo. */
  transcricoesCrescendo: boolean;
  /** ISO da escrita mais recente nas transcrições; nulo se não achou nenhuma. */
  ultimaEscritaEm: string | null;
}

export interface AlvoDoDiagnostico {
  orquestradorId: string;
  sessaoId: string;
  /** Pasta onde o turno roda (o worktree, se houver): é ela que nomeia as transcrições. */
  pastaDoTurno: string;
}

/**
 * Porta do domínio: examina o Claude de um turno no sistema operacional.
 * Nunca lança; o que não der para saber vem com valores neutros.
 */
export interface DiagnosticadorDoClaude {
  diagnosticar(alvo: AlvoDoDiagnostico): Promise<DiagnosticoDoClaude>;
  /** Esquece o estado guardado do alvo (tamanhos anteriores) ao fim do turno. */
  esquecer(orquestradorId: string): void;
}
