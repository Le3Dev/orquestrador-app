import { Nota } from "./Nota";

/**
 * As Notas do usuário, tratadas como uma coleção em memória.
 *
 * As leituras são síncronas de propósito: entre buscar uma Nota, alterá-la e
 * salvá-la não há espera, então duas edições rápidas da mesma Nota nunca se
 * intercalam — a segunda sempre parte do que a primeira gravou.
 *
 * `buscar` e `todas` devolvem cópias: alterar uma Nota buscada não muda nada
 * no repositório até ela ser salva.
 */
export interface RepositorioDeNotas {
  /** Em ordem de criação, da mais antiga para a mais nova. */
  todas(): readonly Nota[];
  buscar(id: string): Nota | null;
  /** Resolve quando a Nota estiver gravada; gravações da mesma Nota seguem a ordem em que foram pedidas. */
  salvar(nota: Nota): Promise<void>;
  remover(id: string): Promise<void>;
}
