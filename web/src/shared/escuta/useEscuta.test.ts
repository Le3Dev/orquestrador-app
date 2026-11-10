import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { CapturaDoAudio } from "./capturaDoAudio";
import type { PreferenciasDaEscuta } from "./preferenciasDaEscuta";
import { SessaoDaEscuta } from "./sessaoDaEscuta";
import { type OpcoesDaEscuta, useEscuta } from "./useEscuta";

function montarSessao(avisoVisto: boolean) {
  let preferencias: PreferenciasDaEscuta = { automatico: true, automaticoManual: false, avisoVisto };
  const parar = vi.fn();
  const iniciarCaptura = vi.fn(async (): Promise<CapturaDoAudio> => ({ parar }));
  const sessao = new SessaoDaEscuta({
    iniciarCaptura,
    transcrever: vi.fn(async () => ""),
    classificar: vi.fn(async () => ({ ehPergunta: false, pergunta: null })),
    preferencias: {
      ler: () => preferencias,
      gravar: (novas) => {
        preferencias = novas;
      },
    },
  });
  return { sessao, iniciarCaptura, parar, preferencias: () => preferencias };
}

const opcoes = (mudanca: Partial<OpcoesDaEscuta> = {}): OpcoesDaEscuta => ({
  modoInvisivelAtivo: false,
  escutaManualLigada: false,
  escutaDisponivel: true,
  chatLivre: true,
  autorizacaoAtiva: false,
  enviar: async () => undefined,
  preencherComposer: () => undefined,
  ...mudanca,
});

describe("useEscuta", () => {
  it("repassa as opções à sessão e mostra o retrato dela", () => {
    const { sessao } = montarSessao(true);
    const { result, rerender } = renderHook((props: OpcoesDaEscuta) => useEscuta(props, sessao), {
      initialProps: opcoes({ escutaDisponivel: false }),
    });
    expect(result.current.situacao).toBe("indisponivel");

    rerender(opcoes());
    expect(result.current.situacao).toBe("desligada");
    expect(result.current).toMatchObject({
      automatico: false, // fora do modo invisível, a escuta manual começa sem o automático
      linhas: [],
      linhaProvisoria: null,
      trechos: [],
      erro: null,
      progressoDoDownload: null,
      precisaDoAviso: false,
      ultimaPergunta: null,
    });
  });

  it("ao entrar no modo pela primeira vez, pede o aviso; confirmar começa a escutar", async () => {
    const { sessao, iniciarCaptura, preferencias } = montarSessao(false);
    const { result, rerender } = renderHook((props: OpcoesDaEscuta) => useEscuta(props, sessao), {
      initialProps: opcoes(),
    });

    rerender(opcoes({ modoInvisivelAtivo: true }));
    expect(result.current.situacao).toBe("aguardando-aviso");
    expect(result.current.precisaDoAviso).toBe(true);
    expect(iniciarCaptura).not.toHaveBeenCalled();

    await act(async () => {
      result.current.confirmarAviso();
    });
    expect(iniciarCaptura).toHaveBeenCalledTimes(1);
    expect(preferencias().avisoVisto).toBe(true);
    expect(result.current.situacao).toBe("escutando");
    expect(result.current.precisaDoAviso).toBe(false);
  });

  it("as ações chegam à sessão: pausar, retomar e alternar o automático", async () => {
    const { sessao, iniciarCaptura, parar } = montarSessao(true);
    const { result } = renderHook(() => useEscuta(opcoes({ modoInvisivelAtivo: true }), sessao));
    await act(async () => undefined);
    expect(result.current.situacao).toBe("escutando");

    act(() => result.current.pausar());
    expect(parar).toHaveBeenCalled();
    expect(result.current.situacao).toBe("pausada");

    await act(async () => {
      result.current.retomar();
    });
    expect(iniciarCaptura).toHaveBeenCalledTimes(2);
    expect(result.current.situacao).toBe("escutando");

    act(() => result.current.alternarAutomatico());
    expect(result.current.automatico).toBe(false);
  });

  it("recusar o aviso deixa a escuta pausada", () => {
    const { sessao } = montarSessao(false);
    const { result } = renderHook(() => useEscuta(opcoes({ modoInvisivelAtivo: true }), sessao));
    act(() => result.current.recusarAviso());
    expect(result.current.situacao).toBe("pausada");
  });

  it("as funções devolvidas são estáveis entre renders", () => {
    const { sessao } = montarSessao(true);
    const { result, rerender } = renderHook(() => useEscuta(opcoes(), sessao));
    const antes = result.current;
    rerender();
    expect(result.current.pausar).toBe(antes.pausar);
    expect(result.current.retomar).toBe(antes.retomar);
    expect(result.current.confirmarAviso).toBe(antes.confirmarAviso);
  });
});
