import { PerguntaDoApp } from "../perguntas/PerguntaDoApp";
import { DadosDoAnexo } from "./Anexo";
import { DadosDaConfiguracao } from "./ConfiguracaoDoOrquestrador";
import { DadosDoConsumoDoTurno } from "./ConsumoDoTurno";
import { ModoDoTurno } from "./ModoDoTurno";
import { DadosDoPedidoNaFila, MotivoDaRetiradaDaFila } from "./PedidoNaFila";
import { NomeDaPredefinicao } from "./PredefinicaoDeConfiguracao";

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
  | {
      tipo: "subagente_iniciado";
      subagenteId: string;
      descricao: string;
      tarefa: string;
      /**
       * Tipo do subagente: o "executor" ou o nome de um subagente pronto.
       * Ausente nos eventos gravados antes dos subagentes prontos.
       */
      papel?: string | undefined;
    }
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
  /**
   * Um endereço local (ex.: `http://localhost:5173`) apareceu na saída de uma
   * ferramenta, do Orquestrador ou de um Subagente: em geral, um servidor de
   * desenvolvimento que acabou de subir. A tela o mostra numa prévia ao vivo.
   * Chega uma vez por endereço em cada turno, já normalizado.
   */
  | { tipo: "endereco_local_detectado"; url: string }
  /** O Claude está raciocinando: não muda o turno, só mostra que há vida. */
  | { tipo: "sinal_de_vida"; tokensPensando: number };

/** Em que ponto está a autorrecuperação de um turno que travou ou falhou (ver ADR-36). */
export type EtapaDaRecuperacao = "encerrado" | "aguardando" | "retomando" | "cancelada" | "desistiu";

/** Por que o turno precisou ser retomado: as causas de falha que o app sabe recuperar. */
export type CausaDaRecuperacao = "silencio" | "limite_de_uso" | "sobrecarga" | "rede";

/** Marcos do ciclo de vida de um turno, decididos pelo domínio. */
export type EventoDeTurno =
  | {
      tipo: "turno_iniciado";
      texto: string;
      configuracao: DadosDaConfiguracao;
      anexos: DadosDoAnexo[];
      modo: ModoDoTurno;
      /**
       * O turno foi aberto sozinho pelo app para retomar `deTurnoId`, que
       * travou ou falhou (ver ADR-36). Ausente nos turnos normais.
       */
      retomada?: { deTurnoId: string; tentativa: number };
    }
  | {
      tipo: "turno_concluido";
      resposta: string;
      uso: UsoDoTurno;
      /**
       * O turno terminou com um Plano aguardando a decisão do usuário: sempre
       * num planejamento, e numa execução em que o Orquestrador propôs um
       * Plano antes de mexer. Ausente nos eventos gravados antes do campo.
       */
      planoPendente: boolean;
      /**
       * Perguntas com opções clicáveis que o Orquestrador fez na resposta
       * final (blocos ```pergunta-do-app), já fora de `resposta`. Ausente nos
       * eventos gravados antes do campo: valem [].
       */
      perguntas: PerguntaDoApp[];
    }
  | { tipo: "turno_cancelado" }
  | { tipo: "turno_falhou"; motivo: string }
  | { tipo: "turno_interrompido" }
  /** A decisão do usuário sobre o Plano pendente de um turno já concluído. */
  | { tipo: "plano_aprovado" }
  | { tipo: "plano_descartado" }
  /**
   * Quanto o turno gastou, lido das transcrições do Claude Code depois que
   * ele terminou. Vem sempre depois do evento de fim do turno; ausente quando
   * não houve transcrição para medir.
   */
  | { tipo: "consumo_do_turno_medido"; consumo: DadosDoConsumoDoTurno }
  /**
   * Um passo da autorrecuperação do turno (ver ADR-36): o app encerrou o
   * turno parado, espera para retomar, retoma, teve a retomada cancelada
   * ou desistiu. Vem sempre com o `turnoId` do turno que travou ou falhou.
   */
  | {
      tipo: "recuperacao_do_turno";
      etapa: EtapaDaRecuperacao;
      causa: CausaDaRecuperacao;
      /** 1 para a primeira tentativa. */
      tentativa: number;
      /** Máximo de tentativas para essa causa. */
      de: number;
      /**
       * Texto pronto para o log, em pt-BR (ex.: "sem saída há 5 min, sem CPU
       * e sem transcrição crescendo"; "limite de uso, libera às 14:30"). Em
       * "desistiu", o diagnóstico completo.
       */
      resumo: string;
      /** Em "aguardando": quando retoma (ISO). Nulo nas outras etapas. */
      retomaEm: string | null;
    };

/**
 * Tudo o que acontece com um Orquestrador. É o que vai para o histórico
 * (`eventos.jsonl`) e, ao vivo, para a tela.
 */
export type EventoDeOrquestracao =
  | ((EventoDoMotor | EventoDeTurno) & { turnoId: string })
  | {
      tipo: "configuracao_alterada";
      configuracao: DadosDaConfiguracao;
      /** A alteração veio de uma predefinição (ex.: "Modo econômico"). Ausente nas alterações campo a campo. */
      predefinicao?: NomeDaPredefinicao;
    }
  /** O usuário trocou o nome do Orquestrador (já aparado). Não pertence a nenhum turno. */
  | { tipo: "orquestrador_renomeado"; nome: string }
  /**
   * A conversa foi limpa ("/clear"): o histórico anterior foi arquivado e o
   * próximo turno começa uma sessão nova. É o primeiro evento da conversa
   * nova; a sequência continua a da anterior.
   */
  | {
      tipo: "conversa_limpa";
      turnosAnteriores: number;
      /** Havia um Plano aguardando decisão, que deixou de valer. */
      planoDescartado: boolean;
      /** O worktree do Orquestrador continua com alterações da conversa anterior. */
      worktreeComAlteracoes: boolean;
    }
  /**
   * Um pedido entrou no fim da fila do Orquestrador. Não pertence a nenhum
   * turno: espera a vez, com ou sem um turno em andamento.
   */
  | { tipo: "pedido_enfileirado"; pedido: DadosDoPedidoNaFila }
  /**
   * Um pedido saiu da fila: `removido` pelo usuário, ou `enviado` — então vem
   * logo antes do `turno_iniciado` do turno que o atende.
   */
  | { tipo: "pedido_retirado_da_fila"; pedidoId: string; motivo: MotivoDaRetiradaDaFila };

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
  /** Estimativa de tokens de raciocínio do ciclo atual. Zero nos sinais com `diagnostico`. */
  tokensPensando: number;
  /**
   * O que a vigia do turno viu quando o Claude ficou sem dar saída (ver
   * ADR-36), ex.: trabalhando "rodando `npm test` há 6 min"; suspeito "sem
   * saída há 3 min, sem CPU". Ausente nos sinais de raciocínio.
   * `semRetomadaAutomatica`: o sistema não deixa ver os processos (Windows),
   * e a vigia só avisa, sem encerrar nem retomar o turno.
   */
  diagnostico?: { situacao: "trabalhando" | "suspeito"; resumo: string; semRetomadaAutomatica?: true };
}
