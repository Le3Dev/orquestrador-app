import {
  calcularRetangulo,
  calcularRetanguloSemCorte,
  pontosDeAmostra,
  type RetanguloDaVista,
} from "../previaNativa";

/** Como medir o corpo: `conferirCobertura` (padrão: sim) e `semCorte` (padrão: não). */
export interface OpcoesDaMedida {
  conferirCobertura?: boolean;
  semCorte?: boolean;
}

/**
 * Onde o corpo de uma janela com vista nativa (a prévia, o navegador do agente) está agora e se algo está por
 * cima dele: o retângulo e se a vista estaria coberta (algum dos pontos de amostra cai em outro elemento da tela:
 * painel, menu, cabeçalho, outra janela). Nulo: o corpo não está na tela.
 *
 * Por padrão o retângulo é cortado pela área do canvas (`.react-flow`), como a Prévia usa. Com `semCorte: true` ele
 * vai inteiro, do tamanho do corpo (x e y podem ser negativos, a caixa pode passar da borda da janela, que corta),
 * e então:
 * - nulo também quando a parte visível (a interseção com a área do canvas) é menor que `LADO_MINIMO_DA_VISTA_PX`;
 * - os pontos de amostra ficam só na parte visível;
 * - se o corpo passa de uma borda da área que não é a borda da janela (± 1 px), `coberta` é verdadeiro: a vista,
 *   sempre por cima do DOM, desenharia sobre algo de fora do canvas. Essa conferência é barata e vale mesmo com
 *   `conferirCobertura: false`.
 *
 * Com `conferirCobertura: false`, não há teste de acerto na tela (`coberta` só reflete a borda do `semCorte`):
 * quem acompanha a vista a cada quadro (o navegador do agente, sempre à vista) confere os nove pontos de vez em
 * quando, não a cada quadro.
 */
export function medirCorpo(
  corpo: HTMLElement,
  { conferirCobertura = true, semCorte = false }: OpcoesDaMedida = {},
): { retangulo: RetanguloDaVista; coberta: boolean } | null {
  const area = corpo.closest(".react-flow")?.getBoundingClientRect() ?? {
    left: 0,
    top: 0,
    width: window.innerWidth,
    height: window.innerHeight,
  };
  let retangulo: RetanguloDaVista;
  let paraAmostrar: RetanguloDaVista;
  let passaDaAreaDoCanvas = false;
  if (semCorte) {
    const medida = calcularRetanguloSemCorte(corpo.getBoundingClientRect(), area, corpo.offsetWidth, {
      largura: window.innerWidth,
      altura: window.innerHeight,
    });
    if (medida === null) {
      return null;
    }
    retangulo = medida.retangulo;
    paraAmostrar = medida.visivel;
    passaDaAreaDoCanvas = medida.passaDaAreaDoCanvas;
  } else {
    const cortado = calcularRetangulo(corpo.getBoundingClientRect(), area, corpo.offsetWidth);
    if (cortado === null) {
      return null;
    }
    retangulo = cortado;
    paraAmostrar = cortado;
  }
  const coberta =
    passaDaAreaDoCanvas ||
    (conferirCobertura &&
      typeof document.elementFromPoint === "function" &&
      pontosDeAmostra(paraAmostrar).some(({ x, y }) => {
        const elemento = document.elementFromPoint(x, y);
        return elemento === null || !corpo.contains(elemento);
      }));
  return { retangulo, coberta };
}
