import {
  ALTURA_DA_NOTA_MINIMIZADA,
  interpretarBixinhosLimpos,
  interpretarLayout,
  lerBixinhosLimpos,
  lerLayout,
  MARGEM_DOS_BIXINHOS,
  organizarComNotas,
  organizarEmGrade,
  type Ponto,
  posicaoAoLado,
  posicaoLivrePerto,
  posicaoParaNovoTerminal,
  posicoesDosBixinhos,
  posicoesLivresDosBixinhos,
  type Retangulo,
  salvarBixinhosLimpos,
  salvarLayout,
  sobrepoe,
  TAMANHO_DA_PREVIA,
  TAMANHO_DO_BIXINHO,
  TAMANHO_DO_SHELL,
  TAMANHO_DO_TERMINAL,
  TAMANHO_MINIMO_DO_TERMINAL,
  tamanhoNaEscalaDaLetra,
} from "./layout";
import {
  ehNota,
  ehPrevia,
  ehShell,
  ehTerminal,
  idDoNoDaNota,
  idDoNoDaPrevia,
  idDoNoDoShell,
  layoutDosNos,
  minimizarOuRestaurar,
  type NoNota,
  nosDoLayout,
  novaNota,
  novaPrevia,
  novoShell,
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

describe("posicoesLivresDosBixinhos", () => {
  // Na origem: as posições relativas ao terminal já são as absolutas.
  const terminal: Retangulo = { x: 0, y: 0, largura: 600, altura: 500 };
  const padrao = posicoesDosBixinhos(3, terminal.largura, terminal.altura);

  function bixinhosEm(posicoes: readonly Ponto[]): Retangulo[] {
    return posicoes.map((posicao) => ({ ...posicao, ...TAMANHO_DO_BIXINHO }));
  }

  function livres(posicoes: readonly Ponto[], obstaculos: readonly Retangulo[]): boolean {
    return bixinhosEm(posicoes).every((bixinho) => obstaculos.every((obstaculo) => !sobrepoe(bixinho, obstaculo)));
  }

  it("sem obstáculos, ou sem conflito, é exatamente o padrão abaixo do terminal", () => {
    expect(posicoesLivresDosBixinhos(7, terminal, [])).toEqual(posicoesDosBixinhos(7, 600, 500));
    expect(posicoesLivresDosBixinhos(7, terminal, [{ x: 5000, y: 5000, largura: 600, altura: 500 }])).toEqual(
      posicoesDosBixinhos(7, 600, 500),
    );
  });

  it("com um terminal logo abaixo, vai para a direita, no mesmo arranjo", () => {
    const abaixo: Retangulo = { x: 0, y: 600, largura: 600, altura: 500 };

    const posicoes = posicoesLivresDosBixinhos(3, terminal, [abaixo]);

    expect(livres(posicoes, [abaixo, terminal])).toBe(true);
    expect(Math.min(...posicoes.map((posicao) => posicao.x))).toBeGreaterThanOrEqual(terminal.largura);
    // O mesmo leque: só deslocado.
    const deslocamento = { x: (posicoes[0]?.x ?? 0) - (padrao[0]?.x ?? 0), y: (posicoes[0]?.y ?? 0) - (padrao[0]?.y ?? 0) };
    expect(posicoes).toEqual(padrao.map((posicao) => ({ x: posicao.x + deslocamento.x, y: posicao.y + deslocamento.y })));
  });

  it("com a direita e embaixo ocupados, vai para a esquerda", () => {
    const obstaculos: Retangulo[] = [
      { x: 0, y: 600, largura: 600, altura: 500 },
      { x: 650, y: -200, largura: 600, altura: 1200 },
    ];

    const posicoes = posicoesLivresDosBixinhos(3, terminal, obstaculos);

    expect(livres(posicoes, [...obstaculos, terminal])).toBe(true);
    expect(Math.max(...posicoes.map((posicao) => posicao.x + TAMANHO_DO_BIXINHO.largura))).toBeLessThanOrEqual(0);
  });

  it("com embaixo e os dois lados ocupados, vai para cima", () => {
    const obstaculos: Retangulo[] = [
      { x: 0, y: 600, largura: 600, altura: 500 },
      { x: 650, y: -200, largura: 600, altura: 1200 },
      { x: -1250, y: -200, largura: 1200, altura: 1200 },
    ];

    const posicoes = posicoesLivresDosBixinhos(3, terminal, obstaculos);

    expect(livres(posicoes, [...obstaculos, terminal])).toBe(true);
    expect(Math.max(...posicoes.map((posicao) => posicao.y + TAMANHO_DO_BIXINHO.altura))).toBeLessThanOrEqual(0);
  });

  it("com tudo ocupado ao redor, desce até ficar livre, centralizado abaixo do terminal", () => {
    const obstaculos: Retangulo[] = [
      { x: 0, y: 600, largura: 600, altura: 500 },
      { x: 650, y: -1000, largura: 600, altura: 2000 },
      { x: -1250, y: -1000, largura: 1200, altura: 2000 },
      { x: -100, y: -1000, largura: 800, altura: 900 },
    ];

    const posicoes = posicoesLivresDosBixinhos(3, terminal, obstaculos);

    expect(livres(posicoes, [...obstaculos, terminal])).toBe(true);
    expect(posicoes.map((posicao) => posicao.x)).toEqual(padrao.map((posicao) => posicao.x));
    expect(Math.min(...posicoes.map((posicao) => posicao.y))).toBe(600 + 500 + MARGEM_DOS_BIXINHOS);
  });

  it("respeita a folga: um obstáculo a menos da margem do grupo já o tira do padrão", () => {
    const baseDoPadrao = Math.max(...padrao.map((posicao) => posicao.y)) + TAMANHO_DO_BIXINHO.altura;
    const colado: Retangulo = { x: 0, y: baseDoPadrao + MARGEM_DOS_BIXINHOS - 1, largura: 600, altura: 100 };
    const naMargem: Retangulo = { ...colado, y: baseDoPadrao + MARGEM_DOS_BIXINHOS };

    expect(posicoesLivresDosBixinhos(3, terminal, [colado])).not.toEqual(padrao);
    expect(posicoesLivresDosBixinhos(3, terminal, [naMargem])).toEqual(padrao);
  });

  it("funciona com o terminal em qualquer lugar do canvas (posições sempre relativas a ele)", () => {
    const longe: Retangulo = { x: 3000, y: -2000, largura: 600, altura: 500 };
    const abaixo: Retangulo = { x: 3000, y: -1400, largura: 600, altura: 500 };

    const naOrigem = posicoesLivresDosBixinhos(3, terminal, [{ x: 0, y: 600, largura: 600, altura: 500 }]);

    expect(posicoesLivresDosBixinhos(3, longe, [abaixo])).toEqual(naOrigem);
    expect(naOrigem).not.toEqual(padrao);
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
      artefatos: {},
      previas: {},
      shells: {},
      viewport: { x: 1, y: 2, zoom: 0.8 },
    });
  });

  it.each([null, "", "não é json", "[]", JSON.stringify({ terminais: 5, viewport: { zoom: 0 } })])(
    "não quebra com conteúdo inválido: %s",
    (texto) => {
      expect(interpretarLayout(texto)).toEqual({
        terminais: {},
        notas: {},
        artefatos: {},
        previas: {},
        shells: {},
        viewport: null,
      });
    },
  );

  it("descarta só os terminais corrompidos", () => {
    const texto = JSON.stringify({ terminais: { bom: { x: 0, y: 0, largura: 1, altura: 1 }, ruim: { x: "a" } } });

    expect(Object.keys(interpretarLayout(texto).terminais)).toEqual(["bom"]);
  });
});

