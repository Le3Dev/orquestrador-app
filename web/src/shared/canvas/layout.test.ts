import {
  ALTURA_DA_NOTA_MINIMIZADA,
  interpretarBixinhosLimpos,
  interpretarLayout,
  lerBixinhosLimpos,
  lerLayout,
  organizarComNotas,
  organizarEmGrade,
  posicaoParaNovoTerminal,
  posicoesDosBixinhos,
  salvarBixinhosLimpos,
  salvarLayout,
  TAMANHO_DO_BIXINHO,
} from "./layout";
import {
  ehNota,
  idDoNoDaNota,
  layoutDosNos,
  minimizarOuRestaurar,
  type NoNota,
  nosDoLayout,
  novaNota,
  novoTerminal,
  sincronizarNotas,
} from "./nos";

describe("posicoesDosBixinhos", () => {
  it("centraliza a fileira abaixo do terminal", () => {
    const [unico] = posicoesDosBixinhos(1, 600, 500);

    expect(unico?.x).toBe(300 - TAMANHO_DO_BIXINHO.largura / 2);
    expect(unico?.y).toBeGreaterThan(500);
  });

  it("espalha em leque e quebra em fileiras de cinco", () => {
    const posicoes = posicoesDosBixinhos(7, 600, 500);
    const primeiraFileira = posicoes.slice(0, 5);
    const segundaFileira = posicoes.slice(5);

    expect(new Set(primeiraFileira.map((posicao) => posicao.y)).size).toBe(1);
    expect(segundaFileira.every((posicao) => posicao.y > (primeiraFileira[0]?.y ?? 0))).toBe(true);
    // A fileira de cinco fica centralizada no meio do terminal.
    const centro = ((primeiraFileira[0]?.x ?? 0) + (primeiraFileira[4]?.x ?? 0) + TAMANHO_DO_BIXINHO.largura) / 2;
    expect(centro).toBeCloseTo(300);
  });
});

describe("posicaoParaNovoTerminal", () => {
  const tamanho = { largura: 600, altura: 500 };

  it("centraliza no ponto pedido", () => {
    expect(posicaoParaNovoTerminal({ x: 1000, y: 800 }, tamanho, [])).toEqual({ x: 700, y: 550 });
  });

  it("desloca em cascata quando já há terminal no mesmo lugar", () => {
    const primeiro = posicaoParaNovoTerminal({ x: 1000, y: 800 }, tamanho, []);
    const segundo = posicaoParaNovoTerminal({ x: 1000, y: 800 }, tamanho, [primeiro]);
    const terceiro = posicaoParaNovoTerminal({ x: 1000, y: 800 }, tamanho, [primeiro, segundo]);

    expect(segundo).not.toEqual(primeiro);
    expect(terceiro).not.toEqual(segundo);
    expect(terceiro.x).toBeGreaterThan(segundo.x);
  });
});

describe("organizarEmGrade", () => {
  it("põe os terminais lado a lado, sem sobrepor, quebrando a cada três", () => {
    const terminais = ["a", "b", "c", "d"].map((id) => ({ id, largura: 600, altura: 500 }));
    const posicoes = organizarEmGrade(terminais);

    expect(posicoes.a).toEqual({ x: 0, y: 0 });
    expect(posicoes.b?.x).toBeGreaterThanOrEqual(600);
    expect(posicoes.c?.x).toBeGreaterThan(posicoes.b?.x ?? 0);
    expect(posicoes.d).toEqual({ x: 0, y: expect.any(Number) });
    expect(posicoes.d?.y).toBeGreaterThan(500);
  });
});

describe("interpretarLayout", () => {
  it("lê um layout válido", () => {
    const texto = JSON.stringify({
      terminais: { o1: { x: 10, y: 20, largura: 600, altura: 500 } },
      viewport: { x: 1, y: 2, zoom: 0.8 },
    });

    expect(interpretarLayout(texto)).toEqual({
      terminais: { o1: { x: 10, y: 20, largura: 600, altura: 500 } },
      notas: {},
      viewport: { x: 1, y: 2, zoom: 0.8 },
    });
  });

  it.each([null, "", "não é json", "[]", JSON.stringify({ terminais: 5, viewport: { zoom: 0 } })])(
    "não quebra com conteúdo inválido: %s",
    (texto) => {
      expect(interpretarLayout(texto)).toEqual({ terminais: {}, notas: {}, viewport: null });
    },
  );

  it("descarta só os terminais corrompidos", () => {
    const texto = JSON.stringify({ terminais: { bom: { x: 0, y: 0, largura: 1, altura: 1 }, ruim: { x: "a" } } });

    expect(Object.keys(interpretarLayout(texto).terminais)).toEqual(["bom"]);
  });
});

