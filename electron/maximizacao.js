"use strict";

// Maximizar "na mão". A janela principal é transparente (necessário para o modo
// invisível) e, no Windows, janelas transparentes não maximizam nem reportam
// isMaximized() de forma confiável. Então guardamos os bounds e ocupamos a área
// útil (workArea) do monitor onde a janela está.

const TOLERANCIA = 2;

function mesmaArea(a, b) {
  return (
    Math.abs(a.x - b.x) <= TOLERANCIA &&
    Math.abs(a.y - b.y) <= TOLERANCIA &&
    Math.abs(a.width - b.width) <= TOLERANCIA &&
    Math.abs(a.height - b.height) <= TOLERANCIA
  );
}

/**
 * @param {object} janela BrowserWindow (ou equivalente: getBounds, setBounds, isMaximized, maximize, unmaximize, on, isDestroyed)
 * @param {object} screen módulo `screen` do Electron (getDisplayMatching)
 * @param {(maximizada: boolean) => void} avisar chamado quando o estado muda
 */
function criarMaximizacao(janela, screen, avisar) {
  let manual = false;
  let restaurar = null;
  let aplicando = false;
  let ultimo = false;

  const estaMaximizada = () => manual || janela.isMaximized();

  const emitir = () => {
    const atual = estaMaximizada();
    if (atual === ultimo) return;
    ultimo = atual;
    avisar(atual);
  };

  function maximizar() {
    if (manual) return;
    if (janela.isMaximized()) return janela.unmaximize();
    restaurar = janela.getBounds();
    const area = screen.getDisplayMatching(restaurar).workArea;
    manual = true;
    aplicando = true;
    try {
      janela.setBounds({ x: area.x, y: area.y, width: area.width, height: area.height });
    } finally {
      aplicando = false;
    }
    emitir();
  }

  function restaurarJanela() {
    if (!manual) return;
    manual = false;
    aplicando = true;
    try {
      if (restaurar) janela.setBounds(restaurar);
    } finally {
      aplicando = false;
    }
    restaurar = null;
    emitir();
  }

  function alternar() {
    if (estaMaximizada()) {
      if (manual) restaurarJanela();
      else janela.unmaximize();
    } else {
      maximizar();
    }
  }

  // Se o usuário redimensiona/move a janela maximizada à mão, ela deixa de estar maximizada.
  function aoMudarGeometria() {
    if (!manual || aplicando) return;
    const area = screen.getDisplayMatching(janela.getBounds()).workArea;
    if (!mesmaArea(janela.getBounds(), area)) {
      manual = false;
      restaurar = null;
      emitir();
    }
  }

  janela.on("maximize", emitir);
  janela.on("unmaximize", emitir);
  janela.on("resize", aoMudarGeometria);
  janela.on("move", aoMudarGeometria);

  return { alternar, estaMaximizada };
}

module.exports = { criarMaximizacao, mesmaArea };
