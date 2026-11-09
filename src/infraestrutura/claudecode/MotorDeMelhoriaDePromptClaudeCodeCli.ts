import { tmpdir } from "node:os";
import path from "node:path";

import type {
  MotorDeMelhoriaDePrompt,
  PedidoAoMotorDeMelhoria,
  ResultadoDoMotorDeMelhoria,
} from "../../prompts/MotorDeMelhoriaDePrompt";
import {
  ChamadaCurtaDoClaudeCode,
  montarAmbienteDaChamadaCurta,
  montarArgumentosDaChamadaCurta,
} from "./ChamadaCurtaDoClaudeCode";
import { FachadaClaudeCodeCli } from "./FachadaClaudeCodeCli";

// O consumo do `result` é calculado no núcleo das chamadas curtas.
export { usoDoResultado } from "./ChamadaCurtaDoClaudeCode";

/** Dono dos processos da melhoria de prompt no registro de processos (não é um Orquestrador). */
export const DONO_DOS_PROCESSOS_DA_MELHORIA = "melhoria-de-prompt";

/** O modelo mais barato: a reescrita é curta e não usa ferramentas. */
export const MODELO_DA_MELHORIA = "haiku";

/**
 * Linha de comando do `claude -p` para melhorar um pedido: a da chamada curta
 * (Haiku, esforço baixo, sem ferramentas, MCP, skills nem sessão gravada,
 * pedido pelo stdin). Ver `montarArgumentosDaChamadaCurta`.
 */
export function montarArgumentosDaMelhoria(arquivoDeInstrucoes: string): string[] {
  return montarArgumentosDaChamadaCurta(MODELO_DA_MELHORIA, arquivoDeInstrucoes);
}

/**
 * Ambiente do processo: o da chamada curta, sem a sessão pai, sem
 * `CLAUDE_CODE_EFFORT_LEVEL` e sem CLAUDE.md nem memória automática (as regras
 * pessoais do usuário viravam requisitos inventados no pedido reescrito). Ver
 * `montarAmbienteDaChamadaCurta`.
 */
export function montarAmbienteDaMelhoria(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return montarAmbienteDaChamadaCurta(base);
}

/**
 * `MotorDeMelhoriaDePrompt` sobre o Claude Code: uma chamada curta (um
 * processo `claude -p` por pedido, com o login da assinatura do usuário),
 * numa pasta temporária própria que guarda o arquivo da instrução e é apagada
 * ao final. O processo entra no registro de processos como os turnos.
 */
export class MotorDeMelhoriaDePromptClaudeCodeCli implements MotorDeMelhoriaDePrompt {
  private readonly chamada: ChamadaCurtaDoClaudeCode;

  constructor(
    fachada: FachadaClaudeCodeCli,
    ambienteBase: NodeJS.ProcessEnv = process.env,
    pastaBase: string = path.join(tmpdir(), "orquestrador-melhoria-de-prompt"),
  ) {
    this.chamada = new ChamadaCurtaDoClaudeCode(
      fachada,
      {
        modelo: MODELO_DA_MELHORIA,
        dono: DONO_DOS_PROCESSOS_DA_MELHORIA,
        pastaBase,
        mensagens: { resultadoEsperado: "o pedido melhorado", tarefa: "melhorar o pedido" },
      },
      ambienteBase,
    );
  }

  melhorar(pedido: PedidoAoMotorDeMelhoria, sinal: AbortSignal): Promise<ResultadoDoMotorDeMelhoria> {
    return this.chamada.executar({ texto: pedido.texto, instrucoes: pedido.instrucoes }, sinal);
  }
}
