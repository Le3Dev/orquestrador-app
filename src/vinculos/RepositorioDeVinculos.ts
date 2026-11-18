import { Vinculo } from "./Vinculo";

/**
 * Os Vínculos entre Orquestradores, tratados como uma coleção em memória (as
 * leituras são síncronas, como nas Notas: buscar, alterar e salvar não têm
 * espera no meio). `buscar` e `todos` devolvem cópias.
 */
export interface RepositorioDeVinculos {
  /** Em ordem de criação, do mais antigo para o mais novo. */
  todos(): readonly Vinculo[];
  buscar(id: string): Vinculo | null;
  /** Resolve quando o Vínculo estiver gravado. */
  salvar(vinculo: Vinculo): Promise<void>;
  remover(id: string): Promise<void>;
}
