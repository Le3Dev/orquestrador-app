import { deflateRawSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import {
  ErroDeExtracaoDeTexto,
  extrairTextoDoDocumento,
  LIMITES_DA_EXTRACAO,
} from "./ExtratorDeTextoDeDocumentos";

interface EntradaDoZip {
  nome: string;
  conteudo: Buffer | string;
  /** 8 (deflate, o padrão) ou 0 (guardado sem compressão). */
  metodo?: 0 | 8;
  /** Tamanho que o diretório central declara, para simular um zip que mente. */
  tamanhoDeclarado?: number;
}

/**
 * Escritor de zip em memória, só para os testes: cabeçalho local, dados, diretório
 * central e fim do diretório. O CRC fica zerado, porque o leitor não o confere.
 */
function montarZip(entradas: EntradaDoZip[]): Buffer {
  const locais: Buffer[] = [];
  const centrais: Buffer[] = [];
  let deslocamento = 0;

  for (const entrada of entradas) {
    const nome = Buffer.from(entrada.nome, "utf8");
    const original = Buffer.isBuffer(entrada.conteudo) ? entrada.conteudo : Buffer.from(entrada.conteudo, "utf8");
    const metodo = entrada.metodo ?? 8;
    const dados = metodo === 8 ? deflateRawSync(original) : original;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(metodo, 8);
    local.writeUInt32LE(dados.length, 18);
    local.writeUInt32LE(original.length, 22);
    local.writeUInt16LE(nome.length, 26);
    locais.push(local, nome, dados);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(metodo, 10);
    central.writeUInt32LE(dados.length, 20);
    central.writeUInt32LE(entrada.tamanhoDeclarado ?? original.length, 24);
    central.writeUInt16LE(nome.length, 28);
    central.writeUInt32LE(deslocamento, 42);
    centrais.push(central, nome);

    deslocamento += local.length + nome.length + dados.length;
  }

  const diretorio = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(entradas.length, 8);
  fim.writeUInt16LE(entradas.length, 10);
  fim.writeUInt32LE(diretorio.length, 12);
  fim.writeUInt32LE(deslocamento, 16);
  return Buffer.concat([...locais, diretorio, fim]);
}

const CABECALHO_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function paragrafo(...conteudo: string[]): string {
  return `<w:p>${conteudo.join("")}</w:p>`;
}

function documentoDoWord(corpo: string): Buffer {
  return montarZip([
    {
      nome: "word/document.xml",
      conteudo: `${CABECALHO_XML}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${corpo}</w:body></w:document>`,
    },
  ]);
}

describe("extrairTextoDoDocumento — Word (.docx)", () => {
  it("junta o texto das runs, uma linha por parágrafo", () => {
    const docx = documentoDoWord(
      paragrafo("<w:r><w:t>Contrato de </w:t></w:r>", '<w:r><w:t xml:space="preserve">prestação</w:t></w:r>') +
        paragrafo("<w:r><w:t>Segundo parágrafo.</w:t></w:r>"),
    );

    expect(extrairTextoDoDocumento("docx", docx)).toBe("Contrato de prestação\nSegundo parágrafo.");
  });

  it("converte <w:tab/> em tab e <w:br/> em quebra de linha, e ignora as paradas de tabulação", () => {
    const docx = documentoDoWord(
      paragrafo(
        '<w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr>',
        "<w:r><w:t>Nome</w:t><w:tab/><w:t>Valor</w:t><w:br/><w:t>Linha 2</w:t></w:r>",
        '<w:r><w:br w:type="page"/></w:r>',
        "<w:r><w:t/><w:t>Fim</w:t></w:r>",
      ),
    );

    expect(extrairTextoDoDocumento("docx", docx)).toBe("Nome\tValor\nLinha 2\nFim");
  });

  it("decodifica as entidades XML, nomeadas e numéricas", () => {
    const docx = documentoDoWord(
      paragrafo("<w:r><w:t>Tom &amp; Jerry &lt;3 &gt; &quot;oi&quot; &apos;ok&apos; caf&#233; caf&#xE9; &#128512;</w:t></w:r>") +
        paragrafo("<w:r><w:t>&#99999999; &desconhecida;</w:t></w:r>"),
    );

    expect(extrairTextoDoDocumento("docx", docx)).toBe(
      `Tom & Jerry <3 > "oi" 'ok' café café 😀\n&#99999999; &desconhecida;`,
    );
  });

  it("lê também uma entrada guardada sem compressão (método 0)", () => {
    const docx = montarZip([
      { nome: "word/document.xml", metodo: 0, conteudo: `<w:document><w:body>${paragrafo("<w:r><w:t>Sem compressão</w:t></w:r>")}</w:body></w:document>` },
    ]);

    expect(extrairTextoDoDocumento("docx", docx)).toBe("Sem compressão");
  });

  it("aceita a extensão em maiúsculas", () => {
    expect(extrairTextoDoDocumento("DOCX", documentoDoWord(paragrafo("<w:r><w:t>oi</w:t></w:r>")))).toBe("oi");
  });

  it("um zip sem word/document.xml não é um Word", () => {
    const outro = montarZip([{ nome: "xl/workbook.xml", conteudo: "<workbook/>" }]);

    expect(() => extrairTextoDoDocumento("docx", outro)).toThrow(/não parece ser um documento do Word/);
  });
});

function planilhaDoExcel(planilhas: Record<string, string>, extras: EntradaDoZip[] = []): Buffer {
  return montarZip([
    ...Object.entries(planilhas).map(([nome, conteudo]) => ({ nome, conteudo })),
    ...extras,
  ]);
}

const WORKBOOK = `${CABECALHO_XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Vendas &amp; Metas" sheetId="1" r:id="rId3"/><sheet name="Resumo" sheetId="2" r:id="rId1"/></sheets></workbook>`;
const RELACOES = `${CABECALHO_XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="x/styles" Target="styles.xml"/><Relationship Id="rId3" Type="x/worksheet" Target="/xl/worksheets/sheet2.xml"/></Relationships>`;
const TEXTOS = `${CABECALHO_XML}<sst count="4" uniqueCount="4"><si><t>Produto</t></si><si><r><t>Total </t></r><r><rPr/><t>geral</t></r><rPh><t>fonético</t></rPh></si><si><t>Linha&#10;dupla</t></si><si><t>Café &amp; Pão</t></si></sst>`;

describe("extrairTextoDoDocumento — Excel (.xlsx)", () => {
  it("monta uma seção por planilha, na ordem do workbook, com as células separadas por tab", () => {
    const xlsx = planilhaDoExcel(
      {
        "xl/workbook.xml": WORKBOOK,
        "xl/_rels/workbook.xml.rels": RELACOES,
        "xl/sharedStrings.xml": TEXTOS,
        // "Vendas & Metas" é a sheet2.xml (rId3); "Resumo" é a sheet1.xml (rId1).
        "xl/worksheets/sheet2.xml": `<worksheet><sheetData>
          <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
          <row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><v>1234.5</v></c></row>
        </sheetData></worksheet>`,
        "xl/worksheets/sheet1.xml": `<worksheet><sheetData>
          <row r="1"><c r="A1" t="inlineStr"><is><t>Texto direto</t></is></c></row>
        </sheetData></worksheet>`,
      },
    );

    expect(extrairTextoDoDocumento("xlsx", xlsx)).toBe(
      ["## Vendas & Metas", "Produto\tTotal geral", "Café & Pão\t1234.5", "", "## Resumo", "Texto direto"].join("\n"),
    );
  });

  it("usa sharedStrings (com texto formatado), inlineStr, booleanos, fórmulas com texto e erros", () => {
    const xlsx = planilhaDoExcel({
      "xl/sharedStrings.xml": TEXTOS,
      "xl/worksheets/sheet1.xml": `<worksheet><sheetData>
        <row r="1">
          <c r="A1" t="s"><v>1</v></c>
          <c r="B1" t="inlineStr"><is><r><t>em </t></r><r><t>partes</t></r></is></c>
          <c r="C1" t="b"><v>1</v></c>
          <c r="D1" t="b"><v>0</v></c>
          <c r="E1" t="str"><f>A1&amp;"!"</f><v>Total geral!</v></c>
          <c r="F1" t="e"><v>#DIV/0!</v></c>
          <c r="G1" t="s"><v>2</v></c>
        </row>
      </sheetData></worksheet>`,
    });

    expect(extrairTextoDoDocumento("xlsx", xlsx)).toBe(
      "## Planilha 1\nTotal geral\tem partes\tVERDADEIRO\tFALSO\tTotal geral!\t#DIV/0!\tLinha dupla",
    );
  });

  it("respeita a coluna de cada célula, preenchendo as puladas, e ignora linhas vazias", () => {
    const xlsx = planilhaDoExcel({
      "xl/worksheets/sheet1.xml": `<worksheet><sheetData>
        <row r="1"><c r="A1"><v>1</v></c><c r="C1"><v>3</v></c><c r="E1"><v>5</v></c></row>
        <row r="2"><c r="A2" s="4"/><c r="B2" s="4"/></row>
        <row r="3"><c r="C3"><v>só na C</v></c></row>
        <row r="4"/>
        <row r="5"><c r="AA5" t="inlineStr"><is><t>AA</t></is></c></row>
      </sheetData></worksheet>`,
    });

    const linhas = (extrairTextoDoDocumento("xlsx", xlsx) ?? "").split("\n").slice(1).map((linha) => linha.split("\t"));
    // Só as três linhas com valor: a 2 (só estilo) e a 4 (vazia) não aparecem.
    expect(linhas).toHaveLength(3);
    const [linha1, linha3, linha5] = linhas;
    expect(linha1).toEqual(["1", "", "3", "", "5"]);
    expect(linha3).toEqual(["", "", "só na C"]);
    expect(linha5).toHaveLength(27);
    expect(linha5?.[26]).toBe("AA");
  });

  it("sem workbook, usa as planilhas pelo número do arquivo, em ordem numérica", () => {
    const xlsx = planilhaDoExcel({
      "xl/worksheets/sheet10.xml": '<worksheet><sheetData><row><c t="inlineStr"><is><t>dez</t></is></c></row></sheetData></worksheet>',
      "xl/worksheets/sheet2.xml": '<worksheet><sheetData><row><c t="inlineStr"><is><t>dois</t></is></c></row></sheetData></worksheet>',
    });

    expect(extrairTextoDoDocumento("xlsx", xlsx)).toBe("## Planilha 2\ndois\n\n## Planilha 10\ndez");
  });

  it("um zip sem planilhas não é um Excel", () => {
    const docx = documentoDoWord(paragrafo("<w:r><w:t>oi</w:t></w:r>"));

    expect(() => extrairTextoDoDocumento("xlsx", docx)).toThrow(/não parece ser uma planilha do Excel/);
  });
});

describe("extrairTextoDoDocumento — PowerPoint (.pptx)", () => {
  const slide = (...paragrafos: string[]) =>
    `<p:sld><p:cSld><p:spTree><p:sp><p:txBody>${paragrafos
      .map((texto) => `<a:p><a:r><a:t>${texto}</a:t></a:r></a:p>`)
      .join("")}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;

  it("junta os slides em ordem numérica (1, 2, 10), cada um com o seu título", () => {
    const pptx = montarZip([
      { nome: "ppt/slides/slide10.xml", conteudo: slide("Fim") },
      { nome: "ppt/slides/slide2.xml", conteudo: slide("Agenda", "Item &amp; item") },
      { nome: "ppt/slides/slide1.xml", conteudo: slide("Capa") },
      { nome: "ppt/presentation.xml", conteudo: "<p:presentation/>" },
    ]);

    expect(extrairTextoDoDocumento("pptx", pptx)).toBe(
      ["## Slide 1", "Capa", "", "## Slide 2", "Agenda", "Item & item", "", "## Slide 10", "Fim"].join("\n"),
    );
  });

  it("converte <a:br/> em quebra de linha", () => {
    const pptx = montarZip([
      { nome: "ppt/slides/slide1.xml", conteudo: "<p:sld><a:p><a:r><a:t>Linha 1</a:t></a:r><a:br/><a:r><a:t>Linha 2</a:t></a:r></a:p></p:sld>" },
    ]);

    expect(extrairTextoDoDocumento("pptx", pptx)).toBe("## Slide 1\nLinha 1\nLinha 2");
  });

  it("um zip sem slides não é uma apresentação", () => {
    expect(() => extrairTextoDoDocumento("pptx", montarZip([{ nome: "a.txt", conteudo: "x" }]))).toThrow(
      /não parece ser uma apresentação do PowerPoint/,
    );
  });
});

describe("extrairTextoDoDocumento — arquivos inválidos e perigosos", () => {
  it("devolve nulo para formatos de que não se extrai texto", () => {
    expect(extrairTextoDoDocumento("pdf", Buffer.from("%PDF-1.7"))).toBeNull();
    expect(extrairTextoDoDocumento("doc", Buffer.from([1, 2, 3]))).toBeNull();
  });

  it("recusa com uma mensagem clara o que não é um zip", () => {
    for (const lixo of [Buffer.from("isto não é um zip"), Buffer.alloc(0), Buffer.alloc(10, 1)]) {
      const falha = () => extrairTextoDoDocumento("docx", lixo);

      expect(falha).toThrow(ErroDeExtracaoDeTexto);
      expect(falha).toThrow(/corrompido ou incompleto/);
    }
  });

  it("recusa um zip cortado no meio", () => {
    const inteiro = documentoDoWord(paragrafo("<w:r><w:t>texto</w:t></w:r>"));

    expect(() => extrairTextoDoDocumento("docx", inteiro.subarray(0, inteiro.length - 30))).toThrow(
      /corrompido ou incompleto/,
    );
  });

  it("recusa dados comprimidos corrompidos", () => {
    const docx = documentoDoWord(paragrafo("<w:r><w:t>texto</w:t></w:r>"));
    const corrompido = Buffer.from(docx);
    // Estraga o começo dos dados deflate da única entrada (logo depois do cabeçalho local e do nome).
    corrompido.fill(0xff, 30 + "word/document.xml".length, 30 + "word/document.xml".length + 8);

    expect(() => extrairTextoDoDocumento("docx", corrompido)).toThrow(/corrompido ou incompleto/);
  });

  it("recusa um zip bomb pelo tamanho descompactado declarado", () => {
    const bomba = documentoDoWord("x".repeat(LIMITES_DA_EXTRACAO.bytesPorEntrada + 1));

    expect(() => extrairTextoDoDocumento("docx", bomba)).toThrow(/grande demais.*zip bomb/);
  });

  it("recusa um zip bomb que mente sobre o tamanho: o teto vale para o que de fato descompacta", () => {
    const bomba = montarZip([
      { nome: "word/document.xml", conteudo: Buffer.alloc(LIMITES_DA_EXTRACAO.bytesPorEntrada + 1024, 0x61), tamanhoDeclarado: 10 },
    ]);

    expect(() => extrairTextoDoDocumento("docx", bomba)).toThrow(/grande demais.*zip bomb/);
  });

  it("recusa o total descompactado acima do teto, mesmo com cada entrada abaixo do seu", () => {
    const xlsx = planilhaDoExcel({
      "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${"a".repeat(600)}</t></is></c></row></sheetData></worksheet>`,
      "xl/worksheets/sheet2.xml": `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${"b".repeat(600)}</t></is></c></row></sheetData></worksheet>`,
    });

    expect(extrairTextoDoDocumento("xlsx", xlsx, { bytesNoTotal: 2000 })).toContain("## Planilha 2");
    expect(() => extrairTextoDoDocumento("xlsx", xlsx, { bytesNoTotal: 1000 })).toThrow(/zip bomb/);
  });

  it("recusa um zip com entradas demais", () => {
    const muitas = montarZip(
      Array.from({ length: LIMITES_DA_EXTRACAO.entradas + 1 }, (_, indice) => ({ nome: `f${indice}.txt`, conteudo: "", metodo: 0 as const })),
    );

    expect(() => extrairTextoDoDocumento("docx", muitas)).toThrow(/entradas demais/);
  });

  it("corta o texto que passa do teto, com um aviso no fim", () => {
    const docx = documentoDoWord(paragrafo(`<w:r><w:t>${"palavra ".repeat(100)}</w:t></w:r>`));

    const texto = extrairTextoDoDocumento("docx", docx, { caracteresDoTexto: 100 }) ?? "";

    expect(texto.startsWith("palavra palavra")).toBe(true);
    expect(texto).toContain("[Texto cortado aqui: o documento passa do limite de");
    expect(texto.length).toBeLessThan(250);
  });

  it("recusa um documento protegido por senha, dizendo o motivo", () => {
    const docx = documentoDoWord(paragrafo("<w:r><w:t>segredo</w:t></w:r>"));
    // Liga o bit de criptografia (bit 0 das marcas) no cabeçalho do diretório central.
    const posicaoDoCentral = docx.length - 22 - (46 + "word/document.xml".length);
    docx.writeUInt16LE(1, posicaoDoCentral + 8);

    expect(() => extrairTextoDoDocumento("docx", docx)).toThrow(/protegido por senha/);
  });
});
