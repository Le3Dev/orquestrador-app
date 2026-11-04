"use strict";

// Ponte segura entre o processo main (Node) e as páginas (renderer). Com
// contextIsolation ligado, a página só enxerga o que for exposto aqui.
// Exposto em window.electron:
//   - janela: controles min/max/fechar (barra de título customizada).
//   - licenca: ativar/validar/desativar/status.
//   - configuracao: ler a configuração local e abrir a janela de ajustes.
//   - primeiraAbertura: usado só pela tela electron/primeiraAbertura.html; o
//     main recusa essas chamadas vindas de qualquer outra janela.

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
    // Chama `callback(maximizada)` a cada maximizar/restaurar; devolve a
    // função que cancela a inscrição.
    aoMudarMaximizada: (callback) => {
      const ouvinte = (_evento, maximizada) => callback(Boolean(maximizada));
      ipcRenderer.on("janela:maximizada", ouvinte);
      return () => ipcRenderer.removeListener("janela:maximizada", ouvinte);
    },
  },

  licenca: {
    activate: (chave) => ipcRenderer.invoke("licenca:activate", chave),
    validate: () => ipcRenderer.invoke("licenca:validate"),
    deactivate: () => ipcRenderer.invoke("licenca:deactivate"),
    status: () => ipcRenderer.invoke("licenca:status"),
  },

  configuracao: {
    // { pastaRaizDosProjetos, caminhoDoClaudeCode }
    obter: () => ipcRenderer.invoke("configuracao:obter"),
    abrirAjustes: () => ipcRenderer.invoke("configuracao:abrir-ajustes"),
  },

  primeiraAbertura: {
    carregar: () => ipcRenderer.invoke("primeira-abertura:carregar"),
    escolherPasta: (atual) => ipcRenderer.invoke("primeira-abertura:escolher-pasta", atual),
    escolherClaudeCode: (atual) => ipcRenderer.invoke("primeira-abertura:escolher-claude-code", atual),
    salvar: (dados) => ipcRenderer.invoke("primeira-abertura:salvar", dados),
  },
});
