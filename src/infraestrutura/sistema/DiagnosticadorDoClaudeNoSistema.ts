import { stat } from "node:fs/promises";
import path from "node:path";

import {
  AlvoDoDiagnostico,
  DiagnosticadorDoClaude,
  DiagnosticoDoClaude,
  ProcessoFilho,
} from "../../orquestracao/DiagnosticoDoClaude";
import { localizarTranscricoes, pastaDoClaude } from "../claudecode/TranscricoesDoClaudeCode";
import { listarProcessos, ProcessoListado } from "./Processos";
import { RegistroDeProcessos } from "./RegistroDeProcessos";

/** No primeiro diagnóstico de um alvo, sem tamanhos anteriores: "crescendo" se alguém escreveu há menos disto. */
const ESCRITA_RECENTE_MS = 60_000;

const TAMANHO_DO_COMANDO = 80;

export interface OpcoesDoDiagnosticador {
  /** Todos os processos da máquina (padrão: `ps`); `null` onde o sistema não deixa ver. */
  listarProcessos?: () => Promise<ProcessoListado[] | null>;
  /** Pasta de configuração do Claude Code, onde ficam as transcrições (padrão: `~/.claude`). */
  pastaDoClaude?: string;
  /** Se o pid existe (padrão: `process.kill(pid, 0)`). */
  processoExiste?: (pid: number) => boolean;
  agora?: () => number;
}

