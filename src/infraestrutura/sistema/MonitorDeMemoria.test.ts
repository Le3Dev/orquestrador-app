import { describe, expect, it } from "vitest";

import { memoriaLivreDoMac } from "./MonitorDeMemoria";

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
