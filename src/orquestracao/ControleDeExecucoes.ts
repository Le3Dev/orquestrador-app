import { EventoRegistrado, SinalDeVida } from "./EventoDeOrquestracao";

/**
 * Os turnos rodando agora, por Orquestrador, e o meio de interrompê-los.
 *
 * Fica fora do `ServicoDeOrquestracao` para que o serviço continue sem
 * estado: quem guarda as execuções em andamento é a infraestrutura.
 */
export interface ControleDeExecucoes {
  iniciar(orquestradorId: string): AbortSignal;
  /** Verdadeiro se havia uma execução para cancelar. */
  cancelar(orquestradorId: string): boolean;
  encerrar(orquestradorId: string): void;
}

/** Quem recebe os eventos à medida que acontecem (a tela, via SSE). */
export interface PublicadorDeEventos {
  publicar(orquestradorId: string, evento: EventoRegistrado): void;
  /** Sinais de vida não entram no histórico: só vão para quem está olhando agora. */
  sinalizar(orquestradorId: string, sinal: SinalDeVida): void;
}
