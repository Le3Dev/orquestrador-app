import { readFileSync, writeFileSync } from "node:fs";

import { encerrarArvore, linhaDeComandoDe } from "./Processos";

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
 * Só é nosso se a linha de comando ainda for a de um agente desta sessão.
 * O Windows reaproveita PIDs: sem essa conferência, poderíamos derrubar outro
 * programa — inclusive uma sessão do Claude Code do próprio usuário.
 */
export function ehAgenteDeixadoPorNos(processo: ProcessoDeAgente, linhaDeComando: string | null): boolean {
  return linhaDeComando !== null && linhaDeComando.includes(processo.sessaoId) && linhaDeComando.includes("stream-json");
}

/**
 * Ao subir, encerra os agentes que ficaram rodando depois que o servidor
 * anterior caiu: sem ninguém para ouvi-los, só gastariam memória e cota.
 * Devolve quantos foram encerrados.
 */
export async function encerrarAgentesOrfaos(arquivo: string): Promise<number> {
  let encerrados = 0;
  for (const processo of RegistroDeProcessos.lerArquivo(arquivo)) {
    if (ehAgenteDeixadoPorNos(processo, await linhaDeComandoDe(processo.pid))) {
      encerrarArvore(processo.pid);
      encerrados += 1;
    }
  }
  return encerrados;
}
