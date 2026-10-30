import { DadosDoAnexo } from "./Anexo";
import { DadosDaConfiguracao } from "./ConfiguracaoDoOrquestrador";
import { ModoDoTurno } from "./ModoDoTurno";

export interface UsoDoTurno {
  /** Tempo de relógio do turno inteiro, incluindo a espera pelos Subagentes. */
  duracaoMs: number;
  tokensDeEntrada: number;
  tokensDeSaida: number;
  subagentesLancados: number;
}

/** Uma janela de limite da assinatura (ex.: 5 horas, 7 dias) e quanto dela já foi usado. */
export interface JanelaDaCota {
  nome: string;
  /** De 0 a 1. */
  utilizacao: number;
  renovaEm: string | null;
  situacao: string;
}

export type SituacaoFinalDoSubagente = "concluido" | "falhou" | "cancelado";

/** O que o motor observa enquanto executa um turno. */
export type EventoDoMotor =
  | { tipo: "sessao_iniciada" }
  | { tipo: "texto_do_orquestrador"; texto: string }
  | { tipo: "ferramenta_do_orquestrador"; ferramenta: string; detalhe: string }
  | { tipo: "subagente_iniciado"; subagenteId: string; descricao: string; tarefa: string }
  | {
      tipo: "progresso_do_subagente";
      subagenteId: string;
      atividade: string;
      ultimaFerramenta: string | null;
      tokens: number;
      ferramentasUsadas: number;
      duracaoMs: number;
    }
  | { tipo: "texto_do_subagente"; subagenteId: string; texto: string }
  | {
      tipo: "subagente_concluido";
      subagenteId: string;
      situacao: SituacaoFinalDoSubagente;
      resumo: string;
      tokens: number;
      duracaoMs: number;
    }
  | { tipo: "resultado_do_subagente"; subagenteId: string; resultado: string }
  | { tipo: "permissao_negada"; ferramenta: string; detalhe: string }
  | { tipo: "uso_da_cota"; janelas: JanelaDaCota[] }
  /** O Claude está raciocinando: não muda o turno, só mostra que há vida. */
  | { tipo: "sinal_de_vida"; tokensPensando: number };

/** Marcos do ciclo de vida de um turno, decididos pelo domínio. */
export type EventoDeTurno =
  | {
      tipo: "turno_iniciado";
      texto: string;
      configuracao: DadosDaConfiguracao;
      anexos: DadosDoAnexo[];
      modo: ModoDoTurno;
    }
  | { tipo: "turno_concluido"; resposta: string; uso: UsoDoTurno }
  | { tipo: "turno_cancelado" }
  | { tipo: "turno_falhou"; motivo: string }
  | { tipo: "turno_interrompido" }
  /** A decisão do usuário sobre o Plano de um turno de planejamento já concluído. */
  | { tipo: "plano_aprovado" }
  | { tipo: "plano_descartado" };

/**
 * Tudo o que acontece com um Orquestrador. É o que vai para o histórico
 * (`eventos.jsonl`) e, ao vivo, para a tela.
 */
export type EventoDeOrquestracao =
  | ((EventoDoMotor | EventoDeTurno) & { turnoId: string })
  | { tipo: "configuracao_alterada"; configuracao: DadosDaConfiguracao };

/** Evento já gravado no histórico, com a posição na sequência e o instante. */
export type EventoRegistrado = EventoDeOrquestracao & { sequencia: number; em: string };

/**
 * Sinal de que o Claude está trabalhando num turno. Passageiro: vai para a
 * tela ao vivo, mas não para o histórico — chega a cada segundo enquanto ele
 * raciocina e não muda nada no turno.
 */
export interface SinalDeVida {
  turnoId: string;
  em: string;
  /** Estimativa de tokens de raciocínio do ciclo atual. */
  tokensPensando: number;
}
