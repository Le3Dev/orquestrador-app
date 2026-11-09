import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DadosDoModeloDeCanvas } from "../../modelos/ModeloDeCanvas";
import { RepositorioDeModelosDeCanvasEmArquivo } from "./RepositorioDeModelosDeCanvasEmArquivo";

function modelo(id: string, alteracoes: Partial<DadosDoModeloDeCanvas> = {}): DadosDoModeloDeCanvas {
  return {
    id,
    nome: `Modelo ${id}`,
    icone: "🧩",
    cor: "#d97757",
    itens: [
      {
        tipo: "orquestrador",
        x: 0,
        y: 0,
        largura: 600,
        altura: 520,
        nome: "Backend",
        pastaDeTrabalho: "/projetos/api",
        configuracao: {
          modeloDoOrquestrador: "opus",
          modeloDosSubagentes: "sonnet",
          quantidadeDeSubagentes: { modo: "automatica", limite: 3 },
          nivelDePermissao: "edicao",
          instrucoesPersonalizadas: "Rode os testes.",
        },
      },
      { tipo: "nota", x: 640, y: 0, titulo: "Pendências", texto: "- [ ] revisar" },
      { tipo: "previa", x: 0, y: 560, url: "http://localhost:5173" },
      { tipo: "terminal", x: 760, y: 560, pasta: "/projetos/api", comando: "npm run dev" },
    ],
    criadoEm: "2026-11-09T12:00:00.000Z",
    atualizadoEm: "2026-11-09T12:00:00.000Z",
    ...alteracoes,
  };
}

describe("RepositorioDeModelosDeCanvasEmArquivo", () => {
  let pasta: string;

  beforeEach(async () => {
    pasta = await mkdtemp(path.join(tmpdir(), "modelos-de-canvas-teste-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(pasta, { recursive: true, force: true });
  });

  it("sem arquivo, abre vazio e não cria nada", async () => {
    const repositorio = await RepositorioDeModelosDeCanvasEmArquivo.abrir(pasta);

    expect(repositorio.todos()).toEqual([]);
    expect(existsSync(path.join(pasta, "modelos-de-canvas.json"))).toBe(false);
  });

  it("grava, vale na hora e reabre igual", async () => {
    const repositorio = await RepositorioDeModelosDeCanvasEmArquivo.abrir(pasta);
    await repositorio.salvar([modelo("m1"), modelo("m2", { nome: "Front" })]);

    expect(repositorio.todos().map((salvo) => salvo.nome)).toEqual(["Modelo m1", "Front"]);
    const reaberto = await RepositorioDeModelosDeCanvasEmArquivo.abrir(pasta);
    expect(reaberto.todos()).toEqual([modelo("m1"), modelo("m2", { nome: "Front" })]);
    expect(JSON.parse(await readFile(path.join(pasta, "modelos-de-canvas.json"), "utf8"))).toEqual({
      modelos: [modelo("m1"), modelo("m2", { nome: "Front" })],
    });
  });

  it("devolve cópias: mexer na lista lida não muda o repositório", async () => {
    const repositorio = await RepositorioDeModelosDeCanvasEmArquivo.abrir(pasta);
    const original = modelo("m1");
    await repositorio.salvar([original]);

    original.nome = "mudado por fora";
    const lido = repositorio.todos()[0];
    if (lido !== undefined) {
      lido.nome = "mudado na cópia";
    }

    expect(repositorio.todos()[0]?.nome).toBe("Modelo m1");
  });

  it("gravações seguidas chegam ao disco na ordem: a última vence", async () => {
    const repositorio = await RepositorioDeModelosDeCanvasEmArquivo.abrir(pasta);
    await Promise.all([repositorio.salvar([modelo("m1")]), repositorio.salvar([modelo("m1"), modelo("m2")])]);

    const reaberto = await RepositorioDeModelosDeCanvasEmArquivo.abrir(pasta);
    expect(reaberto.todos().map((salvo) => salvo.id)).toEqual(["m1", "m2"]);
  });

  it("arquivo de uma versão anterior, sem tamanhos e com campos a mais, abre e perde só os campos a mais", async () => {
    await writeFile(
      path.join(pasta, "modelos-de-canvas.json"),
      JSON.stringify({
        modelos: [
          {
            id: "antigo",
            nome: "Antigo",
            icone: "📋",
            cor: "#336699",
            itens: [{ tipo: "nota", x: 0, y: 0, titulo: "Nota", texto: "", cor: "amarela" }],
            criadoEm: "2026-11-01T10:00:00.000Z",
            atualizadoEm: "2026-11-01T10:00:00.000Z",
            campoQueSumiu: true,
          },
        ],
      }),
      "utf8",
    );

    const repositorio = await RepositorioDeModelosDeCanvasEmArquivo.abrir(pasta);

    expect(repositorio.todos()).toEqual([
      {
        id: "antigo",
        nome: "Antigo",
        icone: "📋",
        cor: "#336699",
        itens: [{ tipo: "nota", x: 0, y: 0, titulo: "Nota", texto: "" }],
        criadoEm: "2026-11-01T10:00:00.000Z",
        atualizadoEm: "2026-11-01T10:00:00.000Z",
      },
    ]);
    expect(existsSync(path.join(pasta, "modelos-de-canvas.ilegivel.json"))).toBe(false);
  });

  it.each([
    ["JSON quebrado", "{ isto não é json"],
    ["item de tipo desconhecido", JSON.stringify({ modelos: [{ ...modelo("m1"), itens: [{ tipo: "bixinho", x: 0, y: 0 }] }] })],
  ])("arquivo ilegível (%s) é guardado à parte, sem derrubar a abertura", async (_caso, conteudo) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await writeFile(path.join(pasta, "modelos-de-canvas.json"), conteudo, "utf8");

    const repositorio = await RepositorioDeModelosDeCanvasEmArquivo.abrir(pasta);

    expect(repositorio.todos()).toEqual([]);
    expect(await readFile(path.join(pasta, "modelos-de-canvas.ilegivel.json"), "utf8")).toBe(conteudo);
    expect(existsSync(path.join(pasta, "modelos-de-canvas.json"))).toBe(false);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("modelos-de-canvas.ilegivel.json"));
  });
});
