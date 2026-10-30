import { useCallback, useEffect, useRef, useState } from "react";

import { salvarLayout, type Viewport } from "../canvas/layout";
import { layoutDosNos, type NoDoCanvas } from "../canvas/nos";

/** Espera depois da última mudança nos nós (fora de um arraste) para gravar o layout. */
export const ESPERA_PARA_SALVAR_O_LAYOUT_MS = 300;

export interface MovimentoDoCanvas {
  /** Do começo ao fim de um arraste de nó ou de um pan/zoom (inclusive o enquadramento animado). */
  movendo: boolean;
  aoComecarArraste: () => void;
  aoTerminarArraste: () => void;
  aoComecarMovimento: () => void;
  aoTerminarMovimento: (evento: unknown, viewport: Viewport) => void;
}

/**
 * Grava o layout do canvas no navegador sem pesar no arraste, e diz quando o
 * usuário está movendo algo.
 *
 * Durante o arraste de um nó nada é gravado: o layout vai para o navegador
 * logo depois de soltar. As outras mudanças nos nós (abrir, fechar,
 * redimensionar, organizar) são gravadas um instante depois da última. A
 * câmera é gravada quando o pan/zoom termina. `movendo` só muda no começo e no
 * fim do movimento, nunca a cada quadro.
 */
export function useMovimentoDoCanvas(nos: readonly NoDoCanvas[], viewportInicial: Viewport | null): MovimentoDoCanvas {
  const [arrastando, setArrastando] = useState(false);
  const [movendoACamera, setMovendoACamera] = useState(false);
  const viewport = useRef(viewportInicial);
  const nosAtuais = useRef(nos);
  const arrastandoAgora = useRef(false);
  const pararDeVigiarOSoltar = useRef<(() => void) | null>(null);

  useEffect(() => {
    nosAtuais.current = nos;
    if (arrastando) {
      return;
    }
    const espera = setTimeout(
      () => salvarLayout(layoutDosNos(nos, viewport.current)),
      ESPERA_PARA_SALVAR_O_LAYOUT_MS,
    );
    return () => clearTimeout(espera);
  }, [nos, arrastando]);

  const aoTerminarArraste = useCallback(() => {
    arrastandoAgora.current = false;
    pararDeVigiarOSoltar.current?.();
    pararDeVigiarOSoltar.current = null;
    setArrastando(false);
  }, []);

  const aoComecarArraste = useCallback(() => {
    arrastandoAgora.current = true;
    setArrastando(true);
    // O React Flow não avisa o fim de um arraste abortado (o nó sumiu no meio,
    // um segundo dedo na tela): soltar o botão encerra o arraste de todo jeito.
    if (pararDeVigiarOSoltar.current === null) {
      window.addEventListener("pointerup", aoTerminarArraste);
      window.addEventListener("pointercancel", aoTerminarArraste);
      pararDeVigiarOSoltar.current = () => {
        window.removeEventListener("pointerup", aoTerminarArraste);
        window.removeEventListener("pointercancel", aoTerminarArraste);
      };
    }
  }, [aoTerminarArraste]);

  // Desmontar no meio de um arraste não deixa ouvintes para trás.
  useEffect(() => aoTerminarArraste, [aoTerminarArraste]);

  const aoComecarMovimento = useCallback(() => setMovendoACamera(true), []);

  const aoTerminarMovimento = useCallback((_evento: unknown, novo: Viewport) => {
    viewport.current = novo;
    setMovendoACamera(false);
    // Se o canvas rolou sozinho no meio de um arraste (nó levado à borda),
    // quem grava é o fim do arraste.
    if (!arrastandoAgora.current) {
      salvarLayout(layoutDosNos(nosAtuais.current, novo));
    }
  }, []);

  return {
    movendo: arrastando || movendoACamera,
    aoComecarArraste,
    aoTerminarArraste,
    aoComecarMovimento,
    aoTerminarMovimento,
  };
}
