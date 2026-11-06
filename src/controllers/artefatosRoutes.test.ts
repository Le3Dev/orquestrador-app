import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OrigemDoArtefato } from "../artefatos/OrigemDoArtefato";
import { ServicoDeArtefatos } from "../artefatos/ServicoDeArtefatos";
import { PastaDeEntradaDosArtefatos } from "../infraestrutura/arquivos/ColetorDeArtefatosEmPasta";
import { RepositorioDeArtefatosEmArquivo } from "../infraestrutura/arquivos/RepositorioDeArtefatosEmArquivo";
import { CanalDosArtefatos, criarArtefatosRoutes, ResumoDoArtefato } from "./artefatosRoutes";

const CSP =
  "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:";

describe("rotas de artefatos", () => {
  let pasta: string;
  let servidor: Server;
  let base: string;
  let repositorio: RepositorioDeArtefatosEmArquivo;
  let entrada: PastaDeEntradaDosArtefatos;
  let servico: ServicoDeArtefatos;
  let relogio: Date;
  let ids: number;

  beforeEach(async () => {
    pasta = await mkdtemp(path.join(tmpdir(), "rotas-artefatos-teste-"));
    repositorio = await RepositorioDeArtefatosEmArquivo.abrir(pasta);
    entrada = new PastaDeEntradaDosArtefatos(path.join(pasta, "artefatos", "entrada"));
    await entrada.garantirPastas();
    relogio = new Date("2026-11-05T12:00:00Z");
    ids = 0;
    const canal = new CanalDosArtefatos();
    servico = new ServicoDeArtefatos({
      repositorio,
      entrada,
      publicador: canal,
      gerarId: () => `art-${++ids}`,
      agora: () => relogio,
    });

    const aplicacao = express();
    aplicacao.use(express.json({ limit: "40mb" }));
    aplicacao.use("/api", criarArtefatosRoutes({ servico, canal }));
    servidor = aplicacao.listen(0, "127.0.0.1");
    await once(servidor, "listening");
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/api`;
  });

  afterEach(async () => {
    servidor.closeAllConnections();
    servidor.close();
    await once(servidor, "close");
    await repositorio.aguardarGravacoes();
    await rm(pasta, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  /** Como o coletor faria: grava na entrada e coleta. */
  async function entregar(arquivo: string, texto: string, origem = OrigemDoArtefato.doChat()): Promise<void> {
    const caminho = entrada.caminhoDe(origem, arquivo);
    await mkdir(path.dirname(caminho), { recursive: true });
    const conteudo = Buffer.from(texto);
    await writeFile(caminho, conteudo);
    await servico.coletar({ origem, arquivo, conteudo, hash: createHash("sha256").update(conteudo).digest("hex") });
  }

  function enviar(metodo: string, caminho: string, corpo?: unknown): Promise<Response> {
    return fetch(`${base}${caminho}`, {
      method: metodo,
      headers: corpo === undefined ? {} : { "Content-Type": "application/json" },
      ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
    });
  }

  it("GET /artefatos sem artefatos responde 200 com lista vazia", async () => {
    const resposta = await fetch(`${base}/artefatos`);

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual([]);
  });

  it("GET /artefatos lista os resumos do atualizado mais recentemente para o mais antigo", async () => {
    await entregar("relatorio-final.html", "<h1>v1</h1>", OrigemDoArtefato.doOrquestrador("orq-1"));
    relogio = new Date("2026-11-05T12:01:00Z");
    await entregar("notas.md", "# notas");
    relogio = new Date("2026-11-05T12:02:00Z");
    await entregar("relatorio-final.html", "<h1>v2</h1>", OrigemDoArtefato.doOrquestrador("orq-1"));

    const lista = (await (await fetch(`${base}/artefatos`)).json()) as ResumoDoArtefato[];

    expect(lista.map((artefato) => artefato.id)).toEqual(["art-1", "art-2"]);
    expect(lista[0]).toEqual({
      id: "art-1",
      titulo: "relatorio final",
      formato: "html",
      origem: { tipo: "orquestrador", id: "orq-1" },
      arquivo: "relatorio-final.html",
      criadoEm: "2026-11-05T12:00:00.000Z",
      atualizadoEm: "2026-11-05T12:02:00.000Z",
      versaoAtual: 2,
      versoes: [
        { numero: 1, criadaEm: "2026-11-05T12:00:00.000Z", tamanho: 11 },
        { numero: 2, criadaEm: "2026-11-05T12:02:00.000Z", tamanho: 11 },
      ],
    });
    expect(lista[1]).toMatchObject({ formato: "markdown", origem: { tipo: "chat", id: null }, versaoAtual: 1 });
  });

  it("GET /artefatos/:id devolve o resumo; inexistente é 404", async () => {
    await entregar("a.html", "<p>a</p>");

    const resposta = await fetch(`${base}/artefatos/art-1`);
    const inexistente = await fetch(`${base}/artefatos/nao-existe`);

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toMatchObject({ id: "art-1", titulo: "a", versaoAtual: 1 });
    expect(inexistente.status).toBe(404);
    expect(await inexistente.json()).toEqual({ erro: "Artefato não encontrado." });
  });

  it("GET da versão devolve o conteúdo bruto com o tipo certo, a CSP e nosniff", async () => {
    await entregar("painel.html", "<h1>Olá</h1><script>1</script>");
    await entregar("leia.md", "# Título\n\ntexto");

    const html = await fetch(`${base}/artefatos/art-1/versoes/1`);
    const markdown = await fetch(`${base}/artefatos/art-2/versoes/1`);

    expect(html.status).toBe(200);
    expect(html.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(html.headers.get("content-security-policy")).toBe(CSP);
    expect(html.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await html.text()).toBe("<h1>Olá</h1><script>1</script>");
    expect(markdown.status).toBe(200);
    expect(markdown.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(markdown.headers.get("content-security-policy")).toBe(CSP);
    expect(await markdown.text()).toBe("# Título\n\ntexto");
  });

  it("GET de versão antiga devolve o conteúdo daquela versão", async () => {
    await entregar("a.html", "<p>1</p>");
    await entregar("a.html", "<p>2</p>");

    expect(await (await fetch(`${base}/artefatos/art-1/versoes/1`)).text()).toBe("<p>1</p>");
    expect(await (await fetch(`${base}/artefatos/art-1/versoes/2`)).text()).toBe("<p>2</p>");
  });

  it.each([["3"], ["0"], ["abc"], ["01"], ["-1"]])("GET da versão %j inexistente é 404", async (numero) => {
    await entregar("a.html", "<p>1</p>");

    const resposta = await fetch(`${base}/artefatos/art-1/versoes/${numero}`);

    expect(resposta.status).toBe(404);
    expect(await resposta.json()).toEqual({ erro: "Versão não encontrada." });
  });

  it("GET da versão de artefato inexistente é 404 do artefato", async () => {
    const resposta = await fetch(`${base}/artefatos/nao-existe/versoes/1`);

    expect(resposta.status).toBe(404);
    expect(await resposta.json()).toEqual({ erro: "Artefato não encontrado." });
  });

  it("PATCH renomeia (aparando) e responde 200 com o resumo", async () => {
    await entregar("a.html", "<p>1</p>");
    relogio = new Date("2026-11-05T12:30:00Z");

    const resposta = await enviar("PATCH", "/artefatos/art-1", { titulo: "  Painel de vendas " });

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toMatchObject({
      id: "art-1",
      titulo: "Painel de vendas",
      atualizadoEm: "2026-11-05T12:30:00.000Z",
    });
    expect(repositorio.buscar("art-1")?.titulo).toBe("Painel de vendas");
  });

  it.each<[string, unknown]>([
    ["vazio", { titulo: "" }],
    ["só espaços", { titulo: "   " }],
    ["longo demais", { titulo: "x".repeat(121) }],
    ["não texto", { titulo: 42 }],
    ["ausente", {}],
    ["corpo que não é objeto", ["x"]],
  ])("PATCH com título %s responde 400 Título inválido.", async (_caso, corpo) => {
    await entregar("a.html", "<p>1</p>");

    const resposta = await enviar("PATCH", "/artefatos/art-1", corpo);

    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toEqual({ erro: "Título inválido." });
    expect(repositorio.buscar("art-1")?.titulo).toBe("a");
  });

  it("PATCH de artefato inexistente é 404", async () => {
    const resposta = await enviar("PATCH", "/artefatos/nao-existe", { titulo: "x" });

    expect(resposta.status).toBe(404);
    expect(await resposta.json()).toEqual({ erro: "Artefato não encontrado." });
  });

  it("DELETE responde 204 e apaga o artefato, as versões e o arquivo da entrada", async () => {
    await entregar("relatorio.md", "# r", OrigemDoArtefato.doOrquestrador("orq-1"));
    const arquivoNaEntrada = path.join(entrada.caminho, "orquestradores", "orq-1", "relatorio.md");
    await stat(arquivoNaEntrada);

    const resposta = await enviar("DELETE", "/artefatos/art-1");
    await repositorio.aguardarGravacoes();

    expect(resposta.status).toBe(204);
    await expect(stat(arquivoNaEntrada)).rejects.toThrow();
    expect(await readdir(path.join(pasta, "artefatos"))).toEqual(["entrada"]);
    expect((await fetch(`${base}/artefatos/art-1`)).status).toBe(404);
    expect(await (await fetch(`${base}/artefatos`)).json()).toEqual([]);
  });

  it("DELETE de artefato inexistente é 404", async () => {
    const resposta = await enviar("DELETE", "/artefatos/nao-existe");

    expect(resposta.status).toBe(404);
    expect(await resposta.json()).toEqual({ erro: "Artefato não encontrado." });
  });

  it("SSE /artefatos/eventos entrega os eventos ao vivo, nomeados e com o resumo", async () => {
    const controle = new AbortController();
    const resposta = await fetch(`${base}/artefatos/eventos`, { signal: controle.signal });
    expect(resposta.status).toBe(200);
    expect(resposta.headers.get("content-type")).toMatch(/^text\/event-stream/);
    const leitor = resposta.body!.getReader();
    const decodificador = new TextDecoder();
    let texto = "";
    const lerAte = async (trecho: string): Promise<void> => {
      while (!texto.includes(trecho)) {
        const { value, done } = await leitor.read();
        if (done) {
          throw new Error(`SSE terminou antes de "${trecho}". Recebido: ${texto}`);
        }
        texto += decodificador.decode(value, { stream: true });
      }
    };

    await lerAte("retry: 3000");
    await entregar("painel.html", "<p>1</p>");
    await lerAte("event: artefato_criado");
    await entregar("painel.html", "<p>2</p>");
    await lerAte("event: versao_adicionada");
    await enviar("PATCH", "/artefatos/art-1", { titulo: "Painel" });
    await lerAte("event: artefato_renomeado");
    await enviar("DELETE", "/artefatos/art-1");
    await lerAte("event: artefato_removido");
    controle.abort();

    const eventos = texto
      .split("\n\n")
      .filter((bloco) => bloco.startsWith("event: "))
      .map((bloco) => {
        const [linhaDoEvento, linhaDosDados] = bloco.split("\n");
        return {
          evento: linhaDoEvento?.slice("event: ".length),
          dados: JSON.parse(linhaDosDados?.slice("data: ".length) ?? "null") as Record<string, unknown>,
        };
      });
    expect(eventos.map((evento) => evento.evento)).toEqual([
      "artefato_criado",
      "versao_adicionada",
      "artefato_renomeado",
      "artefato_removido",
    ]);
    expect(eventos[0]?.dados).toEqual({
      artefato: {
        id: "art-1",
        titulo: "painel",
        formato: "html",
        origem: { tipo: "chat", id: null },
        arquivo: "painel.html",
        criadoEm: "2026-11-05T12:00:00.000Z",
        atualizadoEm: "2026-11-05T12:00:00.000Z",
        versaoAtual: 1,
        versoes: [{ numero: 1, criadaEm: "2026-11-05T12:00:00.000Z", tamanho: 8 }],
      },
    });
    expect(eventos[1]?.dados).toMatchObject({ artefato: { versaoAtual: 2 } });
    expect(eventos[2]?.dados).toMatchObject({ artefato: { titulo: "Painel" } });
    expect(eventos[3]?.dados).toEqual({ id: "art-1" });
    expect(texto).not.toMatch(/^id: /m);
  });
});
