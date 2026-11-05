import { EventoDeOrquestracao, EventoRegistrado } from "./EventoDeOrquestracao";
import { Orquestrador } from "./Orquestrador";

/** O evento de limpeza já registrado e a gravação em disco, que segue em segundo plano. */
export interface ConversaArquivada {
  registrado: EventoRegistrado;
  /** Resolve quando a conversa anterior estiver arquivada e a nova gravada. */
  gravacao: Promise<void>;
}

/**
 * Os Orquestradores e o histórico de eventos de cada um, tratados como uma
 * coleção em memória.
 *
 * As leituras, `anexarEvento` e `arquivarConversa` decidem tudo na hora, de
 * forma síncrona: o motor emite eventos em rajada durante um turno, e a
 * sequência de cada evento precisa ser decidida na ordem em que chegam — a
 * gravação em disco segue em segundo plano, na mesma ordem.
 */
export interface RepositorioDeOrquestradores {
  listar(): readonly Orquestrador[];
  buscarPorId(id: string): Orquestrador | null;
  salvar(orquestrador: Orquestrador): Promise<void>;
  remover(id: string): Promise<void>;
  anexarEvento(orquestradorId: string, evento: EventoDeOrquestracao): EventoRegistrado;
  /**
   * Arquiva o histórico da conversa atual e começa o da nova com `evento` (a
   * limpeza da conversa), gravando também o Orquestrador já limpo. A
   * sequência continua a do histórico anterior: nunca recomeça.
   */
  arquivarConversa(orquestrador: Orquestrador, evento: EventoDeOrquestracao): ConversaArquivada;
  lerEventos(orquestradorId: string, depoisDaSequencia: number): readonly EventoRegistrado[];
}
