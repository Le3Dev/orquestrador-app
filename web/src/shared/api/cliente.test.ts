import { api, argumentosDoContexto, ErroDaApi } from "./cliente";

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

  it("perguntarNoChat manda `anexos` (e não `imagens`) só quando há algum, com o tipo vazio se o arquivo não tem", async () => {
    const buscar = vi.fn<Buscar>(async () => respostaJson({ mensagemId: "m3" }));
    vi.stubGlobal("fetch", buscar);
    const anexos = [
      { nome: "foto.png", tipoDeMidia: "image/png", base64: "cG5n" },
      { nome: "notas.md", tipoDeMidia: "", base64: "IyBub3Rhcw==" },
    ];

    await api.perguntarNoChat("Veja", anexos);
    const corpo = corpoEnviado(buscar);
    expect(corpo).toEqual({ texto: "Veja", anexos });
    expect(corpo).not.toHaveProperty("imagens");

    await api.perguntarNoChat("Veja", anexos, { origem: "escuta" });
    expect(corpoEnviado(buscar)).toEqual({ texto: "Veja", anexos, origem: "escuta" });
  });

  it("enviarMensagem manda `anexos` no corpo, sempre (vazio se não há), e nunca `imagens`", async () => {
    const buscar = vi.fn<Buscar>(async () => respostaJson({ turnoId: "t1" }));
    vi.stubGlobal("fetch", buscar);
    const anexos = [{ nome: "contrato.pdf", tipoDeMidia: "application/pdf", base64: "cGRm" }];

    await api.enviarMensagem("o1", "Resuma", anexos, "planejamento");
    expect(buscar.mock.lastCall?.[0]).toBe("/api/orquestradores/o1/mensagens");
    const corpo = corpoEnviado(buscar);
    expect(corpo).toEqual({ texto: "Resuma", anexos, modo: "planejamento" });
    expect(corpo).not.toHaveProperty("imagens");

    await api.enviarMensagem("o1", "Oi");
    expect(corpoEnviado(buscar)).toEqual({ texto: "Oi", anexos: [], modo: "execucao" });
  });

  it("os endereços dos anexos de documento e de imagem são os mesmos, com o nome do arquivo codificado", () => {
    expect(api.enderecoDoAnexo("o1", "a1.pdf")).toBe("/api/orquestradores/o1/anexos/a1.pdf");
    expect(api.enderecoDoAnexoDoChat("b 2.docx")).toBe("/api/chat/anexos/b%202.docx");
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
    expect(corpoEnviado(buscar)).toEqual({ texto: "olá", anexos: [], modo: "execucao", itensLigados: itens });

    buscar.mockClear();
    await api.enviarMensagem("o1", "olá", [], "execucao", []);
    expect(corpoEnviado(buscar)).toEqual({ texto: "olá", anexos: [], modo: "execucao" });
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

  it("a mensagem e a fila levam `previasAbertas` só quando há alguma", async () => {
    const buscar = vi.spyOn(globalThis, "fetch").mockResolvedValue(respostaJson({ turnoId: "t1" }));
    const previas = ["http://localhost:5173"];

    await api.enviarMensagem("o1", "olá", [], "execucao", [], previas);
    expect(corpoEnviado(buscar)).toEqual({ texto: "olá", anexos: [], modo: "execucao", previasAbertas: previas });

    buscar.mockClear();
    await api.enviarMensagem("o1", "olá", [], "execucao", itens, []);
    expect(corpoEnviado(buscar)).toEqual({ texto: "olá", anexos: [], modo: "execucao", itensLigados: itens });

    buscar.mockClear();
    await api.enfileirarPedido("o1", "depois", "execucao", itens, previas);
    expect(corpoEnviado(buscar)).toEqual({ texto: "depois", modo: "execucao", itensLigados: itens, previasAbertas: previas });
  });

  it("argumentosDoContexto monta só o que tem conteúdo", () => {
    expect(argumentosDoContexto([], [])).toEqual([]);
    expect(argumentosDoContexto(itens, [])).toEqual([itens]);
    expect(argumentosDoContexto([], ["http://localhost:5173"])).toEqual([[], ["http://localhost:5173"]]);
  });
});

