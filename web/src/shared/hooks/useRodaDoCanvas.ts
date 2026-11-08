import { useReactFlow } from "@xyflow/react";
import { type RefObject, useEffect } from "react";

/** Os limites de zoom do canvas: os mesmos passados ao <ReactFlow>. */
export interface LimitesDoZoom {
  minZoom: number;
  maxZoom: number;
}

/**
 * Velocidade do pan pela roda, igual à padrão do `panOnScroll` do React Flow
 * (`panOnScrollSpeed`): o canvas anda metade do deslize.
 */
const VELOCIDADE_DO_PAN = 0.5;
/** Uma "linha" de roda (Firefox, `deltaMode` 1) em pixels, como o React Flow normaliza. */
const PIXELS_POR_LINHA = 20;
/**
 * Pausa (ms) que encerra um gesto: eventos de roda mais próximos que isso são
 * o mesmo deslize do trackpad (inclusive a inércia), e o dono não muda.
 */
const PAUSA_ENTRE_GESTOS_MS = 200;

/** Quem ficou com o gesto em curso: a caixa (rola o conteúdo) ou o canvas (anda). */
type DonoDoGesto = "caixa" | "canvas";

function rodandoNoMac(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent.includes("Mac");
}

/**
 * Quanto o zoom muda (expoente de 2) com uma roda ou pinça, igual ao React
 * Flow: no Mac a pinça do trackpad chega com `ctrlKey` e deltas pequenos, daí
 * o fator 10.
 */
function expoenteDoZoom(evento: WheelEvent): number {
  const fator = evento.ctrlKey && rodandoNoMac() ? 10 : 1;
  const escala = evento.deltaMode === 1 ? 0.05 : evento.deltaMode !== 0 ? 1 : 0.002;
  return -evento.deltaY * escala * fator;
}

/** O deslize da roda em pixels nos dois eixos. */
interface Deslize {
  x: number;
  y: number;
}

/**
 * O deslize da roda em pixels, normalizado como no React Flow. Fora do Mac,
 * Shift+roda é horizontal (o navegador rola para o lado).
 */
function deslizeDaRoda(evento: WheelEvent): Deslize {
  const normalizar = evento.deltaMode === 1 ? PIXELS_POR_LINHA : 1;
  if (!rodandoNoMac() && evento.shiftKey && evento.deltaX === 0) {
    return { x: evento.deltaY * normalizar, y: 0 };
  }
  return { x: evento.deltaX * normalizar, y: evento.deltaY * normalizar };
}

function overflowRolavel(overflow: string): boolean {
  return overflow === "auto" || overflow === "scroll" || overflow === "overlay";
}

function rolaNaHorizontal(elemento: Element): boolean {
  if (elemento.tagName === "INPUT" || elemento.tagName === "TEXTAREA") {
    return true;
  }
  return overflowRolavel(getComputedStyle(elemento).overflowX);
}

function rolaNaVertical(elemento: Element): boolean {
  return elemento.tagName === "TEXTAREA" || overflowRolavel(getComputedStyle(elemento).overflowY);
}

/** Se o elemento ainda rola no eixo e no sentido pedidos (sem ter chegado ao fim). */
function cabeMais(elemento: Element, horizontal: boolean, sentido: number): boolean {
  if (horizontal) {
    if (elemento.scrollWidth <= elemento.clientWidth || !rolaNaHorizontal(elemento)) {
      return false;
    }
    return sentido > 0 ? elemento.scrollLeft + elemento.clientWidth < elemento.scrollWidth - 1 : elemento.scrollLeft > 0;
  }
  if (elemento.scrollHeight <= elemento.clientHeight || !rolaNaVertical(elemento)) {
    return false;
  }
  return sentido > 0 ? elemento.scrollTop + elemento.clientHeight < elemento.scrollHeight - 1 : elemento.scrollTop > 0;
}

/**
 * Se algum elemento entre o alvo e `limite` ainda rola no eixo dominante do
 * deslize: aí o deslize é dele (a conversa, uma tabela larga, um campo com
 * texto comprido).
 */
function algumElementoAbsorve(alvo: Element, deslize: Deslize, limite: Element): boolean {
  const horizontal = Math.abs(deslize.x) > Math.abs(deslize.y);
  const sentido = horizontal ? deslize.x : deslize.y;
  for (let elemento: Element | null = alvo; elemento !== null && elemento !== limite; elemento = elemento.parentElement) {
    if (cabeMais(elemento, horizontal, sentido)) {
      return true;
    }
  }
  return false;
}

