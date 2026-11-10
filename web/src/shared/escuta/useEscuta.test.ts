import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { DescricaoDoMotor, MotorDeTranscricao } from "../ditado/motor";
import type { CapturaDoAudio } from "./capturaDoAudio";
import type { DetectorDeVoz } from "./DetectorDeVoz";
import { APARENCIA_PADRAO_DA_ESCUTA, PREFERENCIAS_PADRAO_DA_ESCUTA, type PreferenciasDaEscuta } from "./preferenciasDaEscuta";
import { SessaoDaEscuta } from "./sessaoDaEscuta";
import { type OpcoesDaEscuta, useEscuta } from "./useEscuta";

const MOTOR: DescricaoDoMotor = { dispositivo: "cpu", modelo: "whisper-base", precisao: "q8", nativo: true };

/** Motor falso: prepara na hora e nunca é chamado a transcrever (nenhum áudio chega nestes testes). */
function motorFalso(): MotorDeTranscricao {
  return {
    transcrever: vi.fn(async () => ({ texto: "", segmentos: [], idioma: "pt", duracaoDaPassadaMs: 0 })),
    preparar: vi.fn(async () => MOTOR),
    motorAtual: () => null,
    aoMudarMotor: () => () => undefined,
    aoBaixar: () => () => undefined,
  };
}

/** VAD falso: nenhum áudio chega nestes testes. */
const detectorFalso = (): DetectorDeVoz => ({
  analisar: vi.fn(async () => ({ amostras: new Float32Array(0), probabilidades: [] })),
  reiniciar: vi.fn(),
  encerrar: vi.fn(),
});

function montarSessao(avisoVisto: boolean) {
  let preferencias: PreferenciasDaEscuta = { ...PREFERENCIAS_PADRAO_DA_ESCUTA, avisoVisto };
  const parar = vi.fn();
  const iniciarCaptura = vi.fn(async (): Promise<CapturaDoAudio> => ({ parar }));
  const sessao = new SessaoDaEscuta({
    iniciarCaptura,
    detectorDeVoz: detectorFalso(),
    motor: motorFalso(),
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

  it("mostra a legenda, o motor, o download e as preferências da tela, e as mudanças chegam à sessão", async () => {
    const { sessao, preferencias } = montarSessao(true);
    const { result } = renderHook(() => useEscuta(opcoes({ modoInvisivelAtivo: true }), sessao));
    await act(async () => undefined);
    expect(result.current).toMatchObject({
      legenda: { frases: [], emAndamento: null },
      motor: MOTOR,
      download: null,
      ultimaPerguntaEnviada: null,
      preferenciasDaTela: { idioma: "automatico", prioridadeDoMotor: "velocidade", aparencia: APARENCIA_PADRAO_DA_ESCUTA },
    });

    act(() => result.current.mudarIdioma("portuguese"));
    act(() => result.current.mudarAparencia({ tamanhoDaFonte: 18, compacto: true }));
    await act(async () => {
      result.current.mudarPrioridadeDoMotor("precisao");
    });
    expect(result.current.preferenciasDaTela).toEqual({
      idioma: "portuguese",
      prioridadeDoMotor: "precisao",
      aparencia: { tamanhoDaFonte: 18, opacidade: APARENCIA_PADRAO_DA_ESCUTA.opacidade, compacto: true },
    });
    expect(preferencias()).toMatchObject({ idioma: "portuguese", prioridadeDoMotor: "precisao" });
  });

  it("as funções devolvidas são estáveis entre renders", () => {
    const { sessao } = montarSessao(true);
    const { result, rerender } = renderHook(() => useEscuta(opcoes(), sessao));
    const antes = result.current;
    rerender();
    expect(result.current.pausar).toBe(antes.pausar);
    expect(result.current.retomar).toBe(antes.retomar);
    expect(result.current.confirmarAviso).toBe(antes.confirmarAviso);
    expect(result.current.mudarIdioma).toBe(antes.mudarIdioma);
    expect(result.current.mudarPrioridadeDoMotor).toBe(antes.mudarPrioridadeDoMotor);
    expect(result.current.mudarAparencia).toBe(antes.mudarAparencia);
  });
});