describe("plugins do Claude Code", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const PLUGIN = {
    id: "apollo-skills@claude-plugins-official",
    nome: "apollo-skills",
    marketplace: "claude-plugins-official",
    oficial: true,
    versao: "0.3.1",
    ligado: false,
    instaladoEm: null,
    inventario: { skills: [], subagentes: 0, servidoresMcp: 1, hooks: 1, verificado: true, temBin: false },
  };

  it("lerCatalogoDePlugins sem consulta chama o catálogo puro, sem parâmetros", async () => {
    const buscar = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      respostaJson({ plugins: [], total: 0, totais: { oficial: 317, aberto: 3662 } }),
    );

    await expect(api.lerCatalogoDePlugins()).resolves.toEqual({ plugins: [], total: 0, totais: { oficial: 317, aberto: 3662 } });

    expect(buscar.mock.calls[0]?.[0]).toBe("/api/plugins/catalogo");
  });

  it("lerCatalogoDePlugins leva a busca, a origem, o limite e o deslocamento, e omite o que está vazio ou zerado", async () => {
    const buscar = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      respostaJson({ plugins: [], total: 0, totais: { oficial: 0, aberto: 0 } }),
    );

    await api.lerCatalogoDePlugins({ busca: "banco de dados", origem: "aberto", limite: 20, deslocamento: 40 });
    const url = new URL(String(buscar.mock.calls[0]?.[0]), "http://app.local");
    expect(url.pathname).toBe("/api/plugins/catalogo");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      busca: "banco de dados",
      origem: "aberto",
      limite: "20",
      deslocamento: "40",
    });

    await api.lerCatalogoDePlugins({ busca: "", origem: "oficial", deslocamento: 0 });
    expect(buscar.mock.calls[1]?.[0]).toBe("/api/plugins/catalogo?origem=oficial");
  });

  it("o erro do catálogo traz a mensagem pronta e o status (503 sem internet)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(respostaJson({ erro: "Sem conexão com a internet." }, 503));

    const falha = await api.lerCatalogoDePlugins().catch((erro: unknown) => erro);

    expect(falha).toBeInstanceOf(ErroDaApi);
    expect(falha).toMatchObject({ message: "Sem conexão com a internet.", status: 503 });
  });

  it("lerPluginsInstalados lê a lista", async () => {
    const buscar = vi.spyOn(globalThis, "fetch").mockResolvedValue(respostaJson({ plugins: [PLUGIN] }));

    await expect(api.lerPluginsInstalados()).resolves.toEqual({ plugins: [PLUGIN] });

    expect(buscar.mock.calls[0]?.[0]).toBe("/api/plugins/instalados");
  });

  it("instalarPlugin manda o id no corpo e devolve se precisa de confirmação", async () => {
    const buscar = vi.spyOn(globalThis, "fetch").mockResolvedValue(respostaJson({ plugin: PLUGIN, precisaConfirmar: true }));

    await expect(api.instalarPlugin(PLUGIN.id)).resolves.toEqual({ plugin: PLUGIN, precisaConfirmar: true });

    expect(buscar.mock.calls[0]?.[0]).toBe("/api/plugins/instalar");
    expect(buscar.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
    expect(JSON.parse(String(buscar.mock.calls[0]?.[1]?.body))).toEqual({ id: "apollo-skills@claude-plugins-official" });
  });

  it("ligar, desligar e remover codificam o id (que tem @) na URL", async () => {
    const buscar = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, opcoes) =>
      opcoes?.method === "DELETE" ? new Response(null, { status: 204 }) : respostaJson({ plugin: PLUGIN }),
    );

    await api.ligarPlugin(PLUGIN.id);
    await api.desligarPlugin(PLUGIN.id);
    await expect(api.removerPlugin(PLUGIN.id)).resolves.toBeNull();

    expect(buscar.mock.calls.map(([url, opcoes]) => [url, opcoes?.method])).toEqual([
      ["/api/plugins/apollo-skills%40claude-plugins-official/ligar", "POST"],
      ["/api/plugins/apollo-skills%40claude-plugins-official/desligar", "POST"],
      ["/api/plugins/apollo-skills%40claude-plugins-official", "DELETE"],
    ]);
  });

  it("a instalação recusada traz o status do servidor (409, 502, 503, 504)", async () => {
    for (const status of [409, 502, 503, 504]) {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(respostaJson({ erro: `falha ${status}` }, status));
      const falha = await api.instalarPlugin("x@y").catch((erro: unknown) => erro);
      expect(falha).toMatchObject({ message: `falha ${status}`, status });
    }
  });
});
