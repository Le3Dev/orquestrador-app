import { act, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";

import { api } from "../api/cliente";
import type { DadosDaNota } from "../api/tipos";
import { TAMANHO_DA_NOTA } from "../canvas/layout";
import { ehNota, idDoNoDaNota, type NoDoCanvas, type NoNota, novaNota, novoTerminal } from "../canvas/nos";
import { useNotas } from "./useNotas";

function nota(id: string): DadosDaNota {
  return { id, titulo: "Nova nota", texto: "", criadaEm: "2026-10-30T12:00:00Z", atualizadaEm: "2026-10-30T12:00:00Z" };
}

/** O centro da área visível, em coordenadas do canvas. */
const CENTRO = { x: 1000, y: 600 };
const centroDaTela = () => CENTRO;

function renderizar(iniciais: NoDoCanvas[] = []) {
  return renderHook(() => {
    const [nos, setNos] = useState<NoDoCanvas[]>(iniciais);
    return { nos, notas: useNotas(setNos, centroDaTela, true) };
  });
}

function notasNoCanvas(nos: readonly NoDoCanvas[]): NoNota[] {
  return nos.filter(ehNota);
}

describe("useNotas", () => {
  afterEach(() => vi.restoreAllMocks());

  it("ao abrir, carrega a lista: cria os nós que faltam e tira as notas que não existem mais", async () => {
    vi.spyOn(api, "listarNotas").mockResolvedValue([nota("n1"), nota("n2")]);
    const terminal = novoTerminal("o1", { x: 0, y: 0 }, 600, 500);
    const { result } = renderizar([terminal, novaNota("n1", { x: 5, y: 5 }), novaNota("apagada", { x: 9, y: 9 })]);

    await waitFor(() => expect(notasNoCanvas(result.current.nos).map((no) => no.data.notaId)).toEqual(["n1", "n2"]));

    expect(result.current.nos[0]).toBe(terminal);
    expect(notasNoCanvas(result.current.nos)[0]?.position).toEqual({ x: 5, y: 5 });
    expect(notasNoCanvas(result.current.nos)[1]?.position).toEqual({
      x: CENTRO.x - TAMANHO_DA_NOTA.largura / 2,
      y: CENTRO.y - TAMANHO_DA_NOTA.altura / 2,
    });
    expect(result.current.notas.valor.loja.ler("n2")).toEqual(nota("n2"));
  });

  it("\"+ notas\" chama o POST e cria o nó, selecionado, no centro da tela e com o foco pedido", async () => {
    vi.spyOn(api, "listarNotas").mockResolvedValue([]);
    const criar = vi.spyOn(api, "criarNota").mockResolvedValue(nota("n3"));
    const { result } = renderizar([{ ...novoTerminal("o1", { x: 0, y: 0 }, 600, 500), selected: true }]);

    await act(() => result.current.notas.criarNota());

    expect(criar).toHaveBeenCalledTimes(1);
    const criada = result.current.nos.find((no) => no.id === idDoNoDaNota("n3"));
    expect(criada).toMatchObject({
      type: "nota",
      selected: true,
      position: { x: CENTRO.x - TAMANHO_DA_NOTA.largura / 2, y: CENTRO.y - TAMANHO_DA_NOTA.altura / 2 },
      data: { notaId: "n3", minimizada: false },
    });
    expect(result.current.nos[0]?.selected).toBe(false);
    expect(result.current.notas.valor.loja.ler("n3")).toEqual(nota("n3"));
    expect(result.current.notas.valor.loja.consumirFoco("n3")).toBe(true);
  });

  it("cada clique cria uma nota nova, deslocada para não ficar exatamente sobre a anterior", async () => {
    vi.spyOn(api, "listarNotas").mockResolvedValue([]);
    vi.spyOn(api, "criarNota").mockResolvedValueOnce(nota("n1")).mockResolvedValueOnce(nota("n2"));
    const { result } = renderizar();

    await act(() => result.current.notas.criarNota());
    await act(() => result.current.notas.criarNota());

    const [primeira, segunda] = notasNoCanvas(result.current.nos);
    expect(segunda?.position).not.toEqual(primeira?.position);
  });

  it("a nota criada enquanto a lista carregava não sai do canvas quando a lista chega", async () => {
    let entregarLista: (lista: DadosDaNota[]) => void = () => undefined;
    vi.spyOn(api, "listarNotas").mockReturnValue(new Promise<DadosDaNota[]>((resolver) => (entregarLista = resolver)));
    vi.spyOn(api, "criarNota").mockResolvedValue(nota("recem"));
    const { result } = renderizar();

    await act(() => result.current.notas.criarNota());
    await act(async () => entregarLista([]));

    expect(notasNoCanvas(result.current.nos).map((no) => no.data.notaId)).toEqual(["recem"]);
  });

  it("se o POST falhar, explica o motivo e não cria nó", async () => {
    vi.spyOn(api, "listarNotas").mockResolvedValue([]);
    vi.spyOn(api, "criarNota").mockRejectedValue(new Error("Não foi possível falar com o servidor."));
    const { result } = renderizar();

    await act(() => result.current.notas.criarNota());

    expect(result.current.notas.erro).toBe("Não foi possível criar a nota: Não foi possível falar com o servidor.");
    expect(notasNoCanvas(result.current.nos)).toEqual([]);
  });

  it("minimizar e apagar mexem só no nó da nota", async () => {
    vi.spyOn(api, "listarNotas").mockResolvedValue([nota("n1"), nota("n2")]);
    const terminal = novoTerminal("o1", { x: 0, y: 0 }, 600, 500);
    const { result } = renderizar([terminal, novaNota("n1", { x: 0, y: 0 }), novaNota("n2", { x: 50, y: 50 })]);
    await waitFor(() => expect(result.current.notas.valor.loja.ler("n1")).toBeDefined());
    const n2 = notasNoCanvas(result.current.nos)[1];

    act(() => result.current.notas.valor.acoes.minimizarOuRestaurar("n1"));
    expect(notasNoCanvas(result.current.nos)[0]?.data.minimizada).toBe(true);
    expect(notasNoCanvas(result.current.nos)[1]).toBe(n2);

    act(() => result.current.notas.valor.acoes.notaApagada("n1"));
    expect(result.current.nos.map((no) => no.id)).toEqual(["o1", idDoNoDaNota("n2")]);
    expect(result.current.notas.valor.loja.ler("n1")).toBeUndefined();
  });

  it("se a lista não carregar, as notas do layout mostram o motivo", async () => {
    vi.spyOn(api, "listarNotas").mockRejectedValue(new Error("O servidor respondeu com erro 500."));
    const { result } = renderizar([novaNota("n1", { x: 0, y: 0 })]);

    await waitFor(() => expect(result.current.notas.valor.loja.lerErroAoCarregar()).toBe("O servidor respondeu com erro 500."));
    // O layout continua: a nota não some só porque o servidor falhou.
    expect(notasNoCanvas(result.current.nos)).toHaveLength(1);
  });
});
