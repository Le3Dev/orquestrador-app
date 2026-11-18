import type { TracoGravado } from "./api/artefatos";
import { criarContasDoDesenho } from "./canvas/desenho";
import {
  CORES_DO_DESENHO,
  ESPESSURAS_DO_DESENHO,
  MAXIMO_DE_CARACTERES_NO_TEXTO,
  MAXIMO_DE_PONTOS_NO_TRACO,
  TIPOS_DE_TRACO,
} from "./canvas/layout";
import {
  type ConfiguracaoDoDesenhoNaPagina,
  criarFuncoesDeAncora,
  type EstadoDoDesenho,
  instalarDesenho,
  interpretarLarguraDaPagina,
  interpretarTracosGravados,
  LARGURA_MAXIMA_DA_PAGINA,
  LARGURA_MINIMA_DA_PAGINA,
  lerMensagemDoDesenho,
  MARCA_DO_DESENHO,
  MAXIMO_DO_CAMINHO_DA_ANCORA,
  SCRIPT_DO_DESENHO,
} from "./desenhoNaPagina";

// O jsdom não tem PointerEvent: sem ele, o fireEvent manda um Event sem botão, clientX nem pointerId.
class EventoDePonteiroFalso extends MouseEvent {
  readonly pointerId: number;
  constructor(tipo: string, inicio: PointerEventInit = {}) {
    super(tipo, inicio);
    this.pointerId = inicio.pointerId ?? 0;
  }
}

/** Uma caixa na tela (o jsdom mede tudo como zero). */
function caixa(left: number, top: number, width = 0, height = 0): DOMRect {
  return { left, top, width, height, x: left, y: top, right: left + width, bottom: top + height, toJSON: () => ({}) };
}

function medir(elemento: Element, medida: () => DOMRect): void {
  Object.defineProperty(elemento, "getBoundingClientRect", { configurable: true, value: medida });
}

/** Faz o elemento rolar por conta própria: overflow auto e mais conteúdo do que cabe. */
function rolavel(elemento: HTMLElement): void {
  elemento.style.overflow = "auto";
  Object.defineProperty(elemento, "scrollHeight", { configurable: true, value: 1000 });
  Object.defineProperty(elemento, "clientHeight", { configurable: true, value: 100 });
}

const ancoras = () => criarFuncoesDeAncora(MARCA_DO_DESENHO, MAXIMO_DO_CAMINHO_DA_ANCORA);

const CONFIGURACAO: ConfiguracaoDoDesenhoNaPagina = {
  marca: MARCA_DO_DESENHO,
  tipos: TIPOS_DE_TRACO,
  cores: CORES_DO_DESENHO,
  espessuras: ESPESSURAS_DO_DESENHO,
  ferramentas: [...TIPOS_DE_TRACO, "borracha"],
  maximoDeTracos: 2000,
  maximoDePontos: MAXIMO_DE_PONTOS_NO_TRACO,
  maximoDeCaracteres: MAXIMO_DE_CARACTERES_NO_TEXTO,
  maximoDoCaminho: MAXIMO_DO_CAMINHO_DA_ANCORA,
  maiorIndice: 100_000,
  maximoDoId: 64,
  distanciaMinima: 2,
  raioDaBorracha: 8,
  teclas: true,
};

const CORES = Object.fromEntries(CORES_DO_DESENHO.map((cor) => [cor, "#123456"])) as EstadoDoDesenho["cores"];

function estado(alteracoes: Partial<EstadoDoDesenho> = {}): EstadoDoDesenho {
  return { tracos: [], ligado: false, ferramenta: "caneta", cor: "azul", espessura: 3, cores: CORES, fonte: "sans-serif", ...alteracoes };
}

function traco(alteracoes: Partial<TracoGravado> = {}): TracoGravado {
  return { id: "t1", tipo: "seta", cor: "azul", espessura: 3, pontos: [{ x: 1, y: 2 }, { x: 30, y: 2 }], ancora: null, ...alteracoes };
}

