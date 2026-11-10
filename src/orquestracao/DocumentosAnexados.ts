/** Documento anexado ao pedido, já guardado em disco, com o texto extraído ao lado. */
export interface DocumentoDoPedido {
  nome: string;
  /** O arquivo original. */
  caminho: string;
  /** O texto extraído; nulo quando a extração falhou. */
  caminhoDoTexto: string | null;
}

/** As linhas que citam os documentos na mensagem enviada ao Claude. */
export function linhasDosDocumentos(documentos: readonly DocumentoDoPedido[]): string[] {
  if (documentos.length === 0) {
    return [];
  }
  return [
    "",
    "Documentos anexados a este pedido (leia o texto extraído com a ferramenta de leitura; ao delegar, passe aos subagentes os caminhos para eles abrirem):",
    ...documentos.map((documento) =>
      documento.caminhoDoTexto === null
        ? `- "${documento.nome}": não foi possível extrair o texto; tente abrir o original (${documento.caminho}).`
        : `- "${documento.nome}": texto extraído em ${documento.caminhoDoTexto} (original: ${documento.caminho})`,
    ),
  ];
}
