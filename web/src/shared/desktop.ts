/**
 * Plataforma do app desktop (Electron). O preload expõe `window.electron`
 * com `desktop: true` e `plataforma` (o process.platform do Node). No
 * navegador puro não existe e as funções daqui devolvem false.
 */
interface PonteDoDesktop {
  desktop?: boolean;
  plataforma?: string;
}

/**
 * true dentro do app desktop no macOS. Lá a janela usa as 3 bolinhas nativas
 * dentro da barra do canvas, e os botões de janela desenhados (do Windows)
 * não aparecem.
 */
export function rodandoNoDesktopDoMac(): boolean {
  if (typeof window === "undefined") return false;
  const ponte = (window as unknown as { electron?: PonteDoDesktop }).electron;
  return ponte?.desktop === true && ponte.plataforma === "darwin";
}
