"use strict";

// Ponte segura entre o processo main (Node) e as páginas (renderer). Com
// contextIsolation ligado, a página só enxerga o que for exposto aqui.
// Exposto em window.electron:
//   - janela: controles min/max/fechar (barra de título customizada).
//   - licenca: ativar/validar/desativar/status.
//   - configuracao: ler a configuração local e abrir a janela de ajustes.
//   - atualizacao: estado da atualização automática (obter/verificar), instalar
//     a versão já baixada (instalarAgora, só da janela principal e só na
//     situação "pronta") e aoMudar (canal "atualizacao:estado"). Fora do app
//     instalado a situação é sempre "indisponivel".
//   - previa: vista nativa da Prévia para endereços externos (sessão própria
//     `persist:previa`); o main só aceita da janela principal e valida tudo.
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

  // EstadoDaAtualizacao: { situacao: "indisponivel" | "verificando" | "em-dia" |
  // "baixando" | "pronta" | "erro", versaoAtual, versaoNova, progresso,
  // mensagemDeErro }
  atualizacao: {
    obter: () => ipcRenderer.invoke("atualizacao:obter"),
    // Dispara a verificação e devolve o estado logo em seguida.
    verificar: () => ipcRenderer.invoke("atualizacao:verificar"),
    // Reinicia o app instalando a versão baixada (só em "pronta").
    instalarAgora: () => ipcRenderer.invoke("atualizacao:instalar-agora").then(() => undefined),
    // Chama `callback(estado)` a cada mudança; devolve a função que cancela.
    aoMudar: (callback) => {
      const ouvinte = (_evento, estado) => callback(estado);
      ipcRenderer.on("atualizacao:estado", ouvinte);
      return () => ipcRenderer.removeListener("atualizacao:estado", ouvinte);
    },
  },

  // Modo invisível da janela principal (transparente, sempre no topo, fora de
  // capturas). Sai também pelo atalho global Ctrl+Shift+I. Enquanto ativo, a
  // tela escuta o áudio do sistema (electron/escutaDoModoInvisivel.js).
  modoInvisivel: {
    entrar: () => ipcRenderer.invoke("modo-invisivel:entrar").then(() => undefined),
    sair: () => ipcRenderer.invoke("modo-invisivel:sair").then(() => undefined),
    // true = a janela recebe cliques; false = cliques passam aos apps atrás.
    capturarMouse: (capturar) => ipcRenderer.invoke("modo-invisivel:capturar-mouse", Boolean(capturar)).then(() => undefined),
    // { nome, tipoDeMidia: "image/jpeg", base64 }; rejeita fora do modo.
    capturarTela: () => ipcRenderer.invoke("tela:capturar"),
    // Botão "capturar agora": devolve o quadro atual (mesmo formato).
    capturarAgora: () => ipcRenderer.invoke("modo-invisivel:capturar-agora"),
    // Quadros capturados pelo atalho global Ctrl+Shift+S; devolve o cancelamento.
    aoCapturarQuadro: (callback) => {
      const ouvinte = (_evento, captura) => callback(captura);
      ipcRenderer.on("modo-invisivel:quadro-capturado", ouvinte);
      return () => ipcRenderer.removeListener("modo-invisivel:quadro-capturado", ouvinte);
    },
    aoMudar: (callback) => {
      const ouvinte = (_evento, ativo) => callback(Boolean(ativo));
      ipcRenderer.on("modo-invisivel:estado", ouvinte);
      return () => ipcRenderer.removeListener("modo-invisivel:estado", ouvinte);
    },
    // Estado atual (para a tela que monta com o modo já ligado).
    estaAtivo: () => ipcRenderer.invoke("modo-invisivel:consultar").then(Boolean),
    // A escuta do áudio do sistema (getDisplayMedia + loopback) só existe no
    // Windows. process.platform faz parte do `process` do preload com sandbox.
    escutaDisponivel: process.platform === "win32",
    // Liga/desliga a escuta fora do modo invisível (botão do chat).
    definirEscutaLigada: (ligada) => ipcRenderer.invoke("escuta:definir-ligada", Boolean(ligada)).then(() => undefined),
  },

  // Vista nativa da Prévia (electron/vistaDaPrevia.js). `id` é o previaId.
  previa: {
    // Cria a vista escondida e carrega o endereço (http/https externo). Resolve false se recusou.
    abrir: (id, url, retangulo) => ipcRenderer.invoke("previa:abrir", { id, url, retangulo }),
    // Mostra (com foco) ou esconde a vista; `retangulo` é obrigatório ao ativar.
    ativar: (id, ativa, retangulo) => ipcRenderer.invoke("previa:ativar", { id, ativa, retangulo }),
    // { x, y, largura, altura, zoom }: onde o corpo da prévia está na tela, a cada mudança.
    retangulo: (id, retangulo) => ipcRenderer.send("previa:retangulo", { id, retangulo }),
    recarregar: (id) => ipcRenderer.invoke("previa:recarregar", { id }),
    // Voltar e avançar no histórico da vista; resolvem false se não há para onde ir.
    voltar: (id) => ipcRenderer.invoke("previa:voltar", { id }),
    avancar: (id) => ipcRenderer.invoke("previa:avancar", { id }),
    fechar: (id) => ipcRenderer.invoke("previa:fechar", { id }),
    // Apaga o login e os dados da sessão persist:previa e recarrega as vistas abertas.
    sairDasContas: () => ipcRenderer.invoke("previa:sair-das-contas"),
    // Eventos: { tipo: "foto", id, foto } | { tipo: "estado", id, carregando, erro, origem, podeVoltar, podeAvancar } (origem: só
    // protocolo e host da página atual, ou null; podeVoltar e podeAvancar: o histórico da vista) | { tipo: "desativada", id } | { tipo: "sessao-limpa" } (descartar as fotos guardadas).
    aoMudar: (callback) => {
      const ouvinte = (_evento, evento) => callback(evento);
      ipcRenderer.on("previa:evento", ouvinte);
      return () => ipcRenderer.removeListener("previa:evento", ouvinte);
    },
  },

  primeiraAbertura: {
    carregar: () => ipcRenderer.invoke("primeira-abertura:carregar"),
    escolherPasta: (atual) => ipcRenderer.invoke("primeira-abertura:escolher-pasta", atual),
    escolherClaudeCode: (atual) => ipcRenderer.invoke("primeira-abertura:escolher-claude-code", atual),
    salvar: (dados) => ipcRenderer.invoke("primeira-abertura:salvar", dados),
  },
});
