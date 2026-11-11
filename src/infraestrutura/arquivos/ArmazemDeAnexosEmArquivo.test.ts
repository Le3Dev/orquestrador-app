import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateRawSync } from "node:zlib";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Anexo, EXTENSOES_DE_DOCUMENTO } from "../../orquestracao/Anexo";
import { ArmazemDeAnexosEmArquivo, ehNomeDeAnexoValido } from "./ArmazemDeAnexosEmArquivo";

/** Um .docx mínimo, com um parágrafo: zip de uma entrada só (cabeçalho local, diretório central e fim). */
function docxMinimo(texto: string): Buffer {
  const nome = Buffer.from("word/document.xml");
  const xml = Buffer.from(`<w:document><w:body><w:p><w:r><w:t>${texto}</w:t></w:r></w:p></w:body></w:document>`);
  const dados = deflateRawSync(xml);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(dados.length, 18);
  local.writeUInt32LE(xml.length, 22);
  local.writeUInt16LE(nome.length, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(dados.length, 20);
  central.writeUInt32LE(xml.length, 24);
  central.writeUInt16LE(nome.length, 28);

  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(1, 8);
  fim.writeUInt16LE(1, 10);
  fim.writeUInt32LE(central.length + nome.length, 12);
  fim.writeUInt32LE(local.length + nome.length + dados.length, 16);
  return Buffer.concat([local, nome, dados, central, nome, fim]);
}

describe("ehNomeDeAnexoValido", () => {
  it("aceita id + extensão de imagem ou de documento, em qualquer das extensões da lista", () => {
    for (const extensao of ["png", "jpg", "gif", "webp", ...EXTENSOES_DE_DOCUMENTO]) {
      expect(ehNomeDeAnexoValido(`a1-B2.${extensao}`)).toBe(true);
    }
  });

  it("recusa caminhos, extensões fora da lista e o .txt do texto extraído", () => {
    for (const nome of ["..\\a.pdf", "../a.pdf", "a/b.pdf", "a1.exe", "a1.PDF", "a1", ".pdf", "a1.pdf.txt", "a1.docx.txt", "a1.jpeg", ""]) {
      expect(ehNomeDeAnexoValido(nome)).toBe(false);
    }
  });
});

describe("ArmazemDeAnexosEmArquivo", () => {
  let pasta: string;
  let armazem: ArmazemDeAnexosEmArquivo;

  beforeEach(async () => {
    pasta = await mkdtemp(path.join(tmpdir(), "armazem-de-anexos-"));
    armazem = new ArmazemDeAnexosEmArquivo(pasta);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(pasta, { recursive: true, force: true });
  });

  const anexo = (id: string, nome: string, tipoDeMidia = "") => Anexo.de({ id, nome, tipoDeMidia, tamanhoEmBytes: 10 });

  it("guarda o arquivo em <pasta>/<chave>/<id>.<extensão>", async () => {
    const conteudo = Buffer.from("%PDF-1.7");

    await armazem.guardar("chat", anexo("a1", "relatorio.pdf"), conteudo);

    expect(armazem.caminhoDe("chat", "a1.pdf")).toBe(path.join(pasta, "chat", "a1.pdf"));
    expect(await readFile(path.join(pasta, "chat", "a1.pdf"))).toEqual(conteudo);
    expect(armazem.pastaDe("chat")).toBe(path.join(pasta, "chat"));
  });

  it("recusa nome de arquivo inválido em caminhoDe e em caminhoDoTextoDe", () => {
    expect(() => armazem.caminhoDe("chat", "..\\..\\x.pdf")).toThrow(/Nome de anexo inválido/);
    expect(() => armazem.caminhoDoTextoDe("chat", "a1.pdf.txt")).toThrow(/Nome de anexo inválido/);
  });

  it("de .docx, extrai o texto para um .txt ao lado, e caminhoDoTextoDe aponta para ele", async () => {
    await armazem.guardar("o1", anexo("d1", "contrato.docx"), docxMinimo("Cláusula 1 &amp; 2"));

    const texto = armazem.caminhoDoTextoDe("o1", "d1.docx");

    expect(texto).toBe(`${path.join(pasta, "o1", "d1.docx")}.txt`);
    expect(await readFile(texto ?? "", "utf8")).toBe("Cláusula 1 & 2");
    expect((await readdir(path.join(pasta, "o1"))).sort()).toEqual(["d1.docx", "d1.docx.txt"]);
  });

  it("formatos sem extração (PDF, texto, .doc) não ganham .txt, e caminhoDoTextoDe devolve nulo", async () => {
    await armazem.guardar("o1", anexo("a1", "relatorio.pdf"), Buffer.from("%PDF"));
    await armazem.guardar("o1", anexo("a2", "notas.md"), Buffer.from("# oi"));
    await armazem.guardar("o1", anexo("a3", "antigo.doc"), Buffer.from([0xd0, 0xcf, 0x11, 0xe0]));
    await armazem.guardar("o1", anexo("a4", "tela.png", "image/png"), Buffer.from([0x89, 0x50]));

    for (const arquivo of ["a1.pdf", "a2.md", "a3.doc", "a4.png"]) {
      expect(armazem.caminhoDoTextoDe("o1", arquivo)).toBeNull();
    }
    expect((await readdir(path.join(pasta, "o1"))).sort()).toEqual(["a1.pdf", "a2.md", "a3.doc", "a4.png"]);
  });

  it("se a extração falhar, o anexo é guardado do mesmo jeito: só um aviso no console", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(armazem.guardar("o1", anexo("d1", "quebrado.docx"), Buffer.from("isto não é um zip"))).resolves.toBeUndefined();

    expect(existsSync(path.join(pasta, "o1", "d1.docx"))).toBe(true);
    expect(armazem.caminhoDoTextoDe("o1", "d1.docx")).toBeNull();
    expect(aviso).toHaveBeenCalledWith(expect.stringContaining('Não deu para extrair o texto de "quebrado.docx"'));
  });

  it("removerTodos apaga a pasta inteira, inclusive os .txt extraídos", async () => {
    await armazem.guardar("o1", anexo("d1", "contrato.docx"), docxMinimo("oi"));

    await armazem.removerTodos("o1");

    expect(existsSync(path.join(pasta, "o1"))).toBe(false);
    expect(armazem.caminhoDoTextoDe("o1", "d1.docx")).toBeNull();
  });
});
