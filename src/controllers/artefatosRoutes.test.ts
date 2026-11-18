import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TracoGravado } from "../artefatos/DesenhoDoArtefato";
import { OrigemDoArtefato } from "../artefatos/OrigemDoArtefato";
import { ServicoDeArtefatos } from "../artefatos/ServicoDeArtefatos";
import { PastaDeEntradaDosArtefatos } from "../infraestrutura/arquivos/ColetorDeArtefatosEmPasta";
import { RepositorioDeArtefatosEmArquivo } from "../infraestrutura/arquivos/RepositorioDeArtefatosEmArquivo";
import { montarAplicacao } from "../root";
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

    // A montagem do app de verdade: o limite do corpo do desenho depende do leitor geral pulá-lo.
    const aplicacao = montarAplicacao(
      { chaveDeAcesso: null, permitirNavegador: true, urlDeDownload: null, pastaDaTela: path.join(pasta, "sem-tela") },
      (rotas) => {
        rotas.use("/api", criarArtefatosRoutes({ servico, canal }));
      },
    );
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

  describe("desenho de cada versão", () => {
    const seta: TracoGravado = {
      id: "t1",
      tipo: "seta",
      cor: "vermelho",
      espessura: 6,
      pontos: [
        { x: 0, y: 0 },
        { x: 10, y: 20 },
      ],
      ancora: { conteiner: [], elemento: [1, 3] },
    };
    const texto: TracoGravado = {
      id: "t2",
      tipo: "texto",
      cor: "claro",
      espessura: 2,
      pontos: [{ x: 4, y: 4 }],
      texto: "aqui",
      ancora: null,
    };
    const pastaDoArtefato = (): string => path.join(pasta, "artefatos", "art-1");

    function enviarTexto(metodo: string, caminho: string, corpo: string): Promise<Response> {
      return fetch(`${base}${caminho}`, { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo });
    }

    it("GET sem desenho responde 200 com lista vazia", async () => {
      await entregar("a.html", "<p>1</p>");

      const resposta = await fetch(`${base}/artefatos/art-1/versoes/1/desenho`);

      expect(resposta.status).toBe(200);
      expect(resposta.headers.get("cache-control")).toBe("no-store");
      expect(await resposta.json()).toEqual({ tracos: [], largura: null });
    });

    it("PUT responde 204, grava v<N>.desenho.json e o GET devolve só os campos conhecidos", async () => {
      await entregar("a.html", "<p>1</p>");
      await entregar("a.html", "<p>2</p>");

      const resposta = await enviar("PUT", "/artefatos/art-1/versoes/1/desenho", {
        tracos: [
          { ...seta, texto: "some: não é texto", extra: true },
          { ...texto, ancora: { conteiner: [0], elemento: [], outro: 1 } },
        ],
        largura: 1280,
        desconhecido: "x",
      });

      expect(resposta.status).toBe(204);
      expect(await resposta.text()).toBe("");
      expect((await readdir(pastaDoArtefato())).sort()).toEqual(["artefato.json", "v1.desenho.json", "v1.html", "v2.html"]);
      expect(await (await fetch(`${base}/artefatos/art-1/versoes/1/desenho`)).json()).toEqual({
        tracos: [seta, { ...texto, ancora: { conteiner: [0], elemento: [] } }],
        largura: 1280,
      });
      // A versão nova começa limpa.
      expect(await (await fetch(`${base}/artefatos/art-1/versoes/2/desenho`)).json()).toEqual({ tracos: [], largura: null });
    });

    it.each<[string, Record<string, unknown>]>([
      ["largura null", { largura: null }],
      ["sem largura (formato anterior)", {}],
    ])("PUT com %s grava largura null e o GET a devolve", async (_caso, largura) => {
      await entregar("a.html", "<p>1</p>");

      const resposta = await enviar("PUT", "/artefatos/art-1/versoes/1/desenho", { tracos: [seta], ...largura });

      expect(resposta.status).toBe(204);
      expect(await (await fetch(`${base}/artefatos/art-1/versoes/1/desenho`)).json()).toEqual({ tracos: [seta], largura: null });
    });

    it.each([[200], [10000]])("PUT com largura %j (limite) é aceito", async (largura) => {
      await entregar("a.html", "<p>1</p>");

      const resposta = await enviar("PUT", "/artefatos/art-1/versoes/1/desenho", { tracos: [seta], largura });

      expect(resposta.status).toBe(204);
      expect(await (await fetch(`${base}/artefatos/art-1/versoes/1/desenho`)).json()).toEqual({ tracos: [seta], largura });
    });

    it("PUT com lista vazia apaga o desenho da versão", async () => {
      await entregar("a.html", "<p>1</p>");
      await enviar("PUT", "/artefatos/art-1/versoes/1/desenho", { tracos: [seta] });

      const resposta = await enviar("PUT", "/artefatos/art-1/versoes/1/desenho", { tracos: [], largura: 900 });

      expect(resposta.status).toBe(204);
      expect((await readdir(pastaDoArtefato())).sort()).toEqual(["artefato.json", "v1.html"]);
      expect(await (await fetch(`${base}/artefatos/art-1/versoes/1/desenho`)).json()).toEqual({ tracos: [], largura: null });
    });

    it("DELETE do artefato leva o desenho junto", async () => {
      await entregar("a.html", "<p>1</p>");
      await enviar("PUT", "/artefatos/art-1/versoes/1/desenho", { tracos: [seta] });

      await enviar("DELETE", "/artefatos/art-1");
      await repositorio.aguardarGravacoes();

      expect(await readdir(path.join(pasta, "artefatos"))).toEqual(["entrada"]);
      expect((await fetch(`${base}/artefatos/art-1/versoes/1/desenho`)).status).toBe(404);
    });

    it.each<[string, string, string]>([
      ["GET", "nao-existe", "1"],
      ["PUT", "nao-existe", "1"],
      ["GET", "nao-existe", "abc"],
    ])("%s do desenho de artefato inexistente é 404 do artefato", async (metodo, id, numero) => {
      const resposta = await enviar(metodo, `/artefatos/${id}/versoes/${numero}/desenho`, metodo === "PUT" ? { tracos: [] } : undefined);

      expect(resposta.status).toBe(404);
      expect(await resposta.json()).toEqual({ erro: "Artefato não encontrado." });
    });

    it.each([["GET"], ["PUT"]])("%s do desenho de versão inexistente é 404 da versão", async (metodo) => {
      await entregar("a.html", "<p>1</p>");

      const resposta = await enviar(metodo, "/artefatos/art-1/versoes/2/desenho", metodo === "PUT" ? { tracos: [seta] } : undefined);

      expect(resposta.status).toBe(404);
      expect(await resposta.json()).toEqual({ erro: "Versão não encontrada." });
      expect((await readdir(pastaDoArtefato())).sort()).toEqual(["artefato.json", "v1.html"]);
    });

    it.each([["0"], ["abc"], ["01"], ["-1"], ["1.5"]])("número de versão %j é 400", async (numero) => {
      await entregar("a.html", "<p>1</p>");

      const leitura = await fetch(`${base}/artefatos/art-1/versoes/${numero}/desenho`);
      const gravacao = await enviar("PUT", `/artefatos/art-1/versoes/${numero}/desenho`, { tracos: [] });

      expect(leitura.status).toBe(400);
      expect(await leitura.json()).toEqual({ erro: "Número de versão inválido." });
      expect(gravacao.status).toBe(400);
      expect(await gravacao.json()).toEqual({ erro: "Número de versão inválido." });
    });

    it.each<[string, unknown]>([
      ["sem tracos", {}],
      ["tracos que não é lista", { tracos: { 0: seta } }],
      ["corpo que é lista", [seta]],
      ["traço que não é objeto", { tracos: ["x"] }],
      ["tipo desconhecido", { tracos: [{ ...seta, tipo: "circulo" }] }],
      ["cor desconhecida", { tracos: [{ ...seta, cor: "#ff0000" }] }],
      ["espessura desconhecida", { tracos: [{ ...seta, espessura: 4 }] }],
      ["espessura em texto", { tracos: [{ ...seta, espessura: "3" }] }],
      ["id vazio", { tracos: [{ ...seta, id: "" }] }],
      ["id longo demais", { tracos: [{ ...seta, id: "x".repeat(65) }] }],
      ["id que não é texto", { tracos: [{ ...seta, id: 1 }] }],
      ["sem pontos", { tracos: [{ ...seta, pontos: [] }] }],
      ["pontos demais", { tracos: [{ ...seta, tipo: "caneta", pontos: Array.from({ length: 5001 }, () => ({ x: 1, y: 1 })) }] }],
      ["ponto com coordenada em texto", { tracos: [{ ...seta, pontos: [{ x: "1", y: 2 }] }] }],
      ["ponto sem y", { tracos: [{ ...seta, pontos: [{ x: 1 }] }] }],
      ["texto longo demais", { tracos: [{ ...texto, texto: "x".repeat(501) }] }],
      ["texto que não é texto", { tracos: [{ ...texto, texto: 42 }] }],
      ["sem âncora", { tracos: [{ ...texto, ancora: undefined }] }],
      ["âncora sem elemento", { tracos: [{ ...seta, ancora: { conteiner: [] } }] }],
      ["índice negativo", { tracos: [{ ...seta, ancora: { conteiner: [-1], elemento: [] } }] }],
      ["índice fracionário", { tracos: [{ ...seta, ancora: { conteiner: [], elemento: [1.5] } }] }],
      ["caminho longo demais", { tracos: [{ ...seta, ancora: { conteiner: Array.from({ length: 65 }, () => 0), elemento: [] } }] }],
      ["traços demais", { tracos: Array.from({ length: 2001 }, (_, indice) => ({ ...texto, id: `t${indice}` })) }],
      ["largura abaixo de 200", { tracos: [seta], largura: 199 }],
      ["largura acima de 10000", { tracos: [seta], largura: 10001 }],
      ["largura fracionária", { tracos: [seta], largura: 1.5 }],
      ["largura em texto", { tracos: [seta], largura: "800" }],
    ])("PUT com %s responde 400 e não grava nada", async (_caso, corpo) => {
      await entregar("a.html", "<p>1</p>");

      const resposta = await enviar("PUT", "/artefatos/art-1/versoes/1/desenho", corpo);

      expect(resposta.status).toBe(400);
      expect(((await resposta.json()) as { erro: string }).erro).toMatch(/^Desenho inválido\./);
      expect((await readdir(pastaDoArtefato())).sort()).toEqual(["artefato.json", "v1.html"]);
    });

    it("PUT com JSON malformado responde 400 em JSON, sem a pilha", async () => {
      await entregar("a.html", "<p>1</p>");

      const resposta = await enviarTexto("PUT", "/artefatos/art-1/versoes/1/desenho", '{"tracos": [');

      expect(resposta.status).toBe(400);
      expect(await resposta.json()).toEqual({ erro: "Desenho inválido." });
    });

    it("PUT com corpo acima de 1 MB responde 413 em JSON, e o limite geral continua valendo nas outras rotas", async () => {
      await entregar("a.html", "<p>1</p>");
      const grande = { tracos: [], enchimento: "x".repeat(1024 * 1024) };

      const resposta = await enviar("PUT", "/artefatos/art-1/versoes/1/desenho", grande);
      const outraRota = await enviar("PATCH", "/artefatos/art-1", { titulo: "Grande", enchimento: "x".repeat(1024 * 1024) });

      expect(resposta.status).toBe(413);
      expect(await resposta.json()).toEqual({ erro: "O desenho passa de 1 MB." });
      expect(outraRota.status).toBe(200);
      expect((await readdir(pastaDoArtefato())).sort()).toEqual(["artefato.json", "v1.html"]);
    });
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
