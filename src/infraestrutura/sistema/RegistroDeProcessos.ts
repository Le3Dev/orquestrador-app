import { readFileSync, writeFileSync } from "node:fs";

import { CongeladorDeProcessos } from "../execucoes/ControleDeExecucoesEmMemoria";
import { descendentesVivos, ProcessoNaArvore } from "./ArvoreDeProcessos";
import { encerrarArvore, identidadeDoProcesso, listarArvore, sinalizarGrupo } from "./Processos";

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
 * Quantas vezes, no máximo, `congelar` relê a árvore atrás de um grupo novo de
 * descendentes (um comando que abriu outro entre a leitura e o SIGSTOP).
 */
export const VOLTAS_DA_BUSCA_DE_GRUPOS = 5;

export interface DependenciasDoRegistro {
  /** Lista os processos da máquina; padrão: `listarArvore`. */
  listar?: () => Promise<ProcessoNaArvore[]>;
  /** Manda o sinal a um grupo; padrão: `sinalizarGrupo`. */
  sinalizar?: (grupo: number, sinal: "SIGSTOP" | "SIGCONT") => boolean;
  /** Processos cujo grupo nunca é congelado; padrão: o servidor e quem o iniciou (o Electron). */
  protegidos?: readonly number[];
}

/** O que `congelar` parou num Orquestrador (ver ADR-51). */
interface Congelamento {
  /** Os grupos dos processos do registro (Claude Code, Codex, Copilot), cada um líder do próprio. */
  lideres: Set<number>;
  /**
   * Os grupos próprios dos descendentes deles: o Claude Code abre o shell de
   * cada `Bash` numa sessão e num grupo novos, fora do SIGSTOP do grupo dele.
   */
  descendentes: Set<number>;
}

/**
 * Os processos `claude.exe` que este servidor iniciou e ainda estão rodando.
 *
 * Gravado em disco a cada mudança: se o servidor cair de repente, os
 * processos continuam vivos (no Windows, filhos não morrem com o pai) e o
 * próximo servidor precisa saber quais eram para encerrá-los.
 */
export class RegistroDeProcessos implements CongeladorDeProcessos {
  private readonly processos = new Map<number, ProcessoDeAgente>();
  /**
   * Os grupos congelados (SIGSTOP) de cada Orquestrador pausado (ver ADR-51).
   * Guardados à parte do registro: um processo que termina sai dele, mas o
   * grupo pode seguir com filhos parados, que precisam do SIGCONT.
   */
  private readonly congelados = new Map<string, Congelamento>();
  private readonly listar: () => Promise<ProcessoNaArvore[]>;
  private readonly sinalizar: (grupo: number, sinal: "SIGSTOP" | "SIGCONT") => boolean;
  private readonly protegidos: ReadonlySet<number>;

  constructor(
    private readonly arquivo: string | null = null,
    dependencias: DependenciasDoRegistro = {},
  ) {
    this.listar = dependencias.listar ?? listarArvore;
    this.sinalizar = dependencias.sinalizar ?? sinalizarGrupo;
    this.protegidos = new Set(dependencias.protegidos ?? [process.pid, process.ppid]);
    this.gravar();
  }

  registrar(processo: ProcessoDeAgente): void {
    this.processos.set(processo.pid, processo);
    this.gravar();
    // Nasceu durante a pausa (ex.: uma subtarefa que o app já estava abrindo): congela junto.
    const congelamento = this.congelados.get(processo.orquestradorId);
    if (congelamento !== undefined && this.sinalizar(processo.pid, "SIGSTOP")) {
      congelamento.lideres.add(processo.pid);
      void this.congelarDescendentes(processo.orquestradorId, congelamento);
    }
  }