describe("criarFuncoesDeAncora", () => {
  let raiz: HTMLDivElement;
  beforeEach(() => {
    raiz = document.createElement("div");
    raiz.innerHTML = `
      <h1>Título</h1>
      <div ${MARCA_DO_DESENHO}=""></div>
      <section>
        <p id="paragrafo">um <span id="trecho">trecho</span></p>
        <div id="lista"><p id="dentro">dentro da lista</p></div>
      </section>
      <div id="fixo" style="position: fixed"><p id="no-fixo">preso</p></div>
      <div id="grudado" style="position: sticky"><span id="no-grudado">grudado</span></div>`;
    document.body.append(raiz);
  });
  afterEach(() => raiz.remove());

  it("monta e segue o caminho de índices, sem contar os elementos da camada", () => {
    const { caminhoAte, elementoDoCaminho } = ancoras();
    const trecho = raiz.querySelector("#trecho") as Element;
    // h1 = 0, (a camada não conta), section = 1; p = 0; span = 0.
    expect(caminhoAte(raiz, trecho)).toEqual([1, 0, 0]);
    expect(elementoDoCaminho(raiz, [1, 0, 0])).toBe(trecho);
    expect(caminhoAte(raiz, raiz)).toEqual([]);
    expect(caminhoAte(raiz, document.body)).toBeNull();
    expect(elementoDoCaminho(raiz, [1, 9])).toBeNull();
  });

  it("a âncora é o bloco sob o ponto (o span inline vale o parágrafo), no contêiner que é a raiz", () => {
    const achado = ancoras().acharAncora(raiz, raiz.querySelector("#trecho"));
    expect(achado?.ancora).toEqual({ conteiner: [], elemento: [1, 0] });
    expect(achado?.alvo.elemento).toBe(raiz.querySelector("#paragrafo"));
  });

  it("dentro de uma div que rola, o contêiner é ela e o elemento conta a partir dela", () => {
    const lista = raiz.querySelector("#lista") as HTMLElement;
    rolavel(lista);
    const achado = ancoras().acharAncora(raiz, raiz.querySelector("#dentro"));
    expect(achado?.ancora).toEqual({ conteiner: [1, 1], elemento: [0] });
    expect(achado?.alvo.conteiner).toBe(lista);
  });

  it("uma div com overflow auto que não tem o que rolar não vira contêiner", () => {
    (raiz.querySelector("#lista") as HTMLElement).style.overflow = "auto";
    expect(ancoras().acharAncora(raiz, raiz.querySelector("#dentro"))?.ancora).toEqual({ conteiner: [], elemento: [1, 1, 0] });
  });

  it("fixed e sticky (no elemento ou acima dele) não ancoram: o traço fica no documento", () => {
    const { acharAncora } = ancoras();
    expect(acharAncora(raiz, raiz.querySelector("#no-fixo"))).toBeNull();
    expect(acharAncora(raiz, raiz.querySelector("#no-grudado"))).toBeNull();
  });

  it("a própria raiz, nada ou algo fora dela não ancoram; no documento, o <body> também não", () => {
    const { acharAncora } = ancoras();
    expect(acharAncora(raiz, raiz)).toBeNull();
    expect(acharAncora(raiz, null)).toBeNull();
    expect(acharAncora(raiz, document.body)).toBeNull();
    expect(acharAncora(document.documentElement, document.body)).toBeNull();
  });

  it("caminho fundo demais vale o ancestral no limite", () => {
    const { acharAncora } = criarFuncoesDeAncora(MARCA_DO_DESENHO, 2);
    const achado = acharAncora(raiz, raiz.querySelector("#dentro"));
    expect(achado?.ancora).toEqual({ conteiner: [], elemento: [1, 1] });
    expect(achado?.alvo.elemento).toBe(raiz.querySelector("#lista"));
  });

  it("resolve a âncora na página de agora; elemento sumido ou âncora nula: nulo (vale o documento)", () => {
    const { resolverAncora } = ancoras();
    expect(resolverAncora(raiz, { conteiner: [], elemento: [1, 0] })?.elemento).toBe(raiz.querySelector("#paragrafo"));
    expect(resolverAncora(raiz, { conteiner: [], elemento: [7, 3] })).toBeNull();
    expect(resolverAncora(raiz, { conteiner: [9], elemento: [] })).toBeNull();
    expect(resolverAncora(raiz, null)).toBeNull();
  });

  it("o canto do elemento é o da caixa dele; o do próprio contêiner anda com a rolagem", () => {
    const { origemNaTela } = ancoras();
    const lista = raiz.querySelector("#lista") as HTMLElement;
    const dentro = raiz.querySelector("#dentro") as HTMLElement;
    medir(lista, () => caixa(50, 60));
    medir(dentro, () => caixa(55, 70));
    Object.defineProperty(lista, "scrollTop", { configurable: true, value: 40 });
    expect(origemNaTela({ conteiner: lista, elemento: dentro }, 1)).toEqual({ x: 55, y: 70 });
    expect(origemNaTela({ conteiner: lista, elemento: lista }, 2)).toEqual({ x: 50, y: 60 - 80 });
  });
});

