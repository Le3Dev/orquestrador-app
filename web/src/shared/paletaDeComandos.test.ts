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
    atualizacao: null,
    orquestradores: [
      { id: "o1", nome: "Painel de vendas", nomeDaPasta: "painel-app", situacao: "trabalhando" },
      { id: "o2", nome: "Relatórios", nomeDaPasta: "relatorios", situacao: "ocioso" },
    ],
    abertos: new Set(["o1"]),
    notas: [{ notaId: "n1", titulo: "Compras", texto: "pão\nleite" }],
    artefatos: [],
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
      "Nova prévia",
      "Organizar",
      "Zoom 100%",
      "Enquadrar tudo",
      "Focar o chat rápido",
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
      ["Nova prévia", null],
      ["Organizar", null],
      ["Zoom 100%", "Ctrl+0"],
      ["Enquadrar tudo", null],
      ["Focar o chat rápido", "Ctrl+J"],
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
      "Nova prévia",
      "Organizar",
      "Zoom 100%",
      "Enquadrar tudo",
      "Focar o chat rápido",
      "Pastas e Claude Code",
    ]);
    expect(acoesNoDesktop.at(-1)).toMatchObject({ acao: "ajustes-do-aplicativo", atalho: null });
    expect(titulos(buscarNaPaleta(acoesNoDesktop, "pasta claude"))).toEqual(["Pastas e Claude Code"]);
  });

  it("\"Entrar no modo fantasma\" só entra com o modo disponível e desligado, depois de \"Focar o chat rápido\"", () => {
    expect(titulos(montarItensDaPaleta(fonte()))).not.toContain("Entrar no modo fantasma");
    expect(titulos(montarItensDaPaleta(fonte({ podeEntrarNoModoFantasma: false })))).not.toContain("Entrar no modo fantasma");

    const acoesComModo = montarItensDaPaleta(fonte({ podeEntrarNoModoFantasma: true })).filter(
      (candidato) => candidato.tipo === "acao",
    );
    expect(titulos(acoesComModo).slice(-2)).toEqual(["Focar o chat rápido", "Entrar no modo fantasma"]);
    expect(acoesComModo.at(-1)).toMatchObject({ acao: "entrar-modo-fantasma", atalho: "Ctrl+\\" });
    expect(titulos(buscarNaPaleta(acoesComModo, "fantasma"))).toEqual(["Entrar no modo fantasma"]);
    expect(titulos(buscarNaPaleta(acoesComModo, "focar o chat"))).toEqual(["Focar o chat rápido"]);
  });

  it("\"Procurar atualizações\" só entra com a ponte do app, por último entre as ações, com a versão e o resultado", () => {
    expect(titulos(montarItensDaPaleta(fonte()))).not.toContain("Procurar atualizações");

    const atualizacao = {
      situacao: "em-dia" as const,
      versaoAtual: "0.2.0",
      versaoNova: null,
      progresso: null,
      mensagemDeErro: null,
    };
    const acoesNoDesktop = montarItensDaPaleta(fonte({ podeAbrirAjustes: true, atualizacao })).filter(
      (candidato) => candidato.tipo === "acao",
    );

    expect(acoesNoDesktop.at(-1)).toEqual({
      tipo: "acao",
      id: "acao:procurar-atualizacoes",
      acao: "procurar-atualizacoes",
      titulo: "Procurar atualizações",
      detalhe: "Versão 0.2.0 — você está na versão mais recente",
      busca: expect.any(String),
      atalho: null,
      // A paleta fica aberta para mostrar o resultado da verificação.
      mantemAPaletaAberta: true,
    });
    expect(titulos(buscarNaPaleta(acoesNoDesktop, "atualizar versao"))).toEqual(["Procurar atualizações"]);

    // Fora do app instalado: a ação continua, avisando que só lá há atualizações.
    const foraDoInstalado = montarItensDaPaleta(fonte({ atualizacao: { ...atualizacao, situacao: "indisponivel" } }));
    expect(foraDoInstalado.find((candidato) => candidato.id === "acao:procurar-atualizacoes")?.detalhe).toBe(
      "Atualizações só no app instalado",
    );
  });

  it("sem mais de uma janela, não oferece \"Organizar\"; nota sem título ganha um nome", () => {
    const itens = montarItensDaPaleta(fonte({ podeOrganizar: false, notas: [{ notaId: "n1", titulo: " ", texto: "" }] }));

    expect(titulos(itens)).not.toContain("Organizar");
    expect(itens.find((candidato) => candidato.tipo === "nota")).toMatchObject({
      titulo: "Nota sem título",
      detalhe: "nota vazia",
    });
  });

  it("lista os artefatos (depois das notas) com o formato, a origem e se estão no canvas", () => {
    const itens = montarItensDaPaleta(
      fonte({
        artefatos: [
          {
            artefatoId: "a1",
            titulo: "Relatório de vendas",
            formato: "html",
            origem: { tipo: "orquestrador", id: "o1" },
            aberto: true,
          },
          { artefatoId: "a2", titulo: "  ", formato: "markdown", origem: { tipo: "chat", id: null }, aberto: false },
          {
            artefatoId: "a3",
            titulo: "Plano",
            formato: "markdown",
            origem: { tipo: "orquestrador", id: "excluido" },
            aberto: false,
          },
        ],
      }),
    );

    const tipos = itens.map((candidato) => candidato.tipo);
    expect(tipos.indexOf("artefato")).toBe(tipos.lastIndexOf("nota") + 1);
    expect(itens.filter((candidato) => candidato.tipo === "artefato")).toEqual([
      expect.objectContaining({
        id: "artefato:a1",
        artefatoId: "a1",
        titulo: "Relatório de vendas",
        detalhe: "HTML · de Painel de vendas · no canvas",
        formato: "html",
        aberto: true,
      }),
      expect.objectContaining({ titulo: "Artefato sem título", detalhe: "Markdown · do chat rápido · abrir" }),
      expect.objectContaining({ titulo: "Plano", detalhe: "Markdown · de um orquestrador · abrir" }),
    ]);
    // O formato também conta na busca, e o grupo se chama "Artefatos".
    expect(titulos(buscarNaPaleta(itens, "relatorio html"))).toEqual(["Relatório de vendas"]);
    expect(titulos(buscarNaPaleta(itens, "plano md"))).toEqual(["Plano"]);
    expect(agruparPorTipo(buscarNaPaleta(itens, "html")).map((grupo) => grupo.rotulo)).toEqual(["Artefatos"]);
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
    expect(resultado.slice(0, 9).map((candidato) => candidato.tipo)).toEqual([
      "acao",
      "acao",
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
