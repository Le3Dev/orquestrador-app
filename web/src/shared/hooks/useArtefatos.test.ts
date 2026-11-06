import { act, renderHook, waitFor } from "@testing-library/react";

import { apiDosArtefatos, type ResumoDoArtefato, type TipoDeEventoDeArtefato } from "../api/artefatos";
import { ErroDaApi } from "../api/cliente";
import { ESPERA_PARA_REABRIR_MS } from "../api/ConexoesDeEventos";
import { type FonteDeEventosDosArtefatos, useArtefatos } from "./useArtefatos";

class FonteFalsa implements FonteDeEventosDosArtefatos {
  readyState = 0;
  onopen: ((evento: Event) => unknown) | null = null;
  onerror: ((evento: Event) => unknown) | null = null;
  fechada = false;
  readonly ouvintes = new Map<string, (evento: MessageEvent<string>) => void>();

  constructor(readonly endereco: string) {}

  addEventListener(tipo: TipoDeEventoDeArtefato, ouvinte: (evento: MessageEvent<string>) => void): void {
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

  emitir(tipo: TipoDeEventoDeArtefato, dados: unknown): void {
    this.ouvintes.get(tipo)?.(new MessageEvent<string>(tipo, { data: JSON.stringify(dados) }));
  }
}

function artefato(id: string, alteracoes: Partial<ResumoDoArtefato> = {}): ResumoDoArtefato {
  return {
    id,
    titulo: `Artefato ${id}`,
    formato: "html",
    origem: { tipo: "orquestrador", id: "o1" },
    arquivo: `${id}.html`,
    criadoEm: "2026-11-05T12:00:00Z",
    atualizadoEm: "2026-11-05T12:00:00Z",
    versaoAtual: 1,
    versoes: [{ numero: 1, criadaEm: "2026-11-05T12:00:00Z", tamanho: 100 }],
    ...alteracoes,
  };
}

const ids = (lista: readonly ResumoDoArtefato[]) => lista.map((item) => item.id);

describe("useArtefatos", () => {
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

  it("assina os eventos e, quando a conexão abre, carrega a lista pelo GET", async () => {
    const listar = vi
      .spyOn(apiDosArtefatos, "listar")
      .mockResolvedValue([artefato("a1", { atualizadoEm: "2026-11-05T12:00:00Z" }), artefato("a2", { atualizadoEm: "2026-11-05T13:00:00Z" })]);
    const { result } = renderHook(() => useArtefatos(true, criarFonte));

    expect(fontes).toHaveLength(1);
    expect(fontes[0]?.endereco).toBe("/api/artefatos/eventos");
    expect(listar).not.toHaveBeenCalled();
    expect(result.current.carregada).toBe(false);

    act(() => fontes[0]?.abrir());

    await waitFor(() => expect(result.current.carregada).toBe(true));
    expect(listar).toHaveBeenCalledTimes(1);
    expect(result.current.conexao).toBe("conectado");
    // Do mais recente para o mais antigo.
    expect(ids(result.current.lista)).toEqual(["a2", "a1"]);
    expect(result.current.ultimoEvento).toBeNull();
  });

  it("aplica os quatro eventos na lista e numera cada um como o último evento", async () => {
    vi.spyOn(apiDosArtefatos, "listar").mockResolvedValue([artefato("a1")]);
    const { result } = renderHook(() => useArtefatos(true, criarFonte));
    act(() => fontes[0]?.abrir());
    await waitFor(() => expect(result.current.carregada).toBe(true));
    const fonte = fontes[0]!;

    const novo = artefato("a2", { atualizadoEm: "2026-11-05T14:00:00Z" });
    act(() => fonte.emitir("artefato_criado", { artefato: novo }));
    expect(ids(result.current.lista)).toEqual(["a2", "a1"]);
    expect(result.current.ultimoEvento).toEqual({ numero: 1, evento: { tipo: "artefato_criado", artefato: novo } });

    const v2 = artefato("a1", {
      versaoAtual: 2,
      atualizadoEm: "2026-11-05T15:00:00Z",
      versoes: [
        { numero: 1, criadaEm: "2026-11-05T12:00:00Z", tamanho: 100 },
        { numero: 2, criadaEm: "2026-11-05T15:00:00Z", tamanho: 180 },
      ],
    });
    act(() => fonte.emitir("versao_adicionada", { artefato: v2 }));
    expect(ids(result.current.lista)).toEqual(["a1", "a2"]);
    expect(result.current.lista[0]?.versaoAtual).toBe(2);
    expect(result.current.ultimoEvento).toMatchObject({ numero: 2, evento: { tipo: "versao_adicionada" } });

    act(() => fonte.emitir("artefato_renomeado", { artefato: { ...v2, titulo: "Painel" } }));
    expect(result.current.lista[0]?.titulo).toBe("Painel");
    expect(result.current.ultimoEvento).toMatchObject({ numero: 3, evento: { tipo: "artefato_renomeado" } });

    act(() => fonte.emitir("artefato_removido", { id: "a2" }));
    expect(ids(result.current.lista)).toEqual(["a1"]);
    expect(result.current.ultimoEvento).toEqual({ numero: 4, evento: { tipo: "artefato_removido", id: "a2" } });
    expect(result.current.eventosRecentes.map((recebido) => recebido.numero)).toEqual([1, 2, 3, 4]);
  });

  it("ignora um evento malformado", async () => {
    vi.spyOn(apiDosArtefatos, "listar").mockResolvedValue([]);
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { result } = renderHook(() => useArtefatos(true, criarFonte));
    act(() => fontes[0]?.abrir());
    await waitFor(() => expect(result.current.carregada).toBe(true));

    act(() => fontes[0]?.emitir("artefato_criado", { artefato: { titulo: "sem id" } }));

    expect(result.current.lista).toEqual([]);
    expect(result.current.ultimoEvento).toBeNull();
    expect(erro).toHaveBeenCalled();
  });

  it("um evento que chega enquanto o GET está no ar não se perde quando a lista chega", async () => {
    let entregar: (lista: ResumoDoArtefato[]) => void = () => undefined;
    vi.spyOn(apiDosArtefatos, "listar").mockReturnValue(
      new Promise<ResumoDoArtefato[]>((resolver) => (entregar = resolver)),
    );
    const { result } = renderHook(() => useArtefatos(true, criarFonte));
    act(() => fontes[0]?.abrir());

    const novo = artefato("a2", { atualizadoEm: "2026-11-05T14:00:00Z" });
    act(() => fontes[0]?.emitir("artefato_criado", { artefato: novo }));
    // A resposta saiu antes da criação: não traz o a2.
    await act(async () => entregar([artefato("a1")]));

    expect(ids(result.current.lista)).toEqual(["a2", "a1"]);
  });

  it("quando o navegador abandona a conexão, assina de novo e recarrega a lista", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const listar = vi
      .spyOn(apiDosArtefatos, "listar")
      .mockResolvedValueOnce([artefato("a1")])
      .mockResolvedValueOnce([artefato("a3")]);
    const { result } = renderHook(() => useArtefatos(true, criarFonte));
    act(() => fontes[0]?.abrir());
    await waitFor(() => expect(ids(result.current.lista)).toEqual(["a1"]));

    act(() => {
      const primeira = fontes[0]!;
      primeira.readyState = 2;
      primeira.onerror?.(new Event("error"));
    });
    expect(result.current.conexao).toBe("reconectando");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ESPERA_PARA_REABRIR_MS);
    });
    expect(fontes).toHaveLength(2);
    expect(fontes[0]?.fechada).toBe(true);
    act(() => fontes[1]?.abrir());

