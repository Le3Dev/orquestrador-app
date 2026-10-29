import { Anexo } from "./Anexo";

/** Onde ficam as imagens anexadas às mensagens de cada Orquestrador. */
export interface ArmazemDeAnexos {
  guardar(orquestradorId: string, anexo: Anexo, conteudo: Uint8Array): Promise<void>;
  /** Caminho absoluto do arquivo — é o que os Subagentes abrem. */
  caminhoDe(orquestradorId: string, arquivo: string): string;
  /** Pasta com os anexos do Orquestrador, liberada para leitura dos agentes. */
  pastaDe(orquestradorId: string): string;
  removerTodos(orquestradorId: string): Promise<void>;
}
