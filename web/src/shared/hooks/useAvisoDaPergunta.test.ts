import { renderHook } from "@testing-library/react";

import { perguntaPendenteDoTurno, useAvisoDaPergunta } from "./useAvisoDaPergunta";

const som = vi.hoisted(() => ({ tocar: vi.fn() }));
vi.mock("../canvas/somDaPergunta", () => ({ tocarSomDaPergunta: som.tocar }));

const AGORA = "2026-10-28T12:00:00Z";

describe("perguntaPendenteDoTurno", () => {
  const turno = { id: "t1", situacao: "concluido", perguntas: [{}], encerradoEm: AGORA };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T12:00:02Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("só o pedido concluído com perguntas é pendente; recente é 'ao vivo'", () => {
    expect(perguntaPendenteDoTurno(turno)).toEqual({ chave: "t1", aoVivo: true });
    expect(perguntaPendenteDoTurno({ ...turno, perguntas: [] })).toBeNull();
    expect(perguntaPendenteDoTurno({ ...turno, situacao: "em_andamento" })).toBeNull();
    expect(perguntaPendenteDoTurno(undefined)).toBeNull();
  });

  it("pergunta antiga (histórico) não é ao vivo", () => {
    expect(perguntaPendenteDoTurno({ ...turno, encerradoEm: "2026-10-27T12:00:00Z" })).toEqual({ chave: "t1", aoVivo: false });
  });
});

describe("useAvisoDaPergunta", () => {
  beforeEach(() => som.tocar.mockClear());

  it("com o som ligado, toca uma vez por pergunta nova, mesmo re-renderizando", () => {
    const { result, rerender } = renderHook(({ p, s }) => useAvisoDaPergunta(p, s), {
      initialProps: { p: null as { chave: string; aoVivo: boolean } | null, s: true },
    });
    expect(som.tocar).not.toHaveBeenCalled();

    rerender({ p: { chave: "t1", aoVivo: true }, s: true });
    expect(som.tocar).toHaveBeenCalledTimes(1);
    expect(result.current.balancando).toBe(true);

    rerender({ p: { chave: "t1", aoVivo: true }, s: true });
    rerender({ p: { chave: "t1", aoVivo: true }, s: false });
    rerender({ p: { chave: "t1", aoVivo: true }, s: true });
    expect(som.tocar).toHaveBeenCalledTimes(1);

    rerender({ p: { chave: "t2", aoVivo: true }, s: true });
    expect(som.tocar).toHaveBeenCalledTimes(2);
  });

  it("com o som desligado (o padrão), balança mas não toca", () => {
    const { result } = renderHook(() => useAvisoDaPergunta({ chave: "t1", aoVivo: true }, false));

    expect(som.tocar).not.toHaveBeenCalled();
    expect(result.current.balancando).toBe(true);
  });

  it("pergunta que já estava lá ao abrir (histórico) não avisa", () => {
    const { result } = renderHook(() => useAvisoDaPergunta({ chave: "t1", aoVivo: false }, true));

    expect(som.tocar).not.toHaveBeenCalled();
    expect(result.current.balancando).toBe(false);
  });
});