describe("tamanho da letra no layout", () => {
  afterEach(() => localStorage.clear());

  const retangulo = { x: 10, y: 20, largura: 600, altura: 500 };

  it("lê o tamanho da letra gravado no terminal", () => {
    const texto = JSON.stringify({ terminais: { o1: { ...retangulo, escalaDaLetra: 1.3 } } });

    expect(interpretarLayout(texto).terminais.o1).toEqual({ ...retangulo, escalaDaLetra: 1.3 });
  });

  it("um layout antigo, sem o campo, vale como a letra normal", () => {
    const texto = JSON.stringify({ terminais: { o1: retangulo } });

    expect(interpretarLayout(texto).terminais.o1).toEqual(retangulo);
    expect(nosDoLayout(interpretarLayout(texto)).filter(ehTerminal)[0]?.data).toEqual({ orquestradorId: "o1" });
  });

  it.each([2, 0, -1, "1.3", null, 1.2])("descarta um tamanho fora das opções (%s), mantendo o terminal", (escala) => {
    const texto = JSON.stringify({ terminais: { o1: { ...retangulo, escalaDaLetra: escala } } });

    expect(interpretarLayout(texto).terminais.o1).toEqual(retangulo);
  });

  it("grava e lê de volta; a letra normal fica sem o campo", () => {
    salvarLayout(
      layoutDosNos(
        [novoTerminal("grande", { x: 0, y: 0 }, 690, 598, 1.15), novoTerminal("normal", { x: 800, y: 0 }, 600, 520, 1)],
        null,
      ),
    );
    const lido = lerLayout();

    expect(lido.terminais.grande).toEqual({ x: 0, y: 0, largura: 690, altura: 598, escalaDaLetra: 1.15 });
    expect(lido.terminais.normal).toEqual({ x: 800, y: 0, largura: 600, altura: 520 });
    expect(nosDoLayout(lido).filter(ehTerminal).find((no) => no.id === "grande")?.data.escalaDaLetra).toBe(1.15);
  });
});

