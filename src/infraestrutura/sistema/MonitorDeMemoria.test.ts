import { describe, expect, it } from "vitest";

import { memoriaLivreDoMac, MonitorDeMemoria } from "./MonitorDeMemoria";
import { RegistroDeProcessos } from "./RegistroDeProcessos";

describe("MonitorDeMemoria", () => {
  it("soma por Orquestrador o Claude Code, os descendentes vivos e os processos deixados, cada pid uma vez", async () => {
    const registro = new RegistroDeProcessos();
    registro.registrar({ pid: 10, orquestradorId: "orq-1", sessaoId: "s1", iniciadoEm: "" });
    registro.registrar({ pid: 20, orquestradorId: "chat", sessaoId: "s2", iniciadoEm: "" });
    const outros = {
      pidsPorOrquestrador: () =>
        new Map([
          // pwsh e node abertos pelo Claude do orq-1, mais um servidor deixado; o 10 repetido não conta duas vezes.
          ["orq-1", new Set([11, 12, 10])],
          ["orq-2", new Set([30])],
        ]),
    };
    const MB = 1024 * 1024;
    const memoria = new Map([
      [10, 250 * MB],
      [11, 40 * MB],
      [12, 100 * MB],
      [20, 230 * MB],
      [30, 300 * MB],
      [99, 999 * MB],
    ]);
    let pedidos: readonly number[] = [];
    const monitor = new MonitorDeMemoria(registro, 5_000, outros, async (pids) => {
      pedidos = pids;
      return new Map([...memoria].filter(([pid]) => pids.includes(pid)));
    });

    await monitor.medir();

    expect([...pedidos].sort((a, b) => a - b)).toEqual([10, 11, 12, 20, 30]);
    expect(monitor.ultimaLeitura?.porOrquestrador).toEqual({ "orq-1": 390 * MB, chat: 230 * MB, "orq-2": 300 * MB });
    expect(monitor.ultimaLeitura?.agentesBytes).toBe(920 * MB);
  });

  it("sem conseguir medir, conta zero em vez de falhar", async () => {
    const registro = new RegistroDeProcessos();
    registro.registrar({ pid: 10, orquestradorId: "orq-1", sessaoId: "s1", iniciadoEm: "" });
    const monitor = new MonitorDeMemoria(registro, 5_000, null, () => Promise.reject(new Error("tasklist sumiu")));

    await monitor.medir();

    expect(monitor.ultimaLeitura?.porOrquestrador).toEqual({ "orq-1": 0 });
    expect(monitor.ultimaLeitura?.agentesBytes).toBe(0);
  });
});

const SAIDA_DO_VM_STAT = [
  "Mach Virtual Memory Statistics: (page size of 16384 bytes)",
  "Pages free:                                3984.",
  "Pages active:                            205159.",
  "Pages inactive:                          191999.",
  "Pages speculative:                        12057.",
  "Pages throttled:                              0.",
  "Pages wired down:                        298354.",
  "Pages purgeable:                           1487.",
  "File-backed pages:                       160650.",
  "Anonymous pages:                         248565.",
  "Pages stored in compressor:              947548.",
  "Pages occupied by compressor:            300130.",
].join("\n");

describe("memoriaLivreDoMac", () => {
  it("calcula a memória livre como o Activity Monitor", () => {
    // usada = (248565 - 1487 + 298354 + 300130) * 16384 = 13.853.687.808
    expect(memoriaLivreDoMac(SAIDA_DO_VM_STAT, 17_179_869_184)).toBe(3_326_181_376);
  });

  it("usa o tamanho de página do cabeçalho", () => {
    const saida = [
      "Mach Virtual Memory Statistics: (page size of 4096 bytes)",
      "Pages wired down:                          1000.",
      "Pages purgeable:                            100.",
      "Anonymous pages:                           2000.",
      "Pages occupied by compressor:               500.",
    ].join("\n");

    expect(memoriaLivreDoMac(saida, 100_000_000)).toBe(100_000_000 - 3400 * 4096);
  });

  it("devolve null quando falta uma linha", () => {
    const saida = SAIDA_DO_VM_STAT.split("\n")
      .filter((linha) => !linha.startsWith("Pages purgeable"))
      .join("\n");

    expect(memoriaLivreDoMac(saida, 17_179_869_184)).toBeNull();
  });

  it("devolve null para saída vazia", () => {
    expect(memoriaLivreDoMac("", 17_179_869_184)).toBeNull();
  });

  it("nunca devolve menos que zero quando a usada passa do total", () => {
    expect(memoriaLivreDoMac(SAIDA_DO_VM_STAT, 1_000_000)).toBe(0);
  });
});
