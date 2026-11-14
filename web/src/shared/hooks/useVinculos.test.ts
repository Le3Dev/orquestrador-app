import { act, renderHook, waitFor } from "@testing-library/react";

import { api } from "../api/cliente";
import type { VinculoDto } from "../api/tipos";
import { INTERVALO_DOS_VINCULOS_MS, useVinculos } from "./useVinculos";

const V1: VinculoDto = {
  id: "v1",
  orquestradorAId: "a",
  orquestradorBId: "b",
  notas: "",
  criadoEm: "2026-01-01T00:00:00Z",
  atualizadoEm: "2026-01-01T00:00:00Z",
};

describe("useVinculos", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("lê ao abrir e recarrega depois de cada ação", async () => {
    const listar = vi.spyOn(api, "listarVinculos").mockResolvedValueOnce([]).mockResolvedValue([V1]);
    vi.spyOn(api, "criarVinculo").mockResolvedValue(V1);
    const { result } = renderHook(() => useVinculos());
    await waitFor(() => expect(listar).toHaveBeenCalledTimes(1));

    await act(() => result.current.criar("a", "b"));

    expect(listar).toHaveBeenCalledTimes(2);
    expect(result.current.vinculos).toEqual([V1]);
  });

  it("recarrega mesmo quando a ação falha, e repassa o erro", async () => {
    const listar = vi.spyOn(api, "listarVinculos").mockResolvedValue([V1]);
    vi.spyOn(api, "desfazerVinculo").mockRejectedValue(new Error("falhou"));
    const { result } = renderHook(() => useVinculos());
    await waitFor(() => expect(result.current.vinculos).toHaveLength(1));
    listar.mockClear();

    await expect(act(() => result.current.desfazer("v1"))).rejects.toThrow("falhou");

    expect(listar).toHaveBeenCalledTimes(1);
  });

  it("consulta de tempos em tempos só enquanto há vínculos", async () => {
    vi.useFakeTimers();
    const listar = vi.spyOn(api, "listarVinculos").mockResolvedValue([]);
    renderHook(() => useVinculos());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVALO_DOS_VINCULOS_MS * 3);
    });
    expect(listar).toHaveBeenCalledTimes(1);

    listar.mockResolvedValue([V1]);
    const { unmount } = renderHook(() => useVinculos());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    listar.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVALO_DOS_VINCULOS_MS * 2);
    });
    expect(listar.mock.calls.length).toBeGreaterThanOrEqual(2);
    unmount();
  });
});
