import { act, renderHook } from "@testing-library/react";

import { CHAVE_DAS_PREFERENCIAS_DA_TELA, usePreferenciasDaTela } from "./usePreferenciasDaTela";

const lerGuardado = () => JSON.parse(localStorage.getItem(CHAVE_DAS_PREFERENCIAS_DA_TELA) ?? "null") as unknown;

describe("usePreferenciasDaTela", () => {
  afterEach(() => localStorage.clear());

  it("sem nada guardado, as duas preferências começam desligadas e o chat fixo com 360 px", () => {
    const { result } = renderHook(() => usePreferenciasDaTela());

    expect(result.current.preferencias).toEqual({ chatFixoNaEsquerda: false, ladoDoChatFixo: "esquerda", visualizadorDeCodigo: false, larguraDoChatFixo: 360, manterBixinhosAteLimpar: false, minimapaVisivel: false, controlesDasJanelas: "automatico" });
    expect(localStorage.getItem(CHAVE_DAS_PREFERENCIAS_DA_TELA)).toBeNull();
  });

  it("mudar uma parte grava no localStorage e mantém a outra; ao montar de novo, lê o que foi gravado", () => {
    const { result, unmount } = renderHook(() => usePreferenciasDaTela());

    act(() => result.current.mudarPreferencias({ visualizadorDeCodigo: true }));
    act(() => result.current.mudarPreferencias({ chatFixoNaEsquerda: true }));

    expect(result.current.preferencias).toEqual({ chatFixoNaEsquerda: true, ladoDoChatFixo: "esquerda", visualizadorDeCodigo: true, larguraDoChatFixo: 360, manterBixinhosAteLimpar: false, minimapaVisivel: false, controlesDasJanelas: "automatico" });
    expect(lerGuardado()).toEqual({ chatFixoNaEsquerda: true, ladoDoChatFixo: "esquerda", visualizadorDeCodigo: true, larguraDoChatFixo: 360, manterBixinhosAteLimpar: false, minimapaVisivel: false, controlesDasJanelas: "automatico" });
    unmount();

    const outra = renderHook(() => usePreferenciasDaTela());
    expect(outra.result.current.preferencias).toEqual({ chatFixoNaEsquerda: true, ladoDoChatFixo: "esquerda", visualizadorDeCodigo: true, larguraDoChatFixo: 360, manterBixinhosAteLimpar: false, minimapaVisivel: false, controlesDasJanelas: "automatico" });
  });

  it("JSON inválido, outro formato ou campo de outro tipo valem o padrão (campo a campo)", () => {
    localStorage.setItem(CHAVE_DAS_PREFERENCIAS_DA_TELA, "{não é json");
    const { result, rerender } = renderHook(() => usePreferenciasDaTela());
    expect(result.current.preferencias).toEqual({ chatFixoNaEsquerda: false, ladoDoChatFixo: "esquerda", visualizadorDeCodigo: false, larguraDoChatFixo: 360, manterBixinhosAteLimpar: false, minimapaVisivel: false, controlesDasJanelas: "automatico" });

    localStorage.setItem(CHAVE_DAS_PREFERENCIAS_DA_TELA, "[true]");
    rerender();
    expect(result.current.preferencias).toEqual({ chatFixoNaEsquerda: false, ladoDoChatFixo: "esquerda", visualizadorDeCodigo: false, larguraDoChatFixo: 360, manterBixinhosAteLimpar: false, minimapaVisivel: false, controlesDasJanelas: "automatico" });

    localStorage.setItem(CHAVE_DAS_PREFERENCIAS_DA_TELA, JSON.stringify({ chatFixoNaEsquerda: "sim", visualizadorDeCodigo: true }));
    rerender();
    expect(result.current.preferencias).toEqual({ chatFixoNaEsquerda: false, ladoDoChatFixo: "esquerda", visualizadorDeCodigo: true, larguraDoChatFixo: 360, manterBixinhosAteLimpar: false, minimapaVisivel: false, controlesDasJanelas: "automatico" });

    // Mudar a partir de um valor inválido grava um JSON válido.
    act(() => result.current.mudarPreferencias({ chatFixoNaEsquerda: true }));
    expect(lerGuardado()).toEqual({ chatFixoNaEsquerda: true, ladoDoChatFixo: "esquerda", visualizadorDeCodigo: true, larguraDoChatFixo: 360, manterBixinhosAteLimpar: false, minimapaVisivel: false, controlesDasJanelas: "automatico" });
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
      ladoDoChatFixo: "esquerda",
      visualizadorDeCodigo: false,
      larguraDoChatFixo: 480,
      manterBixinhosAteLimpar: false,
      minimapaVisivel: false,
      controlesDasJanelas: "automatico",
    });
    expect(lerGuardado()).toEqual({ chatFixoNaEsquerda: false, ladoDoChatFixo: "esquerda", visualizadorDeCodigo: false, larguraDoChatFixo: 480, manterBixinhosAteLimpar: false, minimapaVisivel: false, controlesDasJanelas: "automatico" });

    act(() => result.current.mudarPreferencias({ larguraDoChatFixo: 9999 }));
    expect(result.current.preferencias.larguraDoChatFixo).toBe(640);

    act(() => result.current.mudarPreferencias({ larguraDoChatFixo: 10 }));
    expect(lerGuardado()).toMatchObject({ larguraDoChatFixo: 280 });
  });

  it("o lado do chat fixo: sem o campo (preferência antiga) ou com outro valor, vale a esquerda; mudar grava", () => {
    localStorage.setItem(
      CHAVE_DAS_PREFERENCIAS_DA_TELA,
      JSON.stringify({ chatFixoNaEsquerda: true, visualizadorDeCodigo: false, larguraDoChatFixo: 420 }),
    );
    const { result, rerender } = renderHook(() => usePreferenciasDaTela());
    expect(result.current.preferencias.ladoDoChatFixo).toBe("esquerda");
    expect(result.current.preferencias.larguraDoChatFixo).toBe(420);

    localStorage.setItem(CHAVE_DAS_PREFERENCIAS_DA_TELA, JSON.stringify({ ladoDoChatFixo: "cima" }));
    rerender();
    expect(result.current.preferencias.ladoDoChatFixo).toBe("esquerda");

    act(() => result.current.mudarPreferencias({ ladoDoChatFixo: "direita" }));
    expect(result.current.preferencias.ladoDoChatFixo).toBe("direita");
    expect(lerGuardado()).toEqual({
      chatFixoNaEsquerda: false,
      ladoDoChatFixo: "direita",
      visualizadorDeCodigo: false,
      larguraDoChatFixo: 360,
      manterBixinhosAteLimpar: false,
      minimapaVisivel: false,
      controlesDasJanelas: "automatico",
    });

    // Gravar o mesmo lado não grava de novo.
    const antes = localStorage.getItem(CHAVE_DAS_PREFERENCIAS_DA_TELA);
    const gravar = vi.spyOn(Storage.prototype, "setItem");
    act(() => result.current.mudarPreferencias({ ladoDoChatFixo: "direita" }));
    expect(gravar).not.toHaveBeenCalled();
    expect(localStorage.getItem(CHAVE_DAS_PREFERENCIAS_DA_TELA)).toBe(antes);
    gravar.mockRestore();
  });

  it("manter os bixinhos até limpar: começa desligada, outro tipo vale o padrão e mudar grava", () => {
    localStorage.setItem(CHAVE_DAS_PREFERENCIAS_DA_TELA, JSON.stringify({ manterBixinhosAteLimpar: "sim" }));
    const { result } = renderHook(() => usePreferenciasDaTela());
    expect(result.current.preferencias.manterBixinhosAteLimpar).toBe(false);

    act(() => result.current.mudarPreferencias({ manterBixinhosAteLimpar: true }));
    expect(result.current.preferencias.manterBixinhosAteLimpar).toBe(true);
    expect(lerGuardado()).toMatchObject({ manterBixinhosAteLimpar: true, chatFixoNaEsquerda: false });
  });

  it("o minimapa: sem o campo (preferência antiga) ou com outro tipo, fica recolhido; mudar grava", () => {
    localStorage.setItem(CHAVE_DAS_PREFERENCIAS_DA_TELA, JSON.stringify({ chatFixoNaEsquerda: true }));
    const { result, rerender } = renderHook(() => usePreferenciasDaTela());
    expect(result.current.preferencias.minimapaVisivel).toBe(false);

    localStorage.setItem(CHAVE_DAS_PREFERENCIAS_DA_TELA, JSON.stringify({ minimapaVisivel: "sim" }));
    rerender();
    expect(result.current.preferencias.minimapaVisivel).toBe(false);

    act(() => result.current.mudarPreferencias({ minimapaVisivel: true }));
    expect(result.current.preferencias.minimapaVisivel).toBe(true);
    expect(lerGuardado()).toMatchObject({ minimapaVisivel: true, chatFixoNaEsquerda: false });

    act(() => result.current.mudarPreferencias({ minimapaVisivel: false, controlesDasJanelas: "automatico" }));
    expect(lerGuardado()).toMatchObject({ minimapaVisivel: false, controlesDasJanelas: "automatico" });
  });

  it("os controles das janelas: começam em Automático; sem o campo, valor inválido ou de outro tipo valem Automático; mudar grava", () => {
    localStorage.setItem(CHAVE_DAS_PREFERENCIAS_DA_TELA, JSON.stringify({ chatFixoNaEsquerda: true }));
    const { result, rerender } = renderHook(() => usePreferenciasDaTela());
    expect(result.current.preferencias.controlesDasJanelas).toBe("automatico");

    for (const invalido of ["linux", "Mac", "", 1, true, null, ["mac"]]) {
      localStorage.setItem(CHAVE_DAS_PREFERENCIAS_DA_TELA, JSON.stringify({ controlesDasJanelas: invalido }));
      rerender();
      expect(result.current.preferencias.controlesDasJanelas).toBe("automatico");
    }

    localStorage.setItem(CHAVE_DAS_PREFERENCIAS_DA_TELA, JSON.stringify({ controlesDasJanelas: "windows" }));
    rerender();
    expect(result.current.preferencias.controlesDasJanelas).toBe("windows");

    act(() => result.current.mudarPreferencias({ controlesDasJanelas: "mac" }));
    expect(result.current.preferencias.controlesDasJanelas).toBe("mac");
    expect(lerGuardado()).toMatchObject({ controlesDasJanelas: "mac", chatFixoNaEsquerda: false });

    // Gravar o mesmo estilo não grava de novo.
    const gravar = vi.spyOn(Storage.prototype, "setItem");
    act(() => result.current.mudarPreferencias({ controlesDasJanelas: "mac" }));
    expect(gravar).not.toHaveBeenCalled();
    gravar.mockRestore();
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
        JSON.stringify({ chatFixoNaEsquerda: true, ladoDoChatFixo: "esquerda", visualizadorDeCodigo: true, larguraDoChatFixo: 360, manterBixinhosAteLimpar: false, minimapaVisivel: false, controlesDasJanelas: "automatico" }),
      );
      window.dispatchEvent(new StorageEvent("storage", { key: CHAVE_DAS_PREFERENCIAS_DA_TELA }));
    });

    expect(result.current.preferencias).toEqual({ chatFixoNaEsquerda: true, ladoDoChatFixo: "esquerda", visualizadorDeCodigo: true, larguraDoChatFixo: 360, manterBixinhosAteLimpar: false, minimapaVisivel: false, controlesDasJanelas: "automatico" });

    // Outra aba limpou tudo (key nula): volta ao padrão.
    act(() => {
      localStorage.clear();
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
    });

    expect(result.current.preferencias).toEqual({ chatFixoNaEsquerda: false, ladoDoChatFixo: "esquerda", visualizadorDeCodigo: false, larguraDoChatFixo: 360, manterBixinhosAteLimpar: false, minimapaVisivel: false, controlesDasJanelas: "automatico" });
  });
});
