import { definirTextos } from "../idioma";

/** Textos do nó de rascunho (a criação de um orquestrador no canvas). */
export const textosDeRascunho = definirTextos({
  "pt-BR": {
    confirmarDescartar: "Descartar este rascunho? O que você preencheu será perdido.",
    escolhaUmaPasta: "Escolha uma pasta para começar.",
    deUmNome: "Dê um nome ao orquestrador para começar.",
    encurteAsInstrucoes: "Encurte as instruções para começar.",
    servidorDesconectado: "Servidor desconectado.",
    novoOrquestrador: "novo orquestrador",
    novoOrquestradorNome: (nome: string) => `novo orquestrador · ${nome}`,
    descartar: "Descartar",
    descartarRascunho: "Descartar rascunho",
    pastaENome: "Pasta e nome",
    pastaDeTrabalho: "Pasta de trabalho",
    pastaDica: "Onde ele trabalha.",
    pastaExplicacao:
      'A pasta do projeto que o orquestrador vai ler e mudar; os agentes só trabalham dentro dela. Use "procurar…" para uma pasta fora dos projetos.',
    carregandoPastas: "carregando pastas…",
    escolhaUmProjeto: "escolha um projeto",
    todosOsProjetos: "todos os projetos (pasta raiz)",
    pastaDoComputador: (nome: string) => `${nome} (pasta do computador)`,
    procurarDica: "Escolher uma pasta qualquer do computador",
    procurar: "procurar…",
    nome: "Nome",
    nomeDica: "Como ele aparece no canvas.",
    nomeExplicacao: "Vem da pasta escolhida; um nome digitado aqui não é trocado ao mudar de pasta.",
    nomePlaceholder: "Ex.: Painel de salas",
    permissaoExplicacao: (leitura: string) =>
      `Vale para o orquestrador e para os subagentes. Comece em ${leitura} e libere mais quando precisar: dá para mudar depois, na engrenagem do terminal.`,
    opcoesExplicacao: (rotuloOnline: string, ajudaOnline: string) =>
      `Commit e push por feature: ligado, cada feature ou correção pronta (testada, com lint e build ok) vira um commit próprio com push da branch em seguida, numa branch feature/, fix/, hotfix/ ou refactor/. PR e merge só quando você pedir. Precisa da permissão de rodar comandos. ${rotuloOnline}: ${ajudaOnline} O Modo econômico troca modelos e esforço por outros que gastam menos cota; os campos continuam editáveis. Ele vale só para o Claude Code: com outro motor, os dois papéis voltam ao Claude Code.`,
    tamanhoDaLetraExplicacao:
      "Aumenta a letra do cartão inteiro, na configuração e na conversa, e o cartão cresce junto. Fica guardado neste navegador; dá para mudar depois, na engrenagem do terminal.",
    instrucoesExplicacao:
      "Entram no prompt dele, por exemplo o jeito de responder ou o que rodar antes de concluir. Vazio, valem as Instruções gerais (botão na barra). Aplicar perfil copia um texto pronto, criado no mesmo botão. Não ampliam a permissão acima.",
    passouDoLimite: (limite: string) => `Passou do limite de ${limite} caracteres: encurte o texto para conseguir começar.`,
    comecando: "Começando…",
    comecarEm: (nome: string) => `Começar em ${nome}`,
    comecar: "Começar",
    detalhes: {
      commitEPush: "commit e push",
      artefatosOnline: "artefatos online",
      instrucoesGerais: "instruções gerais",
      instrucoesProprias: "instruções próprias",
    },
  },
  en: {
    confirmarDescartar: "Discard this draft? What you filled in will be lost.",
    escolhaUmaPasta: "Choose a folder to start.",
    deUmNome: "Give the orchestrator a name to start.",
    encurteAsInstrucoes: "Shorten the instructions to start.",
    servidorDesconectado: "Server disconnected.",
    novoOrquestrador: "new orchestrator",
    novoOrquestradorNome: (nome: string) => `new orchestrator · ${nome}`,
    descartar: "Discard",
    descartarRascunho: "Discard draft",
    pastaENome: "Folder and name",
    pastaDeTrabalho: "Working folder",
    pastaDica: "Where it works.",
    pastaExplicacao:
      'The project folder the orchestrator will read and change; the agents only work inside it. Use "browse…" for a folder outside the projects.',
    carregandoPastas: "loading folders…",
    escolhaUmProjeto: "choose a project",
    todosOsProjetos: "all projects (root folder)",
    pastaDoComputador: (nome: string) => `${nome} (computer folder)`,
    procurarDica: "Choose any folder on the computer",
    procurar: "browse…",
    nome: "Name",
    nomeDica: "How it appears on the canvas.",
    nomeExplicacao: "Comes from the chosen folder; a name typed here is not replaced when you change folders.",
    nomePlaceholder: "E.g.: Room dashboard",
    permissaoExplicacao: (leitura: string) =>
      `Applies to the orchestrator and the subagents. Start with ${leitura} and allow more when you need it: you can change it later, in the terminal's gear.`,
    opcoesExplicacao: (rotuloOnline: string, ajudaOnline: string) =>
      `Commit and push per feature: when on, each finished feature or fix (tested, with lint and build passing) becomes its own commit, followed by a push of the branch, on a feature/, fix/, hotfix/ or refactor/ branch. PR and merge only when you ask. Requires permission to run commands. ${rotuloOnline}: ${ajudaOnline} Economy mode switches models and effort to ones that use less quota; the fields stay editable. It only applies to Claude Code: with another engine, both roles go back to Claude Code.`,
    tamanhoDaLetraExplicacao:
      "Enlarges the text of the whole card, in the settings and in the conversation, and the card grows with it. Kept in this browser; you can change it later, in the terminal's gear.",
    instrucoesExplicacao:
      "They go into its prompt, for example how to answer or what to run before finishing. When empty, the General instructions apply (button in the bar). Apply profile copies a ready-made text, created with the same button. They do not widen the permission above.",
    passouDoLimite: (limite: string) => `Over the limit of ${limite} characters: shorten the text to be able to start.`,
    comecando: "Starting…",
    comecarEm: (nome: string) => `Start in ${nome}`,
    comecar: "Start",
    detalhes: {
      commitEPush: "commit and push",
      artefatosOnline: "online artifacts",
      instrucoesGerais: "general instructions",
      instrucoesProprias: "own instructions",
    },
  },
});
