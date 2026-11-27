import { readFileSync, writeFileSync } from "node:fs";

import { encerrarArvore, identidadeDoProcesso } from "./Processos";

export interface ProcessoDeAgente {
  pid: number;
  orquestradorId: string;
  sessaoId: string;
  iniciadoEm: string;
}

function ehProcessoDeAgente(valor: unknown): valor is ProcessoDeAgente {
  if (typeof valor !== "object" || valor === null) {
    return false;
  }
  const { pid, orquestradorId, sessaoId } = valor as Record<string, unknown>;
  return typeof pid === "number" && typeof orquestradorId === "string" && typeof sessaoId === "string";
}

/**
 * Os processos `claude.exe` que este servidor iniciou e ainda estão rodando.
 *
 * Gravado em disco a cada mudança: se o servidor cair de repente, os
 * processos continuam vivos (no Windows, filhos não morrem com o pai) e o
 * próximo servidor precisa saber quais eram para encerrá-los.
 */
export class RegistroDeProcessos {
  private readonly processos = new Map<number, ProcessoDeAgente>();

  constructor(private readonly arquivo: string | null = null) {
    this.gravar();
  }

  registrar(processo: ProcessoDeAgente): void {
    this.processos.set(processo.pid, processo);
    this.gravar();
  }

  remover(pid: number): void {
    if (this.processos.delete(pid)) {
      this.gravar();
    }
  }

  emExecucao(): ProcessoDeAgente[] {
    return [...this.processos.values()];
  }

  static lerArquivo(arquivo: string): ProcessoDeAgente[] {
    try {
      const conteudo: unknown = JSON.parse(readFileSync(arquivo, "utf8"));
      return Array.isArray(conteudo) ? conteudo.filter(ehProcessoDeAgente) : [];
    } catch {
      return [];
    }
  }

  private gravar(): void {
    if (this.arquivo === null) {
      return;
    }
    try {
      writeFileSync(this.arquivo, JSON.stringify(this.emExecucao(), null, 2), "utf8");
    } catch (erro) {
      console.warn("[processos] Não foi possível gravar a lista de processos:", erro);
    }
  }
}

/**
 * O quanto o processo vivo pode ter nascido longe da hora em que o servidor o
 * registrou (`iniciadoEm`, logo depois de iniciá-lo): o Codex e o Copilot, que
 * o app inicia, não levam a sessão na linha de comando.
 */
export const TOLERANCIA_DA_CRIACAO_EM_MS = 15_000;

/** `codex … app-server`: o Codex pelo protocolo dele (`MotorCodex`). Qualquer caminho, `.exe`, `.cmd` ou `.js`. */
const LINHA_DO_CODEX_DO_APP = /\bcodex\b[\s\S]*\bapp-server\b/i;
/** `copilot … --acp`: o GitHub Copilot CLI como servidor ACP (`MotorAcp`). */
const LINHA_DO_COPILOT_DO_APP = /\bcopilot\b[\s\S]*--acp\b/i;
/** `gemini … --acp`: o Gemini CLI como servidor ACP (`MotorAcp`); o CLI é Node, então a linha leva `node …\gemini.js --acp`. */
const LINHA_DO_GEMINI_DO_APP = /\bgemini\b[\s\S]*--acp\b/i;

/**
 * O Codex (`app-server`) e o Copilot (`--acp`) que o app iniciou: a linha de
 * comando sozinha não prova (o app do usuário no VS Code, um editor com
 * Copilot, rodam o mesmo comando), então também se confere que o processo
 * nasceu na hora em que o app o registrou. Sem a hora de criação, não é nosso.
 */
function ehCliDeOutroMotorDeixadoPorNos(
  processo: ProcessoDeAgente,
  linhaDeComando: string,
  criadoEm: Date | null,
): boolean {
  if (criadoEm === null) {
    return false;
  }
  const registrado = Date.parse(processo.iniciadoEm);
  if (!Number.isFinite(registrado) || Math.abs(criadoEm.getTime() - registrado) > TOLERANCIA_DA_CRIACAO_EM_MS) {
    return false;
  }
  return (
    LINHA_DO_CODEX_DO_APP.test(linhaDeComando) ||
    LINHA_DO_COPILOT_DO_APP.test(linhaDeComando) ||
    LINHA_DO_GEMINI_DO_APP.test(linhaDeComando)
  );
}

/**
 * Só é nosso se o processo ainda for um agente desta sessão. O Windows
 * reaproveita PIDs: sem essa conferência, poderíamos derrubar outro programa —
 * inclusive uma sessão do Claude Code, do Codex ou do Copilot do próprio usuário.
 * - Claude Code: a linha de comando leva a sessão (`sessaoId`) e `stream-json`.
 * - Codex (`app-server`) e Copilot (`--acp`): a linha de comando e a hora de
 *   criação perto da do registro (`criadoEm`; sem ela, nunca é nosso).
 */
export function ehAgenteDeixadoPorNos(
  processo: ProcessoDeAgente,
  linhaDeComando: string | null,
  criadoEm: Date | null = null,
): boolean {
  if (linhaDeComando === null) {
    return false;
  }
  if (linhaDeComando.includes(processo.sessaoId) && linhaDeComando.includes("stream-json")) {
    return true;
  }
  return ehCliDeOutroMotorDeixadoPorNos(processo, linhaDeComando, criadoEm);
}

/**
 * Ao subir, encerra os agentes (Claude Code, Codex e Copilot) que ficaram
 * rodando depois que o servidor anterior caiu: sem ninguém para ouvi-los, só
 * gastariam memória e cota. Devolve quantos foram encerrados.
 */
export async function encerrarAgentesOrfaos(arquivo: string): Promise<number> {
  let encerrados = 0;
  for (const processo of RegistroDeProcessos.lerArquivo(arquivo)) {
    const identidade = await identidadeDoProcesso(processo.pid);
    if (identidade !== null && ehAgenteDeixadoPorNos(processo, identidade.linhaDeComando, identidade.criadoEm)) {
      encerrarArvore(processo.pid);
      encerrados += 1;
    }
  }
  return encerrados;
}
