import { calcularRetangulo, pontosDeAmostra, type RetanguloDaVista } from "../previaNativa";

/**
 * Onde o corpo de uma janela com vista nativa (a prévia, o navegador do agente) está agora e se algo está por
 * cima dele: o retângulo (cortado pela área do canvas) e se algum dos pontos de amostra cai em outro elemento da
 * tela (painel, menu, cabeçalho, outra janela). Nulo: o corpo não está na tela.
 *
 * Com `conferirCobertura: false`, só o retângulo (barato, sem teste de acerto na tela); `coberta` vem falso e
 * quem chama confere de vez em quando. Quem acompanha a vista a cada quadro (o navegador do agente, sempre à
 * vista) usa isso para não testar nove pontos a cada quadro.
 */
export function medirCorpo(
  corpo: HTMLElement,
  { conferirCobertura = true }: { conferirCobertura?: boolean } = {},
): { retangulo: RetanguloDaVista; coberta: boolean } | null {
  const area = corpo.closest(".react-flow")?.getBoundingClientRect() ?? {
    left: 0,
    top: 0,
    width: window.innerWidth,
    height: window.innerHeight,
  };
  const retangulo = calcularRetangulo(corpo.getBoundingClientRect(), area, corpo.offsetWidth);
  if (retangulo === null) {
    return null;
  }
  const coberta =
    conferirCobertura &&
    typeof document.elementFromPoint === "function" &&
    pontosDeAmostra(retangulo).some(({ x, y }) => {
      const elemento = document.elementFromPoint(x, y);
      return elemento === null || !corpo.contains(elemento);
    });
  return { retangulo, coberta };
}
