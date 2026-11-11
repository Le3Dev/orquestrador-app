/** O evento que pede ao chat rápido para mostrar a conversa (se oculta) e levar o cursor ao campo. */
export const EVENTO_PARA_FOCAR_O_CHAT = "orquestrador:focar-chat";

/**
 * Pede o foco do chat rápido (Ctrl+J e o item "Focar o chat rápido" da paleta). O chat
 * está num componente à parte do canvas, então o pedido vai por um evento da janela.
 */
export function pedirFocoDoChat(): void {
  window.dispatchEvent(new Event(EVENTO_PARA_FOCAR_O_CHAT));
}
