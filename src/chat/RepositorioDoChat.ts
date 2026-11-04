import type { JanelaDaCota } from "../orquestracao/EventoDeOrquestracao";
import type { ConversaDoChat } from "./ConversaDoChat";
import type { EventoDoChat, EventoDoChatRegistrado } from "./EventoDoChat";
import type { PreferenciasDoChat } from "./PreferenciasDoChat";

/** O evento de limpeza já registrado e a gravação em disco, que segue em segundo plano. */
export interface ConversaDoChatArquivada {
  registrado: EventoDoChatRegistrado;
  /** Resolve quando a conversa anterior estiver arquivada e a nova gravada. */
  gravacao: Promise<void>;
}

/**
 * A conversa do chat (há sempre uma), o histórico de eventos dela e as
 * preferências, tratados como uma coleção em memória.
 *
 * `conversa`, `anexarEvento` e `arquivarConversa` decidem tudo na hora, de
 * forma síncrona — a sequência de cada evento sai na ordem em que chegam; a
 * gravação em disco segue em segundo plano, na mesma ordem.
 */
export interface RepositorioDoChat {
  /** A conversa atual; sempre existe (uma nova é criada quando não há nenhuma). */
  conversa(): ConversaDoChat;
  salvar(conversa: ConversaDoChat): Promise<void>;
  /** Ficam fora da conversa: sobrevivem ao "/clear". */
  preferencias(): PreferenciasDoChat;
  salvarPreferencias(preferencias: PreferenciasDoChat): Promise<void>;
  anexarEvento(evento: EventoDoChat): EventoDoChatRegistrado;
  /**
   * Arquiva o histórico da conversa atual e começa o da nova com `evento` (a
   * limpeza), gravando também a conversa já limpa. A sequência continua.
   */
  arquivarConversa(conversa: ConversaDoChat, evento: EventoDoChat): ConversaDoChatArquivada;
  lerEventos(depoisDaSequencia: number): readonly EventoDoChatRegistrado[];
  /** Sequência do último evento registrado (0 sem nenhum). */
  ultimaSequencia(): number;
  /** As janelas de cota mais recentes que o Claude Code informou, ou `null`. */
  ultimaCota(): JanelaDaCota[] | null;
}
