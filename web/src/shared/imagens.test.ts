import { formatarBytes } from "./formatacao";
import {
  ehCapturaDeTela,
  imagemDaCaptura,
  imagensParaEnvio,
  lerImagem,
  liberarImagens,
  MAXIMO_DE_IMAGENS,
  problemaDaImagem,
  TAMANHO_MAXIMO_DA_IMAGEM,
} from "./imagens";
import { nivelDaMemoria } from "./memoria";

describe("ehCapturaDeTela", () => {
  it("reconhece só o nome gerado pelo Electron", () => {
    expect(ehCapturaDeTela("tela-2026-11-07T10-00-00-000Z.jpg")).toBe(true);
    expect(ehCapturaDeTela("tela.jpg")).toBe(false);
    expect(ehCapturaDeTela("tela-1.png")).toBe(false);
    expect(ehCapturaDeTela("foto.jpg")).toBe(false);
    expect(ehCapturaDeTela("image.png")).toBe(false);
  });
});

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

describe("imagens anexadas sem base64 guardado", () => {
  afterEach(() => vi.restoreAllMocks());

  /** O base64 como o FileReader gera (o que ia ao servidor antes). */
  function base64PeloLeitor(arquivo: Blob): Promise<string> {
    return new Promise((resolver) => {
      const leitor = new FileReader();
      leitor.onload = () => resolver(String(leitor.result).split(",")[1] ?? "");
      leitor.readAsDataURL(arquivo);
    });
  }

  it("lerImagem guarda o arquivo e uma miniatura blob:, sem base64", async () => {
    const criar = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:teste/x");
    const arquivo = new File([new Uint8Array([1, 2, 3])], "image.png", { type: "image/png" });
    const imagem = await lerImagem(arquivo);
    expect(imagem).toMatchObject({ nome: "image.png", tipoDeMidia: "image/png", tamanhoEmBytes: 3, previa: "blob:teste/x" });
    expect(imagem.arquivo).toBe(arquivo);
    expect(criar).toHaveBeenCalledWith(arquivo);
    expect(Object.values(imagem).some((valor) => typeof valor === "string" && valor.startsWith("data:"))).toBe(false);
  });

  it("lerImagem recusa tipo não aceito com a mesma mensagem", async () => {
    await expect(lerImagem(new File(["x"], "doc.pdf", { type: "application/pdf" }))).rejects.toThrow(
      '"doc.pdf" não é uma imagem aceita.',
    );
  });

  it("o base64 gerado no envio é igual ao do arquivo", async () => {
    const bytes = new Uint8Array(1000).map((_, indice) => (indice * 37) % 256);
    const arquivo = new File([bytes], "foto.jpg", { type: "image/jpeg" });
    const [enviada] = await imagensParaEnvio([await lerImagem(arquivo)]);
    expect(enviada).toEqual({ nome: "foto.jpg", tipoDeMidia: "image/jpeg", base64: await base64PeloLeitor(arquivo) });
  });

  it("a captura de tela vira Blob e volta ao mesmo base64 no envio", async () => {
    const base64 = btoa(String.fromCharCode(...new Uint8Array(301).map((_, indice) => (indice * 13) % 256)));
    const captura = { nome: "tela-2026-11-08T10-00-00-000Z.jpg", tipoDeMidia: "image/jpeg" as const, base64 };
    const imagem = imagemDaCaptura(captura);
    expect(imagem).not.toHaveProperty("base64");
    expect(imagem.tamanhoEmBytes).toBe(301);
    expect(await imagensParaEnvio([imagem])).toEqual([captura]);
  });

  it("liberarImagens revoga as URLs das miniaturas", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValueOnce("blob:teste/a").mockReturnValueOnce("blob:teste/b");
    const revogar = vi.spyOn(URL, "revokeObjectURL");
    const imagens = [
      await lerImagem(new File(["a"], "a.png", { type: "image/png" })),
      await lerImagem(new File(["b"], "b.png", { type: "image/png" })),
    ];
    liberarImagens(imagens);
    expect(revogar.mock.calls).toEqual([["blob:teste/a"], ["blob:teste/b"]]);
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
