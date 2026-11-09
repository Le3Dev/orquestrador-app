"use strict";

// Modo invisível: decide, a partir do processo principal, quando a janela
// recebe o mouse. Com setIgnoreMouseEvents(true, { forward: true }) o Windows
// nem sempre repassa os movimentos à tela (sem mouseenter, o botão "Voltar ao
// modo normal" nunca recebia o clique); por isso o main compara a posição do
// cursor com o retângulo do chat a cada instante, sem depender do renderer.
// Lógica sem Electron: janela e screen são injetados para permitir teste.

const SELETOR_DA_AREA = ".chat-rapido";

// Roda na tela: retângulo do chat em px da viewport, ou null se não houver chat.
const SCRIPT_DA_AREA = `(() => {
  const e = document.querySelector(${JSON.stringify(SELETOR_DA_AREA)});
  if (!e) return null;
  const r = e.getBoundingClientRect();
  return [r.left, r.top, r.right, r.bottom];
})()`;

function dentroDoRetangulo(x, y, retangulo) {
  return Array.isArray(retangulo) && x >= retangulo[0] && x <= retangulo[2] && y >= retangulo[1] && y <= retangulo[3];
}

function iniciarRastreioDoMouse({ janela, screen, intervaloMs = 50, agendar = setInterval, cancelar = clearInterval }) {
  let capturando = null; // null = ainda não decidido
  let consultando = false;
  let parado = false;

  function aplicar(capturar) {
    if (parado || janela.isDestroyed() || capturando === capturar) return;
    capturando = capturar;
    if (capturar) janela.setIgnoreMouseEvents(false);
    else janela.setIgnoreMouseEvents(true, { forward: true });
  }

  async function verificar() {
    if (parado || consultando || janela.isDestroyed()) return;
    const ponto = screen.getCursorScreenPoint();
    const area = janela.getContentBounds();
    const x = ponto.x - area.x;
    const y = ponto.y - area.y;
    if (x < 0 || y < 0 || x > area.width || y > area.height) {
      aplicar(false);
      return;
    }
    consultando = true;
    try {
      const retangulo = await janela.webContents.executeJavaScript(SCRIPT_DA_AREA);
      aplicar(dentroDoRetangulo(x, y, retangulo));
    } catch {
      /* tela recarregando: tenta de novo no próximo ciclo */
    } finally {
      consultando = false;
    }
  }

  const id = agendar(() => void verificar(), intervaloMs);
  return {
    // Mantém o estado interno em sincronia com um pedido vindo da tela.
    definir(capturar) {
      aplicar(Boolean(capturar));
    },
    verificar,
    parar() {
      parado = true;
      cancelar(id);
    },
  };
}

module.exports = { iniciarRastreioDoMouse, dentroDoRetangulo, SELETOR_DA_AREA };
