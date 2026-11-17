/**
 * Porta: marcar um aviso para daqui a pouco. Existe para o relógio ser
 * injetável: o agendador e as esperas das Rotinas não dependem de `setTimeout`
 * real nos testes.
 */
export interface Temporizador {
  /** Chama `aoVencer` daqui a `ms` milissegundos e devolve a função que cancela o aviso. */
  agendar(aoVencer: () => void, ms: number): () => void;
}

/** O temporizador de verdade. Não segura o processo aberto: quem o mantém vivo é o servidor. */
export const TEMPORIZADOR_DO_SISTEMA: Temporizador = {
  agendar(aoVencer, ms) {
    const marcador = setTimeout(aoVencer, ms);
    marcador.unref();
    return () => clearTimeout(marcador);
  },
};
