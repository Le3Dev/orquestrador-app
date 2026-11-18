import { Motor, rotuloDoMotor } from "../../orquestracao/Motor";
import { ExecucaoDeSubtarefa, ExecutorDeSubtarefa, ResultadoDaSubtarefa } from "./SubtarefaDoApp";

/**
 * Escolhe o motor que roda cada subtarefa: o `motorDosSubagentes` do pedido
 * (`configuracao.paraMotor` já o ajusta quando o turno está num motor de
 * reserva). Um motor sem executor (o CLI não foi ligado) devolve a falha com o
 * nome dele, para o Orquestrador contar ao usuário.
 */
export class ExecutorDeSubtarefas implements ExecutorDeSubtarefa {
  constructor(private readonly executores: Readonly<Partial<Record<Motor, ExecutorDeSubtarefa>>>) {}

  async executarSubtarefa(execucao: ExecucaoDeSubtarefa): Promise<ResultadoDaSubtarefa> {
    const motor = execucao.pedido.configuracao.motorDosSubagentes;
    const executor = this.executores[motor];
    if (executor === undefined) {
      return {
        situacao: "falhou",
        relatorio: `Os subagentes estão configurados para o ${rotuloDoMotor(motor)}, que não está disponível neste app.`,
        tokensDeEntrada: 0,
        tokensDeSaida: 0,
        duracaoMs: 0,
      };
    }
    return executor.executarSubtarefa(execucao);
  }
}
