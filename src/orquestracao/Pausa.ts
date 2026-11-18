/**
 * Como o Orquestrador está pausado (ver ADR-51):
 * - `congelado`: os processos do turno estão parados (SIGSTOP) e o turno
 *   segue em andamento; continuar (SIGCONT) segue exatamente de onde parou;
 * - `retomada`: não há processo vivo para continuar (Windows, app fechado,
 *   processo morto durante a pausa). O turno terminou `pausado`, e continuar
 *   abre um turno novo na mesma sessão, com `mensagemDeContinuacao`.
 */
export type ModoDaPausa = "congelado" | "retomada";

export interface DadosDaPausa {
  /** ISO: quando o usuário pausou. */
  desde: string;
  modo: ModoDaPausa;
}

export function ehDadosDaPausa(valor: unknown): valor is DadosDaPausa {
  if (typeof valor !== "object" || valor === null) {
    return false;
  }
  const { desde, modo } = valor as Record<string, unknown>;
  return typeof desde === "string" && (modo === "congelado" || modo === "retomada");
}

/**
 * A mensagem do turno que continua uma pausa no modo `retomada`, na mesma
 * sessão. Como a da autorrecuperação (`mensagemDeRetomada`), não pede para
 * desfazer nada.
 */
export function mensagemDeContinuacao(comWorktree: boolean): string {
  const onde = comWorktree ? "da worktree" : "da pasta de trabalho";
  return (
    `Você foi pausado pelo usuário no meio do trabalho. Confira o estado atual ${onde}, sem desfazer nada, ` +
    "e continue de onde parou. Se já estiver concluído, apenas resuma."
  );
}
