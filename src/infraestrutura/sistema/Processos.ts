import { execFile } from "node:child_process";

import { lerArvoreDoPs, lerArvoreDoWindows, ProcessoNaArvore } from "./ArvoreDeProcessos";

export function executar(comando: string, argumentos: readonly string[]): Promise<string> {
  return new Promise((resolver, rejeitar) => {
    execFile(comando, [...argumentos], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (erro, saida) => {
      if (erro !== null) {
        rejeitar(erro);
        return;
      }
      resolver(saida);
    });
  });
}

/** Espera entre o SIGTERM e o SIGKILL ao encerrar uma árvore no Mac/Linux. */
export const ESPERA_ANTES_DO_SIGKILL_MS = 5_000;

/** Manda o sinal a um pid (ou, negativo, a um grupo); falso se não havia ninguém. */
function sinalizar(alvo: number, sinal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(alvo, sinal);
    return true;
  } catch {
    return false;
  }
}

/**
 * Encerra o processo e todos os filhos. No Windows `kill()` mataria só o
 * `claude.exe`, deixando para trás comandos que um Subagente tenha aberto
 * (um `npm test` longo, por exemplo); `taskkill /T` derruba a árvore inteira.
 *
 * No Mac/Linux o Claude Code é iniciado como líder de um grupo de processos
 * próprio (`detached`): o SIGTERM vai ao grupo inteiro e, se alguém ainda
 * estiver vivo depois de `ESPERA_ANTES_DO_SIGKILL_MS`, o grupo leva SIGKILL.
 */
export function encerrarArvore(pid: number | undefined, esperaAntesDoSigkillMs = ESPERA_ANTES_DO_SIGKILL_MS): void {
  if (pid === undefined) {
    return;
  }
  if (process.platform === "win32") {
    execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, (erro) => {
      if (erro !== null) {
        console.warn(`[processos] taskkill do processo ${pid} falhou:`, erro.message);
      }
    });
    return;
  }
  if (!sinalizar(-pid, "SIGTERM")) {
    // Sem grupo com esse id: um processo iniciado sem `detached` (por uma
    // versão anterior do app) ou que já terminou com todo o grupo. Só o
    // SIGTERM ao pid, como antes: um SIGKILL depois da espera poderia acertar
    // um pid já reaproveitado por outro programa.
    sinalizar(pid, "SIGTERM");
    return;
  }
  // `unref`: a espera não segura o servidor que está desligando. O id do
  // grupo não é reaproveitado enquanto houver alguém nele.
  setTimeout(() => {
    if (sinalizar(-pid, 0)) {
      sinalizar(-pid, "SIGKILL");
    }
  }, esperaAntesDoSigkillMs).unref();
}

