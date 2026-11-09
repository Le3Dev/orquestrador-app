"use strict";

// Captura da tela onde está a janela principal (modo invisível). Lógica pura:
// desktopCapturer e screen são injetados para permitir teste sem Electron.

const LARGURA_MAXIMA = 1280;
const QUALIDADE_INICIAL = 70;
const LIMITE_DE_BYTES = 3 * 1024 * 1024;
const QUALIDADES_REDUZIDAS = [55, 40, 25];

function tamanhoReduzido(tamanho) {
  const largura = Math.max(1, Math.round(tamanho.width));
  const altura = Math.max(1, Math.round(tamanho.height));
  if (largura <= LARGURA_MAXIMA) return { width: largura, height: altura };
  return { width: LARGURA_MAXIMA, height: Math.max(1, Math.round((altura * LARGURA_MAXIMA) / largura)) };
}

// O monitor onde está a janela (o que tem a maior área em comum com ela).
function monitorDaJanela(screen, janela) {
  return screen.getDisplayMatching(janela.getBounds());
}

// A fonte "screen" do desktopCapturer que corresponde ao monitor, ou null.
function fonteDoMonitor(fontes, monitor) {
  const alvo = String(monitor.id);
  return (fontes || []).find((f) => String(f.display_id) === alvo) || null;
}

function paraJpeg(imagem) {
  let buffer = imagem.toJPEG(QUALIDADE_INICIAL);
  for (const qualidade of QUALIDADES_REDUZIDAS) {
    if (buffer.length <= LIMITE_DE_BYTES) break;
    buffer = imagem.toJPEG(qualidade);
  }
  return buffer;
}

/**
 * @param {object} p
 * @param {{getSources: Function}} p.desktopCapturer
 * @param {{getDisplayMatching: Function}} p.screen
 * @param {{getBounds: Function, setOpacity?: Function}} p.janela
 * @param {boolean} p.janelaProtegida  true quando setContentProtection já a exclui da captura
 * @param {(texto: string) => void} [p.registrar]
 * @param {() => Date} [p.agora]
 */
async function capturarTela({ desktopCapturer, screen, janela, janelaProtegida, registrar, agora = () => new Date() }) {
  const display = monitorDaJanela(screen, janela);
  const tamanho = tamanhoReduzido(display.size || display.bounds);

  const esconder = !janelaProtegida && typeof janela.setOpacity === "function";
  if (esconder) janela.setOpacity(0);
  let fontes;
  try {
    fontes = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: tamanho });
  } finally {
    if (esconder) janela.setOpacity(1);
  }

  const alvo = String(display.id);
  const fonte = fonteDoMonitor(fontes, display);
  if (!fonte) throw new Error("Não foi possível capturar a tela onde a janela está.");
  if (!fonte.thumbnail || fonte.thumbnail.isEmpty?.()) throw new Error("A captura da tela veio vazia.");

  const buffer = paraJpeg(fonte.thumbnail);
  if (registrar) registrar(`Tela capturada (monitor ${alvo}, ${tamanho.width}x${tamanho.height}, ${buffer.length} bytes).`);
  const d = agora();
  const carimbo = d.toISOString().replace(/[:.]/g, "-");
  return { nome: `tela-${carimbo}.jpg`, tipoDeMidia: "image/jpeg", base64: buffer.toString("base64") };
}

module.exports = { capturarTela, tamanhoReduzido, monitorDaJanela, fonteDoMonitor, LARGURA_MAXIMA, LIMITE_DE_BYTES };
