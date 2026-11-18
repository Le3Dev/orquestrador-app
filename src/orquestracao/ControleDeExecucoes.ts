import { EventoRegistrado, SinalDeVida } from "./EventoDeOrquestracao";

/**
 * Por que uma execução foi interrompida, e o `reason` do `AbortSignal`: o
 * usuário cancelou, a vigia do turno a encerrou porque o Claude ficou em
 * silêncio (ver ADR-36), ou o usuário pausou sem ter como congelar o processo
 * (Windows; ver ADR-49). Um abort sem motivo (ex.: o desligamento do
 * servidor) vale como cancelamento.
 */
export type MotivoDoCancelamento = "usuario" | "silencio" | "pausa";

/**
 * Os turnos rodando agora, por Orquestrador, e o meio de interrompê-los.
 *
 * Fica fora do `ServicoDeOrquestracao` para que o serviço continue sem
 * estado: quem guarda as execuções em andamento é a infraestrutura.
 */
export interface ControleDeExecucoes {
  iniciar(orquestradorId: string): AbortSignal;
  /**
   * Verdadeiro se havia uma execução para cancelar. O `motivo` vira o
   * `reason` do sinal; sem ele, o abort não leva motivo (como antes).
   */
  cancelar(orquestradorId: string, motivo?: MotivoDoCancelamento): boolean;
  encerrar(orquestradorId: string): void;
  /**
   * Congela os processos da execução em andamento (pausa, ver ADR-49). Falso
   * se não há o que congelar: sem execução, sem processo vivo ou no Windows.
   */
  congelar(orquestradorId: string): boolean;
  /** Descongela o que `congelar` parou; falso se nada estava congelado. */
  descongelar(orquestradorId: string): boolean;
}

/** Quem recebe os eventos à medida que acontecem (a tela, via SSE). */
export interface PublicadorDeEventos {
  publicar(orquestradorId: string, evento: EventoRegistrado): void;
  /** Sinais de vida não entram no histórico: só vão para quem está olhando agora. */
  sinalizar(orquestradorId: string, sinal: SinalDeVida): void;
}
