import { api, ErroDaApi } from "./cliente";

const VINCULO = {
  id: "v 1",
  orquestradorAId: "a",
  orquestradorBId: "b",
  notas: "",
  criadoEm: "2026-01-01T00:00:00.000Z",
  atualizadoEm: "2026-01-01T00:00:00.000Z",
};

function respostaJson(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
}

describe("api dos vínculos", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("listar devolve só a lista", async () => {
    const buscar = vi.fn(async () => respostaJson({ vinculos: [VINCULO] }));
    vi.stubGlobal("fetch", buscar);

    await expect(api.listarVinculos()).resolves.toEqual([VINCULO]);
    expect(buscar).toHaveBeenCalledWith("/api/vinculos", expect.anything());
  });

  it("criar manda os dois ids num POST e devolve o vínculo", async () => {
    const buscar = vi.fn(async () => respostaJson({ vinculo: VINCULO }, 201));
    vi.stubGlobal("fetch", buscar);

    await expect(api.criarVinculo("a", "b")).resolves.toEqual(VINCULO);
    expect(buscar).toHaveBeenCalledWith(
      "/api/vinculos",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ orquestradorAId: "a", orquestradorBId: "b" }) }),
    );
  });

  it("criar repetido: o erro traz a mensagem e o status 409", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respostaJson({ erro: "Já vinculados." }, 409)));

    const falha = await api.criarVinculo("a", "b").catch((erro: unknown) => erro);

    expect(falha).toBeInstanceOf(ErroDaApi);
    expect(falha).toMatchObject({ message: "Já vinculados.", status: 409 });
  });

  it("desfazer manda DELETE e aceita o 204 sem corpo", async () => {
    const buscar = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", buscar);

    await expect(api.desfazerVinculo("v 1")).resolves.toBeUndefined();
    expect(buscar).toHaveBeenCalledWith("/api/vinculos/v%201", expect.objectContaining({ method: "DELETE" }));
  });

  it("salvar as notas manda um PUT com o texto", async () => {
    const buscar = vi.fn(async () => respostaJson({ vinculo: { ...VINCULO, notas: "oi" } }));
    vi.stubGlobal("fetch", buscar);

    await expect(api.salvarNotasDoVinculo("v 1", "oi")).resolves.toMatchObject({ notas: "oi" });
    expect(buscar).toHaveBeenCalledWith(
      "/api/vinculos/v%201/notas",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ texto: "oi" }) }),
    );
  });

  it("enviar mensagem manda de e texto num POST (202)", async () => {
    const buscar = vi.fn(async () => respostaJson({ enfileirada: true }, 202));
    vi.stubGlobal("fetch", buscar);

    await api.enviarMensagemDoVinculo("v 1", "a", "olá");

    expect(buscar).toHaveBeenCalledWith(
      "/api/vinculos/v%201/mensagens",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ de: "a", texto: "olá" }) }),
    );
  });
});
