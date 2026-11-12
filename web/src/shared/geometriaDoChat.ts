/** Posição e tamanho (px da janela) do chat rápido móvel do modo invisível. */
export interface GeometriaDoChat {
  readonly x: number;
  readonly y: number;
  readonly largura: number;
  readonly altura: number;
}

/** Tamanho da janela (viewport) em que o chat precisa caber. */
export interface AreaVisivel {
  readonly largura: number;
  readonly altura: number;
}

/** Os menores tamanhos do chat: abaixo disso a barra do campo não cabe. */
export const TAMANHO_MINIMO_DO_CHAT = { largura: 320, altura: 160 } as const;

/** Quanto cada Ctrl+Alt+seta move o chat (px). */
export const PASSO_DE_MOVER_O_CHAT = 40;

function inteiroEntre(valor: number, minimo: number, maximo: number): number {
  if (!Number.isFinite(valor)) {
    return minimo;
  }
  return Math.round(Math.min(Math.max(valor, minimo), Math.max(minimo, maximo)));
}

/**
 * Ajusta a geometria para o chat nunca sair da tela: o tamanho respeita o mínimo
 * e a área visível, e a posição o mantém inteiro dentro dela.
 */
export function limitarGeometriaDoChat(geometria: GeometriaDoChat, area: AreaVisivel): GeometriaDoChat {
  const largura = inteiroEntre(geometria.largura, TAMANHO_MINIMO_DO_CHAT.largura, area.largura);
  const altura = inteiroEntre(geometria.altura, TAMANHO_MINIMO_DO_CHAT.altura, area.altura);
  return {
    largura,
    altura,
    x: inteiroEntre(geometria.x, 0, area.largura - largura),
    y: inteiroEntre(geometria.y, 0, area.altura - altura),
  };
}

/** A mesma geometria movida por (dx, dy), ainda dentro da tela. */
export function moverGeometriaDoChat(
  geometria: GeometriaDoChat,
  dx: number,
  dy: number,
  area: AreaVisivel,
): GeometriaDoChat {
  return limitarGeometriaDoChat({ ...geometria, x: geometria.x + dx, y: geometria.y + dy }, area);
}

/** Valida o que veio do localStorage: só uma geometria com quatro números finitos vale. */
export function interpretarGeometriaDoChat(valor: unknown): GeometriaDoChat | null {
  if (typeof valor !== "object" || valor === null || Array.isArray(valor)) {
    return null;
  }
  const { x, y, largura, altura } = valor as Record<string, unknown>;
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof largura !== "number" ||
    typeof altura !== "number" ||
    ![x, y, largura, altura].every(Number.isFinite)
  ) {
    return null;
  }
  return { x: Math.round(x), y: Math.round(y), largura: Math.round(largura), altura: Math.round(altura) };
}
