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
      capturarAgora: vi.fn().mockResolvedValue({ nome: "tela-agora.jpg", tipoDeMidia: "image/jpeg", base64: "BBB" }),
      aoCapturarQuadro: vi.fn(() => () => undefined),
      aoMudar: vi.fn((callback: (ativo: boolean) => void) => {
        ouvinte = callback;
        return cancelar;
      }),
      estaAtivo: vi.fn().mockResolvedValue(false),
      escutaDisponivel: true,
      ...sobrescritas,
    };
    janelaComPonte.electron = { desktop: true, janela: {}, modoInvisivel };
    return { modoInvisivel, cancelar, avisar: (ativo: boolean) => act(() => ouvinte?.(ativo)) };
  }

  it("no navegador (sem a ponte), fica indisponível e inativo, e nada faz efeito", async () => {
    const { result } = renderHook(() => useModoInvisivel());

    expect(result.current.disponivel).toBe(false);
    expect(result.current.ativo).toBe(false);
    expect(result.current.escutaDisponivel).toBe(false);
    await act(() => result.current.entrar());
    expect(result.current.erro).toBeNull();
    result.current.mouseDaArea.onMouseEnter();
    await expect(result.current.capturarTela()).rejects.toThrow();
    await expect(result.current.capturarAgora()).rejects.toThrow();
    expect(result.current.aoCapturarQuadro(vi.fn())()).toBeUndefined();
  });

  it("capturarAgora e aoCapturarQuadro repassam à ponte", async () => {
    const { modoInvisivel } = ponte();
    const { result } = renderHook(() => useModoInvisivel());

    await expect(result.current.capturarAgora()).resolves.toMatchObject({ base64: "BBB" });
    const callback = vi.fn();
    result.current.aoCapturarQuadro(callback);
    expect(modoInvisivel.aoCapturarQuadro).toHaveBeenCalledWith(callback);
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

  it("quem monta com o modo já ativo (o chat que trocou de lugar) começa ativo e solta o mouse", async () => {
    const { modoInvisivel, avisar } = ponte();
    const primeiro = renderHook(() => useModoInvisivel());
    avisar(true);
    expect(primeiro.result.current.ativo).toBe(true);
    expect(modoInvisivel.capturarMouse).not.toHaveBeenCalled();

    const depois = renderHook(() => useModoInvisivel());

    expect(depois.result.current.ativo).toBe(true);
    await waitFor(() => expect(modoInvisivel.capturarMouse).toHaveBeenLastCalledWith(false));
    expect(modoInvisivel.capturarMouse).not.toHaveBeenCalledWith(true);
  });

  it("entrar não captura o mouse se o componente desmontou antes da resposta", async () => {
    let liberar: () => void = () => undefined;
    const { modoInvisivel } = ponte({
      entrar: vi.fn(() => new Promise<void>((resolve) => (liberar = resolve))),
    });
    const { result, unmount } = renderHook(() => useModoInvisivel());

    const entrada = result.current.entrar();
    unmount();
    liberar();
    await entrada;

    expect(modoInvisivel.entrar).toHaveBeenCalledTimes(1);
    expect(modoInvisivel.capturarMouse).not.toHaveBeenCalled();
  });

  it("remontado com o modo já ligado, começa ativo pela consulta ao processo principal", async () => {
    const { avisar, modoInvisivel } = ponte();
    const primeiro = renderHook(() => useModoInvisivel());
    avisar(true);
    expect(primeiro.result.current.ativo).toBe(true);
    primeiro.unmount();

    // O chat rápido remonta (fixo ↔ flutuante) sem receber novo aviso.
    modoInvisivel.estaAtivo.mockResolvedValue(true);
    const { result } = renderHook(() => useModoInvisivel());

    await waitFor(() => expect(result.current.ativo).toBe(true));
    expect(modoInvisivel.estaAtivo).toHaveBeenCalledTimes(2);
  });

  it("o aviso que chega antes da resposta da consulta vence", async () => {
    let responderConsulta: (ativo: boolean) => void = () => undefined;
    const consulta = new Promise<boolean>((resolver) => {
      responderConsulta = resolver;
    });
    const { avisar } = ponte({ estaAtivo: vi.fn(() => consulta) });
    const { result } = renderHook(() => useModoInvisivel());

    avisar(true);
    avisar(false);
    // A consulta foi feita antes da saída e responde depois, já desatualizada.
    await act(async () => {
      responderConsulta(true);
      await consulta;
    });

    expect(result.current.ativo).toBe(false);
  });

  it("erro na consulta (assíncrono ou síncrono) mantém desligado sem quebrar o hook", async () => {
    const assincrono = ponte({ estaAtivo: vi.fn().mockRejectedValue(new Error("sem janela principal")) });
    const { result, unmount } = renderHook(() => useModoInvisivel());
    await waitFor(() => expect(assincrono.modoInvisivel.estaAtivo).toHaveBeenCalled());
    await act(async () => undefined);
    expect(result.current.ativo).toBe(false);
    expect(result.current.erro).toBeNull();
    unmount();

    const sincrono = ponte({
      estaAtivo: vi.fn(() => {
        throw new Error("canal ausente");
      }),
    });
    const segundo = renderHook(() => useModoInvisivel());
    await act(async () => undefined);
    expect(segundo.result.current.ativo).toBe(false);
    sincrono.avisar(true);
    expect(segundo.result.current.ativo).toBe(true);
  });

  it("ponte sem a consulta (mock antigo) conta como desligado, e o aviso continua valendo", async () => {
    const { avisar } = ponte({ estaAtivo: undefined, escutaDisponivel: undefined });
    const { result } = renderHook(() => useModoInvisivel());

    await act(async () => undefined);
    expect(result.current.ativo).toBe(false);
    expect(result.current.escutaDisponivel).toBe(false);
    avisar(true);
    expect(result.current.ativo).toBe(true);
  });

  it("escutaDisponivel repassa a ponte (só o Windows tem a escuta)", () => {
    ponte({ escutaDisponivel: false });
    const semEscuta = renderHook(() => useModoInvisivel());
    expect(semEscuta.result.current.escutaDisponivel).toBe(false);
    semEscuta.unmount();

    ponte();
    const comEscuta = renderHook(() => useModoInvisivel());
    expect(comEscuta.result.current.escutaDisponivel).toBe(true);
  });

  it("alternarEscutaManual avisa a ponte e só depois marca o estado; desligar marca e avisa", async () => {
    const definirEscutaLigada = vi.fn().mockResolvedValue(undefined);
    ponte({ definirEscutaLigada });
    const { result } = renderHook(() => useModoInvisivel());
    expect(result.current.escutaManualLigada).toBe(false);

    await act(() => result.current.alternarEscutaManual());
    expect(definirEscutaLigada).toHaveBeenLastCalledWith(true);
    expect(result.current.escutaManualLigada).toBe(true);

    await act(() => result.current.alternarEscutaManual());
    expect(definirEscutaLigada).toHaveBeenLastCalledWith(false);
    expect(result.current.escutaManualLigada).toBe(false);
  });

  it("se a ponte recusar ligar a escuta, o estado fica desligado e o erro aparece", async () => {
    ponte({ definirEscutaLigada: vi.fn().mockRejectedValue(new Error("recusado")) });
    const { result } = renderHook(() => useModoInvisivel());

    await act(() => result.current.alternarEscutaManual());
    expect(result.current.escutaManualLigada).toBe(false);
    expect(result.current.erro).toContain("recusado");
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
