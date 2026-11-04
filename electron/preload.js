"use strict";

// Ponte segura entre o processo main (Node) e a SPA (renderer). Com
// contextIsolation ligado, a página só enxerga o que for exposto aqui.
// Exposto em window.electron:
//   - janela: controles min/max/fechar (barra de título customizada).
//   - licenca: ativar/validar/desativar/status.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electron", {
  // Marca para a SPA detectar que está rodando dentro do app desktop.
  desktop: true,
  plataforma: process.platform,

  janela: {
    minimizar: () => ipcRenderer.invoke("janela:minimizar"),
    // Alterna entre maximizado e restaurado.
    maximizar: () => ipcRenderer.invoke("janela:maximizar"),
    fechar: () => ipcRenderer.invoke("janela:fechar"),
    estaMaximizada: () => ipcRenderer.invoke("janela:esta-maximizada"),
  },

  licenca: {
    activate: (chave) => ipcRenderer.invoke("licenca:activate", chave),
    validate: () => ipcRenderer.invoke("licenca:validate"),
    deactivate: () => ipcRenderer.invoke("licenca:deactivate"),
    status: () => ipcRenderer.invoke("licenca:status"),
  },
});
