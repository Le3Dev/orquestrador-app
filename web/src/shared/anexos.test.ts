import {
  anexosParaEnvio,
  arquivosColados,
  categoriaDoArquivo,
  ehAnexoDeImagem,
  ehCapturaDeTela,
  formatoDoDocumento,
  imagemDaCaptura,
  lerAnexo,
  liberarAnexos,
  MAXIMO_DE_ANEXOS,
  MAXIMO_DE_IMAGENS,
  problemaDoAnexo,
  TAMANHO_MAXIMO_DA_IMAGEM,
  TAMANHO_MAXIMO_DO_DOCUMENTO,
  TAMANHO_MAXIMO_DOS_ANEXOS,
  TEXTO_PADRAO_DOS_ANEXOS,
  TIPOS_ACEITOS_NO_SELETOR,
} from "./anexos";
import { formatarBytes } from "./formatacao";
import { nivelDaMemoria } from "./memoria";

const MB = 1024 * 1024;

describe("ehCapturaDeTela", () => {
  it("reconhece só o nome gerado pelo Electron", () => {
    expect(ehCapturaDeTela("tela-2026-11-07T10-00-00-000Z.jpg")).toBe(true);
    expect(ehCapturaDeTela("tela.jpg")).toBe(false);
    expect(ehCapturaDeTela("tela-1.png")).toBe(false);
    expect(ehCapturaDeTela("foto.jpg")).toBe(false);
    expect(ehCapturaDeTela("image.png")).toBe(false);
  });
});

describe("categoriaDoArquivo", () => {
  it("imagem pelo tipo: PNG, JPEG, GIF e WebP", () => {
    for (const type of ["image/png", "image/jpeg", "image/gif", "image/webp"]) {
      expect(categoriaDoArquivo({ name: "arquivo", type })).toBe("imagem");
    }
  });

  it("imagem com o tipo vazio ou genérico: vale a extensão do nome", () => {
    expect(categoriaDoArquivo({ name: "foto.JPG", type: "" })).toBe("imagem");
    expect(categoriaDoArquivo({ name: "icone.webp", type: "application/octet-stream" })).toBe("imagem");
    // Com um tipo que diz outra coisa, a extensão de imagem não basta.
    expect(categoriaDoArquivo({ name: "foto.png", type: "application/zip" })).toBeNull();
  });

  it("documento pela extensão, com o tipo vazio e em maiúsculas", () => {
    for (const extensao of [
      "pdf", "docx", "doc", "xlsx", "xls", "csv", "pptx", "html", "htm", "txt", "md", "json", "xml", "yaml", "yml", "log",
    ]) {
      expect(categoriaDoArquivo({ name: `arquivo.${extensao}`, type: "" })).toBe("documento");
      expect(categoriaDoArquivo({ name: `ARQUIVO.${extensao.toUpperCase()}`, type: "" })).toBe("documento");
    }
  });

  it("a extensão manda: o tipo errado do navegador (.md como text/x-markdown, .csv como excel) não atrapalha", () => {
    expect(categoriaDoArquivo({ name: "notas.md", type: "text/x-markdown" })).toBe("documento");
    expect(categoriaDoArquivo({ name: "dados.csv", type: "application/vnd.ms-excel" })).toBe("documento");
  });

  it("recusa o que não é imagem aceita nem documento aceito", () => {
    expect(categoriaDoArquivo({ name: "app.exe", type: "application/x-msdownload" })).toBeNull();
    expect(categoriaDoArquivo({ name: "pacote.zip", type: "application/zip" })).toBeNull();
    expect(categoriaDoArquivo({ name: "figura.svg", type: "image/svg+xml" })).toBeNull();
    expect(categoriaDoArquivo({ name: "foto.bmp", type: "image/bmp" })).toBeNull();
    expect(categoriaDoArquivo({ name: "sem-extensao", type: "" })).toBeNull();
    expect(categoriaDoArquivo({ name: "constructor", type: "" })).toBeNull();
    expect(categoriaDoArquivo({ name: "arquivo.constructor", type: "" })).toBeNull();
  });
});

