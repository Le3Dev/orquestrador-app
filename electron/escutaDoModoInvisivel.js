"use strict";

// Escuta no modo invisível: resposta ao getDisplayMedia da tela principal.
//
// Com o modo invisível ligado, a tela pede getDisplayMedia({ audio: true,
// video: true }), descarta a trilha de vídeo e transcreve o áudio do sistema
// (Whisper local; nada é gravado em disco). Para isso o processo principal
// responde ao pedido (session.setDisplayMediaRequestHandler) com a fonte
// "screen" do monitor da janela e audio: "loopback", que captura o som do
// sistema sem silenciá-lo ("loopbackWithMute" deixaria o usuário sem som).
//
// Lógica pura: desktopCapturer, screen e o estado do app são injetados para
// permitir teste sem Electron.
//
// Recusa: responder(null). No Electron 33 o `null` encerra o pedido com
// CAPTURE_FAILURE; já `{}` sem vídeo (o getDisplayMedia sempre pede vídeo)
// lança "Video was requested, but no video stream was provided".

const { monitorDaJanela, fonteDoMonitor } = require("./capturaDeTela");

// O loopback de áudio do sistema só é suportado (e confiável) no Windows.
const PLATAFORMA_DA_ESCUTA = "win32";

// Sem miniaturas: a trilha de vídeo é descartada pela tela.
const SEM_MINIATURA = { width: 0, height: 0 };

// O pedido vem do frame principal da janela principal? Instâncias distintas de
// WebFrameMain podem representar o mesmo frame, então a comparação é pelo par
// processId + routingId (único por frame), e não pela referência do objeto.
function vemDaJanelaPrincipal(frame, janela) {
  if (!frame || !janela || janela.isDestroyed()) return false;
  const conteudo = janela.webContents;
  if (!conteudo || conteudo.isDestroyed()) return false;
  const principal = conteudo.mainFrame;
  if (!principal) return false;
  return frame.processId === principal.processId && frame.routingId === principal.routingId;
}

/**
 * Monta o handler de session.setDisplayMediaRequestHandler.
 *
 * Só atende quando, ao mesmo tempo: o modo invisível está ativo, a plataforma
 * é Windows, o pedido vem do frame principal da janela principal e pede áudio.
 * Nesse caso responde { video: <fonte screen do monitor da janela>, audio:
 * "loopback" }; em qualquer outro caso (ou erro), recusa com responder(null) e
 * registra o motivo.
 *
 * @param {object} p
 * @param {{getSources: Function}} p.desktopCapturer
 * @param {{getDisplayMatching: Function}} p.screen
 * @param {() => (object|null)} p.obterJanelaPrincipal  BrowserWindow principal ou null
 * @param {() => boolean} p.modoInvisivelAtivo
 * @param {() => boolean} [p.escutaManualLigada]  escuta ligada pelo botão, fora do modo invisível
 * @param {string} p.plataforma  process.platform
 * @param {(texto: string) => void} [p.registrar]
 * @returns {(pedido: object, responder: Function) => Promise<void>} a Promise
 *   só interessa aos testes; o Electron ignora o retorno.
 */
function criarRespostaAoPedidoDeMidia({
  desktopCapturer,
  screen,
  obterJanelaPrincipal,
  modoInvisivelAtivo,
  escutaManualLigada,
  plataforma,
  registrar,
}) {
  const log = (texto) => {
    if (registrar) registrar(texto);
  };

  function recusar(responder, motivo) {
    log(`Pedido de captura de mídia recusado: ${motivo}`);
    try {
      responder(null);
    } catch (erro) {
      log(`Falha ao recusar o pedido de captura de mídia: ${erro?.message || erro}`);
    }
  }

  // Devolve o motivo da recusa, ou null quando o pedido pode ser atendido.
  function motivoDaRecusa(pedido, janela) {
    const manual = typeof escutaManualLigada === "function" && escutaManualLigada();
    if (!modoInvisivelAtivo() && !manual) return "nem o modo invisível nem a escuta manual estão ativos.";
    if (plataforma !== PLATAFORMA_DA_ESCUTA) return `a escuta do áudio do sistema só existe no Windows (plataforma: ${plataforma}).`;
    if (!vemDaJanelaPrincipal(pedido?.frame, janela)) return "o pedido não veio da janela principal.";
    if (!pedido.audioRequested) return "o pedido não inclui áudio.";
    return null;
  }

  return async function responderAoPedidoDeMidia(pedido, responderDoElectron) {
    // O callback do Electron só pode ser chamado uma vez.
    let respondido = false;
    const responder = (resposta) => {
      respondido = true;
      responderDoElectron(resposta);
    };
    try {
      const janela = obterJanelaPrincipal();
      const motivo = motivoDaRecusa(pedido, janela);
      if (motivo) {
        recusar(responder, motivo);
        return;
      }

      const monitor = monitorDaJanela(screen, janela);
      const fontes = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: SEM_MINIATURA });

      // O usuário pode ter saído do modo (ou fechado a janela) durante a busca.
      const motivoAposBusca = motivoDaRecusa(pedido, obterJanelaPrincipal());
      if (motivoAposBusca) {
        recusar(responder, motivoAposBusca);
        return;
      }

      // O vídeo é descartado pela tela: sem a fonte do monitor, qualquer tela serve.
      const fonte = fonteDoMonitor(fontes, monitor) || (fontes || [])[0] || null;
      if (!fonte) {
        recusar(responder, "nenhuma fonte de tela disponível.");
        return;
      }

      responder({ video: { id: fonte.id, name: fonte.name }, audio: "loopback" });
      log(`Escuta do áudio do sistema liberada (monitor ${monitor.id}, fonte ${fonte.id}).`);
    } catch (erro) {
      if (respondido) {
        log(`Falha ao liberar a escuta do áudio do sistema: ${erro?.message || erro}`);
        return;
      }
      recusar(responder, `erro ao preparar a captura: ${erro?.message || erro}`);
    }
  };
}

module.exports = { criarRespostaAoPedidoDeMidia, vemDaJanelaPrincipal, PLATAFORMA_DA_ESCUTA };
