import { definirTextos } from "../idioma";

/** Textos do prompt do terminal do Orquestrador (campo, fila, anexos, modo). */
export const textosDePromptDoTerminal = definirTextos({
  "pt-BR": {
    avisoDosAnexos:
      "anexos não entram na fila — envie quando o orquestrador estiver livre, ou remova os anexos para pôr só o texto na fila",
    fila: {
      aria: "Fila de pedidos",
      pausada: "fila pausada",
      enviandoOProximo: "enviando o próximo…",
      naFila: "na fila",
      nenhumRodando: "· nenhum pedido rodando: envie o próximo ou remova",
      anteriorTerminou: "· o pedido anterior terminou bem",
      saiSozinha: "· sai sozinha quando o pedido atual terminar bem",
      planMode: "plan mode",
      enviarAgoraDica: "Tira o pedido da fila e o envia agora",
      enviarAgora: "enviar agora",
      remover: (numero: number) => `Remover da fila o pedido ${numero}`,
      removerDica: "Remover da fila",
    },
    remover: (nome: string) => `Remover ${nome}`,
    placeholder: {
      desconectado: "servidor desconectado — dá para escrever, o envio volta quando ele voltar",
      trabalhando: "trabalhando… escreva o próximo e enter põe na fila · esc cancela",
      planejando: "descreva o que planejar — nada é alterado até você aprovar",
      padrao: "peça algo e pressione enter · cole ou arraste imagens e arquivos",
    },
    mensagem: "Mensagem para o orquestrador",
    ditarDestino: "a mensagem",
    anexarDica: "Anexar arquivos (também dá para colar com Ctrl+V ou arrastar para o terminal)",
    anexar: "Anexar arquivos",
    cancelando: "cancelando…",
    cancelar: "cancelar",
    enviar: "enviar ⏎",
    modoDica: "Alterna o modo do próximo pedido (Shift+Tab)",
    planejandoLigado: "‖ plan mode ligado · só investiga e propõe um plano",
    execucao: "› execução",
    shiftTab: " · shift+tab alterna",
  },
  en: {
    avisoDosAnexos:
      "attachments don't go in the queue — send when the orchestrator is free, or remove the attachments to queue just the text",
    fila: {
      aria: "Request queue",
      pausada: "queue paused",
      enviandoOProximo: "sending the next one…",
      naFila: "queued",
      nenhumRodando: "· no request running: send the next one or remove it",
      anteriorTerminou: "· the previous request finished fine",
      saiSozinha: "· goes out on its own when the current request finishes fine",
      planMode: "plan mode",
      enviarAgoraDica: "Takes the request out of the queue and sends it now",
      enviarAgora: "send now",
      remover: (numero: number) => `Remove request ${numero} from the queue`,
      removerDica: "Remove from the queue",
    },
    remover: (nome: string) => `Remove ${nome}`,
    placeholder: {
      desconectado: "server disconnected — you can still write, sending resumes when it is back",
      trabalhando: "working… write the next one and enter queues it · esc cancels",
      planejando: "describe what to plan — nothing is changed until you approve",
      padrao: "ask for something and press enter · paste or drag images and files",
    },
    mensagem: "Message to the orchestrator",
    ditarDestino: "the message",
    anexarDica: "Attach files (you can also paste with Ctrl+V or drag onto the terminal)",
    anexar: "Attach files",
    cancelando: "canceling…",
    cancelar: "cancel",
    enviar: "send ⏎",
    modoDica: "Switches the mode of the next request (Shift+Tab)",
    planejandoLigado: "‖ plan mode on · only investigates and proposes a plan",
    execucao: "› execution",
    shiftTab: " · shift+tab switches",
  },
});

/** Textos do terminal de shell (o terminal do computador num nó do canvas). */
export const textosDeShell = definirTextos({
  "pt-BR": {
    terminal: "Terminal",
    conectando: "conectando…",
    reconectando: "reconectando…",
    encerrado: "encerrado",
    enviarDica: (linhas: number) =>
      `Enviar ao orquestrador: a seleção (ou as últimas ${linhas} linhas) vai para o prompt dele, sem enviar`,
    enviar: "Enviar ao orquestrador",
    fecharDica: "Fechar o terminal (encerra o shell)",
    fechar: "Fechar este terminal",
    shellEncerrou: (codigo: number | null) =>
      codigo === null ? "o shell encerrou" : `o shell encerrou (código ${codigo})`,
    abrirDeNovo: "abrir de novo",
  },
  en: {
    terminal: "Terminal",
    conectando: "connecting…",
    reconectando: "reconnecting…",
    encerrado: "closed",
    enviarDica: (linhas: number) =>
      `Send to the orchestrator: the selection (or the last ${linhas} lines) goes into its prompt, without sending`,
    enviar: "Send to the orchestrator",
    fecharDica: "Close the terminal (ends the shell)",
    fechar: "Close this terminal",
    shellEncerrou: (codigo: number | null) =>
      codigo === null ? "the shell exited" : `the shell exited (code ${codigo})`,
    abrirDeNovo: "open again",
  },
});
