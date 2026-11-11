import { desarmarMarcas } from "./InstrucoesPersonalizadas";

/** O que as instruções dizem de um documento anexado: onde ele está e se há texto extraído. */
export interface DocumentoAnexado {
  caminho: string;
  nome: string;
  /** Nome do formato para o usuário: "PDF", "Excel"... */
  rotulo: string;
  tamanhoEmBytes: number;
  /** Texto extraído (Word, Excel, PowerPoint modernos) gravado ao lado; nulo sem extração. */
  caminhoDoTexto: string | null;
  /** Formato binário antigo (.doc, .xls): sem texto extraído. */
  legado: boolean;
}

/** Tamanho legível, com vírgula decimal: "300 KB", "1,2 MB". */
export function formatarTamanho(bytes: number): string {
  const decimal = (valor: number) => `${Math.round(valor * 10) / 10}`.replace(".", ",");
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${decimal(bytes / 1024)} KB`;
  }
  return `${decimal(bytes / 1024 / 1024)} MB`;
}

/**
 * As linhas do bloco que lista os documentos anexados a uma mensagem, com o
 * caminho de cada um para o agente abrir. O nome vem do usuário: entra como dado,
 * numa linha só e sem poder fechar o bloco em que está (`marcasDoBloco`).
 *
 * Sem documentos, nenhuma linha.
 */
export function linhasDosDocumentosAnexados(
  documentos: readonly DocumentoAnexado[],
  introducao: string,
  marcasDoBloco: readonly string[],
): string[] {
  if (documentos.length === 0) {
    return [];
  }
  return [
    "",
    introducao,
    ...documentos.map((documento) => {
      const nome = desarmarMarcas(documento.nome.replace(/[\r\n\t]+/g, " "), marcasDoBloco);
      const base = `- ${nome} (${documento.rotulo}, ${formatarTamanho(documento.tamanhoEmBytes)}): ${documento.caminho}`;
      if (documento.caminhoDoTexto !== null) {
        return `${base} — texto extraído: ${documento.caminhoDoTexto}`;
      }
      if (documento.legado) {
        return `${base} — formato antigo, sem texto extraído: só dá para ler convertendo com um comando no terminal`;
      }
      return base;
    }),
  ];
}
