import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RepositorioDeModelosDeCanvasEmArquivo } from "../infraestrutura/arquivos/RepositorioDeModelosDeCanvasEmArquivo";
import {
  ArquivoDoModeloDeCanvas,
  ConteudoDoModeloDeCanvas,
  DadosDoModeloDeCanvas,
  enderecoSemSegredos,
  semSegredos,
} from "../modelos/ModeloDeCanvas";
import { ServicoDeModelosDeCanvas } from "../modelos/ServicoDeModelosDeCanvas";
import { criarModelosDeCanvasRoutes } from "./modelosDeCanvasRoutes";

const CONFIGURACAO = {
  modeloDoOrquestrador: "opus",
  modeloDosSubagentes: "sonnet",
  quantidadeDeSubagentes: { modo: "automatica", limite: 3 },
  nivelDePermissao: "edicao_e_comandos",
  permitirCommitEPush: false,
  esforcoDoOrquestrador: "alto",
  esforcoDosSubagentes: "padrao",
  instrucoesPersonalizadas: "Use a chave API_KEY=abc123segredo e rode os testes.",
  subagentesProntos: "todos",
} as const;

function conteudo(alteracoes: Partial<ConteudoDoModeloDeCanvas> = {}): ConteudoDoModeloDeCanvas {
  return {
    nome: "Backend + prévia",
    icone: "🚀",
    cor: "#d97757",
    itens: [
      {
        tipo: "orquestrador",
        x: 0,
        y: 0,
        largura: 600,
        altura: 520,
        nome: "API",
        pastaDeTrabalho: "/Users/pedro/projetos/api",
        configuracao: { ...CONFIGURACAO, quantidadeDeSubagentes: { modo: "automatica", limite: 3 } },
      },
      {
        tipo: "nota",
        x: 640,
        y: 0,
        largura: 320,
        altura: 280,
        titulo: "Como subir",
        texto: "token: ghp_abcdefghijklmnopqrstuvwxyz0123 e depois npm run dev",
      },
      { tipo: "previa", x: 0, y: 560, url: "http://pedro:senha@localhost:5173/painel?access_token=xyz&aba=2" },
      { tipo: "terminal", x: 760, y: 560, pasta: "/Users/pedro/projetos/api", comando: "npm run dev" },
    ],
    ...alteracoes,
  };
}

