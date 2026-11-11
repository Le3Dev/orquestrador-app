import { Anexo } from "./Anexo";

/**
 * Onde ficam os arquivos (imagens e documentos) anexados às mensagens. A chave
 * separa as conversas: o id do Orquestrador, ou "chat" no chat rápido.
 */
export interface ArmazemDeAnexos {
  /**
   * Guarda o arquivo. Word, Excel e PowerPoint modernos ganham também o texto
   * extraído, num `.txt` ao lado; se a extração falhar, o anexo segue sem ele.
   */
  guardar(orquestradorId: string, anexo: Anexo, conteudo: Uint8Array): Promise<void>;
  /** Caminho absoluto do arquivo — é o que os Subagentes abrem. */
  caminhoDe(orquestradorId: string, arquivo: string): string;
  /** Caminho do `.txt` com o texto extraído do arquivo; nulo se não há (formato sem extração ou extração que falhou). */
  caminhoDoTextoDe(orquestradorId: string, arquivo: string): string | null;
  /** Pasta com os anexos do Orquestrador, liberada para leitura dos agentes. */
  pastaDe(orquestradorId: string): string;
  removerTodos(orquestradorId: string): Promise<void>;
}
