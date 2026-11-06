import { act, renderHook } from "@testing-library/react";

import { api } from "../api/cliente";
import type { ResumoDoOrquestrador } from "../api/tipos";
import { useOrquestradores } from "./useOrquestradores";

function orquestrador(id: string, situacao: ResumoDoOrquestrador["situacao"] = "ocioso"): ResumoDoOrquestrador {
  return {
    id,
    nome: `Orquestrador ${id}`,
    pastaDeTrabalho: `C:\\projetos\\${id}`,
    nomeDaPasta: id,
    situacao,
    configuracao: {
      modeloDoOrquestrador: "opus",
      esforcoDoOrquestrador: "padrao",
      modeloDosSubagentes: "sonnet",
      esforcoDosSubagentes: "padrao",
      quantidadeDeSubagentes: { modo: "automatica", limite: 3 },
      nivelDePermissao: "leitura",
      permitirCommitEPush: false,
    },
    criadoEm: "2026-10-30T10:00:00Z",
    totalDeTurnos: 0,
    ultimoTurno: null,
    worktree: null,
  };
}

describe("useOrquestradores", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function consultar(): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
  }

  it("mantém a mesma lista quando a resposta não muda, e só troca o que mudou", async () => {
    // Cada consulta devolve objetos novos, como o JSON da API.
    vi.spyOn(api, "listarOrquestradores")
      .mockImplementationOnce(async () => [orquestrador("o1"), orquestrador("o2")])
      .mockImplementationOnce(async () => [orquestrador("o1"), orquestrador("o2")])
      .mockImplementation(async () => [orquestrador("o1"), orquestrador("o2", "trabalhando")]);

    const { result } = renderHook(() => useOrquestradores());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const primeira = result.current.orquestradores;
    expect(primeira).toHaveLength(2);

    await consultar();
    expect(result.current.orquestradores).toBe(primeira);

    await consultar();
    const terceira = result.current.orquestradores;
    expect(terceira).not.toBe(primeira);
    expect(terceira?.[0]).toBe(primeira?.[0]);
    expect(terceira?.[1]?.situacao).toBe("trabalhando");
  });
});
