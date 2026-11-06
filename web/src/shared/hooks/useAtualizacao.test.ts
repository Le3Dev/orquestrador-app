import { act, renderHook, waitFor } from "@testing-library/react";

import type { EstadoDaAtualizacao } from "../ponteDoDesktop";
import { useAtualizacao } from "./useAtualizacao";

type AoMudar = (estado: EstadoDaAtualizacao) => void;

function estado(alteracoes: Partial<EstadoDaAtualizacao> = {}): EstadoDaAtualizacao {
  return {
    situacao: "em-dia",
    versaoAtual: "0.2.0",
    versaoNova: null,
    progresso: null,
    mensagemDeErro: null,
    ...alteracoes,
  };
}

/** Uma promessa que o teste resolve quando quiser. */
function adiada<Valor>() {
  let resolver: (valor: Valor) => void = () => undefined;
  const promessa = new Promise<Valor>((resolve) => {
    resolver = resolve;
  });
  return { promessa, resolver };
}

describe("useAtualizacao", () => {
  const janelaComPonte = window as unknown as { electron?: unknown };

  afterEach(() => {
    delete janelaComPonte.electron;
  });

  interface OpcoesDaPonte {
    inicial?: EstadoDaAtualizacao;
    obter?: () => Promise<EstadoDaAtualizacao>;
    verificar?: () => Promise<EstadoDaAtualizacao>;
    instalarAgora?: () => Promise<void>;
  }

  function instalarPonte({
    inicial = estado(),
    obter = vi.fn(async () => inicial),
    verificar = vi.fn(async () => inicial),
    instalarAgora = vi.fn(async () => undefined),
  }: OpcoesDaPonte = {}) {
    const ouvintes: AoMudar[] = [];
    const cancelar = vi.fn();
    const atualizacao = {
      obter,
      verificar,
      instalarAgora,
      aoMudar: vi.fn((callback: AoMudar) => {
        ouvintes.push(callback);
        return cancelar;
      }),
    };
    janelaComPonte.electron = { desktop: true, atualizacao };
    const avisar = (novo: EstadoDaAtualizacao) => act(() => ouvintes.forEach((ouvinte) => ouvinte(novo)));
    return { atualizacao, cancelar, avisar };
  }

  it("sem a ponte (navegador), o estado fica nulo e verificar e instalar não fazem nada", async () => {
    const { result } = renderHook(() => useAtualizacao());

    await act(() => result.current.verificar());
    await act(() => result.current.instalarAgora());

    expect(result.current).toMatchObject({ estado: null, avisoDispensado: false, erroAoInstalar: null });
  });

  it("lê o estado ao montar, acompanha os avisos do app e cancela a inscrição ao desmontar", async () => {
    const { atualizacao, cancelar, avisar } = instalarPonte();
    const { result, unmount } = renderHook(() => useAtualizacao());

    await waitFor(() => expect(result.current.estado).toEqual(estado()));
    expect(atualizacao.obter).toHaveBeenCalledTimes(1);
    expect(atualizacao.aoMudar).toHaveBeenCalledTimes(1);

    avisar(estado({ situacao: "baixando", versaoNova: "0.2.1", progresso: 45 }));
    expect(result.current.estado).toMatchObject({ situacao: "baixando", versaoNova: "0.2.1", progresso: 45 });

    // O mesmo estado de novo não troca o objeto (a tela não re-renderiza).
    const anterior = result.current.estado;
    avisar(estado({ situacao: "baixando", versaoNova: "0.2.1", progresso: 45 }));
    expect(result.current.estado).toBe(anterior);

    unmount();
    expect(cancelar).toHaveBeenCalledTimes(1);
  });

  it("um aviso que chega antes da leitura inicial vale mais que ela", async () => {
    const leitura = adiada<EstadoDaAtualizacao>();
    const { avisar } = instalarPonte({ obter: vi.fn(() => leitura.promessa) });
    const { result } = renderHook(() => useAtualizacao());

    avisar(estado({ situacao: "pronta", versaoNova: "0.2.1" }));
    await act(async () => leitura.resolver(estado({ situacao: "verificando" })));

    expect(result.current.estado?.situacao).toBe("pronta");
  });

  it("dispensar esconde o aviso de \"pronta\" até o estado mudar de novo", async () => {
    const pronta = estado({ situacao: "pronta", versaoNova: "0.2.1" });
    const { avisar } = instalarPonte({ inicial: pronta });
    const { result } = renderHook(() => useAtualizacao());
    await waitFor(() => expect(result.current.estado?.situacao).toBe("pronta"));
    expect(result.current.avisoDispensado).toBe(false);

    act(() => result.current.dispensarAviso());
    expect(result.current.avisoDispensado).toBe(true);

    // O mesmo estado repetido pelo app não traz o aviso de volta.
    avisar({ ...pronta });
    expect(result.current.avisoDispensado).toBe(true);

    // Mudou (uma nova verificação) e voltou a "pronta", mesmo com o objeto de antes: o aviso volta.
    avisar(estado({ situacao: "verificando" }));
    avisar(pronta);
    expect(result.current.estado?.situacao).toBe("pronta");
    expect(result.current.avisoDispensado).toBe(false);
  });

  it("verificar mostra \"verificando\" na hora e aplica a resposta do app", async () => {
    const resposta = adiada<EstadoDaAtualizacao>();
    const { atualizacao } = instalarPonte({ verificar: vi.fn(() => resposta.promessa) });
    const { result } = renderHook(() => useAtualizacao());
    await waitFor(() => expect(result.current.estado?.situacao).toBe("em-dia"));

    let verificacao: Promise<void> = Promise.resolve();
    act(() => {
      verificacao = result.current.verificar();
    });
    expect(result.current.estado?.situacao).toBe("verificando");

    await act(async () => {
      resposta.resolver(estado({ situacao: "baixando", versaoNova: "0.2.1", progresso: 0 }));
      await verificacao;
    });
    expect(atualizacao.verificar).toHaveBeenCalledTimes(1);
    expect(result.current.estado).toMatchObject({ situacao: "baixando", versaoNova: "0.2.1" });
  });

  it("falhas da ponte viram o estado de erro (ou a falha ao instalar), sem quebrar", async () => {
    const { atualizacao } = instalarPonte({
      obter: vi.fn().mockRejectedValue(new Error("sem IPC")),
      verificar: vi.fn().mockRejectedValue(new Error("sem internet")),
      instalarAgora: vi.fn().mockRejectedValue(new Error("arquivo em uso")),
    });
    const { result } = renderHook(() => useAtualizacao());

    await waitFor(() =>
      expect(result.current.estado).toEqual({
        situacao: "erro",
        versaoAtual: "",
        versaoNova: null,
        progresso: null,
        mensagemDeErro: "sem IPC",
      }),
    );

    await act(() => result.current.verificar());
    expect(result.current.estado).toMatchObject({ situacao: "erro", mensagemDeErro: "sem internet" });

    await act(() => result.current.instalarAgora());
    expect(atualizacao.instalarAgora).toHaveBeenCalledTimes(1);
    expect(result.current.erroAoInstalar).toBe("Não foi possível reiniciar para instalar: arquivo em uso");
  });

  it("a falha de uma verificação manual não esconde a atualização já pronta", async () => {
    instalarPonte({
      inicial: estado({ situacao: "pronta", versaoNova: "0.2.1" }),
      verificar: vi.fn().mockRejectedValue(new Error("sem internet")),
    });
    const { result } = renderHook(() => useAtualizacao());
    await waitFor(() => expect(result.current.estado?.situacao).toBe("pronta"));

    await act(() => result.current.verificar());

    expect(result.current.estado).toMatchObject({ situacao: "pronta", versaoNova: "0.2.1" });
  });
});
