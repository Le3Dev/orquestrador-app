import {
  agruparPorTipo,
  buscarNaPaleta,
  type FonteDaPaleta,
  type ItemDaPaleta,
  type ItemDeAcao,
  LIMITE_DE_RESULTADOS,
  montarItensDaPaleta,
  normalizar,
} from "./paletaDeComandos";

function fonte(alteracoes: Partial<FonteDaPaleta> = {}): FonteDaPaleta {
  return {
    podeOrganizar: true,
    podeAbrirAjustes: false,
    orquestradores: [
      { id: "o1", nome: "Painel de vendas", nomeDaPasta: "painel-app", situacao: "trabalhando" },
      { id: "o2", nome: "Relatórios", nomeDaPasta: "relatorios", situacao: "ocioso" },
    ],
    abertos: new Set(["o1"]),
    notas: [{ notaId: "n1", titulo: "Compras", texto: "pão\nleite" }],
    conversas: new Map([
      [
        "o1",
        {
          turnos: [
            { id: "t1", texto: "Rode os testes de integração", iniciadoEm: "2026-11-01T10:00:00Z" },
            { id: "t2", texto: "Corrija a exportação para Excel", iniciadoEm: "2026-11-02T10:00:00Z" },
            { id: "t3", texto: "   ", iniciadoEm: "2026-11-03T10:00:00Z" },
          ],
        },
      ],
      // Conversa de um terminal fechado: não entra.
      ["o2", { turnos: [{ id: "t9", texto: "pedido antigo", iniciadoEm: "2026-11-01T09:00:00Z" }] }],
    ]),
    ...alteracoes,
  };
}

const titulos = (itens: readonly ItemDaPaleta[]) => itens.map((item) => item.titulo);

/** Um item simples para testar a busca. */
function item(id: string, titulo: string, tipo: "acao" | "nota" = "nota", busca = ""): ItemDaPaleta {
  return tipo === "acao"
    ? { tipo, id, titulo, detalhe: "", busca, acao: "organizar", atalho: null }
    : { tipo, id, titulo, detalhe: "", busca, notaId: id };
}

describe("normalizar", () => {
  it("tira acentos e passa para minúsculas", () => {
    expect(normalizar("Ação Exportação ÇÃO")).toBe("acao exportacao cao");
  });
});

describe("montarItensDaPaleta", () => {
  it("lista ações, todos os orquestradores, as notas e os pedidos dos terminais abertos (mais recente primeiro)", () => {
    const itens = montarItensDaPaleta(fonte());

    expect(itens.map((candidato) => candidato.tipo)).toEqual([
      "acao",
      "acao",
      "acao",
      "acao",
      "acao",
      "orquestrador",
      "orquestrador",
      "nota",
      "pedido",
      "pedido",
    ]);
    expect(titulos(itens.filter((candidato) => candidato.tipo === "acao"))).toEqual([
      "Novo orquestrador",
      "Nova nota",
      "Organizar",
      "Zoom 100%",
      "Enquadrar tudo",
    ]);
    const pedidos = itens.filter((candidato) => candidato.tipo === "pedido");
    expect(titulos(pedidos)).toEqual(["Corrija a exportação para Excel", "Rode os testes de integração"]);
    // O nome do Orquestrador vai no detalhe do pedido.
    expect(pedidos[0]?.detalhe).toBe("Painel de vendas");
    expect(itens.find((candidato) => candidato.id === "orquestrador:o2")?.detalhe).toBe("relatorios · abrir");
    expect(itens.find((candidato) => candidato.id === "orquestrador:o1")?.detalhe).toBe(
      "painel-app · trabalhando · no canvas",
    );
  });

  it("as ações de criar trazem o atalho do canvas (Ctrl+N e Ctrl+Shift+N), como o Zoom 100% (Ctrl+0)", () => {
    const acoesComAtalho = montarItensDaPaleta(fonte())
      .filter((candidato): candidato is ItemDeAcao => candidato.tipo === "acao")
      .map((candidato) => [candidato.titulo, candidato.atalho]);

    expect(acoesComAtalho).toEqual([
      ["Novo orquestrador", "Ctrl+N"],
      ["Nova nota", "Ctrl+Shift+N"],
      ["Organizar", null],
      ["Zoom 100%", "Ctrl+0"],
      ["Enquadrar tudo", null],
    ]);
  });

  it("\"Pastas e Claude Code\" (reabrir os Ajustes) só entra no app desktop, por último entre as ações", () => {
    expect(titulos(montarItensDaPaleta(fonte()))).not.toContain("Pastas e Claude Code");

    const acoesNoDesktop = montarItensDaPaleta(fonte({ podeAbrirAjustes: true })).filter(
      (candidato) => candidato.tipo === "acao",
    );

    expect(titulos(acoesNoDesktop)).toEqual([
      "Novo orquestrador",
      "Nova nota",
      "Organizar",
      "Zoom 100%",
      "Enquadrar tudo",
      "Pastas e Claude Code",
    ]);
    expect(acoesNoDesktop.at(-1)).toMatchObject({ acao: "ajustes-do-aplicativo", atalho: null });
    expect(titulos(buscarNaPaleta(acoesNoDesktop, "pasta claude"))).toEqual(["Pastas e Claude Code"]);
  });

  it("sem mais de uma janela, não oferece \"Organizar\"; nota sem título ganha um nome", () => {
    const itens = montarItensDaPaleta(fonte({ podeOrganizar: false, notas: [{ notaId: "n1", titulo: " ", texto: "" }] }));

    expect(titulos(itens)).not.toContain("Organizar");
    expect(itens.find((candidato) => candidato.tipo === "nota")).toMatchObject({
      titulo: "Nota sem título",
      detalhe: "nota vazia",
    });
  });

  it("corta pedidos longos num trecho de uma linha", () => {
    const texto = `Primeira linha\n${"palavra ".repeat(40)}`;
    const itens = montarItensDaPaleta(
      fonte({ conversas: new Map([["o1", { turnos: [{ id: "t1", texto, iniciadoEm: "2026-11-01T10:00:00Z" }] }]]) }),
    );
    const pedido = itens.find((candidato) => candidato.tipo === "pedido");

    expect(pedido?.titulo.startsWith("Primeira linha palavra")).toBe(true);
    expect(pedido?.titulo.endsWith("…")).toBe(true);
    expect(pedido?.titulo.length).toBeLessThanOrEqual(91);
  });
});