    await waitFor(() => expect(ids(result.current.lista)).toEqual(["a3"]));
    expect(listar).toHaveBeenCalledTimes(2);
  });

  it("quando o navegador reconecta sozinho (a conexão abre de novo), recarrega a lista", async () => {
    const listar = vi
      .spyOn(apiDosArtefatos, "listar")
      .mockResolvedValueOnce([artefato("a1")])
      .mockResolvedValueOnce([]);
    const { result } = renderHook(() => useArtefatos(true, criarFonte));
    act(() => fontes[0]?.abrir());
    await waitFor(() => expect(ids(result.current.lista)).toEqual(["a1"]));

    // Caiu e voltou: o navegador reabre a mesma conexão.
    act(() => fontes[0]?.onerror?.(new Event("error")));
    act(() => fontes[0]?.abrir());

    await waitFor(() => expect(result.current.lista).toEqual([]));
    expect(listar).toHaveBeenCalledTimes(2);
    expect(fontes).toHaveLength(1);
  });

  it("com o servidor voltando, fecha a conexão antiga e assina de novo", async () => {
    vi.spyOn(apiDosArtefatos, "listar").mockResolvedValue([]);
    const { rerender } = renderHook(({ conectado }) => useArtefatos(conectado, criarFonte), {
      initialProps: { conectado: true },
    });
    expect(fontes).toHaveLength(1);

    rerender({ conectado: false });
    rerender({ conectado: true });

    expect(fontes).toHaveLength(2);
    expect(fontes[0]?.fechada).toBe(true);
  });

  it("se a lista não carrega, avisa e tenta de novo", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(apiDosArtefatos, "listar")
      .mockRejectedValueOnce(new Error("fora do ar"))
      .mockResolvedValueOnce([artefato("a1")]);
    const { result } = renderHook(() => useArtefatos(true, criarFonte));
    act(() => fontes[0]?.abrir());

    await waitFor(() => expect(result.current.erro).toBe("fora do ar"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ESPERA_PARA_REABRIR_MS);
    });
    act(() => fontes[1]?.abrir());

    await waitFor(() => expect(ids(result.current.lista)).toEqual(["a1"]));
    expect(result.current.erro).toBeNull();
  });

  it("renomear chama o PATCH e a lista já sai com o título novo", async () => {
    vi.spyOn(apiDosArtefatos, "listar").mockResolvedValue([artefato("a1")]);
    const renomear = vi.spyOn(apiDosArtefatos, "renomear").mockResolvedValue(artefato("a1", { titulo: "Painel" }));
    const { result } = renderHook(() => useArtefatos(true, criarFonte));
    act(() => fontes[0]?.abrir());
    await waitFor(() => expect(result.current.carregada).toBe(true));

    await act(() => result.current.renomear("a1", "Painel"));

    expect(renomear).toHaveBeenCalledWith("a1", "Painel");
    expect(result.current.lista[0]?.titulo).toBe("Painel");
  });

  it("apagar chama o DELETE e tira da lista; já apagado (404) também sai; outro erro sobe", async () => {
    vi.spyOn(apiDosArtefatos, "listar").mockResolvedValue([artefato("a1"), artefato("a2"), artefato("a3")]);
    const apagar = vi
      .spyOn(apiDosArtefatos, "apagar")
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ErroDaApi("Artefato não encontrado.", 404))
      .mockRejectedValueOnce(new Error("fora do ar"));
    const { result } = renderHook(() => useArtefatos(true, criarFonte));
    act(() => fontes[0]?.abrir());
    await waitFor(() => expect(result.current.carregada).toBe(true));

    await act(() => result.current.apagar("a1"));
    await act(() => result.current.apagar("a2"));
    await expect(result.current.apagar("a3")).rejects.toThrow("fora do ar");

    expect(apagar).toHaveBeenCalledTimes(3);
    expect(ids(result.current.lista)).toEqual(["a3"]);
  });

  it("sem EventSource (jsdom), só carrega a lista pelo GET", async () => {
    vi.spyOn(apiDosArtefatos, "listar").mockResolvedValue([artefato("a1")]);
    const { result } = renderHook(() => useArtefatos(true, () => null));

    await waitFor(() => expect(ids(result.current.lista)).toEqual(["a1"]));
    expect(result.current.conexao).toBeNull();
  });
});