  /**
   * Congela os grupos de processos de um Orquestrador: primeiro o do agente do
   * turno e os de outros motores que o app abriu para ele, cada um líder do
   * próprio grupo; logo depois, em segundo plano, os grupos próprios dos
   * descendentes deles (ver `congelarDescendentes`).
   * Falso se não havia nenhum vivo (ou no Windows): a pausa vira retomada.
   */
  congelar(orquestradorId: string): boolean {
    const congelamento = this.congelados.get(orquestradorId) ?? { lideres: new Set(), descendentes: new Set() };
    for (const processo of this.processos.values()) {
      if (processo.orquestradorId === orquestradorId && this.sinalizar(processo.pid, "SIGSTOP")) {
        congelamento.lideres.add(processo.pid);
      }
    }
    if (congelamento.lideres.size === 0) {
      return false;
    }
    this.congelados.set(orquestradorId, congelamento);
    void this.congelarDescendentes(orquestradorId, congelamento);
    return true;
  }

  /**
   * Descongela (SIGCONT) o que `congelar` parou, os descendentes antes dos
   * líderes; falso se nada estava congelado. Grupos que já terminaram são ignorados.
   */
  descongelar(orquestradorId: string): boolean {
    const congelamento = this.congelados.get(orquestradorId);
    if (congelamento === undefined) {
      return false;
    }
    this.congelados.delete(orquestradorId);
    for (const grupo of [...congelamento.descendentes, ...congelamento.lideres]) {
      this.sinalizar(grupo, "SIGCONT");
    }
    return true;
  }

  /**
   * SIGSTOP nos grupos próprios dos descendentes dos líderes congelados (os
   * shells dos `Bash` do Claude Code, que nascem em sessão própria). Relê a
   * árvore até não aparecer grupo novo, no máximo `VOLTAS_DA_BUSCA_DE_GRUPOS`
   * vezes. Nunca sinaliza o grupo do servidor nem o do Electron (`protegidos`)
   * nem os grupos 0 e 1. Para se o Orquestrador for descongelado no meio.
   */
  private async congelarDescendentes(orquestradorId: string, congelamento: Congelamento): Promise<void> {
    const vistos = new Map<number, ProcessoNaArvore>();
    for (let volta = 0; volta < VOLTAS_DA_BUSCA_DE_GRUPOS; volta++) {
      let arvore: ProcessoNaArvore[];
      try {
        arvore = await this.listar();
      } catch (erro) {
        console.warn("[processos] Não foi possível ler os processos para congelar os comandos dos agentes:", erro);
        return;
      }
      // Descongelado enquanto a árvore era lida: nada mais a congelar.
      if (this.congelados.get(orquestradorId) !== congelamento) {
        return;
      }
      const gruposProtegidos = new Set(
        arvore.filter((processo) => this.protegidos.has(processo.pid)).map((processo) => processo.grupo),
      );
      let novos = 0;
      for (const processo of this.processos.values()) {
        const raiz = arvore.find((vivo) => vivo.pid === processo.pid);
        if (processo.orquestradorId !== orquestradorId || !congelamento.lideres.has(processo.pid) || raiz === undefined) {
          continue;
        }
        const descendentes = descendentesVivos({
          raiz,
          arvore,
          vistos: [...vistos.values()],
          protegidos: this.protegidos,
          adocao: null,
        });
        for (const descendente of descendentes) {
          vistos.set(descendente.pid, descendente);
          const grupo = descendente.grupo;
          if (
            grupo === null ||
            grupo <= 1 ||
            gruposProtegidos.has(grupo) ||
            congelamento.lideres.has(grupo) ||
            congelamento.descendentes.has(grupo)
          ) {
            continue;
          }
          if (this.sinalizar(grupo, "SIGSTOP")) {
            congelamento.descendentes.add(grupo);
            novos += 1;
          }
        }
      }
      if (novos === 0) {
        return;
      }
    }
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
  return LINHA_DO_CODEX_DO_APP.test(linhaDeComando) || LINHA_DO_COPILOT_DO_APP.test(linhaDeComando);
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
