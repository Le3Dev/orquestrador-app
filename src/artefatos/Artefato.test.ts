import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { Artefato, formatoDoArquivo, TAMANHO_MAXIMO_DO_TITULO, tituloInicial } from "./Artefato";
import { ErroDeArtefato } from "./ErroDeArtefato";
import { OrigemDoArtefato } from "./OrigemDoArtefato";

const criadoEm = new Date("2026-11-05T12:00:00Z");
const depois = new Date("2026-11-05T12:05:00Z");

function hashDe(texto: string): string {
  return createHash("sha256").update(texto).digest("hex");
}

function novoArtefato(arquivo = "relatorio-de_vendas.html", origem = OrigemDoArtefato.doChat()): Artefato {
  return Artefato.criar({ id: "a1", origem, arquivo, hash: hashDe("v1"), tamanho: 2, agora: criadoEm });
}

function capturarErro(acao: () => unknown): ErroDeArtefato {
  try {
    acao();
  } catch (erro) {
    if (erro instanceof ErroDeArtefato) {
      return erro;
    }
  }
  throw new Error("Era esperado um ErroDeArtefato.");
}

describe("Artefato", () => {
  it("nasce com o título tirado do nome do arquivo, a versão 1 e criação = atualização", () => {
    const artefato = novoArtefato();

    expect(artefato.paraDados()).toEqual({
      id: "a1",
      titulo: "relatorio de vendas",
      formato: "html",
      origem: { tipo: "chat", id: null },
      arquivo: "relatorio-de_vendas.html",
      criadoEm: "2026-11-05T12:00:00.000Z",
      atualizadoEm: "2026-11-05T12:00:00.000Z",
      versoes: [{ numero: 1, criadaEm: "2026-11-05T12:00:00.000Z", tamanho: 2, hash: hashDe("v1") }],
    });
    expect(artefato.versaoAtual.numero).toBe(1);
  });

  it.each([
    ["painel.html", "painel"],
    ["Plano__de---acao.md", "Plano de acao"],
    ["  espacos  .markdown", "espacos"],
    ["notas.v2.htm", "notas.v2"],
    ["---.html", "Artefato"],
    [`${"x".repeat(200)}.md`, "x".repeat(TAMANHO_MAXIMO_DO_TITULO)],
  ])("título inicial de %j é %j", (arquivo, titulo) => {
    expect(tituloInicial(arquivo)).toBe(titulo);
  });

  it.each([
    ["a.html", "html"],
    ["a.HTM", "html"],
    ["a.md", "markdown"],
    ["a.Markdown", "markdown"],
    ["a.txt", null],
    ["a.html.tmp", null],
    [".md", null],
    ["semextensao", null],
    ["a.constructor", null],
  ])("formato de %j é %j", (arquivo, formato) => {
    expect(formatoDoArquivo(arquivo)).toBe(formato);
  });

  it("guarda a origem de um Orquestrador", () => {
    const artefato = novoArtefato("x.md", OrigemDoArtefato.doOrquestrador("orq-1"));

    expect(artefato.paraDados().origem).toEqual({ tipo: "orquestrador", id: "orq-1" });
    expect(artefato.formato).toBe("markdown");
    expect(artefato.vemDe(OrigemDoArtefato.doOrquestrador("orq-1"), "x.md")).toBe(true);
    expect(artefato.vemDe(OrigemDoArtefato.doChat(), "x.md")).toBe(false);
  });

  it("recusa arquivo que não é HTML nem Markdown, ou nome com pasta", () => {
    expect(capturarErro(() => novoArtefato("dados.txt")).motivo).toBe("dados_invalidos");
    expect(capturarErro(() => novoArtefato("..\\fora.html")).motivo).toBe("dados_invalidos");
    expect(capturarErro(() => novoArtefato("sub/x.html")).motivo).toBe("dados_invalidos");
  });

  it("adicionarVersao com conteúdo novo cria a versão seguinte e atualiza atualizadoEm", () => {
    const artefato = novoArtefato();

    const versao = artefato.adicionarVersao(hashDe("v2"), 20, depois);

    expect(versao?.numero).toBe(2);
    expect(artefato.versaoAtual.hash).toBe(hashDe("v2"));
    expect(artefato.versoes.map((v) => v.numero)).toEqual([1, 2]);
    expect(artefato.atualizadoEm).toEqual(depois);
    expect(artefato.criadoEm).toEqual(criadoEm);
  });

  it("a mesma versão (hash igual ao da última) não duplica nem muda atualizadoEm", () => {
    const artefato = novoArtefato();

    expect(artefato.adicionarVersao(hashDe("v1"), 2, depois)).toBeNull();
    expect(artefato.versoes).toHaveLength(1);
    expect(artefato.atualizadoEm).toEqual(criadoEm);
  });

  it("voltar a um conteúdo antigo (A → B → A) é uma versão nova", () => {
    const artefato = novoArtefato();
    artefato.adicionarVersao(hashDe("v2"), 2, depois);

    expect(artefato.adicionarVersao(hashDe("v1"), 2, depois)?.numero).toBe(3);
  });

  it("renomear apara o título, atualiza atualizadoEm e devolve se mudou", () => {
    const artefato = novoArtefato();

    expect(artefato.renomear("  Vendas de outubro ", depois)).toBe(true);
    expect(artefato.titulo).toBe("Vendas de outubro");
    expect(artefato.atualizadoEm).toEqual(depois);
    expect(artefato.renomear("Vendas de outubro", new Date("2026-11-05T13:00:00Z"))).toBe(false);
    expect(artefato.atualizadoEm).toEqual(depois);
  });

  it.each([[""], ["   "], ["x".repeat(TAMANHO_MAXIMO_DO_TITULO + 1)]])("renomear recusa o título %j", (titulo) => {
    const artefato = novoArtefato();

    const erro = capturarErro(() => artefato.renomear(titulo, depois));

    expect(erro.motivo).toBe("dados_invalidos");
    expect(erro.message).toBe("Título inválido.");
    expect(artefato.titulo).toBe("relatorio de vendas");
  });

  it("renomear aceita exatamente 120 caracteres, contados depois de aparar", () => {
    const artefato = novoArtefato();

    artefato.renomear(` ${"y".repeat(TAMANHO_MAXIMO_DO_TITULO)} `, depois);

    expect(artefato.titulo).toHaveLength(TAMANHO_MAXIMO_DO_TITULO);
  });

  it("reconstitui exatamente os dados gravados e recusa versões fora de sequência", () => {
    const artefato = novoArtefato();
    artefato.adicionarVersao(hashDe("v2"), 5, depois);
    const dados = artefato.paraDados();

    expect(Artefato.reconstituir(dados).paraDados()).toEqual(dados);
    expect(() => Artefato.reconstituir({ ...dados, versoes: [] })).toThrow(ErroDeArtefato);
    expect(() => Artefato.reconstituir({ ...dados, versoes: dados.versoes.slice(1) })).toThrow(ErroDeArtefato);
  });

  it("a origem recusa id de orquestrador que escaparia da pasta", () => {
    expect(capturarErro(() => OrigemDoArtefato.doOrquestrador("..\\fora")).motivo).toBe("dados_invalidos");
    expect(OrigemDoArtefato.doChat().igualA(OrigemDoArtefato.doChat())).toBe(true);
  });
});