describe("instalarDesenho", () => {
  let raiz: HTMLDivElement;
  let hospedeiro: HTMLDivElement;
  let enviar: ReturnType<typeof vi.fn>;
  let desenho: ReturnType<typeof instalarDesenho>;
  /** Quanto a raiz rolou: o hospedeiro (no canto do conteúdo) sobe junto. */
  let rolagem: number;

  beforeEach(() => {
    vi.stubGlobal("PointerEvent", EventoDePonteiroFalso);
    rolagem = 0;
    raiz = document.createElement("div");
    raiz.innerHTML = `<h1>Título</h1><p id="alvo">alvo do traço</p><div id="caixa"><p id="dentro">na caixa</p></div><div id="host"></div>`;
    document.body.append(raiz);
    hospedeiro = raiz.querySelector("#host") as HTMLDivElement;
    hospedeiro.setAttribute(MARCA_DO_DESENHO, "");
    // O <p> está no y 300 do conteúdo; na tela, menos a rolagem.
    medir(raiz.querySelector("#alvo") as Element, () => caixa(20, 300 - rolagem));
    enviar = vi.fn();
    desenho = instalarDesenho(
      { janela: window, raiz, hospedeiro, ouvinte: raiz, enviar, configuracao: CONFIGURACAO },
      criarContasDoDesenho(),
      ancoras(),
    );
    // A camada aparece com o primeiro estado; o SVG fica no canto do conteúdo, que sobe com a rolagem.
    desenho.receber(estado());
    medir(raiz.querySelector('[data-testid="desenho-na-pagina"]') as Element, () => caixa(0, -rolagem));
  });
  afterEach(() => {
    desenho.destruir();
    raiz.remove();
    vi.unstubAllGlobals();
  });

  const svg = () => raiz.querySelector('[data-testid="desenho-na-pagina"]') as SVGSVGElement;
  const posicaoDe = (id: string) => svg().querySelector(`[data-traco-id="${id}"] > g`)?.getAttribute("transform");

  function riscar(alvo: Element, pontos: readonly [number, number][]) {
    const [primeiro, ...resto] = pontos;
    alvo.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1, clientX: primeiro?.[0], clientY: primeiro?.[1] }));
    for (const [x, y] of resto) {
      alvo.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: x, clientY: y }));
    }
    const ultimo = resto.at(-1) ?? primeiro;
    alvo.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, clientX: ultimo?.[0], clientY: ultimo?.[1] }));
  }

  const tracoEnviado = () => enviar.mock.calls.map(([mensagem]) => mensagem as Record<string, unknown>).find((m) => m.desenho === "traco")?.traco as TracoGravado;

  it("avisa que está pronto, a camada não mexe no layout e não pega o ponteiro", () => {
    expect(enviar).toHaveBeenCalledWith({ desenho: "pronto" });
    expect(hospedeiro.style.position).toBe("absolute");
    expect(hospedeiro.style.width).toBe("0px");
    expect(hospedeiro.style.pointerEvents).toBe("none");
    expect(svg().style.pointerEvents).toBe("none");
  });

  it("desligado, o ponteiro é da página: nada de traço", () => {
    desenho.receber(estado({ ligado: false }));
    const clique = vi.fn();
    raiz.addEventListener("click", clique);
    riscar(raiz.querySelector("#alvo") as Element, [[30, 310], [60, 320]]);
    raiz.querySelector("#alvo")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(tracoEnviado()).toBeUndefined();
    expect(clique).toHaveBeenCalled();
  });

  it("ligado, o traço preso ao bloco sob o ponto vai ao app com os pontos relativos ao canto dele, e o clique não chega à página", () => {
    desenho.receber(estado({ ligado: true, ferramenta: "seta" }));
    const clique = vi.fn();
    raiz.addEventListener("click", clique);
    riscar(raiz.querySelector("#alvo") as Element, [[30, 310], [90, 340]]);
    raiz.querySelector("#alvo")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(tracoEnviado()).toMatchObject({
      tipo: "seta",
      cor: "azul",
      espessura: 3,
      pontos: [{ x: 10, y: 10 }, { x: 70, y: 40 }],
      ancora: { conteiner: [], elemento: [1] },
    });
    expect(clique).not.toHaveBeenCalled();
    expect(raiz).toHaveAttribute(`${MARCA_DO_DESENHO}-ligado`, "seta");
  });

  it("o traço vai com a largura da página: a da div do Markdown (o zoom de fora não conta); sem medida, nula", () => {
    desenho.receber(estado({ ligado: true, ferramenta: "linha" }));
    riscar(raiz.querySelector("#alvo") as Element, [[30, 310], [90, 310]]);
    // O jsdom mede tudo como zero: sem medida.
    expect(enviar).toHaveBeenLastCalledWith(expect.objectContaining({ desenho: "traco", largura: null }));

    Object.defineProperty(raiz, "offsetWidth", { configurable: true, value: 759.6 });
    // Na tela a raiz aparece reduzida (escala 0,5): a largura é a do layout dela.
    medir(raiz, () => caixa(0, 0, 380, 500));
    riscar(raiz.querySelector("#alvo") as Element, [[30, 310], [90, 310]]);
    expect(enviar).toHaveBeenLastCalledWith(expect.objectContaining({ desenho: "traco", largura: 760 }));

    desenho.receber(estado({ ligado: true, ferramenta: "texto" }));
    raiz.querySelector("#alvo")?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 25, clientY: 305 }));
    const campo = raiz.querySelector('[data-testid="texto-solto-na-pagina"]') as HTMLInputElement;
    campo.value = "nota";
    campo.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(enviar).toHaveBeenLastCalledWith(expect.objectContaining({ desenho: "traco", largura: 760 }));
  });

  it("começando com a página já rolada, o traço cai no mesmo lugar do conteúdo", () => {
    rolagem = 200;
    desenho.receber(estado({ ligado: true, ferramenta: "linha" }));
    // O <p> agora está no y 100 da tela; o ponto 10 abaixo do canto dele.
    riscar(raiz.querySelector("#alvo") as Element, [[30, 110], [90, 110]]);
    const feito = tracoEnviado();
    expect(feito.pontos).toEqual([{ x: 10, y: 10 }, { x: 70, y: 10 }]);

    desenho.receber(estado({ tracos: [feito] }));
    // Na camada (que rola com o conteúdo), o traço fica no y 300 do conteúdo, onde o <p> está.
    expect(posicaoDe(feito.id)).toBe("translate(20 300)");
  });

  it("a página reflui (outra largura): o traço vai junto da âncora; âncora sumida cai nas coordenadas do documento", () => {
    desenho.receber(
      estado({
        tracos: [
          traco({ id: "preso", ancora: { conteiner: [], elemento: [1] } }),
          traco({ id: "sumido", ancora: { conteiner: [], elemento: [9, 9] } }),
          traco({ id: "solto", ancora: null }),
        ],
      }),
    );
    expect(posicaoDe("preso")).toBe("translate(20 300)");
    expect(posicaoDe("sumido")).toBe("translate(0 0)");
    expect(posicaoDe("solto")).toBe("translate(0 0)");

    medir(raiz.querySelector("#alvo") as Element, () => caixa(40, 520));
    desenho.reposicionar();
    expect(posicaoDe("preso")).toBe("translate(40 520)");
  });

  it("preso numa div que rola por dentro: recortado na área dela e acompanha a rolagem dela", () => {
    const caixaQueRola = raiz.querySelector("#caixa") as HTMLElement;
    rolavel(caixaQueRola);
    Object.defineProperty(caixaQueRola, "clientWidth", { configurable: true, value: 200 });
    medir(caixaQueRola, () => caixa(10, 400, 200, 100));
    let topoDoDentro = 410;
    medir(raiz.querySelector("#dentro") as Element, () => caixa(10, topoDoDentro));
    desenho.receber(estado({ tracos: [traco({ id: "na-caixa", ancora: { conteiner: [2], elemento: [0] } })] }));

    expect(posicaoDe("na-caixa")).toBe("translate(10 410)");
    const recorte = svg().querySelector('[data-traco-id="na-caixa"]')?.getAttribute("clip-path");
    expect(recorte).toMatch(/^url\(#orquestrador-desenho-/);
    expect(svg().querySelector("clipPath rect")).toHaveAttribute("height", "100");

    topoDoDentro = 350;
    caixaQueRola.dispatchEvent(new Event("scroll"));
    expect(posicaoDe("na-caixa")).toBe("translate(10 350)");
  });

  it("com o zoom do canvas (a raiz aparece maior), os pontos ficam em px da página", () => {
    Object.defineProperty(raiz, "offsetWidth", { configurable: true, value: 500 });
    medir(raiz, () => caixa(0, 0, 1000, 800));
    desenho.receber(estado({ ligado: true, ferramenta: "linha" }));
    riscar(raiz.querySelector("#alvo") as Element, [[40, 320], [100, 320]]);
    // O canto do <p> está em (20, 300) na tela: na escala 2, (10, 150) na página.
    expect(tracoEnviado().pontos).toEqual([{ x: 10, y: 10 }, { x: 40, y: 10 }]);
  });

  it("a borracha devolve os ids tocados; o texto solto vira traço com Enter", () => {
    desenho.receber(estado({ ligado: true, ferramenta: "borracha", tracos: [traco({ id: "a", pontos: [{ x: 0, y: 5 }, { x: 100, y: 5 }] })] }));
    riscar(raiz.querySelector("#alvo") as Element, [[50, 5]]);
    expect(enviar).toHaveBeenCalledWith({ desenho: "apagar", ids: ["a"] });

    desenho.receber(estado({ ligado: true, ferramenta: "texto" }));
    raiz.querySelector("#alvo")?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 25, clientY: 305 }));
    const campo = raiz.querySelector('[data-testid="texto-solto-na-pagina"]') as HTMLInputElement;
    campo.value = "Ver aqui";
    campo.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(tracoEnviado()).toMatchObject({ tipo: "texto", texto: "Ver aqui", pontos: [{ x: 5, y: 5 }], ancora: { conteiner: [], elemento: [1] } });
    expect(raiz.querySelector('[data-testid="texto-solto-na-pagina"]')).toBeNull();
  });

  it("repassa Esc e Ctrl/Cmd+Z ao app só com o modo ligado", () => {
    raiz.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(enviar).not.toHaveBeenCalledWith({ desenho: "tecla", tecla: "Escape" });

    desenho.receber(estado({ ligado: true }));
    raiz.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    raiz.dispatchEvent(new KeyboardEvent("keydown", { key: "z", code: "KeyZ", metaKey: true, bubbles: true }));
    raiz.dispatchEvent(new KeyboardEvent("keydown", { key: "z", code: "KeyZ", ctrlKey: true, shiftKey: true, bubbles: true }));
    expect(enviar).toHaveBeenCalledWith({ desenho: "tecla", tecla: "Escape" });
    expect(enviar.mock.calls.filter(([m]) => (m as Record<string, unknown>).tecla === "desfazer")).toHaveLength(1);
  });

  it("estado malformado é ignorado; traço inválido no meio sai e os outros ficam", () => {
    desenho.receber(estado({ tracos: [traco({ id: "bom" })] }));
    desenho.receber({ ...estado(), ligado: "sim" });
    desenho.receber({ ...estado(), ferramenta: "martelo" });
    desenho.receber(null);
    expect(svg().querySelectorAll("[data-traco-id]")).toHaveLength(1);

    desenho.receber(
      estado({
        tracos: [
          traco({ id: "ok" }),
          { ...traco({ id: "ruim" }), tipo: "estrela" as never },
          { ...traco({ id: "fundo" }), ancora: { conteiner: Array(65).fill(0), elemento: [] } },
          { ...traco({ id: "x".repeat(65) }) },
        ],
      }),
    );
    expect([...svg().querySelectorAll("[data-traco-id]")].map((g) => g.getAttribute("data-traco-id"))).toEqual(["ok"]);
  });

  it("destruir tira a camada e as escutas", () => {
    desenho.receber(estado({ ligado: true }));
    desenho.destruir();
    expect(hospedeiro.childElementCount).toBe(0);
    expect(raiz).not.toHaveAttribute(`${MARCA_DO_DESENHO}-ligado`);
    riscar(raiz.querySelector("#alvo") as Element, [[30, 310], [60, 320]]);
    expect(tracoEnviado()).toBeUndefined();
  });
});