/** Linha de comando de um processo, ou nulo se ele não existe mais. */
export async function linhaDeComandoDe(pid: number): Promise<string | null> {
  try {
    const saida =
      process.platform === "win32"
        ? await executar("powershell", [
            "-NoProfile",
            "-Command",
            `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
          ])
        : await executar("ps", ["-o", "args=", "-p", String(pid)]);
    const linha = saida.trim();
    return linha === "" ? null : linha;
  } catch {
    return null;
  }
}

/**
 * Lê a saída de `tasklist /FO CSV /NH`: pid → bytes em uso.
 *
 * A coluna de memória vem formatada no idioma do Windows ("278.528 K" em
 * português, "278,528 K" em inglês); só os dígitos interessam.
 */
export function lerTasklistCsv(texto: string): Map<number, number> {
  const memoria = new Map<number, number>();
  for (const linha of texto.split(/\r?\n/)) {
    const campos = linha.match(/^"[^"]*","(\d+)","[^"]*","[^"]*","([^"]*)"/);
    if (campos === null) {
      continue;
    }
    const quilobytes = Number((campos[2] ?? "").replace(/\D/g, ""));
    if (Number.isFinite(quilobytes) && quilobytes > 0) {
      memoria.set(Number(campos[1]), quilobytes * 1024);
    }
  }
  return memoria;
}

/**
 * Memória em uso (bytes) dos processos pedidos: os Claude Code e o que eles
 * abriram (pwsh, cmd, conhost, node...). No Windows, um `tasklist` sem
 * filtro, que é barato; quem pede escolhe os pids pela árvore.
 */
export async function memoriaDosProcessos(pids: readonly number[]): Promise<Map<number, number>> {
  if (pids.length === 0) {
    return new Map();
  }
  if (process.platform === "win32") {
    const pedidos = new Set(pids);
    const todos = lerTasklistCsv(await executar("tasklist", ["/FO", "CSV", "/NH"]));
    return new Map([...todos].filter(([pid]) => pedidos.has(pid)));
  }
  const saida = await executar("ps", ["-o", "pid=,rss=", "-p", pids.join(",")]);
  const memoria = new Map<number, number>();
  for (const linha of saida.split("\n")) {
    const [pid, rss] = linha.trim().split(/\s+/).map(Number);
    if (pid !== undefined && rss !== undefined && Number.isFinite(pid) && Number.isFinite(rss)) {
      memoria.set(pid, rss * 1024);
    }
  }
  return memoria;
}

/** Um processo da máquina, como o `ps` o mostra. */
export interface ProcessoListado {
  pid: number;
  ppid: number;
  /** % de CPU. */
  cpu: number;
  /** Há quanto tempo está rodando. */
  haMs: number;
  /** Linha de comando completa. */
  comando: string;
}

/** `etime` do `ps` (`[[dd-]hh:]mm:ss`) em milissegundos; nulo se não reconhecer. */
export function tempoDoPsEmMs(etime: string): number | null {
  const partes = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(etime.trim());
  if (partes === null) {
    return null;
  }
  const [dias, horas, minutos, segundos] = [partes[1], partes[2], partes[3], partes[4]].map((parte) => Number(parte ?? 0));
  return ((((dias ?? 0) * 24 + (horas ?? 0)) * 60 + (minutos ?? 0)) * 60 + (segundos ?? 0)) * 1000;
}

/**
 * Lê a saída de `ps -A -o pid=,ppid=,pcpu=,etime=,args=`. A CPU pode vir com
 * vírgula decimal, conforme o idioma do sistema; linhas irreconhecíveis são
 * ignoradas.
 */
export function lerListaDeProcessos(texto: string): ProcessoListado[] {
  const processos: ProcessoListado[] = [];
  for (const linha of texto.split("\n")) {
    const campos = /^\s*(\d+)\s+(\d+)\s+([\d.,]+)\s+(\S+)\s+(.*)$/.exec(linha);
    if (campos === null) {
      continue;
    }
    const haMs = tempoDoPsEmMs(campos[4] ?? "");
    const cpu = Number((campos[3] ?? "").replace(",", "."));
    if (haMs === null || !Number.isFinite(cpu)) {
      continue;
    }
    processos.push({
      pid: Number(campos[1]),
      ppid: Number(campos[2]),
      cpu,
      haMs,
      comando: (campos[5] ?? "").trim(),
    });
  }
  return processos;
}

/**
 * Todos os processos da máquina com pai, CPU e idade, numa única chamada ao
 * `ps`. No Windows devolve lista vazia: não há um equivalente barato. Medido,
 * `Get-CimInstance Win32_PerfFormattedData_PerfProc_Process` aberto do zero
 * leva 3,2–8,1 s com `powershell` e 3,9–4,3 s com `pwsh` (só abrir o
 * `powershell` custa 1,4 s; o `pwsh`, 2,6 s): caro demais a cada 30 s. Com a
 * lista vazia, o diagnóstico marca `processosVisiveis: false` e a vigia do
 * turno ignora CPU e comandos e usa o limite tolerante.
 */
export async function listarProcessos(): Promise<ProcessoListado[]> {
  if (process.platform === "win32") {
    return [];
  }
  return lerListaDeProcessos(await executar("ps", ["-A", "-o", "pid=,ppid=,pcpu=,etime=,args="]));
}

/**
 * Comando do Windows que lista a árvore (pid, ppid, criação, nome e linha de
 * comando) em JSON. Leva de 1 a 2 s: só no fim de um turno, a cada 30 s
 * enquanto há turno rodando e ao encerrar processos — nunca em intervalo curto.
 */
const LISTAGEM_DA_ARVORE_NO_WINDOWS =
  "[Console]::OutputEncoding = [Text.Encoding]::UTF8; " +
  "Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ " +
  "p = [int]$_.ProcessId; pp = [int]$_.ParentProcessId; " +
  "c = $(if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString('o') } else { '' }); " +
  "n = $_.Name; l = $_.CommandLine } } | ConvertTo-Json -Compress";

/** Todos os processos da máquina com pai, criação e linha de comando (ver `ArvoreDeProcessos`). */
export async function listarArvore(): Promise<ProcessoNaArvore[]> {
  if (process.platform === "win32") {
    return lerArvoreDoWindows(
      await executar("powershell", ["-NoProfile", "-NonInteractive", "-Command", LISTAGEM_DA_ARVORE_NO_WINDOWS]),
    );
  }
  return lerArvoreDoPs(await executar("ps", ["-A", "-o", "pid=,ppid=,pgid=,etime=,args="]), Date.now());
}

/**
 * Encerra um único processo (sem a árvore: no Windows o `taskkill /T` segue o
 * ppid, que pode apontar para um PID reaproveitado). Quem chama já conferiu
 * que o pid ainda é o mesmo processo e encerra os descendentes um a um.
 */
export function encerrarProcesso(pid: number): Promise<void> {
  if (process.platform !== "win32") {
    sinalizar(pid, "SIGTERM");
    return Promise.resolve();
  }
  return new Promise((resolver) => {
    execFile("taskkill", ["/PID", String(pid), "/F"], { windowsHide: true }, () => resolver());
  });
}
