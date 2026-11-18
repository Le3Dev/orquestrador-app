import type { ZodRawShape } from "zod";

/** Quem está chamando: o turno registrado em `ServidorMcpDoApp.registrarTurno`. */
export interface ContextoDoTurnoMcp {
  readonly orquestradorId: string;
}

export interface ContextoDaFerramenta extends ContextoDoTurnoMcp {
  /** Aborta quando o agente cancela a chamada, a conexão cai ou o turno termina. */
  readonly sinal: AbortSignal;
}

export type ConteudoDaFerramenta =
  | { readonly tipo: "texto"; readonly texto: string }
  | { readonly tipo: "imagem"; readonly base64: string; readonly tipoDeMidia: string };

export interface ResultadoDaFerramenta {
  readonly conteudo: readonly ConteudoDaFerramenta[];
  /** Verdadeiro quando a ferramenta falhou: o agente lê o conteúdo como a mensagem de erro. */
  readonly erro?: boolean;
}

/**
 * Uma ferramenta que o servidor MCP oferece ao agente. O nome aparece para o
 * Claude Code como `mcp__orquestrador__<nome>`.
 */
export interface FerramentaMcp {
  readonly nome: string;
  /** Descrição curta, em português: é o que o modelo lê para decidir usar a ferramenta. */
  readonly descricao: string;
  /** Os campos de entrada, como esquema zod (o SDK os valida antes de chamar `executar`). */
  readonly entrada: ZodRawShape;
  executar(argumentos: Readonly<Record<string, unknown>>, contexto: ContextoDaFerramenta): Promise<ResultadoDaFerramenta>;
}

/**
 * Um conjunto de ferramentas que um turno liga ou desliga de uma vez
 * (ex.: `navegador`, `delegar_subtarefas`). Registrado em
 * `ServidorMcpDoApp.registrarGrupoDeFerramentas(nome, grupo)`.
 */
export interface GrupoDeFerramentasMcp {
  readonly ferramentas: readonly FerramentaMcp[];
}
