import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RepositorioDeNotasEmArquivo } from "../infraestrutura/arquivos/RepositorioDeNotasEmArquivo";
import { DadosDaNota } from "../notas/Nota";
import { ServicoDeNotas } from "../notas/ServicoDeNotas";
import { criarNotasRoutes } from "./notasRoutes";

describe("rotas de notas", () => {
  let pasta: string;
  let servidor: Server;
  let base: string;
  let repositorio: RepositorioDeNotasEmArquivo;
  let relogio: Date;
  let ids: number;

  beforeEach(async () => {
    pasta = await mkdtemp(path.join(tmpdir(), "rotas-notas-teste-"));
    repositorio = await RepositorioDeNotasEmArquivo.abrir(pasta);
    relogio = new Date("2026-10-30T12:00:00Z");
    ids = 0;

    const aplicacao = express();
    aplicacao.use(express.json({ limit: "40mb" }));
    aplicacao.use(
      "/api",
      criarNotasRoutes({
        servico: new ServicoDeNotas({ repositorio, gerarId: () => `nota-${++ids}`, agora: () => relogio }),
      }),
    );
    servidor = aplicacao.listen(0, "127.0.0.1");
    await once(servidor, "listening");
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/api`;
  });

  afterEach(async () => {
    servidor.close();
    await once(servidor, "close");
    await repositorio.aguardarGravacoes();
    await rm(pasta, { recursive: true, force: true });
  });

  async function enviar(metodo: string, caminho: string, corpo?: unknown): Promise<Response> {
    return fetch(`${base}${caminho}`, {
      method: metodo,
      headers: corpo === undefined ? {} : { "Content-Type": "application/json" },
      ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
    });
  }

  async function criarNota(corpo: unknown = {}): Promise<DadosDaNota> {
    const resposta = await enviar("POST", "/notas", corpo);
    expect(resposta.status).toBe(201);
    return (await resposta.json()) as DadosDaNota;
  }

  it("GET sem notas responde 200 com lista vazia", async () => {
    const resposta = await fetch(`${base}/notas`);

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual([]);
  });

  it("POST sem corpo cria com os padrões e responde 201", async () => {
    const resposta = await enviar("POST", "/notas");

    expect(resposta.status).toBe(201);
    expect(await resposta.json()).toEqual({
      id: "nota-1",
      titulo: "Nova nota",
      texto: "",
      criadaEm: "2026-10-30T12:00:00.000Z",
      atualizadaEm: "2026-10-30T12:00:00.000Z",
    });
  });

  it("POST aceita título e texto; o GET lista em ordem de criação", async () => {
    await criarNota({ titulo: "Primeira", texto: "a fazer" });
    relogio = new Date("2026-10-30T12:01:00Z");
    await criarNota({ titulo: "Segunda" });

    const lista = (await (await fetch(`${base}/notas`)).json()) as DadosDaNota[];

    expect(lista.map((nota) => [nota.titulo, nota.texto])).toEqual([
      ["Primeira", "a fazer"],
      ["Segunda", ""],
    ]);
  });

  it("PATCH parcial altera só o campo enviado e atualiza atualizadaEm", async () => {
    const nota = await criarNota({ titulo: "Ideias", texto: "corpo" });
    relogio = new Date("2026-10-30T12:10:00Z");

    const resposta = await enviar("PATCH", `/notas/${nota.id}`, { texto: "corpo novo" });

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({
      ...nota,
      texto: "corpo novo",
      atualizadaEm: "2026-10-30T12:10:00.000Z",
    });
  });

  it("a nota editada sobrevive a reabrir o repositório", async () => {
    const nota = await criarNota();
    await enviar("PATCH", `/notas/${nota.id}`, { titulo: "Para depois" });
    await repositorio.aguardarGravacoes();

    const reaberto = await RepositorioDeNotasEmArquivo.abrir(pasta);

    expect(reaberto.buscar(nota.id)?.titulo).toBe("Para depois");
  });

  it("PATCHes simultâneos na mesma nota: o disco termina igual ao último aceito", async () => {
    const nota = await criarNota();

    const respostas = await Promise.all(
      Array.from({ length: 10 }, (_, indice) => enviar("PATCH", `/notas/${nota.id}`, { texto: `versão ${indice}` })),
    );
    const final = ((await (await fetch(`${base}/notas`)).json()) as DadosDaNota[])[0];
    await repositorio.aguardarGravacoes();
    const reaberto = await RepositorioDeNotasEmArquivo.abrir(pasta);

    expect(respostas.every((resposta) => resposta.status === 200)).toBe(true);
    expect(final?.texto).toMatch(/^versão \d$/);
    expect(reaberto.buscar(nota.id)?.paraDados()).toEqual(final);
  });

  it("PATCHes em sequência combinam título e texto sem perder nenhum", async () => {
    const nota = await criarNota();

    await Promise.all([
      enviar("PATCH", `/notas/${nota.id}`, { titulo: "Título novo" }),
      enviar("PATCH", `/notas/${nota.id}`, { texto: "texto novo" }),
    ]);

    expect(repositorio.buscar(nota.id)?.paraDados()).toMatchObject({ titulo: "Título novo", texto: "texto novo" });
  });

  it("DELETE responde 204 e a nota some da lista", async () => {
    const nota = await criarNota();

    const resposta = await enviar("DELETE", `/notas/${nota.id}`);

    expect(resposta.status).toBe(204);
    expect(await (await fetch(`${base}/notas`)).json()).toEqual([]);
  });

  it.each<[string, unknown]>([
    ["PATCH", { titulo: "x" }],
    ["DELETE", undefined],
  ])("%s de nota inexistente responde 404", async (metodo, corpo) => {
    const resposta = await enviar(metodo, "/notas/nao-existe", corpo);

    expect(resposta.status).toBe(404);
    expect(await resposta.json()).toEqual({ erro: "Nota não encontrada." });
  });

  it.each<[string, unknown, string]>([
    ["título vazio", { titulo: "   " }, "O título da nota deve ter entre 1 e 120 caracteres."],
    ["título longo", { titulo: "x".repeat(121) }, "O título da nota deve ter entre 1 e 120 caracteres."],
    ["texto longo", { texto: "x".repeat(100_001) }, "A nota pode ter até 100.000 caracteres."],
    ["título que não é texto", { titulo: 42 }, "O título da nota deve ser um texto."],
    ["texto que não é texto", { texto: null }, "O conteúdo da nota deve ser um texto."],
    ["corpo que não é objeto", ["oi"], "Envie os dados da nota."],
  ])("POST com %s responde 400", async (_caso, corpo, mensagem) => {
    const resposta = await enviar("POST", "/notas", corpo);

    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toEqual({ erro: mensagem });
    expect(repositorio.todas()).toEqual([]);
  });

  it("PATCH inválido responde 400 e não grava nada pela metade", async () => {
    const nota = await criarNota({ titulo: "Original", texto: "corpo" });

    const resposta = await enviar("PATCH", `/notas/${nota.id}`, { titulo: "Novo", texto: "x".repeat(100_001) });

    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toEqual({ erro: "A nota pode ter até 100.000 caracteres." });
    expect(repositorio.buscar(nota.id)?.paraDados()).toEqual(nota);
  });
});
