import {
  calcularRetangulo,
  calcularRetanguloSemCorte,
  mesmoRetangulo,
  pontosDeAmostra,
  type RetanguloDaVista,
} from "../previaNativa";

/** Como medir o corpo: `conferirCobertura` (padrão: sim) e `semCorte` (padrão: não). */
export interface OpcoesDaMedida {
  conferirCobertura?: boolean;
  semCorte?: boolean;
}

/** Onde o corpo está na tela e se algo está por cima dele. */
export interface MedidaDoCorpo {
  retangulo: RetanguloDaVista;
  coberta: boolean;
}

/**
 * Quantos quadros seguidos sem nada mexer encerram o acompanhamento por quadro (cerca de 100 ms a 60 Hz): cobre a
 * folga entre dois eventos de um gesto lento e o fim de uma animação de zoom.
 */
export const QUADROS_DE_FOLGA = 6;

/**
 * Em repouso, de quanto em quanto tempo o corpo é conferido (retângulo e cobertura): pega o menu ou painel que abre
 * por cima sem clique nem tecla e a mudança de layout que não avisa ninguém. É o atraso máximo para esconder a vista
 * nesses casos; com clique ou tecla, ela é conferida já no quadro seguinte.
 */
export const INTERVALO_DA_COBERTURA_MS = 250;

/** Algum dos nove pontos de amostra cai fora do corpo (painel, menu, cabeçalho, outra janela por cima)? */
function estaCoberto(corpo: HTMLElement, retangulo: RetanguloDaVista): boolean {
  return (
    typeof document.elementFromPoint === "function" &&
    pontosDeAmostra(retangulo).some(({ x, y }) => {
      const elemento = document.elementFromPoint(x, y);
      return elemento === null || !corpo.contains(elemento);
    })
  );
}

/** A geometria do corpo, antes de saber se algo o cobre. */
interface GeometriaDoCorpo {
  /** O que vai para a vista nativa. */
  retangulo: RetanguloDaVista;
  /** Onde se confere a cobertura: o `retangulo` cortado pela área do canvas (igual a ele sem `semCorte`). */
  paraAmostrar: RetanguloDaVista;
  /** Só com `semCorte`: o corpo passa de uma borda do canvas que não é a da janela (conta como coberto). */
  passaDaAreaDoCanvas: boolean;
}

