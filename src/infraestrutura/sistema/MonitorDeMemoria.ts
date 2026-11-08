import { freemem, totalmem } from "node:os";

import { executar, memoriaDosProcessos } from "./Processos";
import { RegistroDeProcessos } from "./RegistroDeProcessos";

export interface LeituraDeMemoria {
  totalBytes: number;
  /**
   * Memória disponível no computador (inclui o cache que o Windows libera sob
   * demanda; no macOS, total menos a memória usada do Activity Monitor).
   */
  livreBytes: number;
  servidorBytes: number;
  /** Soma dos processos do Claude iniciados por este servidor. */
  agentesBytes: number;
  porOrquestrador: Record<string, number>;
  lidaEm: string;
}

/**
 * Memória livre no macOS a partir da saída do `vm_stat`, no mesmo critério do
 * Activity Monitor: usada = App Memory (páginas anônimas menos purgeable) +
 * Wired + Comprimida; livre = total menos usada. O `os.freemem()` conta só as
 * páginas free e fica muito abaixo do real. Devolve null se o parse falhar.
 */
export function memoriaLivreDoMac(saidaDoVmStat: string, totalBytes: number): number | null {
  const tamanhoDaPagina = /page size of (\d+) bytes/.exec(saidaDoVmStat)?.[1];
  if (tamanhoDaPagina === undefined) {
    return null;
  }

  const paginas = (rotulo: string): number | null => {
    const valor = new RegExp(`^${rotulo}:\\s+(\\d+)\\.?\\s*$`, "m").exec(saidaDoVmStat)?.[1];
    return valor === undefined ? null : Number(valor);
  };
  const anonimas = paginas("Anonymous pages");
  const purgeable = paginas("Pages purgeable");
  const wired = paginas("Pages wired down");
  const comprimida = paginas("Pages occupied by compressor");
  if (anonimas === null || purgeable === null || wired === null || comprimida === null) {
    return null;
  }

  const usadaBytes = (anonimas - purgeable + wired + comprimida) * Number(tamanhoDaPagina);
  return Math.max(0, totalBytes - usadaBytes);
}

/** Memória livre do computador; no macOS usa o `vm_stat` e cai no `freemem()` se falhar. */
export async function memoriaLivre(): Promise<number> {
  if (process.platform !== "darwin") {
    return freemem();
  }
  try {
    return memoriaLivreDoMac(await executar("vm_stat", []), totalmem()) ?? freemem();
  } catch {
    return freemem();
  }
}

/**
 * Mede a memória do computador e dos agentes a cada poucos segundos, em
 * segundo plano: a tela consulta a saúde do servidor com frequência, e medir
 * a cada consulta (o `tasklist` leva centenas de milissegundos) pesaria mais
 * do que ajudaria.
 */
export class MonitorDeMemoria {
  private leitura: LeituraDeMemoria | null = null;
  private intervalo: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly registro: RegistroDeProcessos,
    private readonly intervaloMs = 5_000,
  ) {}

  get ultimaLeitura(): LeituraDeMemoria | null {
    return this.leitura;
  }

  iniciar(): void {
    void this.medir();
    this.intervalo = setInterval(() => void this.medir(), this.intervaloMs);
    this.intervalo.unref();
  }

  parar(): void {
    if (this.intervalo !== null) {
      clearInterval(this.intervalo);
    }
  }

  private async medir(): Promise<void> {
    const processos = this.registro.emExecucao();
    const porPid = await memoriaDosProcessos(processos.map((processo) => processo.pid)).catch(
      () => new Map<number, number>(),
    );

    const porOrquestrador: Record<string, number> = {};
    for (const processo of processos) {
      porOrquestrador[processo.orquestradorId] =
        (porOrquestrador[processo.orquestradorId] ?? 0) + (porPid.get(processo.pid) ?? 0);
    }

    const livreBytes = await memoriaLivre();

    this.leitura = {
      totalBytes: totalmem(),
      livreBytes,
      servidorBytes: process.memoryUsage().rss,
      agentesBytes: Object.values(porOrquestrador).reduce((soma, bytes) => soma + bytes, 0),
      porOrquestrador,
      lidaEm: new Date().toISOString(),
    };
  }
}
