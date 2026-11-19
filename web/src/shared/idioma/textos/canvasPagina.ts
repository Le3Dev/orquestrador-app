import { definirTextos } from "../idioma";

/** Textos da página do canvas, dos hooks dela e dos avisos de `shared/canvas`. */
export const textosDePaginaDoCanvas = definirTextos({
  "pt-BR": {
    ligarAoTerminal: "Arraste até um terminal para ligar a ele (vai como contexto no próximo pedido)",
    vazioTitulo: "Seu canvas de agentes",
    vazioTexto:
      "Cada orquestrador é um terminal: você conversa com ele, e cada subagente que ele instancia aparece como um bixinho ligado ao terminal. Arraste pela barra de título, redimensione pelas bordas e espalhe quantos quiser.",
    vazioAtalhos: "arrastar o fundo move o canvas · shift + arrastar seleciona · ctrl + roda dá zoom",
    vazioCriar: "+ Novo orquestrador",
    tituloDaJanela: "Orquestrador de Agentes",
    desconectado: (titulo: string) => `⚠ Desconectado · ${titulo}`,
    respostaDoChat: "Resposta do chat",
    mostrarMinimapa: "Mostrar minimapa",
    esconderMinimapa: "Esconder minimapa",
    minimapa: "Minimapa",
    avisoDoLimite: (limite: number) =>
      `Limite de ${limite} orquestradores abertos. Feche um dos orquestradores (✕ na barra do terminal) antes de iniciar outro.`,
    escalasDaLetra: { normal: "Normal", grande: "Grande", maior: "Maior" },
    naoAbriuOsAjustes: (motivo: string) => `Não foi possível abrir os ajustes de pastas: ${motivo}`,
    naoReiniciou: (motivo: string) => `Não foi possível reiniciar para instalar: ${motivo}`,
  },
  en: {
    ligarAoTerminal: "Drag to a terminal to link to it (goes as context in the next request)",
    vazioTitulo: "Your agent canvas",
    vazioTexto:
      "Each orchestrator is a terminal: you talk to it, and every subagent it spawns shows up as a critter linked to the terminal. Drag by the title bar, resize by the edges and spread out as many as you like.",
    vazioAtalhos: "drag the background to move the canvas · shift + drag to select · ctrl + wheel to zoom",
    vazioCriar: "+ New orchestrator",
    tituloDaJanela: "Orquestrador de Agentes",
    desconectado: (titulo: string) => `⚠ Disconnected · ${titulo}`,
    respostaDoChat: "Chat reply",
    mostrarMinimapa: "Show minimap",
    esconderMinimapa: "Hide minimap",
    minimapa: "Minimap",
    avisoDoLimite: (limite: number) =>
      `Limit of ${limite} open orchestrators. Close one of the orchestrators (✕ on the terminal bar) before starting another.`,
    escalasDaLetra: { normal: "Normal", grande: "Large", maior: "Larger" },
    naoAbriuOsAjustes: (motivo: string) => `Could not open the folder settings: ${motivo}`,
    naoReiniciou: (motivo: string) => `Could not restart to install: ${motivo}`,
  },
});
