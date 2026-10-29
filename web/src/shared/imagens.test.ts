import { formatarBytes } from "./formatacao";
import { MAXIMO_DE_IMAGENS, problemaDaImagem, TAMANHO_MAXIMO_DA_IMAGEM } from "./imagens";
import { nivelDaMemoria } from "./memoria";

describe("problemaDaImagem", () => {
  const png = { name: "tela.png", type: "image/png", size: 1024 };

  it("aceita PNG, JPEG, GIF e WebP dentro do limite", () => {
    for (const type of ["image/png", "image/jpeg", "image/gif", "image/webp"]) {
      expect(problemaDaImagem({ ...png, type }, 0)).toBeNull();
    }
  });

  it("explica por que recusa", () => {
    expect(problemaDaImagem({ ...png, name: "doc.pdf", type: "application/pdf" }, 0)).toMatch(/não é PNG/);
    expect(problemaDaImagem({ ...png, size: TAMANHO_MAXIMO_DA_IMAGEM + 1 }, 0)).toMatch(/5 MB/);
    expect(problemaDaImagem(png, MAXIMO_DE_IMAGENS)).toMatch(/até 5 imagens/);
  });
});

describe("nivelDaMemoria", () => {
  const GB = 1024 ** 3;
  const leitura = (livre: number, total = 16 * GB) => ({
    totalBytes: total,
    livreBytes: livre,
    servidorBytes: 0,
    agentesBytes: 0,
    porOrquestrador: {},
    lidaEm: "",
  });

  it("classifica pelo mais grave entre o absoluto e o relativo", () => {
    expect(nivelDaMemoria(leitura(6 * GB))).toBe("normal");
    expect(nivelDaMemoria(leitura(1.2 * GB))).toBe("baixa");
    expect(nivelDaMemoria(leitura(0.5 * GB))).toBe("critica");
    // 4 GB livres de 64 GB são só 6%: pouco, mesmo sendo bastante em absoluto.
    expect(nivelDaMemoria(leitura(4 * GB, 64 * GB))).toBe("baixa");
  });
});

describe("formatarBytes", () => {
  it("usa MB até 1 GB e GB acima", () => {
    expect(formatarBytes(480 * 1024 ** 2)).toBe("480 MB");
    expect(formatarBytes(1.94 * 1024 ** 3)).toBe("1,9 GB");
  });
});
