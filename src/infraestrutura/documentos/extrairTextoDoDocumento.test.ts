import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { Anexo } from "../../orquestracao/Anexo";
import { linhasDosDocumentos } from "../../orquestracao/DocumentosAnexados";
import { ArmazemDeAnexosEmArquivo, ehNomeDeAnexoValido } from "../arquivos/ArmazemDeAnexosEmArquivo";
import { extrairTextoDoDocumento, MAXIMO_DE_CARACTERES_EXTRAIDOS, truncarTextoExtraido } from "./extrairTextoDoDocumento";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_TIPO = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const codificar = (texto: string) => new TextEncoder().encode(texto);

/** Um .docx mínimo: só os três arquivos que o formato exige. */
async function criarDocx(paragrafos: string[]): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  const corpo = paragrafos.map((texto) => `<w:p><w:r><w:t>${texto}</w:t></w:r></w:p>`).join("");
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${corpo}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}

function criarPlanilha(formato: "xlsx" | "biff8"): Uint8Array {
  const livro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(livro, XLSX.utils.aoa_to_sheet([["produto", "preço"], ["mesa", 10]]), "Vendas");
  XLSX.utils.book_append_sheet(livro, XLSX.utils.aoa_to_sheet([["cidade"], ["Recife"]]), "Cidades");
  return XLSX.write(livro, { type: "buffer", bookType: formato === "xlsx" ? "xlsx" : "biff8" }) as Uint8Array;
}