describe("terminal minimizado no layout", () => {
  afterEach(() => localStorage.clear());

  const retangulo = { x: 10, y: 20, largura: 600, altura: 500 };

  it("grava e lê de volta o terminal minimizado, com a altura de aberto; o aberto fica sem o campo", () => {
    const minimizado = minimizarOuRestaurar(novoTerminal("o1", { x: 0, y: 0 }, 600, 500));
    expect(minimizado.height).toBe(ALTURA_DA_NOTA_MINIMIZADA);

    salvarLayout(layoutDosNos([minimizado, novoTerminal("o2", { x: 800, y: 0 }, 640, 460)], null));
    const lido = lerLayout();

    expect(lido.terminais.o1).toEqual({ x: 0, y: 0, largura: 600, altura: 500, minimizada: true });
    expect(lido.terminais.o2).toEqual({ x: 800, y: 0, largura: 640, altura: 460 });

    // De volta ao canvas: só a barra, e restaurar volta à altura de antes.
    const o1 = nosDoLayout(lido).filter(ehTerminal).find((no) => no.id === "o1");
    expect(o1?.height).toBe(ALTURA_DA_NOTA_MINIMIZADA);
    expect(o1?.data).toEqual({ orquestradorId: "o1", minimizada: true, alturaAberta: 500 });
    const restaurado = o1 === undefined ? null : minimizarOuRestaurar(o1);
    expect(restaurado?.height).toBe(500);
    expect(restaurado === null ? null : layoutDosNos([restaurado], null).terminais.o1).toEqual({
      x: 0,
      y: 0,
      largura: 600,
      altura: 500,
    });
  });

  it("um layout antigo, sem o campo, vale como aberto", () => {
    const texto = JSON.stringify({ terminais: { o1: retangulo } });

    expect(interpretarLayout(texto).terminais.o1).toEqual(retangulo);
    const no = nosDoLayout(interpretarLayout(texto)).filter(ehTerminal)[0];
    expect(no?.height).toBe(500);
    expect(no?.data).toEqual({ orquestradorId: "o1" });
  });

  it.each([false, "sim", 1, null])("descarta um valor que não é true (%s), mantendo o terminal aberto", (valor) => {
    const texto = JSON.stringify({ terminais: { o1: { ...retangulo, minimizada: valor } } });

    expect(interpretarLayout(texto).terminais.o1).toEqual(retangulo);
  });

  it("guarda junto com o tamanho da letra", () => {
    const texto = JSON.stringify({ terminais: { o1: { ...retangulo, escalaDaLetra: 1.15, minimizada: true } } });

    expect(interpretarLayout(texto).terminais.o1).toEqual({ ...retangulo, escalaDaLetra: 1.15, minimizada: true });
    expect(nosDoLayout(interpretarLayout(texto)).filter(ehTerminal)[0]?.data).toEqual({
      orquestradorId: "o1",
      escalaDaLetra: 1.15,
      minimizada: true,
      alturaAberta: 500,
    });
  });
});

