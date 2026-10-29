import { EventoDeOrquestracao, EventoRegistrado } from "./EventoDeOrquestracao";
import { Orquestrador } from "./Orquestrador";

/**
 * Os Orquestradores e o histórico de eventos de cada um, tratados como uma
 * coleção em memória.
 *
 * As leituras e `anexarEvento` são síncronas de propósito: o motor emite
 * eventos em rajada durante um turno, e a sequência de cada evento precisa
 * ser decidida na hora, na ordem em que chegam — a gravação em disco segue
 * em segundo plano, na mesma ordem.
 */
export interface RepositorioDeOrquestradores {
  listar(): readonly Orquestrador[];
  buscarPorId(id: string): Orquestrador | null;
  salvar(orquestrador: Orquestrador): Promise<void>;
  remover(id: string): Promise<void>;
  anexarEvento(orquestradorId: string, evento: EventoDeOrquestracao): EventoRegistrado;
  lerEventos(orquestradorId: string, depoisDaSequencia: number): readonly EventoRegistrado[];
}
