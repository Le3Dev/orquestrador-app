import { definirTextos } from "../idioma";

/** Textos da transcrição do terminal: linhas do log, sinal de vida, retomada, plano e banner. */
export const textosDeTranscricao = definirTextos({
  "pt-BR": {
    origemOrquestrador: "orquestrador",
    orientacaoRetoma: "O app retoma sozinho se travar.",
    orientacaoCancelar: "Se continuar assim, cancele (esc) e reenvie.",
    semNoticias: (motor: string, duracao: string, resumo: string) => `sem notícias do ${motor} há ${duracao}: ${resumo}.`,
    semNoticiasTempo: (motor: string, duracao: string) => `sem notícias do ${motor} há ${duracao} — pode ter travado.`,
    sinalDeVida: (tokens: string | null, duracao: string) =>
      `${tokens === null ? "" : `pensando · ~${tokens} tokens de raciocínio · `}último sinal há ${duracao}`,
    retomada: {
      aria: "Retomada automática",
      retomandoEm: "Retomando em ",
      retomandoAgora: "Retomando agora",
      tentativa: (tentativa: number, de: number) => `(tentativa ${tentativa} de ${de})`,
      naoRetomarSozinho: (causa: string) => `Não retomar sozinho (${causa})`,
      cancelando: "cancelando…",
      cancelar: "cancelar retomada",
      automatica: (tentativa: number) => `retomada automática (tentativa ${tentativa})`,
      mensagemEnviada: "mensagem enviada ao Claude",
    },
    trocaDeMotor: "Troca de motor",
    desistencia: {
      aria: "Retomada automática sem sucesso",
      titulo: (causa: string, tentativa: number, de: number) =>
        `Não consegui retomar sozinho (${causa}, ${tentativa} de ${de} tentativas)`,
      orientacao:
        "Você decide o próximo passo: reenvie o pedido (se puder, em partes menores) ou confira o log acima para ver onde ele parou.",
    },
    abrirEmTamanhoReal: (nome: string) => `${nome} — abrir em tamanho real`,
    pedidoRodouNo: (motor: string) => `Este pedido rodou no ${motor}`,
    semConexao: "sem conexão com o servidor — aguardando ele voltar",
    banner: {
      pasta: "pasta ",
      config: "config ",
      economico: "econômico",
      economicoDica: "A configuração atual é a do modo econômico.",
      vazio: "digite um pedido e pressione enter — o orquestrador divide o trabalho e instancia os agentes.",
      pedidos: (quantidade: number) =>
        `${quantidade} ${quantidade === 1 ? "pedido" : "pedidos"} nesta conversa · /clear começa uma nova`,
    },
    conversaNova: (momento: string) => `— conversa nova iniciada às ${momento} —`,
    avisosDaConversaNova: "Avisos da conversa nova",
    worktreeComAlteracoes: "a worktree tem alterações da conversa anterior",
    planoDescartado: "o plano pendente foi descartado",
    mostrarAnteriores: (quantidade: number) => `Mostrar ${quantidade} anteriores`,
  },
  en: {
    origemOrquestrador: "orchestrator",
    orientacaoRetoma: "The app resumes on its own if it gets stuck.",
    orientacaoCancelar: "If it stays like this, cancel (esc) and resend.",
    semNoticias: (motor: string, duracao: string, resumo: string) => `no news from ${motor} for ${duracao}: ${resumo}.`,
    semNoticiasTempo: (motor: string, duracao: string) => `no news from ${motor} for ${duracao} — it may be stuck.`,
    sinalDeVida: (tokens: string | null, duracao: string) =>
      `${tokens === null ? "" : `thinking · ~${tokens} reasoning tokens · `}last signal ${duracao} ago`,
    retomada: {
      aria: "Automatic resume",
      retomandoEm: "Resuming in ",
      retomandoAgora: "Resuming now",
      tentativa: (tentativa: number, de: number) => `(attempt ${tentativa} of ${de})`,
      naoRetomarSozinho: (causa: string) => `Do not resume on its own (${causa})`,
      cancelando: "canceling…",
      cancelar: "cancel resume",
      automatica: (tentativa: number) => `automatic resume (attempt ${tentativa})`,
      mensagemEnviada: "message sent to Claude",
    },
    trocaDeMotor: "Engine switch",
    desistencia: {
      aria: "Automatic resume failed",
      titulo: (causa: string, tentativa: number, de: number) =>
        `Could not resume on its own (${causa}, ${tentativa} of ${de} attempts)`,
      orientacao:
        "You decide the next step: resend the request (in smaller parts, if you can) or check the log above to see where it stopped.",
    },
    abrirEmTamanhoReal: (nome: string) => `${nome} — open at full size`,
    pedidoRodouNo: (motor: string) => `This request ran on ${motor}`,
    semConexao: "no connection to the server — waiting for it to come back",
    banner: {
      pasta: "folder ",
      config: "config ",
      economico: "economy",
      economicoDica: "The current configuration is the economy mode one.",
      vazio: "type a request and press enter — the orchestrator splits the work and spawns the agents.",
      pedidos: (quantidade: number) =>
        `${quantidade} ${quantidade === 1 ? "request" : "requests"} in this conversation · /clear starts a new one`,
    },
    conversaNova: (momento: string) => `— new conversation started at ${momento} —`,
    avisosDaConversaNova: "New conversation notices",
    worktreeComAlteracoes: "the worktree has changes from the previous conversation",
    planoDescartado: "the pending plan was discarded",
    mostrarAnteriores: (quantidade: number) => `Show ${quantidade} earlier`,
  },
});