/**
 * Roda e pinça por cima das caixas do canvas. As áreas com a classe `nowheel`
 * (a conversa, a nota, o terminal, o artefato) rolam o próprio conteúdo e o
 * React Flow ignora a roda nelas; este hook devolve ao canvas o que a caixa
 * não usa:
 *
 * - zoom: pinça do trackpad (chega com `ctrlKey`) ou Ctrl+roda dá zoom no
 *   canvas centrado no ponteiro, na mesma velocidade do zoom do React Flow;
 * - pan: um deslize (vertical, horizontal ou diagonal) que nenhum elemento
 *   sob o ponteiro consegue rolar no eixo dominante move o canvas nos dois
 *   eixos, como o `panOnScroll` fora das caixas.
 *
 * O dono do gesto (a caixa ou o canvas) é decidido no primeiro evento e vale
 * até uma pausa de `PAUSA_ENTRE_GESTOS_MS`: a conversa rolada até o fim não
 * sai arrastando o canvas, e um pan que passa por cima de uma caixa rolável
 * continua sendo pan. Fora das áreas `nowheel` (e fora das caixas, como no
 * chat rápido) nada muda: quem cuida é o React Flow, e um deslize ali só
 * marca o gesto como do canvas. O ouvinte fica em captura no elemento do
 * canvas, antes do xterm e do React Flow, e só interrompe o evento quando o
 * usa.
 */
export function useRodaDoCanvas(area: RefObject<HTMLElement | null>, { minZoom, maxZoom }: LimitesDoZoom): void {
  const { getViewport, setViewport } = useReactFlow();

  useEffect(() => {
    const elemento = area.current;
    if (elemento === null) {
      return;
    }
    let gesto: { dono: DonoDoGesto; ultimoEvento: number } | null = null;
    /** O dono do gesto em curso; sem gesto (ou depois da pausa), `decidir` escolhe. */
    const donoDoGesto = (decidir: () => DonoDoGesto): DonoDoGesto => {
      const agora = performance.now();
      const intervalo = gesto === null ? Number.POSITIVE_INFINITY : agora - gesto.ultimoEvento;
      const dono = gesto !== null && intervalo >= 0 && intervalo < PAUSA_ENTRE_GESTOS_MS ? gesto.dono : decidir();
      gesto = { dono, ultimoEvento: agora };
      return dono;
    };

    const aoRolar = (evento: WheelEvent) => {
      const alvo = evento.target;
      if (!(alvo instanceof Element)) {
        return;
      }
      const caixa = alvo.closest(".nowheel");
      if (caixa === null) {
        // O React Flow move o canvas (`panOnScroll`): o gesto passa a ser dele.
        if (!evento.ctrlKey && alvo.closest(".react-flow") !== null) {
          donoDoGesto(() => "canvas");
        }
        return;
      }
      const viewport = alvo.closest(".react-flow__viewport");
      if (viewport === null || !viewport.contains(caixa)) {
        return;
      }
      const atual = getViewport();

      if (evento.ctrlKey) {
        evento.preventDefault();
        evento.stopPropagation();
        const zoom = Math.min(maxZoom, Math.max(minZoom, atual.zoom * Math.pow(2, expoenteDoZoom(evento))));
        if (zoom === atual.zoom) {
          return;
        }
        const quadro = (alvo.closest(".react-flow") ?? elemento).getBoundingClientRect();
        const pontoX = evento.clientX - quadro.left;
        const pontoY = evento.clientY - quadro.top;
        const escala = zoom / atual.zoom;
        void setViewport({
          x: pontoX - (pontoX - atual.x) * escala,
          y: pontoY - (pontoY - atual.y) * escala,
          zoom,
        });
        return;
      }

      const deslize = deslizeDaRoda(evento);
      if (deslize.x === 0 && deslize.y === 0) {
        return;
      }
      const dono = donoDoGesto(() => (algumElementoAbsorve(alvo, deslize, viewport) ? "caixa" : "canvas"));
      if (dono === "caixa") {
        return;
      }
      evento.preventDefault();
      evento.stopPropagation();
      void setViewport({
        x: atual.x - deslize.x * VELOCIDADE_DO_PAN,
        y: atual.y - deslize.y * VELOCIDADE_DO_PAN,
        zoom: atual.zoom,
      });
    };
    elemento.addEventListener("wheel", aoRolar, { capture: true, passive: false });
    return () => elemento.removeEventListener("wheel", aoRolar, { capture: true });
  }, [area, getViewport, setViewport, minZoom, maxZoom]);
}