describe("formatoDoDocumento", () => {
  it("dá o rótulo do formato e marca .doc e .xls como formato antigo", () => {
    expect(formatoDoDocumento("a.pdf")).toEqual({ rotulo: "PDF", legado: false });
    expect(formatoDoDocumento("a.DOCX")).toEqual({ rotulo: "Word", legado: false });
    expect(formatoDoDocumento("a.doc")).toEqual({ rotulo: "Word (formato antigo)", legado: true });
    expect(formatoDoDocumento("a.xlsx")).toEqual({ rotulo: "Excel", legado: false });
    expect(formatoDoDocumento("a.xls")).toEqual({ rotulo: "Excel (formato antigo)", legado: true });
    expect(formatoDoDocumento("a.pptx")?.rotulo).toBe("PowerPoint");
    expect(formatoDoDocumento("a.htm")?.rotulo).toBe("HTML");
    expect(formatoDoDocumento("a.yml")?.rotulo).toBe("YAML");
    expect(formatoDoDocumento("a.md")?.rotulo).toBe("Markdown");
    expect(formatoDoDocumento("a.log")?.rotulo).toBe("Log");
    expect(formatoDoDocumento("a.txt")?.rotulo).toBe("Texto");
  });

  it("só .doc e .xls são formato antigo; PowerPoint antigo (.ppt) nem é aceito", () => {
    expect(["pdf", "docx", "xlsx", "csv", "pptx", "html", "txt", "md", "json", "xml", "yaml", "log"].some(
      (extensao) => formatoDoDocumento(`a.${extensao}`)?.legado === true,
    )).toBe(false);
    expect(formatoDoDocumento("a.ppt")).toBeNull();
    expect(formatoDoDocumento("sem-extensao")).toBeNull();
  });
});

describe("TIPOS_ACEITOS_NO_SELETOR", () => {
  it("lista os tipos de imagem e as extensões dos documentos, para o `accept` do seletor", () => {
    const itens = TIPOS_ACEITOS_NO_SELETOR.split(",");
    expect(itens).toEqual(
      expect.arrayContaining(["image/png", "image/jpeg", "image/gif", "image/webp", ".pdf", ".docx", ".doc", ".xlsx", ".xls", ".csv", ".pptx", ".html", ".htm", ".txt", ".md", ".json", ".xml", ".yaml", ".yml", ".log"]),
    );
    expect(itens).toHaveLength(20);
  });
});

describe("ehAnexoDeImagem", () => {
  it("usa a categoria e, sem ela (turno antigo), o tipo image/*", () => {
    expect(ehAnexoDeImagem({ categoria: "imagem", tipoDeMidia: "image/png" })).toBe(true);
    expect(ehAnexoDeImagem({ categoria: "documento", tipoDeMidia: "application/pdf" })).toBe(false);
    expect(ehAnexoDeImagem({ tipoDeMidia: "image/jpeg" })).toBe(true);
    expect(ehAnexoDeImagem({ tipoDeMidia: "application/pdf" })).toBe(false);
    expect(ehAnexoDeImagem({ tipoDeMidia: "" })).toBe(false);
  });

  it("a categoria vence o tipo", () => {
    expect(ehAnexoDeImagem({ categoria: "documento", tipoDeMidia: "image/png" })).toBe(false);
    expect(ehAnexoDeImagem({ categoria: "imagem", tipoDeMidia: "" })).toBe(true);
  });
});