describe("lerMensagemDoDesenho", () => {
  const daPagina = (dados: Record<string, unknown>) => ({ origem: "orquestrador-artefato", ...dados });

  it("aceita as mensagens da camada, validadas", () => {
    expect(lerMensagemDoDesenho(daPagina({ desenho: "pronto" }))).toEqual({ tipo: "pronto" });
    expect(lerMensagemDoDesenho(daPagina({ desenho: "traco", traco: traco({ texto: "sobra" } as Partial<TracoGravado>) }))).toEqual({
      tipo: "traco",
      traco: traco(),
      largura: null,
    });
    expect(lerMensagemDoDesenho(daPagina({ desenho: "apagar", ids: ["a", "b", "a"] }))).toEqual({ tipo: "apagar", ids: ["a", "b"] });
    expect(lerMensagemDoDesenho(daPagina({ desenho: "tecla", tecla: "Escape" }))).toEqual({ tipo: "tecla", tecla: "Escape" });
    expect(lerMensagemDoDesenho(daPagina({ desenho: "tecla", tecla: "desfazer" }))).toEqual({ tipo: "tecla", tecla: "desfazer" });
  });

  it("a largura da página que vem com o traço é arredondada e limitada; malformada vale nula sem derrubar o traço", () => {
    const largura = (valor: unknown) => {
      const lida = lerMensagemDoDesenho(daPagina({ desenho: "traco", traco: traco(), largura: valor }));
      return lida?.tipo === "traco" ? lida.largura : "recusada";
    };
    expect(largura(1500)).toBe(1500);
    expect(largura(1499.6)).toBe(1500);
    expect(largura(50)).toBe(LARGURA_MINIMA_DA_PAGINA);
    expect(largura(20_000)).toBe(LARGURA_MAXIMA_DA_PAGINA);
    expect(largura("1500")).toBeNull();
    expect(largura(Number.NaN)).toBeNull();
    expect(largura(Number.POSITIVE_INFINITY)).toBeNull();
    expect(largura(0)).toBeNull();
    expect(largura(-30)).toBeNull();
    expect(interpretarLarguraDaPagina(840.4)).toBe(840);
    expect(interpretarLarguraDaPagina(null)).toBeNull();
  });

  it("recusa o que não é da camada ou está malformado", () => {
    expect(lerMensagemDoDesenho(null)).toBeNull();
    expect(lerMensagemDoDesenho("traco")).toBeNull();
    expect(lerMensagemDoDesenho({ origem: "outra", desenho: "pronto" })).toBeNull();
    // A mensagem de navegação (mesma origem) não é do desenho.
    expect(lerMensagemDoDesenho(daPagina({ suportado: true, podeVoltar: true, podeAvancar: false }))).toBeNull();
    expect(lerMensagemDoDesenho(daPagina({ desenho: "traco", traco: { ...traco(), pontos: [{ x: 1, y: 2 }] } }))).toBeNull();
    expect(lerMensagemDoDesenho(daPagina({ desenho: "traco", traco: { ...traco(), cor: "rosa" } }))).toBeNull();
    expect(lerMensagemDoDesenho(daPagina({ desenho: "traco", traco: { ...traco(), ancora: { conteiner: [-1], elemento: [] } } }))).toBeNull();
    expect(lerMensagemDoDesenho(daPagina({ desenho: "traco", traco: { ...traco(), ancora: "body" } }))).toBeNull();
    expect(lerMensagemDoDesenho(daPagina({ desenho: "traco", traco: { ...traco(), id: "x".repeat(65) } }))).toBeNull();
    expect(lerMensagemDoDesenho(daPagina({ desenho: "apagar", ids: [] }))).toBeNull();
    expect(lerMensagemDoDesenho(daPagina({ desenho: "apagar", ids: [1] }))).toBeNull();
    expect(lerMensagemDoDesenho(daPagina({ desenho: "tecla", tecla: "Enter" }))).toBeNull();
    expect(lerMensagemDoDesenho(daPagina({ desenho: "apagar-tudo" }))).toBeNull();
  });

  it("interpretarTracosGravados tira os corrompidos e sempre devolve a âncora (sem ela, nula)", () => {
    const semAncora: Partial<TracoGravado> = traco({ id: "s" });
    delete semAncora.ancora;
    expect(interpretarTracosGravados([traco(), { tipo: "seta" }, semAncora])).toEqual([traco(), traco({ id: "s" })]);
    expect(interpretarTracosGravados("x")).toEqual([]);
  });
});