function existePeloSinal(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (erro) {
    // EPERM: existe, mas é de outro usuário.
    return (erro as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Um trecho da linha de comando que é caminho absoluto ou passa por `node_modules`. */
function ehCaminhoLongo(trecho: string): boolean {
  return /node_modules/.test(trecho) || /^(?:\/|[A-Za-z]:\\)/.test(trecho);
}

/**
 * Linha de comando curta para a tela: caminhos absolutos e de `node_modules`
 * viram só o nome do arquivo (`/…/node_modules/.bin/vitest run` → `vitest
 * run`), e o todo é cortado em ~80 caracteres.
 */
export function encurtarComando(comando: string): string {
  const curto = comando
    .trim()
    .split(/\s+/)
    .map((trecho) => (ehCaminhoLongo(trecho) ? path.basename(trecho.replace(/\\/g, "/")) || trecho : trecho))
    .join(" ");
  return curto.length <= TAMANHO_DO_COMANDO ? curto : `${curto.slice(0, TAMANHO_DO_COMANDO - 1)}…`;
}

/** Descendentes de `pid` (filhos, netos…), na ordem em que aparecem. */
function descendentes(pid: number, processos: readonly ProcessoListado[]): ProcessoListado[] {
  const porPai = new Map<number, ProcessoListado[]>();
  for (const processo of processos) {
    porPai.set(processo.ppid, [...(porPai.get(processo.ppid) ?? []), processo]);
  }
  const encontrados: ProcessoListado[] = [];
  const vistos = new Set<number>([pid]);
  const fila = [pid];
  while (fila.length > 0) {
    for (const filho of porPai.get(fila.shift() as number) ?? []) {
      if (!vistos.has(filho.pid)) {
        vistos.add(filho.pid);
        encontrados.push(filho);
        fila.push(filho.pid);
      }
    }
  }
  return encontrados;
}

/** Caminho → "tamanho:mtime" de cada transcrição, e a escrita mais recente. */
interface RetratoDasTranscricoes {
  marcas: Map<string, string>;
  ultimaEscritaMs: number | null;
}

/**
 * `DiagnosticadorDoClaude` sobre o sistema operacional: acha o processo do
 * Claude do Orquestrador no registro, lê a árvore e a CPU com um único `ps` e
 * compara o tamanho e a data das transcrições com o diagnóstico anterior.
 * Nunca lança: o que falhar vira valor neutro.
 */
export class DiagnosticadorDoClaudeNoSistema implements DiagnosticadorDoClaude {
  private readonly anteriores = new Map<string, Map<string, string>>();
  private readonly listar: () => Promise<ProcessoListado[] | null>;
  private readonly pastaDeConfiguracao: string;
  private readonly processoExiste: (pid: number) => boolean;
  private readonly agora: () => number;

  constructor(
    private readonly registro: RegistroDeProcessos,
    opcoes: OpcoesDoDiagnosticador = {},
  ) {
    this.listar = opcoes.listarProcessos ?? listarProcessos;
    this.pastaDeConfiguracao = opcoes.pastaDoClaude ?? pastaDoClaude();
    this.processoExiste = opcoes.processoExiste ?? existePeloSinal;
    this.agora = opcoes.agora ?? Date.now;
  }

  async diagnosticar(alvo: AlvoDoDiagnostico): Promise<DiagnosticoDoClaude> {
    try {
      const [processo, transcricoes] = await Promise.all([this.examinarProcesso(alvo), this.examinarTranscricoes(alvo)]);
      return { ...processo, ...transcricoes };
    } catch (erro) {
      console.warn("[diagnostico] Diagnóstico falhou:", erro instanceof Error ? erro.message : erro);
      return {
        processoVivo: false,
        processosConhecidos: true,
        cpuDoClaude: 0,
        filhos: [],
        transcricoesCrescendo: false,
        ultimaEscritaEm: null,
      };
    }
  }

  esquecer(orquestradorId: string): void {
    this.anteriores.delete(orquestradorId);
  }

  /** O pid do Claude do alvo: o da mesma sessão ou, sem ele, o mais recente do Orquestrador. */
  private pidDoClaude(alvo: AlvoDoDiagnostico): number | null {
    const doOrquestrador = this.registro.emExecucao().filter((processo) => processo.orquestradorId === alvo.orquestradorId);
    const daSessao = doOrquestrador.filter((processo) => processo.sessaoId === alvo.sessaoId);
    const candidatos = daSessao.length > 0 ? daSessao : doOrquestrador;
    const maisRecente = [...candidatos].sort((a, b) => b.iniciadoEm.localeCompare(a.iniciadoEm))[0];
    return maisRecente?.pid ?? null;
  }

  private async examinarProcesso(
    alvo: AlvoDoDiagnostico,
  ): Promise<Pick<DiagnosticoDoClaude, "processoVivo" | "processosConhecidos" | "cpuDoClaude" | "filhos">> {
    const pid = this.pidDoClaude(alvo);
    if (pid === null) {
      return { processoVivo: false, processosConhecidos: true, cpuDoClaude: 0, filhos: [] };
    }
    let processos: ProcessoListado[] = [];
    let processosConhecidos = true;
    try {
      const listados = await this.listar();
      processosConhecidos = listados !== null;
      processos = listados ?? [];
    } catch (erro) {
      console.warn("[diagnostico] Não foi possível listar os processos:", erro instanceof Error ? erro.message : erro);
    }
    const doClaude = processos.find((processo) => processo.pid === pid);
    let processoVivo = doClaude !== undefined;
    if (!processoVivo) {
      try {
        processoVivo = this.processoExiste(pid);
      } catch {
        processoVivo = false;
      }
    }
    const filhos: ProcessoFilho[] = descendentes(pid, processos)
      .sort((a, b) => b.cpu - a.cpu)
      .map((filho) => ({ pid: filho.pid, comando: encurtarComando(filho.comando), cpu: filho.cpu, haMs: filho.haMs }));
    return { processoVivo, processosConhecidos, cpuDoClaude: doClaude?.cpu ?? 0, filhos };
  }

  private async examinarTranscricoes(
    alvo: AlvoDoDiagnostico,
  ): Promise<Pick<DiagnosticoDoClaude, "transcricoesCrescendo" | "ultimaEscritaEm">> {
    const retrato = await this.retratar(alvo);
    const anterior = this.anteriores.get(alvo.orquestradorId);
    this.anteriores.set(alvo.orquestradorId, retrato.marcas);

    let transcricoesCrescendo: boolean;
    if (anterior === undefined) {
      transcricoesCrescendo =
        retrato.ultimaEscritaMs !== null && this.agora() - retrato.ultimaEscritaMs <= ESCRITA_RECENTE_MS;
    } else {
      transcricoesCrescendo = [...retrato.marcas].some(([caminho, marca]) => anterior.get(caminho) !== marca);
    }
    return {
      transcricoesCrescendo,
      ultimaEscritaEm: retrato.ultimaEscritaMs === null ? null : new Date(retrato.ultimaEscritaMs).toISOString(),
    };
  }

  private async retratar(alvo: AlvoDoDiagnostico): Promise<RetratoDasTranscricoes> {
    const marcas = new Map<string, string>();
    let ultimaEscritaMs: number | null = null;
    try {
      const arquivos = await localizarTranscricoes(alvo.pastaDoTurno, [alvo.sessaoId], this.pastaDeConfiguracao);
      const dados = await Promise.all(
        arquivos.map(async (arquivo) => {
          try {
            return { caminho: arquivo.caminho, info: await stat(arquivo.caminho) };
          } catch {
            return null;
          }
        }),
      );
      for (const dado of dados) {
        if (dado === null) {
          continue;
        }
        marcas.set(dado.caminho, `${dado.info.size}:${dado.info.mtimeMs}`);
        ultimaEscritaMs = Math.max(ultimaEscritaMs ?? 0, dado.info.mtimeMs);
      }
    } catch (erro) {
      console.warn("[diagnostico] Não foi possível ler as transcrições:", erro instanceof Error ? erro.message : erro);
    }
    return { marcas, ultimaEscritaMs };
  }
}