describe("problemaDoAnexo", () => {
  const png = { name: "tela.png", type: "image/png", size: 1024 };
  const pdf = { name: "contrato.pdf", type: "application/pdf", size: 1024 };
  const imagemPendente = { categoria: "imagem" as const, tamanhoEmBytes: 1024 };
  const documentoPendente = { categoria: "documento" as const, tamanhoEmBytes: 1024 };

  it("aceita imagens e documentos dentro dos limites", () => {
    expect(problemaDoAnexo(png, [])).toBeNull();
    expect(problemaDoAnexo(pdf, [])).toBeNull();
    expect(problemaDoAnexo({ name: "NOTAS.MD", type: "", size: 10 }, [])).toBeNull();
    expect(problemaDoAnexo({ ...png, size: TAMANHO_MAXIMO_DA_IMAGEM }, [])).toBeNull();
    expect(problemaDoAnexo({ ...pdf, size: TAMANHO_MAXIMO_DO_DOCUMENTO }, [])).toBeNull();
  });

  it("recusa formato não aceito e explica quais são aceitos", () => {
    const mensagem = problemaDoAnexo({ name: "app.exe", type: "application/x-msdownload", size: 10 }, []);
    expect(mensagem).toContain('"app.exe" tem um formato que não dá para anexar.');
    expect(mensagem).toContain("imagens (PNG, JPEG, GIF ou WebP)");
    expect(mensagem).toContain("documentos (PDF, Word, Excel, CSV, PowerPoint, HTML, TXT, MD, JSON, XML, YAML ou LOG)");
  });

  it("o limite de tamanho é por categoria: imagem 5 MB, documento 32 MB", () => {
    expect(problemaDoAnexo({ ...png, size: 5 * MB + 1 }, [])).toBe('"tela.png" passa de 5 MB, o limite do Claude por imagem.');
    // 6 MB é demais para imagem e normal para documento.
    expect(problemaDoAnexo({ ...pdf, size: 6 * MB }, [])).toBeNull();
    expect(problemaDoAnexo({ ...pdf, size: 32 * MB + 1 }, [])).toBe('"contrato.pdf" passa de 32 MB, o limite por documento.');
  });

  it("recusa arquivo vazio", () => {
    expect(problemaDoAnexo({ ...pdf, size: 0 }, [])).toBe('"contrato.pdf" está vazio.');
  });

  it("aceita até 10 anexos por mensagem e recusa o 11º, de qualquer categoria", () => {
    const nove = Array.from({ length: MAXIMO_DE_ANEXOS - 1 }, () => documentoPendente);
    const dez = [...nove, documentoPendente];
    expect(problemaDoAnexo(pdf, nove)).toBeNull();
    expect(problemaDoAnexo(pdf, dez)).toBe("Dá para anexar até 10 arquivos por mensagem.");
    expect(problemaDoAnexo(png, dez)).toBe("Dá para anexar até 10 arquivos por mensagem.");
  });

  it("aceita 5 imagens e recusa a 6ª, mas os documentos seguem até os 10 anexos", () => {
    const cinco = Array.from({ length: MAXIMO_DE_IMAGENS }, () => imagemPendente);
    expect(problemaDoAnexo(png, cinco.slice(0, 4))).toBeNull();
    expect(problemaDoAnexo(png, cinco)).toBe("Dá para anexar até 5 imagens por mensagem.");
    expect(problemaDoAnexo(pdf, cinco)).toBeNull();
    expect(problemaDoAnexo(pdf, [...cinco, ...Array.from({ length: 4 }, () => documentoPendente)])).toBeNull();
  });

  it("limita o total da mensagem a 100 MB", () => {
    const tres = Array.from({ length: 3 }, () => ({ categoria: "documento" as const, tamanhoEmBytes: 30 * MB }));
    // 90 MB já anexados: mais 10 MB cabem exatamente; 10 MB + 1 byte não.
    expect(problemaDoAnexo({ ...pdf, size: 10 * MB }, tres)).toBeNull();
    expect(problemaDoAnexo({ ...pdf, size: 10 * MB + 1 }, tres)).toBe("Os anexos de uma mensagem somam no máximo 100 MB.");
    expect(TAMANHO_MAXIMO_DOS_ANEXOS).toBe(100 * MB);
  });

  it("a ordem das verificações: formato, tamanho, quantidade e soma", () => {
    const cheio = Array.from({ length: MAXIMO_DE_ANEXOS }, () => documentoPendente);
    // Formato recusado aparece mesmo com a lista cheia.
    expect(problemaDoAnexo({ name: "x.exe", type: "", size: 1 }, cheio)).toContain("formato que não dá para anexar");
    // Grande demais aparece antes do limite de quantidade.
    expect(problemaDoAnexo({ ...pdf, size: 33 * MB }, cheio)).toContain("passa de 32 MB");
  });
});

describe("arquivosColados", () => {
  const foto = new File(["b"], "image.png", { type: "image/png" });
  const planilha = new File(["a"], "vendas.xlsx", { type: "" });
  const zip = new File(["c"], "dados.zip", { type: "application/zip" });
  const colagem = (files: File[], texto = "") => ({ files: files as unknown as FileList, getData: () => texto });

  it("devolve só os arquivos de formato aceito", () => {
    expect(arquivosColados(colagem([foto, zip, planilha], "caminho"))).toEqual([foto, planilha]);
  });

  it("sem nenhum aceito e sem texto junto, devolve todos para a tela explicar a recusa", () => {
    expect(arquivosColados(colagem([zip]))).toEqual([zip]);
  });

  it("sem nenhum aceito e com texto junto, não rouba a colagem do texto", () => {
    expect(arquivosColados(colagem([zip], "texto colado"))).toEqual([]);
  });

  it("sem arquivos, devolve vazio sem nem olhar o texto", () => {
    expect(arquivosColados({ files: [] as unknown as FileList, getData: () => { throw new Error("não devia ler"); } })).toEqual([]);
  });
});

