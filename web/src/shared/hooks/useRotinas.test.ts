import { act, renderHook, waitFor } from "@testing-library/react";

import { ErroDaApi } from "../api/cliente";
import { ESPERA_PARA_REABRIR_MS } from "../api/ConexoesDeEventos";
import {
  apiDasRotinas,
  type DadosDaExecucao,
  type DadosDaRotina,
  type ResumoDaRotina,
  type TipoDeEventoDeRotina,
} from "../api/rotinas";
import { type FonteDeEventosDasRotinas, useRotinas } from "./useRotinas";

class FonteFalsa implements FonteDeEventosDasRotinas {
  readyState = 0;
  onopen: ((evento: Event) => unknown) | null = null;
  onerror: ((evento: Event) => unknown) | null = null;
  fechada = false;
  readonly ouvintes = new Map<string, (evento: MessageEvent<string>) => void>();

  constructor(readonly endereco: string) {}

  addEventListener(tipo: TipoDeEventoDeRotina, ouvinte: (evento: MessageEvent<string>) => void): void {
    this.ouvintes.set(tipo, ouvinte);
  }

  close(): void {
    this.fechada = true;
    this.readyState = 2;
  }

  abrir(): void {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }

  emitir(tipo: TipoDeEventoDeRotina, dados: unknown): void {
    this.ouvintes.get(tipo)?.(new MessageEvent<string>(tipo, { data: JSON.stringify(dados) }));
  }
}

function dadosDaRotina(id: string, alteracoes: Partial<DadosDaRotina> = {}): DadosDaRotina {
  return {
    id,
    nome: `Rotina ${id}`,
    ativa: true,
    gatilho: { tipo: "diario", hora: "09:00" },
    etapas: [{ tipo: "aprovacao", mensagem: "Posso seguir?" }],
    aoPerder: "pular",
    criadaEm: "2026-11-05T12:00:00Z",
    ultimaExecucaoEm: null,
    proximaExecucaoEm: "2026-11-06T12:00:00Z",
    ...alteracoes,
  };
}

function rotina(id: string, alteracoes: Partial<ResumoDaRotina> = {}): ResumoDaRotina {
  return { ...dadosDaRotina(id), execucaoAtiva: null, ...alteracoes };
}

function execucao(id: string, rotinaId: string, alteracoes: Partial<DadosDaExecucao> = {}): DadosDaExecucao {
  return {
    id,
    rotinaId,
    rotinaNome: `Rotina ${rotinaId}`,
    origem: "manual",
    situacao: "em_andamento",
    etapaAtual: 0,
    etapas: [{ tipo: "aprovacao", mensagem: "Posso seguir?" }],
    resultados: [],
    iniciadaEm: "2026-11-05T13:00:00Z",
    encerradaEm: null,
    motivo: null,
    pendencia: null,
    ...alteracoes,
  };
}

const ids = (lista: readonly ResumoDaRotina[]) => lista.map((item) => item.id);

