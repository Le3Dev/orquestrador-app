import { Anexo } from "./Anexo";

/** Onde ficam as imagens e os documentos anexados às mensagens de cada Orquestrador. */
export interface ArmazemDeAnexos {
  /** Guarda o original; num documento, guarda também o texto extraído (se a extração falhar, só o original). */
  guardar(orquestradorId: string, anexo: Anexo, conteudo: Uint8Array): Promise<void>;
  /** Caminho absoluto do arquivo — é o que os Subagentes abrem. */
  caminhoDe(orquestradorId: string, arquivo: string): string;
  /** Caminho do texto extraído do documento `anexoId`; nulo se não há (imagem ou extração que falhou). */
  caminhoDoTexto(orquestradorId: string, anexoId: string): Promise<string | null>;
  /** Pasta com os anexos do Orquestrador, liberada para leitura dos agentes. */
  pastaDe(orquestradorId: string): string;
  removerTodos(orquestradorId: string): Promise<void>;
}