describe("anexos pendentes sem base64 guardado", () => {
  afterEach(() => vi.restoreAllMocks());

  /** O base64 como o FileReader gera (o que vai ao servidor). */
  function base64PeloLeitor(arquivo: Blob): Promise<string> {
    return new Promise((resolver) => {
      const leitor = new FileReader();
      leitor.onload = () => resolver(String(leitor.result).split(",")[1] ?? "");
      leitor.readAsDataURL(arquivo);
    });
  }

  it("lerAnexo de imagem guarda o arquivo e uma miniatura blob:, sem base64", async () => {
    const criar = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:teste/x");
    const arquivo = new File([new Uint8Array([1, 2, 3])], "image.png", { type: "image/png" });
    const anexo = await lerAnexo(arquivo);
    expect(anexo).toMatchObject({
      nome: "image.png",
      categoria: "imagem",
      tipoDeMidia: "image/png",
      tamanhoEmBytes: 3,
      previa: "blob:teste/x",
      rotulo: "Imagem",
      legado: false,
    });
    expect(anexo.arquivo).toBe(arquivo);
    expect(criar).toHaveBeenCalledWith(arquivo);
    expect(Object.values(anexo).some((valor) => typeof valor === "string" && valor.startsWith("data:"))).toBe(false);
  });

  it("lerAnexo de documento guarda o arquivo, o rótulo e o tipo (vazio se o navegador não deu), sem miniatura", async () => {
    const criar = vi.spyOn(URL, "createObjectURL");
    const arquivo = new File(["# titulo"], "notas.MD", { type: "" });
    const anexo = await lerAnexo(arquivo);
    expect(anexo).toMatchObject({
      nome: "notas.MD",
      categoria: "documento",
      tipoDeMidia: "",
      tamanhoEmBytes: 8,
      previa: null,
      rotulo: "Markdown",
      legado: false,
    });
    expect(anexo.arquivo).toBe(arquivo);
    expect(criar).not.toHaveBeenCalled();
  });

  it("lerAnexo marca o formato antigo como legado", async () => {
    const anexo = await lerAnexo(new File(["x"], "base.xls", { type: "application/vnd.ms-excel" }));
    expect(anexo).toMatchObject({ rotulo: "Excel (formato antigo)", legado: true });
    expect(await lerAnexo(new File(["x"], "ata.doc", { type: "application/msword" }))).toMatchObject({
      rotulo: "Word (formato antigo)",
      legado: true,
    });
    expect((await lerAnexo(new File(["x"], "base.xlsx", { type: "" }))).legado).toBe(false);
  });

  it("lerAnexo recusa formato não aceito", async () => {
    await expect(lerAnexo(new File(["x"], "app.exe", { type: "application/x-msdownload" }))).rejects.toThrow(
      '"app.exe" não é um formato aceito.',
    );
  });

  it("o base64 gerado no envio é igual ao do arquivo, na ordem dos anexos e com o tipo original", async () => {
    const bytes = new Uint8Array(1000).map((_, indice) => (indice * 37) % 256);
    const foto = new File([bytes], "foto.jpg", { type: "image/jpeg" });
    const planilha = new File([bytes.slice(0, 301)], "dados.csv", { type: "" });
    const [enviada, enviadaDoCsv] = await anexosParaEnvio([await lerAnexo(foto), await lerAnexo(planilha)]);
    expect(enviada).toEqual({ nome: "foto.jpg", tipoDeMidia: "image/jpeg", base64: await base64PeloLeitor(foto) });
    expect(enviadaDoCsv).toEqual({ nome: "dados.csv", tipoDeMidia: "", base64: await base64PeloLeitor(planilha) });
  });

  it("a captura de tela vira Blob de imagem e volta ao mesmo base64 no envio", async () => {
    const base64 = btoa(String.fromCharCode(...new Uint8Array(301).map((_, indice) => (indice * 13) % 256)));
    const captura = { nome: "tela-2026-11-08T10-00-00-000Z.jpg", tipoDeMidia: "image/jpeg" as const, base64 };
    const anexo = imagemDaCaptura(captura);
    expect(anexo).not.toHaveProperty("base64");
    expect(anexo).toMatchObject({ categoria: "imagem", tamanhoEmBytes: 301, rotulo: "Imagem", legado: false });
    expect(anexo.previa).not.toBeNull();
    expect(await anexosParaEnvio([anexo])).toEqual([captura]);
  });

  it("liberarAnexos revoga só as URLs das miniaturas (documento não tem)", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValueOnce("blob:teste/a").mockReturnValueOnce("blob:teste/b");
    const revogar = vi.spyOn(URL, "revokeObjectURL");
    const anexos = [
      await lerAnexo(new File(["a"], "a.png", { type: "image/png" })),
      await lerAnexo(new File(["d"], "d.pdf", { type: "application/pdf" })),
      await lerAnexo(new File(["b"], "b.png", { type: "image/png" })),
    ];
    liberarAnexos(anexos);
    expect(revogar.mock.calls).toEqual([["blob:teste/a"], ["blob:teste/b"]]);
  });
});

describe("texto padrão dos anexos", () => {
  it("é um só, serve para imagens e documentos", () => {
    expect(TEXTO_PADRAO_DOS_ANEXOS).toBe("Analise os anexos.");
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
