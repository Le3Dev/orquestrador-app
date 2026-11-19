import { definirTextos } from "../idioma";

/** Textos dos componentes comuns: campo de instruções, anexo, etiquetas, melhoria do prompt e campos da configuração. */
export const textosDeComponentesComuns = definirTextos({
  "pt-BR": {
    instrucoes: {
      ditarDestino: "as instruções",
      passouDoLimite: (limite: string) => `Passou do limite de ${limite} caracteres: encurte o texto para conseguir salvar.`,
    },
    anexo: {
      documento: "Documento",
      cliqueParaBaixar: "Clique para baixar.",
      remover: (nome: string) => `Remover ${nome}`,
    },
    dica: { oQueE: (sobre: string) => `O que é ${sobre}` },
    situacoes: {
      ocioso: "Ocioso",
      trabalhando: "Trabalhando",
      em_andamento: "Em andamento",
      executando: "Executando",
      concluido: "Concluído",
      falhou: "Falhou",
      cancelado: "Cancelado",
      interrompido: "Interrompido",
    },
    worktree: {
      dica: (branch: string, caminho: string, ativo: boolean) =>
        `Branch: ${branch}\nWorktree: ${caminho}${ativo ? " · em uso agora" : " · inativo"}`,
    },
    melhoria: {
      cancelarRotulo: "Cancelar a melhoria do pedido",
      cancelarDica: "Cancelar a melhoria (o texto fica como estava)",
      cancelar: "cancelar",
      melhorar: "Melhorar o pedido",
      melhorando: "melhorando o pedido…",
      melhorado: "melhorado · ≈ índice ",
      desfazerDica: "Volta o texto de antes da melhoria",
      desfazer: "desfazer",
    },
    previa: {
      origem: {
        orquestrador: "valem as instruções deste orquestrador",
        padrao: "valem as instruções gerais",
      },
      esconder: "Esconder prompt final",
      visualizar: "Pré-visualizar prompt final",
      montando: "montando…",
      semInstrucoes: "Sem instruções personalizadas: o pedido vai exatamente como antes.",
      nestePedido: (origem: string) => `Neste pedido ${origem}.`,
      mensagemDeCadaPedido: "mensagem de cada pedido",
      systemPrompt: "system prompt da conversa (fixo desde o 1º pedido)",
    },
    codigo: {
      copiar: "copiar",
      copiado: "copiado",
      naoCopiou: "não copiou",
      linguagemPadrao: "código",
      copiarDica: "Copiar o código",
    },
    configuracao: {
      prontos: { todos: "Todos", nenhum: "Nenhum", escolher: "Escolher" },
      naoAplicou: (predefinicao: string, detalhe: string) => `Não foi possível aplicar o ${predefinicao}: ${detalhe}`,
      permissao: "Permissão",
      permissaoDica: "O que ele pode fazer na pasta.",
      permissaoExplicacao: (comandos: string) =>
        `Vale para o orquestrador e para os subagentes. Libere ${comandos} só quando precisar instalar, testar ou compilar.`,
      avisoDeComandos: "Edita, instala, testa e compila. Use só em pastas que você confia.",
      quantidade: "Quantidade",
      quantidadeDica: "Quantos ao mesmo tempo.",
      quantidadeExplicacao:
        "Automática: o orquestrador decide quantos subagentes usar, até o máximo escolhido (no padrão, até 3 ao mesmo tempo). Fixa: ele usa sempre essa quantidade. Cada subagente consome a cota da sua assinatura do Claude.",
      subagentesProntos: "Subagentes prontos",
      subagentesProntosDica: "Quais ele pode usar.",
      subagentesProntosExplicacao:
        "Os subagentes prontos são criados no botão Subagentes da barra. Todos inclui os que você criar depois; Nenhum deixa só o subagente padrão; Escolher libera só os marcados. Vale já no próximo pedido.",
      nenhumPronto: "Nenhum subagente pronto criado ainda.",
      prontosEscolhidos: "Subagentes prontos escolhidos",
      opcoes: "Opções",
      opcoesDica: "Commit e push por feature; publicar artefatos online.",
      opcoesExplicacao: (rotuloOnline: string, ajudaOnline: string) =>
        `Commit e push por feature: ligado, cada feature ou correção pronta (testada, com lint e build ok) vira um commit próprio com push da branch em seguida, numa branch feature/, fix/, hotfix/ ou refactor/. PR e merge só quando você pedir. Precisa da permissão de rodar comandos. ${rotuloOnline}: ${ajudaOnline} O Modo econômico troca modelos e esforço por outros que gastam menos cota e já vale, sem o Salvar; os campos continuam editáveis. Ele vale só para o Claude Code: com outro motor, os dois papéis voltam ao Claude Code.`,
      commitEPush: "Commit e push por feature",
      aplicando: "Aplicando…",
      modoEconomico: "Modo econômico",
      soValeCom: (permissao: string) => `Só vale com ${permissao}.`,
      tamanhoDaLetra: "Tamanho da letra",
      tamanhoDaLetraDica: "Só deste orquestrador, no canvas.",
      tamanhoDaLetraExplicacao:
        "Aumenta a letra do cartão inteiro, na configuração e na conversa, e o cartão cresce junto. Vale na hora, sem o Salvar, e fica guardado neste navegador.",
      instrucoes: "Instruções",
      instrucoesDica: "Regras só deste orquestrador.",
      instrucoesExplicacao:
        "Entram no prompt dele, por exemplo o jeito de responder ou o que rodar antes de concluir, e valem já no próximo pedido, inclusive nesta conversa. Vazio, valem as Instruções gerais (botão na barra). Aplicar perfil copia um texto pronto, criado no mesmo botão. Não ampliam a permissão acima.",
      instrucoesPlaceholder: "Opcional. Ex.: Responda em tópicos curtos. Rode os testes antes de concluir.",
    },
  },
  en: {
    instrucoes: {
      ditarDestino: "the instructions",
      passouDoLimite: (limite: string) => `Over the limit of ${limite} characters: shorten the text to be able to save.`,
    },
    anexo: {
      documento: "Document",
      cliqueParaBaixar: "Click to download.",
      remover: (nome: string) => `Remove ${nome}`,
    },
    dica: { oQueE: (sobre: string) => `What is ${sobre}` },
    situacoes: {
      ocioso: "Idle",
      trabalhando: "Working",
      em_andamento: "In progress",
      executando: "Running",
      concluido: "Done",
      falhou: "Failed",
      cancelado: "Canceled",
      interrompido: "Interrupted",
    },
    worktree: {
      dica: (branch: string, caminho: string, ativo: boolean) =>
        `Branch: ${branch}\nWorktree: ${caminho}${ativo ? " · in use now" : " · inactive"}`,
    },
    melhoria: {
      cancelarRotulo: "Cancel improving the request",
      cancelarDica: "Cancel the improvement (the text stays as it was)",
      cancelar: "cancel",
      melhorar: "Improve the request",
      melhorando: "improving the request…",
      melhorado: "improved · ≈ index ",
      desfazerDica: "Restores the text from before the improvement",
      desfazer: "undo",
    },
    previa: {
      origem: {
        orquestrador: "this orchestrator's instructions apply",
        padrao: "the general instructions apply",
      },
      esconder: "Hide final prompt",
      visualizar: "Preview final prompt",
      montando: "building…",
      semInstrucoes: "No custom instructions: the request goes exactly as before.",
      nestePedido: (origem: string) => `In this request ${origem}.`,
      mensagemDeCadaPedido: "message of each request",
      systemPrompt: "conversation system prompt (fixed since the 1st request)",
    },
    codigo: {
      copiar: "copy",
      copiado: "copied",
      naoCopiou: "copy failed",
      linguagemPadrao: "code",
      copiarDica: "Copy the code",
    },
    configuracao: {
      prontos: { todos: "All", nenhum: "None", escolher: "Choose" },
      naoAplicou: (predefinicao: string, detalhe: string) => `Could not apply ${predefinicao}: ${detalhe}`,
      permissao: "Permission",
      permissaoDica: "What it can do in the folder.",
      permissaoExplicacao: (comandos: string) =>
        `Applies to the orchestrator and the subagents. Allow ${comandos} only when you need to install, test or build.`,
      avisoDeComandos: "Edits, installs, tests and builds. Use only in folders you trust.",
      quantidade: "Number",
      quantidadeDica: "How many at the same time.",
      quantidadeExplicacao:
        "Automatic: the orchestrator decides how many subagents to use, up to the chosen maximum (by default, up to 3 at the same time). Fixed: it always uses that number. Each subagent uses your Claude subscription quota.",
      subagentesProntos: "Ready-made subagents",
      subagentesProntosDica: "Which ones it can use.",
      subagentesProntosExplicacao:
        "Ready-made subagents are created with the Subagents button in the bar. All includes the ones you create later; None leaves only the default subagent; Choose allows only the checked ones. Applies from the next request.",
      nenhumPronto: "No ready-made subagent created yet.",
      prontosEscolhidos: "Chosen ready-made subagents",
      opcoes: "Options",
      opcoesDica: "Commit and push per feature; publish artifacts online.",
      opcoesExplicacao: (rotuloOnline: string, ajudaOnline: string) =>
        `Commit and push per feature: when on, each finished feature or fix (tested, with lint and build passing) becomes its own commit, followed by a push of the branch, on a feature/, fix/, hotfix/ or refactor/ branch. PR and merge only when you ask. Requires permission to run commands. ${rotuloOnline}: ${ajudaOnline} Economy mode switches models and effort to ones that use less quota and takes effect right away, without Save; the fields stay editable. It only applies to Claude Code: with another engine, both roles go back to Claude Code.`,
      commitEPush: "Commit and push per feature",
      aplicando: "Applying…",
      modoEconomico: "Economy mode",
      soValeCom: (permissao: string) => `Only works with ${permissao}.`,
      tamanhoDaLetra: "Font size",
      tamanhoDaLetraDica: "Only for this orchestrator, on the canvas.",
      tamanhoDaLetraExplicacao:
        "Enlarges the text of the whole card, in the settings and in the conversation, and the card grows with it. Takes effect right away, without Save, and is kept in this browser.",
      instrucoes: "Instructions",
      instrucoesDica: "Rules only for this orchestrator.",
      instrucoesExplicacao:
        "They go into its prompt, for example how to answer or what to run before finishing, and apply from the next request, including in this conversation. When empty, the General instructions apply (button in the bar). Apply profile copies a ready-made text, created with the same button. They do not widen the permission above.",
      instrucoesPlaceholder: "Optional. E.g.: Answer in short bullet points. Run the tests before finishing.",
    },
  },
});
