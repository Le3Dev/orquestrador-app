import { EventoDoMotor } from "../../orquestracao/EventoDeOrquestracao";
import { Motor, rotuloDoMotor } from "../../orquestracao/Motor";
import { MotorDeAgentes, PedidoDeTurno, ResultadoDoTurno } from "../../orquestracao/MotorDeAgentes";
import { RegistroDeTurnosDoApp } from "./RegistroDeTurnosDoApp";

export interface DependenciasDoRoteador {
  /** O motor de cada `Motor`. Um motor ausente (o CLI não foi ligado) recusa o turno com o nome dele. */
  motores: Readonly<Partial<Record<Motor, MotorDeAgentes>>>;
  turnos: RegistroDeTurnosDoApp;
}

/**
 * O ponto de entrada de todos os motores: `MotorDeAgentes` que escolhe o motor
 * pelo `pedido.motor` (o do Orquestrador ou o de reserva que o domínio escolheu).
 *
 * Também registra o turno em andamento (`RegistroDeTurnosDoApp`) antes de
 * passá-lo ao motor e o libera quando ele termina, de qualquer jeito: é por esse
 * registro que a ferramenta `delegar_subtarefas` acha o pedido, os eventos da tela
 * e o cancelamento do turno do Orquestrador que a chamou. Registrar aqui, e não
 * em cada motor, cobre também o Orquestrador no Claude Code que delega a
 * subagentes de outro motor.
 */
export class RoteadorDeMotores implements MotorDeAgentes {
  constructor(private readonly dependencias: DependenciasDoRoteador) {}

  async executarTurno(
    pedido: PedidoDeTurno,
    aoObservar: (evento: EventoDoMotor) => void,
    sinal: AbortSignal,
    aoReceberLinha?: () => void,
  ): Promise<ResultadoDoTurno> {
    const motor = this.dependencias.motores[pedido.motor];
    if (motor === undefined) {
      return {
        sucesso: false,
        motivo: `O motor ${rotuloDoMotor(pedido.motor)} não está disponível neste app.`,
        uso: null,
      };
    }
    const { liberar } = this.dependencias.turnos.registrar(pedido, aoObservar, sinal);
    try {
      return await motor.executarTurno(pedido, aoObservar, sinal, aoReceberLinha);
    } finally {
      liberar();
    }
  }
}
