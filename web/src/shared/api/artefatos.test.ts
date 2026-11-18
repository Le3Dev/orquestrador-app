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

  it("lerDesenho busca os traços e a largura da versão; sem a lista, vazio; sem largura numérica, nula; versão inexistente dá 404", async () => {
    const traco = { id: "t1", tipo: "seta", cor: "azul", espessura: 3, pontos: [{ x: 1, y: 2 }, { x: 3, y: 4 }], ancora: null };
    const buscar = vi
      .fn()
      .mockResolvedValueOnce(respostaJson({ tracos: [traco], largura: 1500 }))
      .mockResolvedValueOnce(respostaJson({ tracos: [traco], largura: null }))
      .mockResolvedValueOnce(respostaJson({ largura: "1500" }))
      .mockResolvedValueOnce(respostaJson({ erro: "Versão não encontrada." }, 404));
    vi.stubGlobal("fetch", buscar);

    await expect(apiDosArtefatos.lerDesenho("a 1", 2)).resolves.toEqual({ tracos: [traco], largura: 1500 });
    expect(buscar).toHaveBeenCalledWith("/api/artefatos/a%201/versoes/2/desenho", expect.anything());
    await expect(apiDosArtefatos.lerDesenho("a1", 2)).resolves.toEqual({ tracos: [traco], largura: null });
    await expect(apiDosArtefatos.lerDesenho("a1", 2)).resolves.toEqual({ tracos: [], largura: null });
    await expect(apiDosArtefatos.lerDesenho("a1", 9)).rejects.toMatchObject({ status: 404 });
  });

  it("salvarDesenho manda um PUT com { tracos, largura } e aceita o 204; 413 vira erro com a mensagem", async () => {
    const tracos = [
      {
        id: "t1",
        tipo: "texto" as const,
        cor: "verde" as const,
        espessura: 3 as const,
        pontos: [{ x: 1, y: 2 }],
        texto: "oi",
        ancora: { conteiner: [], elemento: [1, 0] },
      },
    ];
    const buscar = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(respostaJson({ erro: "Desenho grande demais." }, 413));
    vi.stubGlobal("fetch", buscar);

    await expect(apiDosArtefatos.salvarDesenho("a1", 3, tracos, 1500)).resolves.toBeUndefined();
    expect(buscar).toHaveBeenCalledWith(
      "/api/artefatos/a1/versoes/3/desenho",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ tracos, largura: 1500 }) }),
    );
    await expect(apiDosArtefatos.salvarDesenho("a1", 3, tracos, null)).rejects.toMatchObject({
      message: "Desenho grande demais.",
      status: 413,
    });
    expect(buscar).toHaveBeenLastCalledWith(
      "/api/artefatos/a1/versoes/3/desenho",
      expect.objectContaining({ body: JSON.stringify({ tracos, largura: null }) }),
    );
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