describe("SCRIPT_DO_DESENHO", () => {
  afterEach(() => {
    document.documentElement.querySelectorAll(`:scope > [${MARCA_DO_DESENHO}]`).forEach((elemento) => elemento.remove());
  });

  /** Uma janela de página falsa: o `parent` é o app; as escutas ficam num EventTarget. */
  function rodarNaPagina(innerWidth?: number) {
    const eventos = new EventTarget();
    const pai = { postMessage: vi.fn() };
    const janela = {
      parent: pai,
      innerWidth,
      addEventListener: eventos.addEventListener.bind(eventos),
      removeEventListener: eventos.removeEventListener.bind(eventos),
      setTimeout: window.setTimeout.bind(window),
      clearTimeout: window.clearTimeout.bind(window),
    };
    new Function("window", SCRIPT_DO_DESENHO)(janela);
    const receber = (dados: unknown, source: unknown) => {
      const evento = new Event("message");
      Object.assign(evento, { data: dados, source });
      eventos.dispatchEvent(evento);
    };
    return { pai, receber, eventos };
  }

  it("na página HTML, o traço vai à janela pai com a largura do iframe (innerWidth)", () => {
    vi.stubGlobal("PointerEvent", EventoDePonteiroFalso);
    try {
      const { pai, receber, eventos } = rodarNaPagina(1500);
      receber({ origem: "orquestrador-app", acao: "desenho", estado: estado({ ligado: true, ferramenta: "linha" }) }, pai);
      eventos.dispatchEvent(new PointerEvent("pointerdown", { button: 0, pointerId: 1, clientX: 10, clientY: 10 }));
      eventos.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 90, clientY: 10 }));
      eventos.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, clientX: 90, clientY: 10 }));
      expect(pai.postMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({ desenho: "traco", largura: 1500, origem: "orquestrador-artefato" }),
        "*",
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("é um script que roda sozinho (sem nada do app): avisa a janela pai e, com o estado, põe a camada no fim do <html>", () => {
    const { pai, receber } = rodarNaPagina();
    expect(pai.postMessage).toHaveBeenCalledWith({ desenho: "pronto", origem: "orquestrador-artefato" }, "*");
    receber({ origem: "orquestrador-app", acao: "desenho", estado: estado() }, pai);
    expect(document.documentElement.querySelector(`:scope > [${MARCA_DO_DESENHO}] [data-testid="desenho-na-pagina"]`)).not.toBeNull();
  });

  it("só obedece à janela pai, no formato do app", () => {
    const { pai, receber } = rodarNaPagina();
    const mensagem = { origem: "orquestrador-app", acao: "desenho", estado: estado({ tracos: [traco({ id: "do-app" })] }) };
    const tracosNaPagina = () => document.querySelectorAll('[data-testid="desenho-na-pagina"] [data-traco-id]').length;

    receber(mensagem, window);
    receber({ ...mensagem, origem: "outra" }, pai);
    receber({ ...mensagem, acao: "voltar" }, pai);
    expect(tracosNaPagina()).toBe(0);

    receber(mensagem, pai);
    expect(tracosNaPagina()).toBe(1);
  });
});
