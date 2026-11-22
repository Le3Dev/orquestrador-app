import { calcularRetangulo, mesmoRetangulo, pontosDeAmostra, type RetanguloDaVista } from "../previaNativa";

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

/**
 * Onde o corpo de uma janela com vista nativa (a prévia, o navegador do agente) está agora e se algo está por
 * cima dele: o retângulo (cortado pela área do canvas) e se algum dos pontos de amostra cai em outro elemento da
 * tela (painel, menu, cabeçalho, outra janela). Nulo: o corpo não está na tela.
 *
 * Com `conferirCobertura: false`, só o retângulo (barato, sem teste de acerto na tela); `coberta` vem falso.
 */
export function medirCorpo(
  corpo: HTMLElement,
  { conferirCobertura = true }: { conferirCobertura?: boolean } = {},
): MedidaDoCorpo | null {
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
  return { retangulo, coberta: conferirCobertura && estaCoberto(corpo, retangulo) };
}

/** O pedaço da loja do React Flow (`useStoreApi()`) que avisa pan, zoom, arraste e redimensionamento. */
export interface LojaDoCanvas {
  getState: () => { transform: unknown; nodes: unknown; width: number; height: number };
  subscribe: (ouvinte: () => void) => () => void;
}

/** Eventos de entrada que podem abrir um menu ou painel por cima: conferem a cobertura logo no quadro seguinte. */
const EVENTOS_QUE_ABREM_MENUS = ["pointerdown", "pointerup", "keydown"] as const;

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
): () => void {
  let encerrado = false;
  let quadro = 0;
  let quadrosParados = 0;
  let mexeu = false;
  let conferirCobertura = true;
  let primeira = true;
  let anterior: RetanguloDaVista | null = null;
  let coberta = false;

  /** Mede o corpo, confere a cobertura se preciso e avisa; devolve se o retângulo mudou. */
  const medir = (): boolean => {
    const retangulo = medirCorpo(corpo, { conferirCobertura: false })?.retangulo ?? null;
    const mudou = primeira || !mesmoRetangulo(anterior, retangulo);
    primeira = false;
    anterior = retangulo;
    if (retangulo === null) {
      coberta = false;
    } else if (mudou || conferirCobertura) {
      coberta = estaCoberto(corpo, retangulo);
    }
    conferirCobertura = false;
    aoMedir(retangulo === null ? null : { retangulo, coberta });
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
