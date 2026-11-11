"use strict";

// Modo invisível: decide, a partir do processo principal, quando a janela
// recebe o mouse. Com setIgnoreMouseEvents(true, { forward: true }) o Windows
// nem sempre repassa os movimentos à tela (sem mouseenter, o botão "Voltar ao
// modo normal" nunca recebia o clique); por isso o main compara a posição do
// cursor com o retângulo do chat a cada instante, sem depender do renderer.
// Lógica sem Electron: janela e screen são injetados para permitir teste.

const SELETOR_DA_AREA = ".chat-rapido";

// Áreas sólidas do chat (cabeçalho, conversa, campo, menus, modais...) levam
// este atributo; só sobre elas o mouse é capturado, e os vãos transparentes
// deixam o clique passar. Sem nenhuma marcada na página (tela antiga), vale o
// retângulo inteiro de `.chat-rapido`.
const ATRIBUTO_DA_AREA_CLICAVEL = "data-area-clicavel";

// Roda na tela: true se o ponto (px da viewport) deve capturar o mouse.
function scriptDoPonto(x, y) {
  return `(() => {
  const x = ${Number(x)}, y = ${Number(y)};
  if (document.querySelector("[${ATRIBUTO_DA_AREA_CLICAVEL}]")) {
    const el = document.elementFromPoint(x, y);
    return Boolean(el && el.closest("[${ATRIBUTO_DA_AREA_CLICAVEL}]"));
  }
  const e = document.querySelector(${JSON.stringify(SELETOR_DA_AREA)});
  if (!e) return false;
  const r = e.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
})()`;
}

function dentroDoRetangulo(x, y, retangulo) {
  return Array.isArray(retangulo) && x >= retangulo[0] && x <= retangulo[2] && y >= retangulo[1] && y <= retangulo[3];
}

function iniciarRastreioDoMouse({ janela, screen, intervaloMs = 50, agendar = setInterval, cancelar = clearInterval }) {
  let capturando = null; // null = ainda não decidido
  let consultando = false;
  let parado = false;
  let pausado = false; // overlay oculto: nada captura o mouse

  function aplicar(capturar) {
    if (parado || janela.isDestroyed() || capturando === capturar) return;
    capturando = capturar;
    if (capturar) janela.setIgnoreMouseEvents(false);
    else janela.setIgnoreMouseEvents(true, { forward: true });
  }

  async function verificar() {
    if (parado || pausado || consultando || janela.isDestroyed()) return;
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
      // O cursor vem em px de tela; a viewport usa px divididos pelo zoom.
      const zoom = typeof janela.webContents.getZoomFactor === "function" ? janela.webContents.getZoomFactor() : 1;
      const fator = zoom > 0 && zoom !== 1 ? zoom : 1;
      const capturar = await janela.webContents.executeJavaScript(scriptDoPonto(x / fator, y / fator));
      if (!pausado) aplicar(capturar === true);
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
      if (pausado) return;
      aplicar(Boolean(capturar));
    },
    // Pausado: força os cliques a passarem e ignora o cursor até retomar.
    pausar(pausar) {
      pausado = Boolean(pausar);
      if (pausado) aplicar(false);
    },
    verificar,
    parar() {
      parado = true;
      cancelar(id);
    },
  };
}

module.exports = { iniciarRastreioDoMouse, dentroDoRetangulo, scriptDoPonto, SELETOR_DA_AREA, ATRIBUTO_DA_AREA_CLICAVEL };
