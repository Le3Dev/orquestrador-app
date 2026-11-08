import { api, ErroDaApi } from "./cliente";

function respostaJson(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
}

describe("api.lerConsumoDosOrquestradores", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lê o consumo de cada orquestrador na rota própria", async () => {
    const corpo = [
      {
        id: "o1",
        nome: "Painel",
        turnosMedidos: 2,
        parcial: false,
        uso: { entrada: 10, criacaoDeCache: 0, leituraDeCache: 0, saida: 2 },
        indiceDeCusto: 20,
      },
    ];
    const buscar = vi.spyOn(globalThis, "fetch").mockResolvedValue(respostaJson(corpo));

    await expect(api.lerConsumoDosOrquestradores()).resolves.toEqual(corpo);
    expect(buscar.mock.calls[0]?.[0]).toBe("/api/consumo-dos-orquestradores");
  });

  it("devolve a mensagem de erro do servidor", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(respostaJson({ erro: "Erro inesperado no servidor: x" }, 500));

    const falha = api.lerConsumoDosOrquestradores();

    await expect(falha).rejects.toBeInstanceOf(ErroDaApi);
    await expect(falha).rejects.toThrow("Erro inesperado no servidor: x");
  });
});
