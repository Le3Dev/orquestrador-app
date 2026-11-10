import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import * as XLSX from "xlsx";

import type { TipoDeMidia } from "../../orquestracao/Anexo";

/** Teto do texto extraído: acima disso o texto é cortado e o corte é avisado no próprio texto. */
export const MAXIMO_DE_CARACTERES_EXTRAIDOS = 500_000;

/** Extrai o texto de um documento; lança erro se o arquivo não puder ser lido. */
export type ExtratorDeTexto = (conteudo: Uint8Array, tipoDeMidia: TipoDeMidia) => Promise<string>;

export function truncarTextoExtraido(texto: string, maximo = MAXIMO_DE_CARACTERES_EXTRAIDOS): string {
  if (texto.length <= maximo) {
    return texto;
  }
  return `${texto.slice(0, maximo)}\n\n[Texto cortado: o documento tem ${texto.length} caracteres e só os primeiros ${maximo} foram extraídos.]\n`;
}

function textoDaPlanilha(conteudo: Uint8Array): string {
  const planilha = XLSX.read(conteudo, { type: "buffer", cellDates: true });
  const abas = planilha.SheetNames.map((nome) => {
    const aba = planilha.Sheets[nome];
    return aba === undefined ? null : `## Aba: ${nome}\n${XLSX.utils.sheet_to_csv(aba)}`;
  }).filter((aba): aba is string => aba !== null);
  return abas.join("\n\n");
}

async function textoDoPdf(conteudo: Uint8Array): Promise<string> {
  const leitor = new PDFParse({ data: new Uint8Array(conteudo) });
  try {
    const { text } = await leitor.getText();
    return text;
  } finally {
    await leitor.destroy();
  }
}

export const extrairTextoDoDocumento: ExtratorDeTexto = async (conteudo, tipoDeMidia) => {
  let texto: string;
  switch (tipoDeMidia) {
    case "application/pdf":
      texto = await textoDoPdf(conteudo);
      break;
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      texto = (await mammoth.extractRawText({ buffer: Buffer.from(conteudo) })).value;
      break;
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    case "application/vnd.ms-excel":
      texto = textoDaPlanilha(conteudo);
      break;
    case "text/csv":
    case "text/plain":
    case "text/markdown":
      texto = new TextDecoder("utf-8").decode(conteudo);
      break;
    default:
      throw new Error(`Sem extrator para ${tipoDeMidia}.`);
  }
  return truncarTextoExtraido(texto);
};
