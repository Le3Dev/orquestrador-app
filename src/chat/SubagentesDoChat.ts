import type { ModeloDoSubagentePronto } from "../orquestracao/SubagentesProntos";

/**
 * Um subagente pronto como o chat o enxerga: sem o prompt, para não pesar no
 * bloco de contexto de cada pergunta.
 */
export interface SubagenteDoChat {
  nome: string;
  descricao: string;
  modelo: ModeloDoSubagentePronto;
}

/**
 * A biblioteca de subagentes prontos, para o Claude saber quais existem antes
 * de sugerir criar ou editar um.
 *
 * Porta: o contexto `chat` não conhece as preferências globais — quem traduz
 * é o adaptador montado em `root.ts`.
 */
export interface SubagentesDoChat {
  listarSubagentesProntos(): Promise<SubagenteDoChat[]>;
}
