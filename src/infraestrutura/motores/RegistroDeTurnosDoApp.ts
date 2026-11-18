import { EventoDoMotor } from "../../orquestracao/EventoDeOrquestracao";
import { PedidoDeTurno } from "../../orquestracao/MotorDeAgentes";

/**
 * O turno de um Orquestrador em andamento, como as ferramentas do app (a
 * delegação de subtarefas) precisam enxergá-lo: o pedido (pasta de trabalho,
 * permissões, subagentes prontos), onde publicar os eventos da tela e o sinal de
 * cancelamento. Uma chamada MCP só sabe o `orquestradorId` (vem do token do
 * turno); é por ele que acha o turno.
 */
export interface TurnoEmAndamento {
  readonly pedido: PedidoDeTurno;
  readonly aoObservar: (evento: EventoDoMotor) => void;
  readonly sinal: AbortSignal;
  /** Subagentes lançados pelas ferramentas do app neste turno. */
  subagentesLancados: number;
  /** Tokens gastos pelos subagentes lançados pelas ferramentas do app: somam ao consumo do turno. */
  tokensDeEntradaDosSubagentes: number;
  tokensDeSaidaDosSubagentes: number;
}

/**
 * Quem está em turno, por Orquestrador. Quem executa o turno (hoje o
 * `RoteadorDeMotores`, único ponto de entrada de todos os motores) registra ao
 * começar e libera ao terminar, de modo que vale também para um Orquestrador no
 * Claude Code que delega a subagentes de outro motor.
 */
export class RegistroDeTurnosDoApp {
  private readonly turnos = new Map<string, TurnoEmAndamento>();

  /**
   * Registra o turno e devolve a função que o libera. Liberar só apaga o que
   * este registro criou: um turno novo do mesmo Orquestrador (a reserva) que já
   * tenha entrado não é apagado por um turno antigo que termina depois.
   */
  registrar(
    pedido: PedidoDeTurno,
    aoObservar: (evento: EventoDoMotor) => void,
    sinal: AbortSignal,
  ): { turno: TurnoEmAndamento; liberar: () => void } {
    const turno: TurnoEmAndamento = {
      pedido,
      aoObservar,
      sinal,
      subagentesLancados: 0,
      tokensDeEntradaDosSubagentes: 0,
      tokensDeSaidaDosSubagentes: 0,
    };
    this.turnos.set(pedido.orquestradorId, turno);
    return {
      turno,
      liberar: () => {
        if (this.turnos.get(pedido.orquestradorId) === turno) {
          this.turnos.delete(pedido.orquestradorId);
        }
      },
    };
  }

  obter(orquestradorId: string): TurnoEmAndamento | undefined {
    return this.turnos.get(orquestradorId);
  }
}
