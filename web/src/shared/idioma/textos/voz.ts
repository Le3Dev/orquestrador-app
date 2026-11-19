import { definirTextos } from "../idioma";

/**
 * Textos da voz: o ditado (microfone no campo), a escuta do áudio do computador
 * (erros e captura) e o modo invisível. Os blocos de "ditado" são os do botão e do painel.
 */
export const textosDeVoz = definirTextos({
  "pt-BR": {
    ditado: {
      silencio: "Não estou ouvindo nada, confira o microfone",
      anuncioPermita: "Permita o acesso ao microfone.",
      anuncioGravando: "Gravando. Enter conclui, Esc descarta.",
      anuncioBaixando: "Baixando o modelo de voz, só na primeira vez.",
      anuncioTranscrevendo: "Transcrevendo o áudio.",
      anuncioInserido: "Texto adicionado ao campo.",
      erroAcessoNegado:
        "O acesso ao microfone foi negado. No Mac, libere em Ajustes do Sistema › Privacidade e Segurança › Microfone (ative este app) e tente de novo.",
      erroSemMicrofone: "Nenhum microfone encontrado.",
      erroMicrofoneOcupado: "O microfone está ocupado por outro programa.",
      erroNavegadorSemAcesso: "O ditado falhou: este navegador não deu acesso ao microfone.",
      erroDownloadDoModelo: "Não foi possível baixar o modelo de voz. Confira a internet e tente de novo.",
      erroGenerico: "O ditado falhou. Tente de novo ou digite o texto.",
      tituloGravando: "Gravando: clique para transformar em texto (Esc descarta)",
      tituloBaixando: (percentual: number) =>
        `Baixando o modelo de voz: ${percentual}% (só na primeira vez, uns 250 MB)`,
      tituloTranscrevendo: "Transformando a fala em texto…",
      tituloParado: (destino: string) => `Ditar ${destino} por voz (roda no seu computador, o áudio não sai dele)`,
      rotuloParar: "Parar e transformar em texto",
      rotuloDitar: (destino: string) => `Ditar ${destino} por voz`,
      fecharAviso: "Fechar aviso do ditado",
      concluir: "Concluir",
      descartar: "Descartar",
      dicaDeTeclas: "Enter conclui, Esc descarta",
      permitaOMicrofone: "Permita o acesso ao microfone",
      dicaDoPedido: "O pedido aparece na tela. O áudio fica só neste computador.",
      baixandoOModelo: "Baixando o modelo de voz",
      downloadDoModelo: "Download do modelo de voz",
      dicaDoDownload: "Só na primeira vez, uns 250 MB. Depois fica salvo neste computador.",
      preparandoOAudio: "Preparando o áudio",
      transcrevendoSegundos: (segundos: number) => `Transcrevendo ${segundos} s de áudio`,
      textoAdicionado: "Texto adicionado ao campo",
    },
    escuta: {
      erroDownloadDoModelo:
        "Não foi possível baixar o modelo de voz da escuta. Confira a internet; a escuta tenta de novo na próxima fala.",
      motorNaoPreparado: (mensagem: string) => `O motor de transcrição da escuta não pôde ser preparado: ${mensagem}`,
      transcricaoFalhou: (mensagem: string) => `A transcrição da escuta falhou: ${mensagem}`,
      detectorFalhou: (mensagem: string) => `O detector de voz da escuta falhou: ${mensagem}`,
      avaliacaoFalhou: (detalhe: string) => `A escuta não conseguiu avaliar a pergunta: ${detalhe}`,
      perguntaNaoFoiParaOCampo: (mensagem: string) =>
        `A pergunta da escuta não foi para o campo de mensagem: ${mensagem}`,
      perguntaNaoEnviada: (mensagem: string) => `A pergunta da escuta não foi enviada: ${mensagem}`,
    },
    captura: {
      semAudio: "O áudio do computador não veio na captura.",
      encerrada: "A captura do áudio do computador terminou. Clique em retomar no indicador da escuta.",
      naoLiberada: "A captura do áudio não foi liberada. Clique em retomar no indicador da escuta.",
      precisaDeUmClique: "A captura do áudio precisa de um clique. Clique em retomar no indicador da escuta.",
      semSuporte:
        "Este computador não oferece a captura do áudio do sistema. A escuta só funciona no app desktop, no Windows.",
      semFonte: "Nenhuma fonte de áudio do computador foi encontrada para capturar.",
      naoPodeSerLido:
        "O áudio do computador não pôde ser lido. Clique em retomar no indicador da escuta para tentar de novo.",
      falhou: (mensagem: string) => `A captura do áudio do computador falhou: ${mensagem}`,
    },
    motorNativo: {
      falhou: "A transcrição nativa falhou.",
      semOApp: "O app não oferece a transcrição nativa.",
      naoConectada: "A transcrição nativa não está conectada.",
      caiuDuasVezes: "A transcrição nativa caiu duas vezes; seguindo no navegador.",
      semPorta: "A transcrição nativa não respondeu: a porta não chegou.",
      naoConectou: (mensagem: string) => `Não foi possível conectar à transcrição nativa: ${mensagem}`,
      desligada: (mensagem: string) => `A transcrição nativa foi desligada: ${mensagem}`,
      naoCarregou: (mensagem: string) => `A transcrição nativa não carregou: ${mensagem}`,
      reconhecimentoFalhou: "O reconhecimento de voz falhou ao iniciar.",
      descartada: "A transcrição foi descartada: chegaram trechos mais novos da escuta.",
    },
    modoInvisivel: {
      falhaAoEntrar: (mensagem: string) => `Não foi possível entrar no modo invisível: ${mensagem}`,
      falhaAoSair: (mensagem: string) => `Não foi possível sair do modo invisível: ${mensagem}`,
      falhaAoAlternar: (mensagem: string) => `Não foi possível alternar o modo invisível: ${mensagem}`,
      falhaNaEscuta: (ligar: boolean, mensagem: string) =>
        `Não foi possível ${ligar ? "ligar" : "desligar"} a escuta: ${mensagem}`,
      capturaSoNoDesktop: "a captura de tela só existe no aplicativo desktop",
    },
  },
  en: {
    ditado: {
      silencio: "I can't hear anything, check your microphone",
      anuncioPermita: "Allow microphone access.",
      anuncioGravando: "Recording. Enter finishes, Esc discards.",
      anuncioBaixando: "Downloading the voice model, first time only.",
      anuncioTranscrevendo: "Transcribing the audio.",
      anuncioInserido: "Text added to the field.",
      erroAcessoNegado:
        "Microphone access was denied. On a Mac, allow it in System Settings › Privacy & Security › Microphone (enable this app) and try again.",
      erroSemMicrofone: "No microphone found.",
      erroMicrofoneOcupado: "The microphone is in use by another program.",
      erroNavegadorSemAcesso: "Dictation failed: this browser did not give access to the microphone.",
      erroDownloadDoModelo: "Could not download the voice model. Check your internet connection and try again.",
      erroGenerico: "Dictation failed. Try again or type the text.",
      tituloGravando: "Recording: click to turn it into text (Esc discards)",
      tituloBaixando: (percentual: number) =>
        `Downloading the voice model: ${percentual}% (first time only, about 250 MB)`,
      tituloTranscrevendo: "Turning speech into text…",
      tituloParado: (destino: string) => `Dictate ${destino} by voice (runs on your computer, the audio never leaves it)`,
      rotuloParar: "Stop and turn into text",
      rotuloDitar: (destino: string) => `Dictate ${destino} by voice`,
      fecharAviso: "Close dictation notice",
      concluir: "Finish",
      descartar: "Discard",
      dicaDeTeclas: "Enter finishes, Esc discards",
      permitaOMicrofone: "Allow microphone access",
      dicaDoPedido: "The request appears on screen. The audio stays on this computer only.",
      baixandoOModelo: "Downloading the voice model",
      downloadDoModelo: "Voice model download",
      dicaDoDownload: "First time only, about 250 MB. It is then saved on this computer.",
      preparandoOAudio: "Preparing the audio",
      transcrevendoSegundos: (segundos: number) => `Transcribing ${segundos} s of audio`,
      textoAdicionado: "Text added to the field",
    },
    escuta: {
      erroDownloadDoModelo:
        "Could not download the listening voice model. Check your internet connection; listening will try again on the next speech.",
      motorNaoPreparado: (mensagem: string) => `The listening transcription engine could not be prepared: ${mensagem}`,
      transcricaoFalhou: (mensagem: string) => `Listening transcription failed: ${mensagem}`,
      detectorFalhou: (mensagem: string) => `The listening voice detector failed: ${mensagem}`,
      avaliacaoFalhou: (detalhe: string) => `Listening could not evaluate the question: ${detalhe}`,
      perguntaNaoFoiParaOCampo: (mensagem: string) =>
        `The question from listening did not go to the message field: ${mensagem}`,
      perguntaNaoEnviada: (mensagem: string) => `The question from listening was not sent: ${mensagem}`,
    },
    captura: {
      semAudio: "The computer audio did not come through the capture.",
      encerrada: "The computer audio capture ended. Click resume on the listening indicator.",
      naoLiberada: "The audio capture was not allowed. Click resume on the listening indicator.",
      precisaDeUmClique: "The audio capture needs a click. Click resume on the listening indicator.",
      semSuporte:
        "This computer does not offer system audio capture. Listening only works in the desktop app, on Windows.",
      semFonte: "No computer audio source was found to capture.",
      naoPodeSerLido: "The computer audio could not be read. Click resume on the listening indicator to try again.",
      falhou: (mensagem: string) => `The computer audio capture failed: ${mensagem}`,
    },
    motorNativo: {
      falhou: "Native transcription failed.",
      semOApp: "The app does not offer native transcription.",
      naoConectada: "Native transcription is not connected.",
      caiuDuasVezes: "Native transcription dropped twice; continuing in the browser.",
      semPorta: "Native transcription did not respond: the port never arrived.",
      naoConectou: (mensagem: string) => `Could not connect to native transcription: ${mensagem}`,
      desligada: (mensagem: string) => `Native transcription was shut down: ${mensagem}`,
      naoCarregou: (mensagem: string) => `Native transcription did not load: ${mensagem}`,
      reconhecimentoFalhou: "Speech recognition failed to start.",
      descartada: "The transcription was discarded: newer pieces of listening arrived.",
    },
    modoInvisivel: {
      falhaAoEntrar: (mensagem: string) => `Could not enter invisible mode: ${mensagem}`,
      falhaAoSair: (mensagem: string) => `Could not leave invisible mode: ${mensagem}`,
      falhaAoAlternar: (mensagem: string) => `Could not toggle invisible mode: ${mensagem}`,
      falhaNaEscuta: (ligar: boolean, mensagem: string) =>
        `Could not turn listening ${ligar ? "on" : "off"}: ${mensagem}`,
      capturaSoNoDesktop: "screen capture only exists in the desktop app",
    },
  },
});
