"use strict";

// Ponte segura entre o processo main (Node) e as páginas (renderer). Com
// contextIsolation ligado, a página só enxerga o que for exposto aqui.
// Exposto em window.electron:
//   - janela: controles min/max/fechar (barra de título customizada).
//   - licenca: pedirCodigo/entrar/sair/status e links (assinar/portal) da tela de entrada.
//   - configuracao: ler a configuração local e abrir a janela de ajustes.
//   - atualizacao: estado da atualização automática (obter/verificar), instalar
//     a versão já baixada (instalarAgora, só da janela principal e só na
//     situação "pronta"), esperar os orquestradores terminarem
//     (instalarQuandoLivre/cancelarEspera) e aoMudar (canal
//     "atualizacao:estado"). Fora do app instalado a situação é sempre
//     "indisponivel".
//   - previa: vista nativa da Prévia para endereços externos (sessão própria
//     `persist:previa`); o main só aceita da janela principal e valida tudo.
//   - rotinas: a bandeja do Windows (electron/bandeja.js). informarSituacao conta
//     ao app as rotinas ativas e as execuções aguardando aprovação; aoPedirPainel
//     avisa quando o usuário clica na notificação de aprovação. O main só aceita
//     da janela principal.
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
    pedirCodigo: (email) => ipcRenderer.invoke("licenca:pedir-codigo", email),
    // { email, codigo, substituirOutraMaquina? }
    entrar: (dados) => ipcRenderer.invoke("licenca:entrar", dados),
    sair: () => ipcRenderer.invoke("licenca:sair"),
    status: () => ipcRenderer.invoke("licenca:status"),
    bloqueio: () => ipcRenderer.invoke("licenca:bloqueio"),
    links: () => ipcRenderer.invoke("licenca:links"),
    abrirLink: (qual) => ipcRenderer.invoke("licenca:abrir-link", qual),
  },

  configuracao: {
    // { pastaRaizDosProjetos, caminhoDoClaudeCode }
    obter: () => ipcRenderer.invoke("configuracao:obter"),
    abrirAjustes: () => ipcRenderer.invoke("configuracao:abrir-ajustes"),
  },

  // EstadoDaAtualizacao: { situacao: "indisponivel" | "verificando" | "em-dia" |
  // "baixando" | "pronta" | "aguardando" | "erro", versaoAtual, versaoNova,
  // progresso (no Mac, null em "baixando"), mensagemDeErro, etapa (texto da
  // etapa no Mac; null no Windows), orquestradoresTrabalhando (só em
  // "aguardando") }
  atualizacao: {
    obter: () => ipcRenderer.invoke("atualizacao:obter"),
    // Dispara a verificação e devolve o estado logo em seguida.
    verificar: () => ipcRenderer.invoke("atualizacao:verificar"),
    // Reinicia o app instalando a versão baixada (só em "pronta"). Sem
    // `{ forcar: true }` e com orquestradores trabalhando, não reinicia.
    // Resolve { iniciou, orquestradoresTrabalhando }.
    instalarAgora: (opcoes) =>
      ipcRenderer.invoke("atualizacao:instalar-agora", { forcar: Boolean(opcoes && opcoes.forcar === true) }),
    // "aguardando": instala sozinho quando nenhum orquestrador estiver trabalhando.
    instalarQuandoLivre: () => ipcRenderer.invoke("atualizacao:instalar-quando-livre"),
    // Desiste da espera: volta para "pronta".
    cancelarEspera: () => ipcRenderer.invoke("atualizacao:cancelar-espera"),
    // Chama `callback(estado)` a cada mudança; devolve a função que cancela.
    aoMudar: (callback) => {
      const ouvinte = (_evento, estado) => callback(estado);
      ipcRenderer.on("atualizacao:estado", ouvinte);
      return () => ipcRenderer.removeListener("atualizacao:estado", ouvinte);
    },
  },

  // Modo invisível da janela principal (transparente, sempre no topo, fora de
  // capturas). Atalhos globais (electron/atalhosDoModoInvisivel.js): Ctrl+\
  // alterna (entra / oculta / mostra, sempre ativo); no modo: Ctrl+Shift+I sai,
  // Ctrl+Shift+S captura, e as demais viram ações via `aoAtalho` (responder-agora,
  // focar-campo, mover-cima/baixo/esquerda/direita, rolar-acima/abaixo,
  // opacidade-mais/menos). No modo a janela não é focável (não rouba o teclado do
  // app de trás): `definirFocavel(true)` a foca para digitar. Enquanto ativo, a
  // tela escuta o áudio do sistema (electron/escutaDoModoInvisivel.js).
  modoInvisivel: {
    // Mesmo efeito do Ctrl+\ (entra no modo, ou oculta/mostra o overlay).
    alternar: () => ipcRenderer.invoke("modo-invisivel:alternar").then(() => undefined),
    // true = janela focável e focada (teclado); false = devolve o foco. Só no modo.
    definirFocavel: (focavel) => ipcRenderer.invoke("modo-invisivel:definir-focavel", Boolean(focavel)).then(() => undefined),
    // Ações dos atalhos globais (strings listadas acima); devolve o cancelamento.
    aoAtalho: (callback) => {
      const ouvinte = (_evento, acao) => callback(String(acao));
      ipcRenderer.on("modo-invisivel:atalho", ouvinte);
      return () => ipcRenderer.removeListener("modo-invisivel:atalho", ouvinte);
    },
    // true quando o overlay é ocultado (opacidade 0, sem sair do modo); devolve o cancelamento.
    aoMudarOculto: (callback) => {
      const ouvinte = (_evento, oculto) => callback(Boolean(oculto));
      ipcRenderer.on("modo-invisivel:oculto", ouvinte);
      return () => ipcRenderer.removeListener("modo-invisivel:oculto", ouvinte);
    },
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

  // Motor nativo de transcrição (electron/transcricaoNativa.js). `disponivel`:
  // o binário do onnxruntime-node desta plataforma existe (o main avisa pelo
  // argumento da janela; o preload com sandbox não lê o disco). `conectar`
  // pede a porta do motor, que chega por window.postMessage com
  // { tipo: "orquestrador:porta-da-transcricao" } e a porta em `ports[0]`
  // (pode chegar de novo depois: a nova substitui a antiga). Rejeita fora da
  // janela principal ou com o motor desligado (aí a tela usa o navegador).
  transcricaoNativa: {
    disponivel: process.argv.includes("--transcricao-nativa-disponivel"),
    conectar: () => ipcRenderer.invoke("transcricao:conectar").then(() => undefined),
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

  // Navegador do agente (electron/navegadorDoAgente.js): um Chromium por Orquestrador, que os agentes
  // controlam por ferramentas MCP. A tela (próxima onda) mostra um nó do canvas por Orquestrador; `orquestradorId`
  // identifica o navegador. A vista nativa fica POR BAIXO da tela, pintando, até o nó pedir `mostrar`.
  //
  // Fluxo da tela: `aoAtivar` avisa que o agente usou o navegador pela primeira vez (abra o nó); com o nó
  // aberto, `mostrar` com o retângulo do corpo do nó e `posicionar` a cada mudança dele; ao fechar o nó,
  // `ocultar` (a vista desce, o agente segue usando); "assumir" = `pausar` (o agente é recusado com "O usuário
  // assumiu o navegador; tente depois." e a vista recebe o teclado) e "devolver" = `retomar`; ao excluir o
  // Orquestrador, `fechar(id, true)`. Ao carregar, `estados()` devolve os navegadores já abertos.
  navegadorDoAgente: {
    // { x, y, largura, altura, zoom }: onde o corpo do nó está na tela (pixels CSS; zoom = escala do canvas).
    // Só vale com a vista mostrada; enviar a cada quadro em que muda.
    posicionar: (orquestradorId, retangulo) => ipcRenderer.send("navegador-do-agente:posicionar", { orquestradorId, retangulo }),
    // Põe a vista sobre o nó (acima da tela). Resolve false se recusou (sem navegador aberto, modo invisível).
    mostrar: (orquestradorId, retangulo) => ipcRenderer.invoke("navegador-do-agente:mostrar", { orquestradorId, retangulo }),
    // Devolve a vista para baixo da tela; ela continua viva e o agente segue usando.
    ocultar: (orquestradorId) => ipcRenderer.invoke("navegador-do-agente:ocultar", { orquestradorId }),
    // O usuário assume: comandos do agente são recusados e o que está rodando é cancelado.
    pausar: (orquestradorId) => ipcRenderer.invoke("navegador-do-agente:pausar", { orquestradorId }),
    // O usuário devolve o navegador ao agente.
    retomar: (orquestradorId) => ipcRenderer.invoke("navegador-do-agente:retomar", { orquestradorId }),
    // Navegação do usuário (botões do nó, com o agente pausado); resolvem false se não há navegador aberto ou,
    // no voltar e no avançar, não há para onde ir.
    voltar: (orquestradorId) => ipcRenderer.invoke("navegador-do-agente:voltar", { orquestradorId }),
    avancar: (orquestradorId) => ipcRenderer.invoke("navegador-do-agente:avancar", { orquestradorId }),
    recarregar: (orquestradorId) => ipcRenderer.invoke("navegador-do-agente:recarregar", { orquestradorId }),
    // Fecha o navegador do Orquestrador; `apagarDados` (true ao excluir o Orquestrador) apaga também login e cookies.
    fechar: (orquestradorId, apagarDados = false) =>
      ipcRenderer.invoke("navegador-do-agente:fechar", { orquestradorId, apagarDados: apagarDados === true }),
    // Os navegadores abertos: [{ orquestradorId, url, titulo, carregando, ultimaAcao, emUsoPeloAgente, pausado, podeVoltar, podeAvancar }].
    estados: () => ipcRenderer.invoke("navegador-do-agente:estados"),
    // Data URI (JPEG, até 1000 px) da página, para o nó mostrar enquanto a vista nativa está por baixo; null se falhou.
    foto: (orquestradorId) => ipcRenderer.invoke("navegador-do-agente:foto", { orquestradorId }),
    // Mudanças: { orquestradorId, url, titulo, carregando, ultimaAcao, emUsoPeloAgente, pausado, podeVoltar, podeAvancar }
    // (url e titulo atuais; ultimaAcao: texto curto do que o agente está fazendo ou fez, sem o texto digitado;
    // emUsoPeloAgente: um comando está rodando). Só vem quando algo muda. Devolve a função que cancela a inscrição.
    aoMudar: (callback) => {
      const ouvinte = (_evento, estado) => callback(estado);
      ipcRenderer.on("navegador-do-agente:mudou", ouvinte);
      return () => ipcRenderer.removeListener("navegador-do-agente:mudou", ouvinte);
    },
    // O agente usou o navegador de um Orquestrador pela primeira vez (ou de novo, depois de fechado): { orquestradorId }.
    // A tela abre o nó. Devolve a função que cancela a inscrição.
    aoAtivar: (callback) => {
      const ouvinte = (_evento, dados) => callback(dados);
      ipcRenderer.on("navegador-do-agente:ativado", ouvinte);
      return () => ipcRenderer.removeListener("navegador-do-agente:ativado", ouvinte);
    },
  },

  // Rotinas e a bandeja do Windows (electron/bandeja.js). Só a janela principal fala com o app.
  rotinas: {
    // { ativas, aguardandoAprovacao, pendentes: [{ id, rotina }] }: `ativas` = rotinas ligadas (com pelo
    // menos uma, fechar a janela esconde o app na bandeja); `pendentes` = execuções aguardando aprovação,
    // com o id da execução e o nome da rotina (o app avisa uma vez por execução, com notificação do
    // Windows). Reenviar a cada mudança; resolve depois que o app registrou.
    informarSituacao: (situacao) => {
      const dados = situacao !== null && typeof situacao === "object" ? situacao : {};
      return ipcRenderer
        .invoke("rotinas:informar-situacao", {
          ativas: Number(dados.ativas),
          aguardandoAprovacao: Number(dados.aguardandoAprovacao),
          pendentes: Array.isArray(dados.pendentes)
            ? dados.pendentes
                .filter((pendente) => pendente !== null && typeof pendente === "object" && typeof pendente.id === "string")
                .map((pendente) => ({ id: pendente.id, rotina: typeof pendente.rotina === "string" ? pendente.rotina : "" }))
            : [],
        })
        .then(() => undefined);
    },
    // O usuário clicou na notificação de aprovação: a tela deve abrir o painel das rotinas. Devolve o cancelamento.
    aoPedirPainel: (callback) => {
      const ouvinte = () => callback();
      ipcRenderer.on("rotinas:abrir-painel", ouvinte);
      return () => ipcRenderer.removeListener("rotinas:abrir-painel", ouvinte);
    },
  },

  primeiraAbertura: {
    carregar: () => ipcRenderer.invoke("primeira-abertura:carregar"),
    escolherPasta: (atual) => ipcRenderer.invoke("primeira-abertura:escolher-pasta", atual),
    escolherClaudeCode: (atual) => ipcRenderer.invoke("primeira-abertura:escolher-claude-code", atual),
    salvar: (dados) => ipcRenderer.invoke("primeira-abertura:salvar", dados),
  },
});

// O contextBridge não passa MessagePort: a porta do motor nativo vai à página
// pelo window.postMessage (padrão da documentação do Electron).
ipcRenderer.on("transcricao:porta", (evento) => {
  window.postMessage({ tipo: "orquestrador:porta-da-transcricao" }, "*", evento.ports);
});
