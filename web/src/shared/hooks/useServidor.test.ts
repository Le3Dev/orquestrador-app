import { act, renderHook } from "@testing-library/react";

import { api } from "../api/cliente";
import { INTERVALO_DA_VERIFICACAO_MS, useServidor } from "./useServidor";

describe("useServidor", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function avancar(): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVALO_DA_VERIFICACAO_MS);
    });
  }

  it("percebe a queda e, quando volta outro processo, avisa que reiniciou", async () => {
    const saude = vi
      .spyOn(api, "saude")
      .mockResolvedValueOnce({ ok: true, iniciadoEm: "processo-1", memoria: null })
      .mockRejectedValueOnce(new Error("fora do ar"))
      .mockResolvedValue({ ok: true, iniciadoEm: "processo-2", memoria: null });

    const { result } = renderHook(() => useServidor());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.conectado).toBe(true);

    await avancar();
    expect(result.current.conectado).toBe(false);
    expect(result.current.caiuEm).toBeInstanceOf(Date);

    await avancar();
    expect(result.current).toMatchObject({ conectado: true, caiuEm: null, reiniciou: true });
    expect(result.current.voltouEm).toBeInstanceOf(Date);
    expect(saude).toHaveBeenCalledTimes(3);
  });

  it("uma queda rápida do mesmo processo não conta como reinício", async () => {
    vi.spyOn(api, "saude")
      .mockResolvedValueOnce({ ok: true, iniciadoEm: "processo-1", memoria: null })
      .mockRejectedValueOnce(new Error("instável"))
      .mockResolvedValue({ ok: true, iniciadoEm: "processo-1", memoria: null });

    const { result } = renderHook(() => useServidor());
    await avancar();
    await avancar();

    expect(result.current).toMatchObject({ conectado: true, reiniciou: false });
  });

  it("mantém o mesmo estado quando a resposta não muda, e troca quando a memória muda", async () => {
    const leitura = (livreBytes: number) => ({
      totalBytes: 16,
      livreBytes,
      servidorBytes: 1,
      agentesBytes: 0,
      porOrquestrador: {},
      lidaEm: `leitura-${livreBytes}`,
    });
    vi.spyOn(api, "saude")
      .mockResolvedValueOnce({ ok: true, iniciadoEm: "processo-1", memoria: leitura(8) })
      .mockResolvedValueOnce({ ok: true, iniciadoEm: "processo-1", memoria: leitura(8) })
      .mockResolvedValue({ ok: true, iniciadoEm: "processo-1", memoria: leitura(7) });

    const { result } = renderHook(() => useServidor());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const primeiro = result.current;

    await avancar();
    expect(result.current).toBe(primeiro);

    await avancar();
    expect(result.current).not.toBe(primeiro);
    expect(result.current.memoria?.livreBytes).toBe(7);
  });

  it("não dispara outra consulta enquanto a anterior está pendente", async () => {
    const saude = vi.spyOn(api, "saude").mockReturnValue(new Promise(() => undefined));

    const { result } = renderHook(() => useServidor());
    await avancar();
    await avancar();

    expect(saude).toHaveBeenCalledTimes(1);
    expect(result.current.conectado).toBe(true);
  });
});