function medirGeometria(corpo: HTMLElement, semCorte: boolean): GeometriaDoCorpo | null {
  const area = corpo.closest(".react-flow")?.getBoundingClientRect() ?? {
    left: 0,
    top: 0,
    width: window.innerWidth,
    height: window.innerHeight,
  };
  if (semCorte) {
    const medida = calcularRetanguloSemCorte(corpo.getBoundingClientRect(), area, corpo.offsetWidth, {
      largura: window.innerWidth,
      altura: window.innerHeight,
    });
    return medida === null
      ? null
      : { retangulo: medida.retangulo, paraAmostrar: medida.visivel, passaDaAreaDoCanvas: medida.passaDaAreaDoCanvas };
  }
  const cortado = calcularRetangulo(corpo.getBoundingClientRect(), area, corpo.offsetWidth);
  return cortado === null ? null : { retangulo: cortado, paraAmostrar: cortado, passaDaAreaDoCanvas: false };
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
 * Com `conferirCobertura: false`, não há teste de acerto na tela (`coberta` só reflete a borda do `semCorte`).
 */
export function medirCorpo(
  corpo: HTMLElement,
  { conferirCobertura = true, semCorte = false }: OpcoesDaMedida = {},
): MedidaDoCorpo | null {
  const geometria = medirGeometria(corpo, semCorte);
  if (geometria === null) {
    return null;
  }
  const coberta =
    geometria.passaDaAreaDoCanvas || (conferirCobertura && estaCoberto(corpo, geometria.paraAmostrar));
  return { retangulo: geometria.retangulo, coberta };
}

/** O pedaço da loja do React Flow (`useStoreApi()`) que avisa pan, zoom, arraste e redimensionamento. */
export interface LojaDoCanvas {
  getState: () => { transform: readonly number[]; nodes: unknown; width: number; height: number };
  subscribe: (ouvinte: () => void) => () => void;
}

/** Como acompanhar o corpo. */
export interface OpcoesDoAcompanhamento {
  /** Mede o retângulo inteiro, sem o corte da área do canvas (veja `medirCorpo`). */
  semCorte?: boolean;
  /**
   * Chamada na hora, dentro do aviso da loja (antes do quadro seguinte ser desenhado), quando a câmera do canvas
   * muda (pan, zoom). Quem não aguenta a vista nativa um quadro atrás do corpo desce a vista aqui. É a mesma
   * escuta que move o acompanhamento por quadro: não ocupa o `onViewportChangeStart/End` do React Flow, que tem uma
   * vaga só por canvas.
   */
  aoMexerACamera?: () => void;
}

/** Eventos de entrada que podem abrir um menu ou painel por cima: conferem a cobertura logo no quadro seguinte. */
const EVENTOS_QUE_ABREM_MENUS = ["pointerdown", "pointerup", "keydown"] as const;

function mesmaCamera(a: readonly number[], b: readonly number[]): boolean {
  return a === b || (a.length === b.length && a.every((valor, indice) => valor === b[indice]));
}

/**
 * Acompanha o corpo de uma vista nativa e chama `aoMedir` a cada medida (nula: fora da tela). Mede por quadro só
 * enquanto algo se mexe: a câmera do canvas (pan, zoom), os nós (arraste, redimensionar, outro nó por cima), o
 * tamanho do canvas ou da janela, o próprio corpo (ResizeObserver) ou um clique ou tecla (que pode abrir um menu).
 * Depois de `QUADROS_DE_FOLGA` quadros parados, faz uma última medida com a cobertura e para; em repouso, confere a
 * cada `INTERVALO_DA_COBERTURA_MS` (nada com a janela oculta). A cobertura (nove pontos na tela) só roda quando o
 * retângulo muda, quando algo se mexeu e no repouso; o retângulo sozinho custa dois `getBoundingClientRect`.
 *
 * `aoMedir` recebe a mesma medida repetida; quem chama manda à ponte só o que mudou. Devolve o cancelamento.
 */
export function acompanharCorpo(
  corpo: HTMLElement,
  loja: LojaDoCanvas,
  aoMedir: (medida: MedidaDoCorpo | null) => void,
  { semCorte = false, aoMexerACamera }: OpcoesDoAcompanhamento = {},
): () => void {
  let encerrado = false;
  let quadro = 0;
  let quadrosParados = 0;
  let mexeu = false;
  let conferirCobertura = true;
  let primeira = true;
  let anterior: RetanguloDaVista | null = null;
  // O que o último teste de acerto na tela achou (nove pontos); a borda do canvas (`semCorte`) é conferida sempre.
  let cobertaPorOutroElemento = false;

  /** Mede o corpo, confere a cobertura se preciso e avisa; devolve se o retângulo mudou. */
  const medir = (): boolean => {
    const geometria = medirGeometria(corpo, semCorte);
    const retangulo = geometria?.retangulo ?? null;
    const mudou = primeira || !mesmoRetangulo(anterior, retangulo);
    primeira = false;
    anterior = retangulo;
    if (geometria === null) {
      cobertaPorOutroElemento = false;
    } else if (mudou || conferirCobertura) {
      cobertaPorOutroElemento = estaCoberto(corpo, geometria.paraAmostrar);
    }
    conferirCobertura = false;
    aoMedir(
      geometria === null
        ? null
        : { retangulo: geometria.retangulo, coberta: geometria.passaDaAreaDoCanvas || cobertaPorOutroElemento },
    );
    return mudou;
  };

  const passo = (): void => {
    quadro = 0;
    if (encerrado) {
      return;
    }
    const mudou = medir();
    quadrosParados = mudou || mexeu ? 0 : quadrosParados + 1;
    mexeu = false;
    if (quadrosParados < QUADROS_DE_FOLGA) {
      quadro = requestAnimationFrame(passo);
      return;
    }
    // Parou: a última medida, exata e com a cobertura (um menu pode ter aberto durante o gesto).
    if (!encerrado && anterior !== null) {
      conferirCobertura = true;
      medir();
    }
  };

  const movimentar = (): void => {
    if (encerrado) {
      return;
    }
    mexeu = true;
    conferirCobertura = true;
    if (quadro === 0) {
      quadrosParados = 0;
      quadro = requestAnimationFrame(passo);
    }
  };

  // A loja avisa qualquer mudança: só conta como movimento a câmera, os nós e o tamanho do canvas.
  let estado = loja.getState();
  const sairDaLoja = loja.subscribe(() => {
    const novo = loja.getState();
    if (aoMexerACamera !== undefined && !mesmaCamera(estado.transform, novo.transform)) {
      aoMexerACamera();
    }
    if (
      novo.transform !== estado.transform ||
      novo.nodes !== estado.nodes ||
      novo.width !== estado.width ||
      novo.height !== estado.height
    ) {
      movimentar();
    }
    estado = novo;
  });

  const observador = typeof ResizeObserver === "function" ? new ResizeObserver(movimentar) : null;
  observador?.observe(corpo);
  window.addEventListener("resize", movimentar);
  for (const tipo of EVENTOS_QUE_ABREM_MENUS) {
    document.addEventListener(tipo, movimentar, { capture: true, passive: true });
  }
  const aoMudarVisibilidade = (): void => {
    if (!document.hidden) {
      movimentar();
    }
  };
  document.addEventListener("visibilitychange", aoMudarVisibilidade);

  // Em repouso: a conferência lenta. Com a janela oculta não há o que conferir (ao voltar, `visibilitychange`).
  const repouso = setInterval(() => {
    if (quadro !== 0 || document.hidden) {
      return;
    }
    conferirCobertura = true;
    if (medir()) {
      movimentar();
    }
  }, INTERVALO_DA_COBERTURA_MS);

  movimentar();

  return () => {
    encerrado = true;
    cancelAnimationFrame(quadro);
    quadro = 0;
    clearInterval(repouso);
    sairDaLoja();
    observador?.disconnect();
    window.removeEventListener("resize", movimentar);
    for (const tipo of EVENTOS_QUE_ABREM_MENUS) {
      document.removeEventListener(tipo, movimentar, { capture: true });
    }
    document.removeEventListener("visibilitychange", aoMudarVisibilidade);
  };
}
