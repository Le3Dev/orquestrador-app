import { act, renderHook } from "@testing-library/react";

import { CHAVE_DAS_PREFERENCIAS_DA_TELA, usePreferenciasDaTela } from "./usePreferenciasDaTela";

const lerGuardado = () => JSON.parse(localStorage.getItem(CHAVE_DAS_PREFERENCIAS_DA_TELA) ?? "null") as unknown;

describe("usePreferenciasDaTela", () => {
  afterEach(() => localStorage.clear());

  it("sem nada guardado, as duas preferências começam desligadas e o chat fixo com 360 px", () => {
    const { result } = renderHook(() => usePreferenciasDaTela());

    expect(result.current.preferencias).toEqual({ chatFixoNaEsquerda: false, visualizadorDeCodigo: false, larguraDoChatFixo: 360 });
    expect(localStorage.getItem(CHAVE_DAS_PREFERENCIAS_DA_TELA)).toBeNull();
  });

  it("mudar uma parte grava no localStorage e mantém a outra; ao montar de novo, lê o que foi gravado", () => {
    const { result, unmount } = renderHook(() => usePreferenciasDaTela());

    act(() => result.current.mudarPreferencias({ visualizadorDeCodigo: true }));
    act(() => result.current.mudarPreferencias({ chatFixoNaEsquerda: true }));

    expect(result.current.preferencias).toEqual({ chatFixoNaEsquerda: true, visualizadorDeCodigo: true, larguraDoChatFixo: 360 });
    expect(lerGuardado()).toEqual({ chatFixoNaEsquerda: true, visualizadorDeCodigo: true, larguraDoChatFixo: 360 });
    unmount();

    const outra = renderHook(() => usePreferenciasDaTela());
    expect(outra.result.current.preferencias).toEqual({ chatFixoNaEsquerda: true, visualizadorDeCodigo: true, larguraDoChatFixo: 360 });
  });

  it("JSON inválido, outro formato ou campo de outro tipo valem o padrão (campo a campo)", () => {
    localStorage.setItem(CHAVE_DAS_PREFERENCIAS_DA_TELA, "{não é json");
    const { result, rerender } = renderHook(() => usePreferenciasDaTela());
    expect(result.current.preferencias).toEqual({ chatFixoNaEsquerda: false, visualizadorDeCodigo: false, larguraDoChatFixo: 360 });

    localStorage.setItem(CHAVE_DAS_PREFERENCIAS_DA_TELA, "[true]");
    rerender();
    expect(result.current.preferencias).toEqual({ chatFixoNaEsquerda: false, visualizadorDeCodigo: false, larguraDoChatFixo: 360 });

    localStorage.setItem(CHAVE_DAS_PREFERENCIAS_DA_TELA, JSON.stringify({ chatFixoNaEsquerda: "sim", visualizadorDeCodigo: true }));
    rerender();
    expect(result.current.preferencias).toEqual({ chatFixoNaEsquerda: false, visualizadorDeCodigo: true, larguraDoChatFixo: 360 });

    // Mudar a partir de um valor inválido grava um JSON válido.
    act(() => result.current.mudarPreferencias({ chatFixoNaEsquerda: true }));
    expect(lerGuardado()).toEqual({ chatFixoNaEsquerda: true, visualizadorDeCodigo: true, larguraDoChatFixo: 360 });
  });

  it("a largura do chat fixo: tipo errado vale o padrão; fora de 280 a 640, é limitada ao intervalo", () => {
    const guardar = (valor: unknown) =>
      localStorage.setItem(CHAVE_DAS_PREFERENCIAS_DA_TELA, JSON.stringify({ larguraDoChatFixo: valor }));
    guardar("500");
    const { result, rerender } = renderHook(() => usePreferenciasDaTela());
    expect(result.current.preferencias.larguraDoChatFixo).toBe(360);

    guardar(null);
    rerender();
    expect(result.current.preferencias.larguraDoChatFixo).toBe(360);

    guardar(100);
    rerender();
    expect(result.current.preferencias.larguraDoChatFixo).toBe(280);

    guardar(5000);
    rerender();
    expect(result.current.preferencias.larguraDoChatFixo).toBe(640);

    guardar(420.6);
    rerender();
    expect(result.current.preferencias.larguraDoChatFixo).toBe(421);
  });

  it("mudar a largura grava limitada ao intervalo e mantém o resto", () => {
    const { result } = renderHook(() => usePreferenciasDaTela());

    act(() => result.current.mudarPreferencias({ larguraDoChatFixo: 480 }));
    expect(result.current.preferencias).toEqual({
      chatFixoNaEsquerda: false,
      visualizadorDeCodigo: false,
      larguraDoChatFixo: 480,
    });
    expect(lerGuardado()).toEqual({ chatFixoNaEsquerda: false, visualizadorDeCodigo: false, larguraDoChatFixo: 480 });

    act(() => result.current.mudarPreferencias({ larguraDoChatFixo: 9999 }));
    expect(result.current.preferencias.larguraDoChatFixo).toBe(640);

    act(() => result.current.mudarPreferencias({ larguraDoChatFixo: 10 }));
    expect(lerGuardado()).toMatchObject({ larguraDoChatFixo: 280 });
  });

  it("o retrato é estável: sem mudança, o mesmo objeto a cada render", () => {
    const { result, rerender } = renderHook(() => usePreferenciasDaTela());
    const primeiro = result.current.preferencias;
    const mudar = result.current.mudarPreferencias;

    rerender();

    expect(result.current.preferencias).toBe(primeiro);
    expect(result.current.mudarPreferencias).toBe(mudar);
  });

  it("sincroniza: mudar num componente reflete nos outros da mesma aba", () => {
    const a = renderHook(() => usePreferenciasDaTela());
    const b = renderHook(() => usePreferenciasDaTela());

    act(() => a.result.current.mudarPreferencias({ chatFixoNaEsquerda: true }));

    expect(b.result.current.preferencias.chatFixoNaEsquerda).toBe(true);

    act(() => b.result.current.mudarPreferencias({ chatFixoNaEsquerda: false }));

    expect(a.result.current.preferencias.chatFixoNaEsquerda).toBe(false);
  });

  it("sincroniza com outras abas: o evento storage da chave faz reler", () => {
    const { result } = renderHook(() => usePreferenciasDaTela());

    act(() => {
      localStorage.setItem(
        CHAVE_DAS_PREFERENCIAS_DA_TELA,
        JSON.stringify({ chatFixoNaEsquerda: true, visualizadorDeCodigo: true, larguraDoChatFixo: 360 }),
      );
      window.dispatchEvent(new StorageEvent("storage", { key: CHAVE_DAS_PREFERENCIAS_DA_TELA }));
    });

    expect(result.current.preferencias).toEqual({ chatFixoNaEsquerda: true, visualizadorDeCodigo: true, larguraDoChatFixo: 360 });

    // Outra aba limpou tudo (key nula): volta ao padrão.
    act(() => {
      localStorage.clear();
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
    });

    expect(result.current.preferencias).toEqual({ chatFixoNaEsquerda: false, visualizadorDeCodigo: false, larguraDoChatFixo: 360 });
  });
});
