import { DadosDoArtefato } from "./Artefato";

/**
 * O que acontece com os Artefatos, para as telas conectadas. Só ao vivo: não
 * há histórico; a tela recarrega a lista ao (re)conectar.
 */
export type EventoDeArtefato =
  | { tipo: "artefato_criado"; artefato: DadosDoArtefato }
  | { tipo: "versao_adicionada"; artefato: DadosDoArtefato }
  | { tipo: "artefato_renomeado"; artefato: DadosDoArtefato }
  | { tipo: "artefato_removido"; id: string };

export type TipoDeEventoDeArtefato = EventoDeArtefato["tipo"];

/** Porta: entrega os eventos às telas (na infraestrutura, por SSE). */
export interface PublicadorDeArtefatos {
  publicar(evento: EventoDeArtefato): void;
}
