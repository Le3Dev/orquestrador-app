import { apiDosArtefatos } from "./artefatos";
import { ErroDaApi } from "./cliente";

function respostaJson(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
}

describe("apiDosArtefatos", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renomear manda um PATCH só com o título", async () => {
    const buscar = vi.fn(async () => respostaJson({ id: "a 1", titulo: "Painel" }));
    vi.stubGlobal("fetch", buscar);

    await expect(apiDosArtefatos.renomear("a 1", "Painel")).resolves.toMatchObject({ titulo: "Painel" });

    expect(buscar).toHaveBeenCalledWith(
      "/api/artefatos/a%201",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ titulo: "Painel" }) }),
    );
  });

  it("título recusado: o erro traz a mensagem do servidor e o status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respostaJson({ erro: "Título inválido." }, 400)));

    const falha = await apiDosArtefatos.renomear("a1", "").catch((erro: unknown) => erro);

    expect(falha).toBeInstanceOf(ErroDaApi);
    expect(falha).toMatchObject({ message: "Título inválido.", status: 400 });
  });

  it("lerVersao devolve o conteúdo bruto; versão inexistente dá 404", async () => {
    const buscar = vi
      .fn()
      .mockResolvedValueOnce(new Response("<h1>oi</h1>", { status: 200, headers: { "Content-Type": "text/html" } }))
      .mockResolvedValueOnce(respostaJson({ erro: "Versão não encontrada." }, 404));
    vi.stubGlobal("fetch", buscar);

    await expect(apiDosArtefatos.lerVersao("a1", 2)).resolves.toBe("<h1>oi</h1>");
    expect(buscar).toHaveBeenCalledWith("/api/artefatos/a1/versoes/2", {});
    await expect(apiDosArtefatos.lerVersao("a1", 9)).rejects.toMatchObject({ status: 404 });
  });

  it("apagar manda um DELETE e aceita o 204 sem corpo", async () => {
    const buscar = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", buscar);

    await expect(apiDosArtefatos.apagar("a1")).resolves.toBeUndefined();
    expect(buscar).toHaveBeenCalledWith("/api/artefatos/a1", expect.objectContaining({ method: "DELETE" }));
  });

  it("sem servidor, explica que não conseguiu falar com ele", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));

    await expect(apiDosArtefatos.listar()).rejects.toThrow("Não foi possível falar com o servidor.");
  });
});
