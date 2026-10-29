import { freemem, totalmem } from "node:os";

import { memoriaDosProcessos } from "./Processos";
import { RegistroDeProcessos } from "./RegistroDeProcessos";

export interface LeituraDeMemoria {
  totalBytes: number;
  /** Memória disponível no computador (inclui o cache que o Windows libera sob demanda). */
  livreBytes: number;
  servidorBytes: number;
  /** Soma dos processos do Claude iniciados por este servidor. */
  agentesBytes: number;
  porOrquestrador: Record<string, number>;
  lidaEm: string;
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

    this.leitura = {
      totalBytes: totalmem(),
      livreBytes: freemem(),
      servidorBytes: process.memoryUsage().rss,
      agentesBytes: Object.values(porOrquestrador).reduce((soma, bytes) => soma + bytes, 0),
      porOrquestrador,
      lidaEm: new Date().toISOString(),
    };
  }
}