describe("notas no layout", () => {
  afterEach(() => localStorage.clear());

  function notaDoCanvas(nos: ReturnType<typeof nosDoLayout>, notaId: string): NoNota | undefined {
    return nos.filter(ehNota).find((no) => no.id === idDoNoDaNota(notaId));
  }

  it("grava e lê de volta a posição, o tamanho e se a nota está minimizada", () => {
    const aberta = novaNota("n1", { x: 10.4, y: 20.6 }, 340, 300);
    const minimizada = minimizarOuRestaurar(novaNota("n2", { x: 400, y: 0 }, 320, 260));

    salvarLayout(layoutDosNos([novoTerminal("o1", { x: 0, y: 0 }, 600, 500), aberta, minimizada], null));
    const lido = lerLayout();

    expect(lido.terminais.o1).toEqual({ x: 0, y: 0, largura: 600, altura: 500 });
    // A altura gravada é sempre a da nota aberta, mesmo minimizada.
    expect(lido.notas).toEqual({
      n1: { x: 10, y: 21, largura: 340, altura: 300, minimizada: false },
      n2: { x: 400, y: 0, largura: 320, altura: 260, minimizada: true },
    });

    // De volta ao canvas: a minimizada tem só a barra, e restaurar volta ao tamanho de antes.
    const nos = nosDoLayout(lido);
    const n2 = notaDoCanvas(nos, "n2");
    expect(n2?.height).toBe(ALTURA_DA_NOTA_MINIMIZADA);
    expect(n2 === undefined ? null : minimizarOuRestaurar(n2).height).toBe(260);
    expect(notaDoCanvas(nos, "n1")).toMatchObject({ position: { x: 10, y: 21 }, width: 340, height: 300 });
  });

  it("um layout antigo, sem notas, continua válido", () => {
    const antigo = JSON.stringify({
      terminais: { o1: { x: 10, y: 20, largura: 600, altura: 500 } },
      viewport: { x: 1, y: 2, zoom: 0.8 },
    });

    expect(interpretarLayout(antigo)).toEqual({
      terminais: { o1: { x: 10, y: 20, largura: 600, altura: 500 } },
      notas: {},
      viewport: { x: 1, y: 2, zoom: 0.8 },
    });
  });

  it("descarta só as notas corrompidas; sem `minimizada`, a nota fica aberta", () => {
    const texto = JSON.stringify({
      terminais: {},
      notas: { boa: { x: 0, y: 0, largura: 300, altura: 200 }, ruim: { x: 0, y: "a" } },
    });

    expect(interpretarLayout(texto).notas).toEqual({ boa: { x: 0, y: 0, largura: 300, altura: 200, minimizada: false } });
  });

  it("a nota que não existe mais no servidor sai do layout", () => {
    salvarLayout(layoutDosNos([novaNota("n1", { x: 0, y: 0 }), novaNota("apagada", { x: 50, y: 50 })], null));

    const nos = sincronizarNotas(nosDoLayout(lerLayout()), ["n1"], new Set(), () => ({ x: 0, y: 0 }));
    salvarLayout(layoutDosNos(nos, null));

    expect(Object.keys(lerLayout().notas)).toEqual(["n1"]);
  });
});

describe("organizarComNotas", () => {
  const terminais = ["a", "b"].map((id) => ({ id, largura: 600, altura: 500 }));

  it("não mexe na grade dos terminais e põe as notas em coluna à direita dela", () => {
    const notas = [
      { id: "n1", largura: 320, altura: 280 },
      { id: "n2", largura: 320, altura: ALTURA_DA_NOTA_MINIMIZADA },
    ];
    const posicoes = organizarComNotas(terminais, notas);
    const grade = organizarEmGrade(terminais);

    expect(posicoes.a).toEqual(grade.a);
    expect(posicoes.b).toEqual(grade.b);
    expect(posicoes.n1?.x).toBeGreaterThan((grade.b?.x ?? 0) + 600);
    expect(posicoes.n2).toEqual({ x: posicoes.n1?.x, y: 280 + 24 });
  });

  it("sem terminais, as notas começam no canto e quebram em colunas de quatro", () => {
    const notas = ["n1", "n2", "n3", "n4", "n5"].map((id) => ({ id, largura: 300, altura: 200 }));
    const posicoes = organizarComNotas([], notas);

    expect(posicoes.n1).toEqual({ x: 0, y: 0 });
    expect(posicoes.n4?.x).toBe(0);
    expect(posicoes.n5).toEqual({ x: 300 + 24, y: 0 });
  });
});

describe("bixinhos limpos no armazenamento", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("salva e lê de volta, por orquestrador, sobrevivendo a um F5", () => {
    salvarBixinhosLimpos(new Map([["o1", { turnoId: "t1", subagentes: ["s1", "s2"] }]]));

    expect(lerBixinhosLimpos()).toEqual(new Map([["o1", { turnoId: "t1", subagentes: ["s1", "s2"] }]]));
  });

  it.each([null, "", "não é json", "[]", "5", JSON.stringify({ o1: { turnoId: 1, subagentes: "s1" } })])(
    "ignora conteúdo corrompido: %s",
    (texto) => {
      expect(interpretarBixinhosLimpos(texto)).toEqual(new Map());
    },
  );

  it("descarta só os orquestradores com limpeza corrompida", () => {
    const texto = JSON.stringify({ bom: { turnoId: "t1", subagentes: ["s1"] }, ruim: { turnoId: "t1", subagentes: [1] } });

    expect([...interpretarBixinhosLimpos(texto).keys()]).toEqual(["bom"]);
  });

  it("não quebra a tela sem armazenamento", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("localStorage bloqueado");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("cota excedida");
    });

    expect(lerBixinhosLimpos()).toEqual(new Map());
    expect(() => salvarBixinhosLimpos(new Map([["o1", { turnoId: "t1", subagentes: ["s1"] }]]))).not.toThrow();
  });
});