describe("useRotinas", () => {
  let fontes: FonteFalsa[];
  const criarFonte = (endereco: string) => {
    const fonte = new FonteFalsa(endereco);
    fontes.push(fonte);
    return fonte;
  };

  beforeEach(() => {
    fontes = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function montar(inicial: ResumoDaRotina[] = [rotina("r1")]) {
    const listar = vi.spyOn(apiDasRotinas, "listar").mockResolvedValue(inicial);
    const hook = renderHook(() => useRotinas(true, criarFonte));
    act(() => fontes[0]?.abrir());
    await waitFor(() => expect(hook.result.current.carregada).toBe(true));
    return { ...hook, listar, fonte: fontes[0]! };
  }

  it("assina os eventos e, quando a conexão abre, carrega a lista pelo GET na ordem de criação", async () => {
    const listar = vi
      .spyOn(apiDasRotinas, "listar")
      .mockResolvedValue([rotina("r2", { criadaEm: "2026-11-05T14:00:00Z" }), rotina("r1", { criadaEm: "2026-11-05T12:00:00Z" })]);
    const { result } = renderHook(() => useRotinas(true, criarFonte));

    expect(fontes[0]?.endereco).toBe("/api/rotinas/eventos");
    expect(listar).not.toHaveBeenCalled();
    expect(result.current.carregada).toBe(false);
    expect(result.current.indisponivel).toBe(false);

    act(() => fontes[0]?.abrir());

    await waitFor(() => expect(result.current.carregada).toBe(true));
    expect(listar).toHaveBeenCalledTimes(1);
    expect(result.current.conexao).toBe("conectado");
    expect(ids(result.current.lista)).toEqual(["r1", "r2"]);
    expect(result.current.erro).toBeNull();
  });

  it("conta as rotinas ativas e junta as execuções que aguardam aprovação", async () => {
    const parada = execucao("e1", "r1", { situacao: "aguardando_aprovacao", pendencia: { tipo: "aprovacao", mensagem: "Posso?" } });
    const { result } = await montar([
      rotina("r1", { execucaoAtiva: parada }),
      rotina("r2", { ativa: false }),
      rotina("r3", { execucaoAtiva: execucao("e3", "r3") }),
    ]);

    expect(result.current.ativas).toBe(2);
    expect(result.current.aprovacoesPendentes).toEqual([{ execucao: parada, rotinaNome: "Rotina r1" }]);
  });

  it("aplica os eventos da rotina e da execução na lista", async () => {
    const { result, fonte } = await montar([rotina("r1")]);

    act(() => fonte.emitir("rotina_criada", { rotina: dadosDaRotina("r2", { criadaEm: "2026-11-05T15:00:00Z" }) }));
    expect(ids(result.current.lista)).toEqual(["r1", "r2"]);

    act(() => fonte.emitir("rotina_alterada", { rotina: dadosDaRotina("r1", { nome: "Nova", ativa: false }) }));
    expect(result.current.lista[0]).toMatchObject({ nome: "Nova", ativa: false, execucaoAtiva: null });
    expect(result.current.ativas).toBe(1);

    act(() => fonte.emitir("execucao_iniciada", { execucao: execucao("e1", "r1") }));
    expect(result.current.lista[0]?.execucaoAtiva?.id).toBe("e1");

    const parada = execucao("e1", "r1", { situacao: "aguardando_aprovacao", pendencia: { tipo: "plano", plano: "1. Fazer" } });
    act(() => fonte.emitir("aguardando_aprovacao", { execucao: parada }));
    expect(result.current.aprovacoesPendentes).toHaveLength(1);
    expect(result.current.aprovacoesPendentes[0]?.execucao.pendencia).toEqual({ tipo: "plano", plano: "1. Fazer" });

    // `rotina_alterada` (a agenda andou) não apaga a execução que está parada.
    act(() => fonte.emitir("rotina_alterada", { rotina: dadosDaRotina("r1", { nome: "Nova", ativa: false }) }));
    expect(result.current.aprovacoesPendentes).toHaveLength(1);

    act(() =>
      fonte.emitir("execucao_encerrada", { execucao: execucao("e1", "r1", { situacao: "concluida" }), situacao: "concluida" }),
    );
    expect(result.current.lista[0]?.execucaoAtiva).toBeNull();
    expect(result.current.aprovacoesPendentes).toHaveLength(0);

    act(() => fonte.emitir("rotina_removida", { id: "r2" }));
    expect(ids(result.current.lista)).toEqual(["r1"]);
  });

  it("ignora o fim de uma execução que não é a que está na rotina", async () => {
    const { result, fonte } = await montar([rotina("r1", { execucaoAtiva: execucao("e2", "r1") })]);

    act(() =>
      fonte.emitir("execucao_encerrada", { execucao: execucao("e1", "r1", { situacao: "falhou" }), situacao: "falhou" }),
    );

    expect(result.current.lista[0]?.execucaoAtiva?.id).toBe("e2");
  });

  it("descarta evento malformado sem derrubar a lista", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { result, fonte } = await montar();

    act(() => fonte.emitir("rotina_criada", { rotina: { id: 3 } }));
    act(() => fonte.ouvintes.get("rotina_removida")?.(new MessageEvent<string>("rotina_removida", { data: "{não é json" })));

    expect(ids(result.current.lista)).toEqual(["r1"]);
    expect(erro).toHaveBeenCalledTimes(2);
  });

  it("com a rota fora do ar (404), fica indisponível, não quebra e tenta de novo depois, cada vez mais devagar", async () => {
    vi.useFakeTimers();
    const listar = vi.spyOn(apiDasRotinas, "listar").mockRejectedValue(new ErroDaApi("O servidor respondeu com erro 404.", 404));
    const { result } = renderHook(() => useRotinas(true, criarFonte));
    await act(async () => {
      fontes[0]?.abrir();
    });

    expect(result.current.indisponivel).toBe(true);
    expect(result.current.erro).toBe("O servidor respondeu com erro 404.");
    expect(result.current.lista).toEqual([]);
    expect(result.current.ativas).toBe(0);
    expect(fontes).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ESPERA_PARA_REABRIR_MS);
    });
    expect(fontes).toHaveLength(2);
    expect(fontes[0]?.fechada).toBe(true);
    await act(async () => {
      fontes[1]?.abrir();
    });
    expect(listar).toHaveBeenCalledTimes(2);

    // A segunda falha espera o dobro.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ESPERA_PARA_REABRIR_MS);
    });
    expect(fontes).toHaveLength(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ESPERA_PARA_REABRIR_MS);
    });
    expect(fontes).toHaveLength(3);
  });

  it("quando a rota volta, carrega a lista e deixa de ser indisponível", async () => {
    vi.useFakeTimers();
    vi.spyOn(apiDasRotinas, "listar")
      .mockRejectedValueOnce(new ErroDaApi("Não encontrado.", 404))
      .mockResolvedValue([rotina("r1")]);
    const { result } = renderHook(() => useRotinas(true, criarFonte));
    await act(async () => {
      fontes[0]?.abrir();
    });
    expect(result.current.indisponivel).toBe(true);

    act(() => result.current.recarregar());
    await act(async () => {
      fontes[1]?.abrir();
    });

    expect(result.current.indisponivel).toBe(false);
    expect(result.current.erro).toBeNull();
    expect(ids(result.current.lista)).toEqual(["r1"]);
  });

  it("sem conexão ao vivo disponível, lê a lista só pelo GET", async () => {
    const listar = vi.spyOn(apiDasRotinas, "listar").mockResolvedValue([rotina("r1")]);
    const { result } = renderHook(() => useRotinas(true, () => null));

    await waitFor(() => expect(result.current.carregada).toBe(true));
    expect(listar).toHaveBeenCalledTimes(1);
  });

  it("recarrega a lista quando a conexão reabre e reaplica o que chegou durante o GET", async () => {
    const { result, fonte, listar } = await montar([rotina("r1")]);
    let responder: (lista: ResumoDaRotina[]) => void = () => undefined;
    listar.mockReturnValueOnce(new Promise((resolver) => (responder = resolver)));

    act(() => fonte.abrir());
    act(() => fonte.emitir("rotina_criada", { rotina: dadosDaRotina("r9", { criadaEm: "2026-11-05T20:00:00Z" }) }));
    await act(async () => responder([rotina("r1"), rotina("r2", { criadaEm: "2026-11-05T13:00:00Z" })]));

    expect(ids(result.current.lista)).toEqual(["r1", "r2", "r9"]);
  });

  it("criar, alterar e apagar atualizam a lista com a resposta do servidor", async () => {
    const { result } = await montar([rotina("r1")]);
    vi.spyOn(apiDasRotinas, "criar").mockResolvedValue(rotina("r2", { criadaEm: "2026-11-05T16:00:00Z" }));
    const alterar = vi.spyOn(apiDasRotinas, "alterar").mockResolvedValue(rotina("r1", { ativa: false }));
    const apagar = vi.spyOn(apiDasRotinas, "apagar").mockResolvedValue(undefined);

    await act(() =>
      result.current.criar({ nome: "Nova", gatilho: { tipo: "diario", hora: "09:00" }, etapas: [{ tipo: "espera", minutos: 5 }] }),
    );
    expect(ids(result.current.lista)).toEqual(["r1", "r2"]);

    await act(() => result.current.alterar("r1", { ativa: false }));
    expect(alterar).toHaveBeenCalledWith("r1", { ativa: false });
    expect(result.current.lista[0]?.ativa).toBe(false);

    await act(() => result.current.apagar("r2"));
    expect(apagar).toHaveBeenCalledWith("r2");
    expect(ids(result.current.lista)).toEqual(["r1"]);
  });

  it("apagar uma rotina que já foi apagada em outro lugar (404) só a tira da tela; outros erros sobem", async () => {
    const { result } = await montar([rotina("r1"), rotina("r2", { criadaEm: "2026-11-05T13:00:00Z" })]);
    const apagar = vi
      .spyOn(apiDasRotinas, "apagar")
      .mockRejectedValueOnce(new ErroDaApi("Rotina não encontrada.", 404))
      .mockRejectedValueOnce(new ErroDaApi("Falha no servidor.", 500));

    await act(() => result.current.apagar("r1"));
    expect(ids(result.current.lista)).toEqual(["r2"]);

    await expect(act(() => result.current.apagar("r2"))).rejects.toThrow("Falha no servidor.");
    expect(apagar).toHaveBeenCalledTimes(2);
    expect(ids(result.current.lista)).toEqual(["r2"]);
  });

  it("executar agora, aprovar e recusar guardam a execução devolvida pelo servidor", async () => {
    const { result } = await montar([rotina("r1")]);
    vi.spyOn(apiDasRotinas, "executarAgora").mockResolvedValue(
      execucao("e1", "r1", { situacao: "aguardando_aprovacao", pendencia: { tipo: "aprovacao", mensagem: "Posso?" } }),
    );
    const aprovar = vi.spyOn(apiDasRotinas, "aprovar").mockResolvedValue(execucao("e1", "r1", { situacao: "em_andamento" }));
    const recusar = vi
      .spyOn(apiDasRotinas, "recusar")
      .mockResolvedValue(execucao("e1", "r1", { situacao: "recusada", etapaAtual: null }));

    await act(() => result.current.executarAgora("r1"));
    expect(result.current.aprovacoesPendentes).toHaveLength(1);

    await act(() => result.current.aprovar("e1"));
    expect(aprovar).toHaveBeenCalledWith("e1");
    expect(result.current.aprovacoesPendentes).toHaveLength(0);
    expect(result.current.lista[0]?.execucaoAtiva?.situacao).toBe("em_andamento");

    await act(() => result.current.recusar("e1", "Não agora"));
    expect(recusar).toHaveBeenCalledWith("e1", "Não agora");
    expect(result.current.lista[0]?.execucaoAtiva).toBeNull();
  });

  it("não assina nada enquanto o servidor está desconectado", () => {
    vi.spyOn(apiDasRotinas, "listar").mockResolvedValue([]);
    renderHook(() => useRotinas(false, criarFonte));

    expect(fontes).toHaveLength(0);
  });
});
