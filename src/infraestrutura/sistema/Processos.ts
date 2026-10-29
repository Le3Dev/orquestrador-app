import { execFile } from "node:child_process";

function executar(comando: string, argumentos: readonly string[]): Promise<string> {
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

/**
 * Encerra o processo e todos os filhos. No Windows `kill()` mataria só o
 * `claude.exe`, deixando para trás comandos que um Subagente tenha aberto
 * (um `npm test` longo, por exemplo); `taskkill /T` derruba a árvore inteira.
 */
export function encerrarArvore(pid: number | undefined): void {
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
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Já tinha terminado.
  }
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

/** Memória em uso (bytes) dos processos do Claude Code pedidos. */
export async function memoriaDosProcessos(pids: readonly number[]): Promise<Map<number, number>> {
  if (pids.length === 0) {
    return new Map();
  }
  if (process.platform === "win32") {
    const todos = lerTasklistCsv(await executar("tasklist", ["/FO", "CSV", "/NH", "/FI", "IMAGENAME eq claude.exe"]));
    return new Map([...todos].filter(([pid]) => pids.includes(pid)));
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