describe("rotas de modelos de canvas", () => {
  let pasta: string;
  let servidor: Server;
  let base: string;
  let repositorio: RepositorioDeModelosDeCanvasEmArquivo;
  let ids: number;

  beforeEach(async () => {
    pasta = await mkdtemp(path.join(tmpdir(), "rotas-modelos-teste-"));
    repositorio = await RepositorioDeModelosDeCanvasEmArquivo.abrir(pasta);
    ids = 0;
    const aplicacao = express();
    aplicacao.use(express.json({ limit: "40mb" }));
    aplicacao.use(
      "/api",
      criarModelosDeCanvasRoutes({
        servico: new ServicoDeModelosDeCanvas({
          repositorio,
          gerarId: () => `modelo-${++ids}`,
          agora: () => new Date("2026-11-09T12:00:00Z"),
        }),
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

  async function criar(corpo: unknown = conteudo()): Promise<DadosDoModeloDeCanvas> {
    const resposta = await enviar("POST", "/modelos-de-canvas", corpo);
    expect(resposta.status).toBe(201);
    return (await resposta.json()) as DadosDoModeloDeCanvas;
  }

  it("GET sem modelos responde lista vazia", async () => {
    const resposta = await fetch(`${base}/modelos-de-canvas`);

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual([]);
  });

  it("POST salva com id e datas, apara o nome, ignora campos de fora (como o id do orquestrador) e sobrevive a reabrir", async () => {
    const corpo = conteudo({ nome: "  Backend + prévia  " });
    const comExtras = {
      ...corpo,
      conversa: ["não vai"],
      itens: corpo.itens.map((item) => ({ ...item, id: "o1", worktree: { caminho: "/tmp/x" }, eventos: [] })),
    };

    const salvo = await criar(comExtras);

    expect(salvo).toEqual({
      ...conteudo(),
      id: "modelo-1",
      criadoEm: "2026-11-09T12:00:00.000Z",
      atualizadoEm: "2026-11-09T12:00:00.000Z",
    });
    await repositorio.aguardarGravacoes();
    const reaberto = await RepositorioDeModelosDeCanvasEmArquivo.abrir(pasta);
    expect(reaberto.todos()).toEqual([salvo]);
    expect(JSON.stringify(reaberto.todos())).not.toMatch(/worktree|eventos|conversa|"o1"/);
  });

  it.each<[string, unknown, string]>([
    ["corpo que não é objeto", ["oi"], "Envie os dados do modelo."],
    ["sem nome", { ...conteudo(), nome: "   " }, "Dê um nome ao modelo."],
    ["nome longo", { ...conteudo(), nome: "x".repeat(81) }, "O nome do modelo deve ter até 80 caracteres."],
    ["sem ícone", { ...conteudo(), icone: "" }, "Escolha um ícone para o modelo."],
    ["cor fora do formato", { ...conteudo(), cor: "laranja" }, "A cor do modelo deve estar no formato #rrggbb."],
    ["sem itens", { ...conteudo(), itens: [] }, "O modelo precisa de pelo menos 1 item."],
    [
      "itens demais",
      { ...conteudo(), itens: Array.from({ length: 31 }, () => ({ tipo: "previa", x: 0, y: 0, url: "" })) },
      "Um modelo pode ter até 30 itens.",
    ],
    [
      "item de outro tipo",
      { ...conteudo(), itens: [{ tipo: "artefato", x: 0, y: 0 }] },
      'Tipo de item do modelo inválido (use "orquestrador", "nota", "previa" ou "terminal").',
    ],
    [
      "nota longa",
      { ...conteudo(), itens: [{ tipo: "nota", x: 0, y: 0, titulo: "N", texto: "x".repeat(100_001) }] },
      "A nota pode ter até 100.000 caracteres.",
    ],
    [
      "prévia sem http",
      { ...conteudo(), itens: [{ tipo: "previa", x: 0, y: 0, url: "file:///etc/passwd" }] },
      "O endereço da prévia deve começar com http:// ou https://.",
    ],
    [
      "posição que não é número",
      { ...conteudo(), itens: [{ tipo: "previa", x: "0", y: 0, url: "" }] },
      "A posição de cada item deve ser um número.",
    ],
    [
      "configuração com modelo inválido",
      {
        ...conteudo(),
        itens: [{ tipo: "orquestrador", x: 0, y: 0, nome: "A", configuracao: { ...CONFIGURACAO, modeloDoOrquestrador: "gpt" } }],
      },
      "Modelo do orquestrador inválido.",
    ],
    [
      "instruções longas demais",
      {
        ...conteudo(),
        itens: [
          { tipo: "orquestrador", x: 0, y: 0, nome: "A", configuracao: { ...CONFIGURACAO, instrucoesPersonalizadas: "x".repeat(8_001) } },
        ],
      },
      "As instruções personalizadas devem ter até 4000 caracteres.",
    ],
  ])("POST com %s responde 400 e não grava", async (_caso, corpo, mensagem) => {
    const resposta = await enviar("POST", "/modelos-de-canvas", corpo);

    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toEqual({ erro: mensagem });
    expect(repositorio.todos()).toEqual([]);
  });

  it("o 51º modelo é recusado com 409", async () => {
    await repositorio.salvar(
      Array.from({ length: 50 }, (_, indice) => ({
        ...conteudo(),
        id: `m${indice}`,
        criadoEm: "2026-11-09T12:00:00.000Z",
        atualizadoEm: "2026-11-09T12:00:00.000Z",
      })),
    );

    const resposta = await enviar("POST", "/modelos-de-canvas", conteudo());

    expect(resposta.status).toBe(409);
    expect(await resposta.json()).toEqual({ erro: "Você já tem 50 modelos. Apague um antes de salvar outro." });
  });

  it("PATCH renomeia (e troca ícone e cor) sem mexer nos itens; DELETE apaga", async () => {
    const salvo = await criar();

    const resposta = await enviar("PATCH", `/modelos-de-canvas/${salvo.id}`, { nome: " Só o back ", cor: "#336699" });

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ ...salvo, nome: "Só o back", cor: "#336699" });
    expect((await enviar("PATCH", `/modelos-de-canvas/${salvo.id}`, { nome: "" })).status).toBe(400);

    expect((await enviar("DELETE", `/modelos-de-canvas/${salvo.id}`)).status).toBe(204);
    expect(await (await fetch(`${base}/modelos-de-canvas`)).json()).toEqual([]);
  });

  it.each<[string, unknown]>([
    ["PATCH", { nome: "x" }],
    ["DELETE", undefined],
    ["GET", undefined],
  ])("%s de modelo inexistente responde 404", async (metodo, corpo) => {
    const caminho = metodo === "GET" ? "/modelos-de-canvas/nao-existe/exportar" : "/modelos-de-canvas/nao-existe";

    const resposta = await enviar(metodo, caminho, corpo);

    expect(resposta.status).toBe(404);
    expect(await resposta.json()).toEqual({ erro: "Modelo não encontrado." });
  });

  it("exportar sem caminhos (o padrão) tira pastas, comandos e segredos, e mantém o resto", async () => {
    const salvo = await criar();

    const resposta = await fetch(`${base}/modelos-de-canvas/${salvo.id}/exportar`);

    expect(resposta.status).toBe(200);
    expect(resposta.headers.get("content-disposition")).toBe('attachment; filename="modelo-backend-previa.json"');
    const arquivo = (await resposta.json()) as ArquivoDoModeloDeCanvas;
    expect(arquivo).toMatchObject({
      formato: "orquestrador-de-agentes/modelo-de-canvas",
      versao: 1,
      exportadoEm: "2026-11-09T12:00:00.000Z",
    });
    const [orquestrador, nota, previa, terminal] = arquivo.modelo.itens;
    expect(orquestrador).not.toHaveProperty("pastaDeTrabalho");
    expect(orquestrador).toMatchObject({ nome: "API", x: 0, y: 0, largura: 600, altura: 520 });
    expect(orquestrador?.tipo === "orquestrador" && orquestrador.configuracao.instrucoesPersonalizadas).toBe(
      "Use a chave API_KEY=[removido] e rode os testes.",
    );
    expect(nota).toMatchObject({ titulo: "Como subir", texto: "token: [removido] e depois npm run dev" });
    expect(previa).toEqual({ tipo: "previa", x: 0, y: 560, url: "http://localhost:5173/painel?aba=2" });
    expect(terminal).toEqual({ tipo: "terminal", x: 760, y: 560 });
    expect(JSON.stringify(arquivo)).not.toMatch(/\/Users\/pedro|"comando"|"pasta|ghp_|abc123segredo|senha@|access_token/);
  });

  it("exportar com semCaminhos=0 leva tudo como está, e o arquivo exportado volta pela importação", async () => {
    const salvo = await criar();

    const arquivo = (await (await fetch(`${base}/modelos-de-canvas/${salvo.id}/exportar?semCaminhos=0`)).json()) as ArquivoDoModeloDeCanvas;

    expect(arquivo.modelo).toEqual(conteudo());
    const conferido = await enviar("POST", "/modelos-de-canvas/importacao/conferir", arquivo);
    expect(conferido.status).toBe(200);
    expect(await conferido.json()).toEqual(conteudo());
    // Conferir não grava: só o modelo criado acima.
    expect(repositorio.todos()).toHaveLength(1);
  });

  it.each<[string, unknown, string]>([
    ["outro formato", { formato: "outra-coisa", versao: 1, modelo: conteudo() }, "Este arquivo não é um modelo de canvas do Orquestrador."],
    ["versão futura", { formato: "orquestrador-de-agentes/modelo-de-canvas", versao: 2, modelo: conteudo() }, "Versão de modelo de canvas não suportada."],
    ["lista solta", [conteudo()], "Este arquivo não é um modelo de canvas do Orquestrador."],
    [
      "modelo inválido",
      { formato: "orquestrador-de-agentes/modelo-de-canvas", versao: 1, modelo: { ...conteudo(), cor: "azul" } },
      "A cor do modelo deve estar no formato #rrggbb.",
    ],
  ])("conferir importação com %s responde 400", async (_caso, corpo, mensagem) => {
    const resposta = await enviar("POST", "/modelos-de-canvas/importacao/conferir", corpo);

    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toEqual({ erro: mensagem });
    expect(repositorio.todos()).toEqual([]);
  });
});

describe("segredos no modelo exportado", () => {
  it.each([
    ["sk-ant-api03-abcdefghijklmnopqrstuv", "[removido]"],
    ["export OPENAI_API_KEY='sk-abcdef'", "export OPENAI_API_KEY='[removido]'"],
    ["senha = hunter22", "senha = [removido]"],
    ["AKIAABCDEFGHIJKLMNOP no bucket", "[removido] no bucket"],
    ["texto comum, sem nada", "texto comum, sem nada"],
  ])("semSegredos(%j)", (texto, esperado) => {
    expect(semSegredos(texto)).toBe(esperado);
  });

  it("endereço sem credenciais fica igual; com elas, sai sem usuário, senha e parâmetros sensíveis", () => {
    expect(enderecoSemSegredos("http://localhost:5173")).toBe("http://localhost:5173");
    expect(enderecoSemSegredos("https://app.exemplo.com/?apiKey=1&q=ok")).toBe("https://app.exemplo.com/?q=ok");
  });
});
