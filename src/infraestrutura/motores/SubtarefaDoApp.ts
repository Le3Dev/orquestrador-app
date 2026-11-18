import { EventoDoMotor } from "../../orquestracao/EventoDeOrquestracao";
import { PedidoDeTurno } from "../../orquestracao/MotorDeAgentes";
import { DadosDoSubagentePronto } from "../../orquestracao/SubagentesProntos";

/** Uma subtarefa que o Orquestrador pediu para delegar (`delegar_subtarefas`). */
export interface SubtarefaPedida {
  /** Curta: aparece no bixinho do subagente. */
  descricao: string;
  prompt: string;
  /** O nome de um subagente pronto; nulo para o `executor`. */
  subagente: string | null;
}

export interface ExecucaoDeSubtarefa {
  /** O pedido do turno do Orquestrador: pasta de trabalho, nível, modo, artefatos, commit e o motor dos subagentes. */
  pedido: PedidoDeTurno;
  subtarefa: SubtarefaPedida;
  especialidade: DadosDoSubagentePronto | null;
  subagenteId: string;
  /**
   * Os eventos do andamento da subtarefa, já no formato de subagente
   * (`progresso_do_subagente`, `texto_do_subagente`...). O início e o fim de
   * cada subagente quem emite é a delegação.
   */
  aoProgredir: (evento: EventoDoMotor) => void;
  sinal: AbortSignal;
}

export interface ResultadoDaSubtarefa {
  situacao: "concluido" | "falhou" | "cancelado";
  /** O relatório final do subagente; na falha, o motivo. */
  relatorio: string;
  tokensDeEntrada: number;
  tokensDeSaida: number;
  duracaoMs: number;
}

/** Roda uma subtarefa num motor: um agente novo, sem conversa anterior, com as regras do subagente. */
export interface ExecutorDeSubtarefa {
  executarSubtarefa(execucao: ExecucaoDeSubtarefa): Promise<ResultadoDaSubtarefa>;
}

/**
 * Converte o que um agente emite quando roda como "orquestrador" (o adaptador
 * de cada motor) no que a tela espera de um Subagente. Uma instância por
 * subtarefa. O raciocínio, a lista de tarefas e a cota de uso do agente
 * não são do subagente na tela; ferramentas e falas, sim.
 */
export class ConversorParaSubagente {
  private ferramentasUsadas = 0;
  /** Os tokens gastos até aqui, quando o motor os informa. */
  tokens = 0;

  constructor(
    private readonly subagenteId: string,
    private readonly inicio: number,
    private readonly agora: () => number = Date.now,
  ) {}

  converter(evento: EventoDoMotor): EventoDoMotor[] {
    switch (evento.tipo) {
      case "texto_do_orquestrador":
        return [{ tipo: "texto_do_subagente", subagenteId: this.subagenteId, texto: evento.texto }];
      case "ferramenta_do_orquestrador":
        this.ferramentasUsadas += 1;
        return [
          {
            tipo: "progresso_do_subagente",
            subagenteId: this.subagenteId,
            atividade: evento.detalhe,
            ultimaFerramenta: evento.ferramenta,
            tokens: this.tokens,
            ferramentasUsadas: this.ferramentasUsadas,
            duracaoMs: this.agora() - this.inicio,
          },
        ];
      case "endereco_local_detectado":
      case "permissao_negada":
        return [evento];
      default:
        return [];
    }
  }
}
