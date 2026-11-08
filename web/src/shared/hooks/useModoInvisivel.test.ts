import { act, renderHook, waitFor } from "@testing-library/react";

import { useModoInvisivel } from "./useModoInvisivel";

describe("useModoInvisivel", () => {
  const janelaComPonte = window as unknown as { electron?: unknown };

  afterEach(() => {
    delete janelaComPonte.electron;
  });

  /** A ponte com o modo invisível; `avisar` simula o aviso do processo principal. */
  function ponte(sobrescritas: Record<string, unknown> = {}) {
    let ouvinte: ((ativo: boolean) => void) | null = null;
    const cancelar = vi.fn();
    const modoInvisivel = {
      entrar: vi.fn().mockResolvedValue(undefined),
      sair: vi.fn().mockResolvedValue(undefined),
      capturarMouse: vi.fn().mockResolvedValue(undefined),
      capturarTela: vi.fn().mockResolvedValue({ nome: "tela.jpg", tipoDeMidia: "image/jpeg", base64: "AAA" }),
      aoMudar: vi.fn((callback: (ativo: boolean) => void) => {
        ouvinte = callback;
        return cancelar;
      }),
      ...sobrescritas,
    };
    janelaComPonte.electron = { desktop: true, janela: {}, modoInvisivel };
    return { modoInvisivel, cancelar, avisar: (ativo: boolean) => act(() => ouvinte?.(ativo)) };
  }

  it("no navegador (sem a ponte), fica indisponível e inativo, e nada faz efeito", async () => {
    const { result } = renderHook(() => useModoInvisivel());

    expect(result.current.disponivel).toBe(false);
    expect(result.current.ativo).toBe(false);
    await act(() => result.current.entrar());
    expect(result.current.erro).toBeNull();
    result.current.mouseDaArea.onMouseEnter();
    await expect(result.current.capturarTela()).rejects.toThrow();
  });

  it("acompanha o aviso do processo principal (inclusive a saída pelo atalho) e cancela ao desmontar", () => {
    const { avisar, cancelar } = ponte();
    const { result, unmount } = renderHook(() => useModoInvisivel());

    expect(result.current.disponivel).toBe(true);
    expect(result.current.ativo).toBe(false);
    avisar(true);
    expect(result.current.ativo).toBe(true);
    avisar(false);
    expect(result.current.ativo).toBe(false);

    unmount();
    expect(cancelar).toHaveBeenCalledTimes(1);
  });

  it("entrar pede o modo e já captura o mouse, para o botão de voltar funcionar; sair só pede a saída", async () => {
    const { modoInvisivel } = ponte();
    const { result } = renderHook(() => useModoInvisivel());

    await act(() => result.current.entrar());
    expect(modoInvisivel.entrar).toHaveBeenCalledTimes(1);
    expect(modoInvisivel.capturarMouse).toHaveBeenCalledWith(true);

    await act(() => result.current.sair());
    expect(modoInvisivel.sair).toHaveBeenCalledTimes(1);
  });

  it("falha ao entrar preenche o erro, que pode ser descartado", async () => {
    ponte({ entrar: vi.fn().mockRejectedValue(new Error("sem permissão")) });
    const { result } = renderHook(() => useModoInvisivel());

    await act(() => result.current.entrar());
    expect(result.current.erro).toBe("Não foi possível entrar no modo invisível: sem permissão");

    act(() => result.current.descartarErro());
    expect(result.current.erro).toBeNull();
  });

  it("o mouse da área só captura/solta com o modo ativo", async () => {
    const { modoInvisivel, avisar } = ponte();
    const { result } = renderHook(() => useModoInvisivel());

    result.current.mouseDaArea.onMouseEnter();
    expect(modoInvisivel.capturarMouse).not.toHaveBeenCalled();

    avisar(true);
    await waitFor(() => expect(result.current.ativo).toBe(true));
    result.current.mouseDaArea.onMouseEnter();
    expect(modoInvisivel.capturarMouse).toHaveBeenLastCalledWith(true);
    result.current.mouseDaArea.onMouseLeave();
    expect(modoInvisivel.capturarMouse).toHaveBeenLastCalledWith(false);
  });

  it("capturarTela devolve a foto da ponte", async () => {
    ponte();
    const { result } = renderHook(() => useModoInvisivel());

    await expect(result.current.capturarTela()).resolves.toEqual({
      nome: "tela.jpg",
      tipoDeMidia: "image/jpeg",
      base64: "AAA",
    });
  });
});
