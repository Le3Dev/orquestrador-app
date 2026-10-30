import { act, renderHook } from "@testing-library/react";

import { lerLayout } from "../canvas/layout";
import { type NoDoCanvas, novoTerminal } from "../canvas/nos";
import { ESPERA_PARA_SALVAR_O_LAYOUT_MS, useMovimentoDoCanvas } from "./useMovimentoDoCanvas";

function terminalEm(x: number): NoDoCanvas[] {
  return [novoTerminal("o1", { x, y: 0 }, 600, 500)];
}

describe("useMovimentoDoCanvas", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  function renderizar() {
    const hook = renderHook(({ nos }) => useMovimentoDoCanvas(nos, null), { initialProps: { nos: terminalEm(0) } });
    // A gravação de quando o canvas abre.
    act(() => {
      vi.advanceTimersByTime(ESPERA_PARA_SALVAR_O_LAYOUT_MS);
    });
    return hook;
  }

  it("não grava o layout durante o arraste, só depois de soltar", () => {
    const { result, rerender } = renderizar();
    const gravar = vi.spyOn(Storage.prototype, "setItem");

    act(() => result.current.aoComecarArraste());
    expect(result.current.movendo).toBe(true);
    for (let quadro = 1; quadro <= 5; quadro++) {
      rerender({ nos: terminalEm(quadro * 10) });
      act(() => {
        vi.advanceTimersByTime(1_000);
      });
    }
    expect(gravar).not.toHaveBeenCalled();

    act(() => result.current.aoTerminarArraste());
    expect(result.current.movendo).toBe(false);
    act(() => {
      vi.advanceTimersByTime(ESPERA_PARA_SALVAR_O_LAYOUT_MS);
    });
    expect(gravar).toHaveBeenCalledTimes(1);
    expect(lerLayout().terminais.o1).toMatchObject({ x: 50, y: 0 });
  });

  it("grava a câmera quando o pan/zoom termina", () => {
    const { result } = renderizar();

    act(() => result.current.aoComecarMovimento());
    expect(result.current.movendo).toBe(true);
    act(() => result.current.aoTerminarMovimento(null, { x: 10, y: 20, zoom: 0.5 }));

    expect(result.current.movendo).toBe(false);
    expect(lerLayout().viewport).toEqual({ x: 10, y: 20, zoom: 0.5 });
  });

  it("soltar o botão encerra o arraste mesmo sem o aviso do React Flow", () => {
    const { result } = renderizar();

    act(() => result.current.aoComecarArraste());
    act(() => {
      window.dispatchEvent(new Event("pointerup"));
    });

    expect(result.current.movendo).toBe(false);
  });
});