describe("buscarNaPaleta", () => {
  it("não diferencia maiúsculas nem acentos, nos dois sentidos", () => {
    const itens = montarItensDaPaleta(fonte());

    expect(titulos(buscarNaPaleta(itens, "EXPORTACAO"))).toEqual(["Corrija a exportação para Excel"]);
    expect(titulos(buscarNaPaleta(itens, "relatórios"))).toEqual(["Relatórios"]);
    expect(titulos(buscarNaPaleta(itens, "relatorios"))).toEqual(["Relatórios"]);
  });

  it("todas as palavras precisam casar, em qualquer parte do item", () => {
    const itens = montarItensDaPaleta(fonte());

    expect(titulos(buscarNaPaleta(itens, "testes integracao"))).toEqual(["Rode os testes de integração"]);
    expect(buscarNaPaleta(itens, "testes excel")).toEqual([]);
    // O texto da nota (que não aparece no título) também conta.
    expect(titulos(buscarNaPaleta(itens, "leite"))).toEqual(["Compras"]);
    // O nome do Orquestrador (no detalhe) junto com o pedido.
    expect(titulos(buscarNaPaleta(itens, "vendas excel"))).toEqual(["Corrija a exportação para Excel"]);
  });

  it("ordena: começo do título, depois começo de palavra, depois meio", () => {
    const itens = [
      item("meio", "Reorganizar a fila"),
      item("palavra", "Abrir e organizar"),
      item("titulo", "Organizar"),
    ];

    expect(buscarNaPaleta(itens, "organ").map((candidato) => candidato.id)).toEqual(["titulo", "palavra", "meio"]);
  });

  it("no empate, ações vêm antes das notas e a ordem original se mantém", () => {
    const itens = [item("n1", "Zoom da nota"), item("a1", "Zoom 100%", "acao"), item("n2", "Zoom de novo")];

    expect(buscarNaPaleta(itens, "zoom").map((candidato) => candidato.id)).toEqual(["a1", "n1", "n2"]);
  });

  it("devolve no máximo 50 resultados", () => {
    const itens = Array.from({ length: 80 }, (_, indice) => item(`n${indice}`, `Nota ${indice}`));

    expect(buscarNaPaleta(itens, "nota")).toHaveLength(LIMITE_DE_RESULTADOS);
    expect(buscarNaPaleta(itens, "")).toHaveLength(LIMITE_DE_RESULTADOS);
  });

  it("sem texto, mostra ações e orquestradores primeiro", () => {
    const itens = montarItensDaPaleta(fonte());
    const resultado = buscarNaPaleta(itens, "   ");

    expect(resultado).toHaveLength(itens.length);
    expect(resultado.slice(0, 7).map((candidato) => candidato.tipo)).toEqual([
      "acao",
      "acao",
      "acao",
      "acao",
      "acao",
      "orquestrador",
      "orquestrador",
    ]);
  });
});

describe("agruparPorTipo", () => {
  it("agrupa na ordem do primeiro resultado de cada tipo, mantendo o ranking dentro do grupo", () => {
    const itens = [item("n1", "Nota"), item("a1", "Ação", "acao"), item("n2", "Outra nota")];

    expect(agruparPorTipo(itens).map((grupo) => [grupo.rotulo, grupo.itens.map((candidato) => candidato.id)])).toEqual([
      ["Notas", ["n1", "n2"]],
      ["Ações", ["a1"]],
    ]);
  });
});
