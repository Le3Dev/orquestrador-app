import { act, renderHook, waitFor } from "@testing-library/react";

import { apiDosArtefatos, type DesenhoGravado, type TracoGravado } from "./api/artefatos";
import { useDesenhoDoArtefato } from "./desenhoDoArtefato";

function seta(id: string): TracoGravado {
  return { id, tipo: "seta", cor: "azul", espessura: 3, pontos: [{ x: 10, y: 10 }, { x: 80, y: 10 }], ancora: null };
}

const CHAVE_ANTIGA = "orquestrador-agentes:canvas:v1:desenho-da-tela-cheia";

describe("useDesenhoDoArtefato: a largura da página", () => {
  const lerDesenho = () => vi.mocked(apiDosArtefatos.lerDesenho);
  const salvarDesenho = () => vi.mocked(apiDosArtefatos.salvarDesenho);

  beforeEach(() => {
    vi.spyOn(apiDosArtefatos, "lerDesenho").mockResolvedValue({ tracos: [], largura: null });
    vi.spyOn(apiDosArtefatos, "salvarDesenho").mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  async function abrir(gravado: DesenhoGravado = { tracos: [], largura: null }) {
    lerDesenho().mockResolvedValue(gravado);
    const hook = renderHook(() => useDesenhoDoArtefato("a1", 3, { existe: true, ehAtual: true }));
    await waitFor(() => expect(hook.result.current.situacao).toBe("pronto"));
    return hook;
  }

  /** Grava o passo que esperava o atraso e espera a vez dele na fila. */
  async function gravarJa(hook: Awaited<ReturnType<typeof abrir>>) {
    await act(async () => hook.result.current.gravarJa());
  }

  it("o primeiro traço grava a largura da página; os seguintes mantêm a do primeiro", async () => {
    const hook = await abrir();
    expect(hook.result.current.largura).toBeNull();

    act(() => hook.result.current.acrescentar(seta("t1"), 1500));
    expect(hook.result.current.largura).toBe(1500);
    await gravarJa(hook);
    expect(salvarDesenho()).toHaveBeenLastCalledWith("a1", 3, [seta("t1")], 1500);

    act(() => hook.result.current.acrescentar(seta("t2"), 840));
    expect(hook.result.current.largura).toBe(1500);
    await gravarJa(hook);
    expect(salvarDesenho()).toHaveBeenLastCalledWith("a1", 3, [seta("t1"), seta("t2")], 1500);
  });

  it("a largura do primeiro traço é arredondada e limitada; sem largura, o desenho fica sem", async () => {
    const hook = await abrir();
    act(() => hook.result.current.acrescentar(seta("t1"), 1499.6));
    expect(hook.result.current.largura).toBe(1500);

    const outro = await abrir();
    act(() => outro.result.current.acrescentar(seta("t1"), 50_000));
    expect(outro.result.current.largura).toBe(10_000);

    const semLargura = await abrir();
    act(() => semLargura.result.current.acrescentar(seta("t1"), null));
    expect(semLargura.result.current.largura).toBeNull();
  });

  it("apagando todos os traços, a largura zera (a página volta a fluir); o desfazer a traz de volta", async () => {
    const hook = await abrir({ tracos: [seta("t1"), seta("t2")], largura: 1200 });
    expect(hook.result.current.largura).toBe(1200);

    act(() => hook.result.current.apagar(["t1"]));
    expect(hook.result.current.largura).toBe(1200);
    act(() => hook.result.current.apagar(["t2"]));
    expect(hook.result.current.tracos).toEqual([]);
    expect(hook.result.current.largura).toBeNull();
    await gravarJa(hook);
    expect(salvarDesenho()).toHaveBeenLastCalledWith("a1", 3, [], null);

    act(() => hook.result.current.desfazer());
    expect(hook.result.current.tracos).toEqual([seta("t2")]);
    expect(hook.result.current.largura).toBe(1200);

    // Começar de novo depois de apagar tudo: vale a largura de agora.
    act(() => hook.result.current.apagar(["t2"]));
    act(() => hook.result.current.acrescentar(seta("t3"), 900));
    expect(hook.result.current.largura).toBe(900);
  });

  it("desfazer o primeiro traço zera a largura", async () => {
    const hook = await abrir();
    act(() => hook.result.current.acrescentar(seta("t1"), 1500));
    act(() => hook.result.current.desfazer());
    expect(hook.result.current.tracos).toEqual([]);
    expect(hook.result.current.largura).toBeNull();
  });

  it("lida do servidor: vale com traços (validada); sem traços, nula", async () => {
    expect((await abrir({ tracos: [seta("t1")], largura: 1499.7 })).result.current.largura).toBe(1500);
    expect((await abrir({ tracos: [], largura: 1500 })).result.current.largura).toBeNull();
    expect((await abrir({ tracos: [seta("t1")], largura: -3 })).result.current.largura).toBeNull();
  });

  it("o desenho migrado do navegador vai sem largura e continua sem; traço novo nele não ganha largura", async () => {
    const antigo = { id: "velho", tipo: "retangulo", cor: "verde", espessura: 3, pontos: [{ x: 1, y: 2 }, { x: 50, y: 60 }] };
    localStorage.setItem(CHAVE_ANTIGA, JSON.stringify({ a1: [antigo] }));
    const hook = await abrir({ tracos: [], largura: 1500 });

    await waitFor(() => expect(salvarDesenho()).toHaveBeenCalledWith("a1", 3, [{ ...antigo, ancora: null }], null));
    expect(hook.result.current.largura).toBeNull();
    act(() => hook.result.current.acrescentar(seta("t1"), 1500));
    expect(hook.result.current.largura).toBeNull();
  });
});
