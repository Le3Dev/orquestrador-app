import type { JanelaDaCota } from "../orquestracao/EventoDeOrquestracao";
import type { AcaoDoApp } from "./AcaoDoApp";
import type { DadosDaMensagemDoChat } from "./MensagemDoChat";
import type { UsoDaResposta } from "./MotorDeChat";
import type { DadosDasPreferenciasDoChat } from "./PreferenciasDoChat";

/**
 * Tudo o que acontece no chat e muda o que a tela mostra depois de
 * recarregar. É o que vai para o histórico (`eventos.jsonl`) e, ao vivo, para
 * a tela.
 */
export type EventoDoChat =
  | {
      tipo: "pergunta_enviada";
      mensagemDoUsuario: DadosDaMensagemDoChat;
      /** A resposta do Claude, ainda vazia e "respondendo". */
      mensagemDoClaude: DadosDaMensagemDoChat;
    }
  | {
      tipo: "resposta_concluida";
      mensagemId: string;
      texto: string;
      acoes: AcaoDoApp[];
      avisos: string[];
      uso: UsoDaResposta;
    }
  | { tipo: "resposta_falhou"; mensagemId: string; motivo: string; uso: UsoDaResposta | null }
  | { tipo: "resposta_cancelada"; mensagemId: string }
  /** Primeiro evento da conversa nova; a sequência continua a da anterior. */
  | { tipo: "conversa_limpa" }
  | { tipo: "preferencias_alteradas"; preferencias: DadosDasPreferenciasDoChat }
  | { tipo: "uso_da_cota"; janelas: JanelaDaCota[] };

/** Evento já gravado no histórico, com a posição na sequência e o instante. */
export type EventoDoChatRegistrado = EventoDoChat & { sequencia: number; em: string };

/**
 * Passageiros: vão para a tela ao vivo, mas não para o histórico — o texto
 * final da resposta já chega inteiro em `resposta_concluida`.
 *
 * - `trecho`: um pedaço novo do texto da resposta (delta);
 * - `atividade`: uma ferramenta que o Claude está usando (pesquisa, leitura).
 */
export type SinalDoChat =
  | { tipo: "trecho"; mensagemId: string; texto: string }
  | { tipo: "atividade"; mensagemId: string; ferramenta: string; detalhe: string };

/** Quem recebe os eventos do chat à medida que acontecem (a tela, via SSE). */
export interface PublicadorDoChat {
  publicar(evento: EventoDoChatRegistrado): void;
  sinalizar(sinal: SinalDoChat): void;
}
