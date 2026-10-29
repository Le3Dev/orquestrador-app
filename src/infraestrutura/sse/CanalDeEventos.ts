import { PublicadorDeEventos } from "../../orquestracao/ControleDeExecucoes";
import { EventoRegistrado, SinalDeVida } from "../../orquestracao/EventoDeOrquestracao";

export interface Assinante {
  aoEvento: (evento: EventoRegistrado) => void;
  aoSinal: (sinal: SinalDeVida) => void;
}

/** Distribui os eventos (e os sinais de vida) de cada Orquestrador para as telas conectadas a ele. */
export class CanalDeEventos implements PublicadorDeEventos {
  private readonly assinantes = new Map<string, Set<Assinante>>();

  /** Devolve a função que cancela a assinatura. */
  assinar(orquestradorId: string, assinante: Assinante): () => void {
    const doOrquestrador = this.assinantes.get(orquestradorId) ?? new Set<Assinante>();
    doOrquestrador.add(assinante);
    this.assinantes.set(orquestradorId, doOrquestrador);

    return () => {
      doOrquestrador.delete(assinante);
      if (doOrquestrador.size === 0) {
        this.assinantes.delete(orquestradorId);
      }
    };
  }

  publicar(orquestradorId: string, evento: EventoRegistrado): void {
    this.entregar(orquestradorId, (assinante) => assinante.aoEvento(evento));
  }

  sinalizar(orquestradorId: string, sinal: SinalDeVida): void {
    this.entregar(orquestradorId, (assinante) => assinante.aoSinal(sinal));
  }

  private entregar(orquestradorId: string, entrega: (assinante: Assinante) => void): void {
    for (const assinante of this.assinantes.get(orquestradorId) ?? []) {
      try {
        entrega(assinante);
      } catch (erro) {
        // Uma conexão com problema não pode impedir as outras de receberem.
        console.warn("[sse] Falha ao entregar evento:", erro);
      }
    }
  }
}
