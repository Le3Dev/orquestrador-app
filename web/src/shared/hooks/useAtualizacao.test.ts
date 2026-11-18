import { act, renderHook, waitFor } from "@testing-library/react";

import type { EstadoDaAtualizacao, ResultadoDoReinicio } from "../ponteDoDesktop";
import { useAtualizacao } from "./useAtualizacao";

type AoMudar = (estado: EstadoDaAtualizacao) => void;

function estado(alteracoes: Partial<EstadoDaAtualizacao> = {}): EstadoDaAtualizacao {
  return {
    situacao: "em-dia",
    versaoAtual: "0.2.0",
    versaoNova: null,
    progresso: null,
    mensagemDeErro: null,
    etapa: null,
    orquestradoresTrabalhando: null,
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
    instalarAgora?: (opcoes?: { forcar?: boolean }) => Promise<ResultadoDoReinicio | void>;
    /** A ponte nova: com `instalarQuandoLivre` e `cancelarEspera`. */
    comEspera?: boolean;
  }

  function instalarPonte({
    inicial = estado(),
    obter = vi.fn(async () => inicial),
    verificar = vi.fn(async () => inicial),
    instalarAgora = vi.fn(async () => undefined),
    comEspera = false,
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
      ...(comEspera
        ? { instalarQuandoLivre: vi.fn(async () => undefined), cancelarEspera: vi.fn(async () => undefined) }
        : {}),
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
        etapa: null,
        orquestradoresTrabalhando: null,
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

  it("ponte antiga sem `etapa` e `orquestradoresTrabalhando`: os campos ausentes valem null", async () => {
    const antigo = { situacao: "baixando", versaoAtual: "0.2.0", versaoNova: "0.2.1", progresso: 10, mensagemDeErro: null };
    janelaComPonte.electron = {
      desktop: true,
      atualizacao: {
        obter: vi.fn(async () => antigo),
        verificar: vi.fn(async () => antigo),
        instalarAgora: vi.fn(async () => undefined),
        aoMudar: vi.fn(() => () => undefined),
      },
    };
    const { result } = renderHook(() => useAtualizacao());

    await waitFor(() =>
      expect(result.current.estado).toEqual({ ...antigo, etapa: null, orquestradoresTrabalhando: null }),
    );
    expect(result.current.suportaEspera).toBe(false);

    // Sem resposta, reiniciar vale como "iniciou"; esperar e cancelar não fazem nada.
    let resultado: ResultadoDoReinicio | null = null;
    await act(async () => {
      resultado = await result.current.instalarAgora();
    });
    expect(resultado).toEqual({ iniciou: true, orquestradoresTrabalhando: 0 });
    await act(() => result.current.instalarQuandoLivre());
    await act(() => result.current.cancelarEspera());
    expect(result.current.erroAoInstalar).toBeNull();
  });

  it("ponte nova: devolve a recusa com os orquestradores trabalhando e repassa forcar, esperar e cancelar", async () => {
    const instalarAgora = vi.fn(async (opcoes?: { forcar?: boolean }) =>
      opcoes?.forcar === true ? { iniciou: true, orquestradoresTrabalhando: 2 } : { iniciou: false, orquestradoresTrabalhando: 2 },
    );
    const { atualizacao, avisar } = instalarPonte({
      inicial: estado({ situacao: "pronta", versaoNova: "0.2.1" }),
      instalarAgora,
      comEspera: true,
    });
    const { result } = renderHook(() => useAtualizacao());
    await waitFor(() => expect(result.current.estado?.situacao).toBe("pronta"));
    expect(result.current.suportaEspera).toBe(true);

    let resultado: ResultadoDoReinicio | null = null;
    await act(async () => {
      resultado = await result.current.instalarAgora();
    });
    expect(instalarAgora).toHaveBeenLastCalledWith();
    expect(resultado).toEqual({ iniciou: false, orquestradoresTrabalhando: 2 });

    await act(async () => {
      resultado = await result.current.instalarAgora({ forcar: true });
    });
    expect(instalarAgora).toHaveBeenLastCalledWith({ forcar: true });
    expect(resultado).toEqual({ iniciou: true, orquestradoresTrabalhando: 2 });

    await act(() => result.current.instalarQuandoLivre());
    expect(atualizacao.instalarQuandoLivre).toHaveBeenCalledTimes(1);
    avisar(estado({ situacao: "aguardando", versaoNova: "0.2.1", orquestradoresTrabalhando: 2 }));
    expect(result.current.estado).toMatchObject({ situacao: "aguardando", orquestradoresTrabalhando: 2 });

    await act(() => result.current.cancelarEspera());
    expect(atualizacao.cancelarEspera).toHaveBeenCalledTimes(1);
  });

  it("acompanha a etapa do Mac e a falha da verificação não esconde a espera", async () => {
    const { avisar } = instalarPonte({
      inicial: estado({ situacao: "baixando", versaoNova: "0.2.1", etapa: "Instalando dependências" }),
      verificar: vi.fn().mockRejectedValue(new Error("sem internet")),
      comEspera: true,
    });
    const { result } = renderHook(() => useAtualizacao());
    await waitFor(() => expect(result.current.estado?.etapa).toBe("Instalando dependências"));

    avisar(estado({ situacao: "baixando", versaoNova: "0.2.1", etapa: "Gerando o app" }));
    expect(result.current.estado).toMatchObject({ etapa: "Gerando o app", progresso: null });

    avisar(estado({ situacao: "aguardando", versaoNova: "0.2.1", orquestradoresTrabalhando: 1 }));
    await act(() => result.current.verificar());
    expect(result.current.estado).toMatchObject({ situacao: "aguardando", orquestradoresTrabalhando: 1 });
  });

  it("falhas ao esperar ou cancelar viram a mensagem de erro, sem quebrar", async () => {
    const atualizacao = {
      obter: vi.fn(async () => estado({ situacao: "pronta", versaoNova: "0.2.1" })),
      verificar: vi.fn(async () => estado()),
      instalarAgora: vi.fn(async () => ({ iniciou: false, orquestradoresTrabalhando: 1 })),
      instalarQuandoLivre: vi.fn().mockRejectedValue(new Error("sem IPC")),
      cancelarEspera: vi.fn().mockRejectedValue(new Error("sem IPC")),
      aoMudar: vi.fn(() => () => undefined),
    };
    janelaComPonte.electron = { desktop: true, atualizacao };
    const { result } = renderHook(() => useAtualizacao());
    await waitFor(() => expect(result.current.estado?.situacao).toBe("pronta"));

    await act(() => result.current.instalarQuandoLivre());
    expect(result.current.erroAoInstalar).toBe("Não foi possível agendar o reinício: sem IPC");
    await act(() => result.current.cancelarEspera());
    expect(result.current.erroAoInstalar).toBe("Não foi possível cancelar a espera: sem IPC");
  });
});