/** Um PDF mínimo de uma página com um texto; o leitor reconstrói a tabela de referências. */
function criarPdf(texto: string): Uint8Array {
  const fluxo = `BT /F1 18 Tf 20 100 Td (${texto}) Tj ET`;
  const objetos = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${fluxo.length} >>\nstream\n${fluxo}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const posicoes: number[] = [];
  objetos.forEach((objeto, indice) => {
    posicoes.push(pdf.length);
    pdf += `${indice + 1} 0 obj\n${objeto}\nendobj\n`;
  });
  const inicioDaTabela = pdf.length;
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (const posicao of posicoes) {
    pdf += `${String(posicao).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${inicioDaTabela}\n%%EOF\n`;
  return codificar(pdf);
}

describe("extrairTextoDoDocumento", () => {
  it("lê CSV, TXT e MD como texto UTF-8", async () => {
    expect(await extrairTextoDoDocumento(codificar("a,b\nçã,2\n"), "text/csv")).toBe("a,b\nçã,2\n");
    expect(await extrairTextoDoDocumento(codificar("olá"), "text/plain")).toBe("olá");
    expect(await extrairTextoDoDocumento(codificar("# Título"), "text/markdown")).toBe("# Título");
  });

  it("extrai o texto de um DOCX", async () => {
    const texto = await extrairTextoDoDocumento(await criarDocx(["Primeiro parágrafo", "Segundo parágrafo"]), DOCX);
    expect(texto).toContain("Primeiro parágrafo");
    expect(texto).toContain("Segundo parágrafo");
  });

  it("extrai todas as abas de um XLSX e de um XLS em CSV", async () => {
    for (const [formato, tipo] of [
      ["xlsx", XLSX_TIPO],
      ["biff8", "application/vnd.ms-excel"],
    ] as const) {
      const texto = await extrairTextoDoDocumento(criarPlanilha(formato), tipo);
      expect(texto).toContain("## Aba: Vendas");
      expect(texto).toContain("produto,preço");
      expect(texto).toContain("mesa,10");
      expect(texto).toContain("## Aba: Cidades");
      expect(texto).toContain("Recife");
    }
  });

  it("extrai o texto de um PDF", async () => {
    const texto = await extrairTextoDoDocumento(criarPdf("Contrato de teste"), "application/pdf");
    expect(texto).toContain("Contrato de teste");
  });

  it("falha com arquivo corrompido (o armazém trata)", async () => {
    await expect(extrairTextoDoDocumento(codificar("isto não é um zip"), DOCX)).rejects.toThrow();
    await expect(extrairTextoDoDocumento(codificar("isto não é um pdf"), "application/pdf")).rejects.toThrow();
  });

  it("corta o texto acima do teto e avisa no próprio texto", () => {
    const longo = "a".repeat(MAXIMO_DE_CARACTERES_EXTRAIDOS + 10);
    const cortado = truncarTextoExtraido(longo);
    expect(cortado.startsWith("a".repeat(MAXIMO_DE_CARACTERES_EXTRAIDOS))).toBe(true);
    expect(cortado).toContain("Texto cortado");
    expect(truncarTextoExtraido("curto")).toBe("curto");
  });
});

describe("ArmazemDeAnexosEmArquivo com documentos", () => {
  let pasta: string;
  let armazem: ArmazemDeAnexosEmArquivo;

  beforeEach(async () => {
    pasta = await mkdtemp(path.join(tmpdir(), "anexos-"));
    armazem = new ArmazemDeAnexosEmArquivo(pasta);
  });
  afterEach(async () => {
    await rm(pasta, { recursive: true, force: true });
  });

  const anexo = (nome: string, tipoDeMidia: string, tamanho = 10) =>
    Anexo.de({ id: "abc-1", nome, tipoDeMidia, tamanhoEmBytes: tamanho });

  it("guarda o original e o texto extraído ao lado", async () => {
    const csv = codificar("a,b\n1,2\n");
    await armazem.guardar("o1", anexo("dados.csv", ""), csv);

    expect(await readFile(armazem.caminhoDe("o1", "abc-1.csv"), "utf8")).toBe("a,b\n1,2\n");
    const caminhoDoTexto = await armazem.caminhoDoTexto("o1", "abc-1");
    expect(caminhoDoTexto).toBe(armazem.caminhoDe("o1", "abc-1.texto.txt"));
    expect(await readFile(caminhoDoTexto ?? "", "utf8")).toBe("a,b\n1,2\n");
  });

  it("um .txt não colide com o texto extraído", async () => {
    await armazem.guardar("o1", anexo("nota.txt", "text/plain"), codificar("oi"));
    expect(await readFile(armazem.caminhoDe("o1", "abc-1.txt"), "utf8")).toBe("oi");
    expect(await readFile(armazem.caminhoDe("o1", "abc-1.texto.txt"), "utf8")).toBe("oi");
  });

  it("não derruba a mensagem quando a extração falha: fica só o original", async () => {
    const aviso = console.warn;
    console.warn = () => undefined;
    try {
      await armazem.guardar("o1", anexo("quebrado.docx", DOCX), codificar("lixo"));
    } finally {
      console.warn = aviso;
    }
    expect(await readFile(armazem.caminhoDe("o1", "abc-1.docx"), "utf8")).toBe("lixo");
    expect(await armazem.caminhoDoTexto("o1", "abc-1")).toBeNull();
  });

  it("não cria texto para imagens", async () => {
    await armazem.guardar("o1", anexo("tela.png", "image/png"), new Uint8Array([1, 2]));
    expect(await armazem.caminhoDoTexto("o1", "abc-1")).toBeNull();
  });

  it("aceita só nomes gerados por nós", () => {
    for (const valido of ["a1.png", "a1.pdf", "a1.docx", "a1.xlsx", "a1.xls", "a1.csv", "a1.txt", "a1.md", "a1.texto.txt"]) {
      expect(ehNomeDeAnexoValido(valido)).toBe(true);
    }
    for (const invalido of ["a1.exe", "a1.html", "..\\a1.txt", "../a1.txt", "a1.texto.texto.txt", "a1.svg", "a1"]) {
      expect(ehNomeDeAnexoValido(invalido)).toBe(false);
    }
  });
});

describe("linhasDosDocumentos", () => {
  it("cita o nome, o texto extraído e o original; e avisa quando não foi possível extrair", () => {
    const linhas = linhasDosDocumentos([
      { nome: "a.docx", caminho: "/x/a.docx", caminhoDoTexto: "/x/a.texto.txt" },
      { nome: "b.pdf", caminho: "/x/b.pdf", caminhoDoTexto: null },
    ]).join("\n");

    expect(linhas).toContain('"a.docx": texto extraído em /x/a.texto.txt (original: /x/a.docx)');
    expect(linhas).toContain('"b.pdf": não foi possível extrair o texto');
    expect(linhas).toContain("/x/b.pdf");
    expect(linhasDosDocumentos([])).toEqual([]);
  });
});
