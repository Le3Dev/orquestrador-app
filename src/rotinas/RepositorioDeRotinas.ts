import { Rotina } from "./Rotina";

/**
 * Porta: onde as Rotinas ficam guardadas. Quem busca recebe sempre uma cópia:
 * alterá-la só vale depois de `salvar`.
 */
export interface RepositorioDeRotinas {
  /** Da mais antiga para a mais nova. */
  todas(): readonly Rotina[];
  buscar(id: string): Rotina | null;
  salvar(rotina: Rotina): Promise<void>;
  /** Remove a Rotina e as execuções dela. */
  remover(id: string): Promise<void>;
}
