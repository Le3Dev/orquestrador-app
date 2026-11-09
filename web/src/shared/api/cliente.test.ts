import { api, ErroDaApi } from "./cliente";

type Buscar = (url: string, opcoes?: RequestInit) => Promise<Response>;

function respostaJson(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
}

/** O corpo JSON da última chamada ao `fetch` simulado. */
function corpoEnviado(buscar: ReturnType<typeof vi.fn<Buscar>>): unknown {
  const opcoes = buscar.mock.lastCall?.[1];
  return JSON.parse(String(opcoes?.body));
}

describe("api", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("perguntarNoChat sem origem: o corpo não leva o campo origem", async () => {
    const buscar = vi.fn<Buscar>(async () => respostaJson({ mensagemId: "m1" }));
    vi.stubGlobal("fetch", buscar);

    await expect(api.perguntarNoChat("Oi, Claude")).resolves.toEqual({ mensagemId: "m1" });

    expect(buscar).toHaveBeenCalledWith("/api/chat/mensagens", expect.objectContaining({ method: "POST" }));
    const corpo = corpoEnviado(buscar);
    expect(corpo).toEqual({ texto: "Oi, Claude" });
    expect(corpo).not.toHaveProperty("origem");
  });

  it("perguntarNoChat com origem da escuta: o corpo leva a origem", async () => {
    const buscar = vi.fn<Buscar>(async () => respostaJson({ mensagemId: "m2" }));
    vi.stubGlobal("fetch", buscar);

    await api.perguntarNoChat("Como inverter a lista?", [], { origem: "escuta" });

    expect(corpoEnviado(buscar)).toEqual({ texto: "Como inverter a lista?", origem: "escuta" });
  });

  it("classificarNaEscuta manda o trecho e o contexto e devolve a classificação", async () => {
    const buscar = vi.fn<Buscar>(async () =>
      respostaJson({ ehPergunta: true, pergunta: "Como inverter uma lista ligada?" }),
    );
    vi.stubGlobal("fetch", buscar);

    await expect(
      api.classificarNaEscuta({ trecho: "como inverte a lista ligada", contexto: "falando de listas" }),
    ).resolves.toEqual({ ehPergunta: true, pergunta: "Como inverter uma lista ligada?" });

    expect(buscar).toHaveBeenCalledWith("/api/escuta/classificar", expect.objectContaining({ method: "POST" }));
    expect(corpoEnviado(buscar)).toEqual({ trecho: "como inverte a lista ligada", contexto: "falando de listas" });
  });

  it("classificarNaEscuta com 502: vira ErroDaApi com o status e a mensagem do servidor", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<Buscar>(async () => respostaJson({ erro: "O Claude Code não respondeu a tempo." }, 502)),
    );

    const falha = await api.classificarNaEscuta({ trecho: "e agora?" }).catch((erro: unknown) => erro);

    expect(falha).toBeInstanceOf(ErroDaApi);
    expect(falha).toMatchObject({ message: "O Claude Code não respondeu a tempo.", status: 502 });
  });
});

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

describe("itens ligados no pedido", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const itens = [{ tipo: "nota" as const, titulo: "Ideias", conteudo: "comprar café" }];

  function corpoEnviado(buscar: { mock: { calls: unknown[][] } }): unknown {
    const opcoes = buscar.mock.calls[0]?.[1] as RequestInit | undefined;
    return JSON.parse(String(opcoes?.body));
  }

  it("a mensagem leva `itensLigados` só quando há algum", async () => {
    const buscar = vi.spyOn(globalThis, "fetch").mockResolvedValue(respostaJson({ turnoId: "t1" }));

    await api.enviarMensagem("o1", "olá", [], "execucao", itens);
    expect(corpoEnviado(buscar)).toEqual({ texto: "olá", imagens: [], modo: "execucao", itensLigados: itens });

    buscar.mockClear();
    await api.enviarMensagem("o1", "olá", [], "execucao", []);
    expect(corpoEnviado(buscar)).toEqual({ texto: "olá", imagens: [], modo: "execucao" });
  });

  it("o pedido na fila também", async () => {
    const buscar = vi.spyOn(globalThis, "fetch").mockResolvedValue(respostaJson({ pedidoId: "p1" }));

    await api.enfileirarPedido("o1", "depois", "planejamento", itens);
    expect(buscar.mock.calls[0]?.[0]).toBe("/api/orquestradores/o1/fila");
    expect(corpoEnviado(buscar)).toEqual({ texto: "depois", modo: "planejamento", itensLigados: itens });

    buscar.mockClear();
    await api.enfileirarPedido("o1", "depois");
    expect(corpoEnviado(buscar)).toEqual({ texto: "depois", modo: "execucao" });
  });
});