describe("tamanhoNaEscalaDaLetra", () => {
  const padrao = TAMANHO_DO_TERMINAL;
  const minimo = TAMANHO_MINIMO_DO_TERMINAL;

  it("cresce e diminui na mesma proporção da letra", () => {
    expect(tamanhoNaEscalaDaLetra({ largura: 600, altura: 520 }, 1, 1.15, padrao, minimo)).toEqual({
      largura: 690,
      altura: 598,
    });
    expect(tamanhoNaEscalaDaLetra({ largura: 690, altura: 598 }, 1.15, 1, padrao, minimo)).toEqual({
      largura: 600,
      altura: 520,
    });
  });

  it("não passa do padrão na maior letra, nem encolhe um cartão já maior que isso", () => {
    expect(tamanhoNaEscalaDaLetra({ largura: 700, altura: 600 }, 1, 1.3, padrao, minimo)).toEqual({
      largura: Math.round(padrao.largura * 1.3),
      altura: Math.round(padrao.altura * 1.3),
    });
    expect(tamanhoNaEscalaDaLetra({ largura: 1200, altura: 900 }, 1, 1.15, padrao, minimo)).toEqual({
      largura: 1200,
      altura: 900,
    });
  });

  it("ao diminuir, não fica menor que o mínimo", () => {
    expect(tamanhoNaEscalaDaLetra({ largura: 430, altura: 310 }, 1.3, 1, padrao, minimo)).toEqual(minimo);
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
      artefatos: {},
      previas: {},
      shells: {},
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

describe("prévias no layout", () => {
  afterEach(() => localStorage.clear());

  it("grava e lê de volta posição, tamanho, minimizada, endereço e orquestrador", () => {
    const daBarra = novaPrevia("p1", { x: 10.4, y: 20.6 }, { url: "", orquestradorId: null }, 700, 500);
    const doTerminal = minimizarOuRestaurar(
      novaPrevia("p2", { x: 800, y: 0 }, { url: "http://localhost:5173", orquestradorId: "o1" }),
    );

    salvarLayout(layoutDosNos([novoTerminal("o1", { x: 0, y: 0 }, 600, 500), daBarra, doTerminal], null));
    const lido = lerLayout();

    expect(lido.previas).toEqual({
      p1: { x: 10, y: 21, largura: 700, altura: 500, minimizada: false, url: "", orquestradorId: null },
      p2: {
        x: 800,
        y: 0,
        largura: TAMANHO_DA_PREVIA.largura,
        altura: TAMANHO_DA_PREVIA.altura,
        minimizada: true,
        url: "http://localhost:5173",
        orquestradorId: "o1",
      },
    });

    // De volta ao canvas: o endereço vai no data do nó, e a minimizada tem só a barra.
    const p2 = nosDoLayout(lido).filter(ehPrevia).find((no) => no.id === idDoNoDaPrevia("p2"));
    expect(p2?.data).toMatchObject({ previaId: "p2", url: "http://localhost:5173", orquestradorId: "o1", minimizada: true });
    expect(p2?.height).toBe(ALTURA_DA_NOTA_MINIMIZADA);
    expect(p2 === undefined ? null : minimizarOuRestaurar(p2).height).toBe(TAMANHO_DA_PREVIA.altura);
  });

  it("um layout antigo, sem prévias, vale como sem prévias", () => {
    const antigo = JSON.stringify({ terminais: {}, notas: { n1: { x: 0, y: 0, largura: 300, altura: 200 } } });

    expect(interpretarLayout(antigo).previas).toEqual({});
  });

  it("descarta só as prévias corrompidas e limpa endereço e orquestrador inválidos", () => {
    const texto = JSON.stringify({
      previas: {
        boa: { x: 0, y: 0, largura: 720, altura: 520, url: "javascript:alert(1)", orquestradorId: 5 },
        ruim: { x: 0, y: "a", largura: 720, altura: 520 },
      },
    });

    expect(interpretarLayout(texto).previas).toEqual({
      boa: { x: 0, y: 0, largura: 720, altura: 520, minimizada: false, url: "", orquestradorId: null },
    });
  });
});

describe("posicaoAoLado", () => {
  const terminal: Retangulo = { x: 0, y: 0, largura: 600, altura: 500 };
  const tamanho = { largura: 720, altura: 520 };

  it("abre à direita do terminal, com o topo alinhado", () => {
    const posicao = posicaoAoLado(terminal, tamanho, []);

    expect(posicao.y).toBe(0);
    expect(posicao.x).toBeGreaterThan(600);
  });

  it("com algo à direita, vai para a esquerda sem sobrepor", () => {
    const aDireita: Retangulo = { x: 650, y: 0, largura: 600, altura: 500 };
    const posicao = posicaoAoLado(terminal, tamanho, [aDireita]);

    expect(posicao.x + tamanho.largura).toBeLessThanOrEqual(0);
    expect(sobrepoe({ ...posicao, ...tamanho }, aDireita)).toBe(false);
  });

  it("sem lugar livre, fica à direita mesmo", () => {
    const tudo: Retangulo = { x: -5000, y: -5000, largura: 10_000, altura: 10_000 };

    expect(posicaoAoLado(terminal, tamanho, [tudo])).toEqual(posicaoAoLado(terminal, tamanho, []));
  });
});

describe("posicaoLivrePerto", () => {
  const tamanho = TAMANHO_DO_TERMINAL;
  const inicio: Ponto = { x: 1000, y: 500 };
  const passoX = tamanho.largura + 40;
  const livreDe = (posicao: Ponto, obstaculos: readonly Retangulo[]) =>
    obstaculos.every((obstaculo) => !sobrepoe({ ...posicao, ...tamanho }, obstaculo));

  it("sem nada no canvas, abre no lugar de partida", () => {
    expect(posicaoLivrePerto(inicio, tamanho, [])).toEqual(inicio);
  });

  it("com algo longe, também abre no lugar de partida", () => {
    expect(posicaoLivrePerto(inicio, tamanho, [{ x: -3000, y: -3000, largura: 400, altura: 300 }])).toEqual(inicio);
  });

  it("com um terminal ocupando a vista, vai para a direita, sem cobri-lo", () => {
    const naVista: Retangulo = { x: 1000, y: 500, ...tamanho };
    const posicao = posicaoLivrePerto(inicio, tamanho, [naVista]);

    expect(posicao).toEqual({ x: inicio.x + passoX, y: inicio.y });
    expect(livreDe(posicao, [naVista])).toBe(true);
  });

  it("encostar conta como ocupado: a folga entre as janelas vale", () => {
    const quaseEncostado: Retangulo = { x: inicio.x + tamanho.largura + 10, y: inicio.y, largura: 320, altura: 280 };

    expect(posicaoLivrePerto(inicio, tamanho, [quaseEncostado])).not.toEqual(inicio);
  });

  it("com a fileira toda ocupada à direita, desce para a primeira fileira livre abaixo", () => {
    const faixa: Retangulo = { x: inicio.x - 100, y: inicio.y - 50, largura: 6 * passoX + 200, altura: tamanho.altura + 100 };
    const posicao = posicaoLivrePerto(inicio, tamanho, [faixa]);

    expect(posicao.x).toBe(inicio.x);
    expect(posicao.y).toBeGreaterThan(inicio.y);
    expect(livreDe(posicao, [faixa])).toBe(true);
  });

  it("sem lugar na varredura, abre logo abaixo de tudo, alinhada ao lugar de partida", () => {
    const tudo: Retangulo = { x: -5000, y: -5000, largura: 20_000, altura: 10_000 };

    expect(posicaoLivrePerto(inicio, tamanho, [tudo])).toEqual({ x: inicio.x, y: 5000 + 40 });
  });

  it("varre em passos do tamanho da janela mais a folga", () => {
    const doisNaVista: Retangulo[] = [
      { x: 1000, y: 500, ...tamanho },
      { x: 1000 + passoX, y: 500, largura: 320, altura: 280 },
    ];

    expect(posicaoLivrePerto(inicio, tamanho, doisNaVista)).toEqual({ x: inicio.x + 2 * passoX, y: inicio.y });
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

describe("shells no layout", () => {
  afterEach(() => localStorage.clear());

  it("grava e lê de volta posição, tamanho, terminal do servidor, pasta e orquestrador", () => {
    const solto = novoShell("s1", { x: 10.4, y: 20.6 }, { terminalId: "t1", pasta: "/p/app", orquestradorId: null }, 700, 420);
    const ligado = novoShell("s2", { x: 800, y: 0 }, { terminalId: "t2", pasta: "/p/api", orquestradorId: "o1" });

    salvarLayout(layoutDosNos([novoTerminal("o1", { x: 0, y: 0 }, 600, 500), solto, ligado], null));
    const lido = lerLayout();

    expect(lido.shells).toEqual({
      s1: { x: 10, y: 21, largura: 700, altura: 420, terminalId: "t1", pasta: "/p/app", orquestradorId: null },
      s2: {
        x: 800,
        y: 0,
        largura: TAMANHO_DO_SHELL.largura,
        altura: TAMANHO_DO_SHELL.altura,
        terminalId: "t2",
        pasta: "/p/api",
        orquestradorId: "o1",
      },
    });

    // De volta ao canvas: o bloco religa ao mesmo terminal do servidor.
    const s2 = nosDoLayout(lido).filter(ehShell).find((no) => no.id === idDoNoDoShell("s2"));
    expect(s2?.data).toEqual({ shellId: "s2", terminalId: "t2", pasta: "/p/api", orquestradorId: "o1" });
    expect(s2).toMatchObject({ position: { x: 800, y: 0 }, width: TAMANHO_DO_SHELL.largura });
  });

  it("um layout antigo, sem shells, vale como nenhum shell", () => {
    const antigo = JSON.stringify({ terminais: {}, previas: {} });

    expect(interpretarLayout(antigo).shells).toEqual({});
    expect(nosDoLayout(interpretarLayout(antigo)).filter(ehShell)).toEqual([]);
  });

  it("descarta só os shells corrompidos ou sem terminal ou pasta; orquestrador inválido fica solto", () => {
    const texto = JSON.stringify({
      shells: {
        bom: { x: 0, y: 0, largura: 640, altura: 400, terminalId: "t1", pasta: "/p", orquestradorId: 5 },
        semTerminal: { x: 0, y: 0, largura: 640, altura: 400, pasta: "/p" },
        semPasta: { x: 0, y: 0, largura: 640, altura: 400, terminalId: "t2", pasta: "" },
        torto: { x: "a", y: 0, largura: 640, altura: 400, terminalId: "t3", pasta: "/p" },
      },
    });

    expect(interpretarLayout(texto).shells).toEqual({
      bom: { x: 0, y: 0, largura: 640, altura: 400, terminalId: "t1", pasta: "/p", orquestradorId: null },
    });
    expect(interpretarLayout(JSON.stringify({ shells: 5 })).shells).toEqual({});
  });
});
