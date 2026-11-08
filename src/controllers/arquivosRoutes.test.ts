import { once } from "node:events";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { SistemaDeArquivosEmDisco } from "../infraestrutura/arquivos/SistemaDeArquivosEmDisco";
import { TAMANHO_MAXIMO_DO_ARQUIVO } from "../orquestracao/ArquivosDaPasta";
import { ConfiguracaoDoOrquestrador } from "../orquestracao/ConfiguracaoDoOrquestrador";
import { Orquestrador } from "../orquestracao/Orquestrador";
import { PastaDeTrabalho } from "../orquestracao/PastaDeTrabalho";
import { ServicoDeArquivos } from "../orquestracao/ServicoDeArquivos";
import { criarArquivosRoutes } from "./arquivosRoutes";

const COM_ACENTO = "docs/relatório final.md";

describe("rotas do visualizador de arquivos", () => {
  let servidor: Server;
  let base: string;
  let pasta: string;
  let url: string;
  let orquestrador: Orquestrador;

  async function gravar(relativo: string, conteudo: string | Buffer, raiz = pasta): Promise<void> {
    const destino = path.join(raiz, relativo);
    await mkdir(path.dirname(destino), { recursive: true });
    await writeFile(destino, conteudo);
  }

  beforeAll(async () => {
    base = await mkdtemp(path.join(tmpdir(), "rotas-de-arquivos-"));
    pasta = path.join(base, "painel");
    await gravar("src/app.ts", "const a = 1;\n");
    await gravar(COM_ACENTO, "# Relatório\n\nfim");
    await gravar(".env", "SENHA=1");
    await gravar(".git/config", "[core]");
    await gravar("dados.bin", Buffer.from([1, 0, 2]));
    await gravar("grande.log", "x".repeat(TAMANHO_MAXIMO_DO_ARQUIVO + 10));
    await gravar("segredo.txt", "de fora", path.join(base, "fora"));
    await symlink(path.join(base, "fora", "segredo.txt"), path.join(pasta, "atalho.txt"));

    const aplicacao = express();
    aplicacao.use(
      "/api",
      criarArquivosRoutes({
        servico: new ServicoDeArquivos({
          // O Orquestrador muda a cada teste; a rota sempre usa o atual.
          repositorio: { buscarPorId: (id) => (id === orquestrador.id ? orquestrador : null) },
          sistema: new SistemaDeArquivosEmDisco(),
        }),
      }),
    );
    servidor = aplicacao.listen(0, "127.0.0.1");
    await once(servidor, "listening");
    url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/api/orquestradores`;
  });

  afterAll(async () => {
    servidor.close();
    await once(servidor, "close");
    await rm(base, { recursive: true, force: true });
  });

  beforeEach(() => {
    orquestrador = Orquestrador.criar({
      id: "o1",
      nome: "Painel",
      pastaDeTrabalho: PastaDeTrabalho.qualquer(pasta),
      sessaoId: "s1",
      configuracao: ConfiguracaoDoOrquestrador.de({
        modeloDoOrquestrador: "opus",
        modeloDosSubagentes: "sonnet",
        quantidadeDeSubagentes: { modo: "automatica", limite: 2 },
        nivelDePermissao: "edicao_e_comandos",
      }),
      agora: new Date("2026-11-07T10:00:00Z"),
    });
  });

  function urlDaPasta(caminho?: string): string {
    return `${url}/o1/arquivos${caminho === undefined ? "" : `?caminho=${encodeURIComponent(caminho)}`}`;
  }

  function urlDoArquivo(caminho: string): string {
    return `${url}/o1/arquivos/conteudo?caminho=${encodeURIComponent(caminho)}`;
  }

  describe("GET /orquestradores/:id/arquivos", () => {
    it("200 com um nível da raiz, sem .git, .env e link para fora", async () => {
      const resposta = await fetch(urlDaPasta());

      expect(resposta.status).toBe(200);
      expect(await resposta.json()).toEqual({
        caminho: "",
        entradas: [
          { nome: "docs", tipo: "pasta" },
          { nome: "src", tipo: "pasta" },
          { nome: "dados.bin", tipo: "arquivo", tamanho: 3 },
          { nome: "grande.log", tipo: "arquivo", tamanho: TAMANHO_MAXIMO_DO_ARQUIVO + 10 },
        ],
        truncada: false,
      });
    });

    it("200 com uma subpasta", async () => {
      const resposta = await fetch(urlDaPasta("docs"));

      expect(resposta.status).toBe(200);
      expect(await resposta.json()).toEqual({
        caminho: "docs",
        entradas: [{ nome: "relatório final.md", tipo: "arquivo", tamanho: 17 }],
        truncada: false,
      });
    });

    it.each<[string, string, number]>([
      ["../", "?caminho=..%2F", 400],
      ["absoluto", `?caminho=${encodeURIComponent(path.join(tmpdir(), "fora"))}`, 400],
      ["repetido", "?caminho=src&caminho=docs", 400],
      [".git", "?caminho=.git", 403],
      ["inexistente", "?caminho=nada", 404],
      ["arquivo", "?caminho=src%2Fapp.ts", 400],
    ])("recusa %s com %i", async (_caso, query, status) => {
      const resposta = await fetch(`${url}/o1/arquivos${query}`);

      expect(resposta.status).toBe(status);
      expect(typeof ((await resposta.json()) as { erro: unknown }).erro).toBe("string");
    });

    it("404 para orquestrador inexistente", async () => {
      const resposta = await fetch(`${url}/nao-existe/arquivos`);

      expect(resposta.status).toBe(404);
      expect(await resposta.json()).toEqual({ erro: "Orquestrador não encontrado." });
    });
  });

  describe("GET /orquestradores/:id/arquivos/conteudo", () => {
    it("200 com conteúdo, tamanho e linhas, inclusive com acento e espaço no nome", async () => {
      const resposta = await fetch(urlDoArquivo(COM_ACENTO));

      expect(resposta.status).toBe(200);
      expect(resposta.headers.get("cache-control")).toBe("no-store");
      expect(await resposta.json()).toEqual({
        caminho: COM_ACENTO,
        conteudo: "# Relatório\n\nfim",
        tamanho: 17,
        linhas: 3,
      });
    });

    it.each([
      ["sem o parâmetro", ""],
      ["com o parâmetro vazio", "?caminho="],
      ["com o parâmetro repetido", "?caminho=a&caminho=b"],
    ])("400 %s", async (_caso, query) => {
      const resposta = await fetch(`${url}/o1/arquivos/conteudo${query}`);

      expect(resposta.status).toBe(400);
      expect(await resposta.json()).toEqual({ erro: "Informe o arquivo." });
    });

    it.each<[string, number, string]>([
      ["../fora/segredo.txt", 400, 'Caminho inválido: ".." não é aceito.'],
      ["/etc/passwd", 400, "Caminho inválido: use um caminho relativo à pasta do orquestrador."],
      [".git/config", 403, '".git/config" está bloqueado (.git, node_modules e .env não abrem no visualizador).'],
      [".env", 403, '".env" está bloqueado (.git, node_modules e .env não abrem no visualizador).'],
      ["atalho.txt", 403, '"atalho.txt" aponta para fora da pasta do orquestrador.'],
      ["nada.ts", 404, '"nada.ts" não existe.'],
      ["grande.log", 413, '"grande.log" tem 501 KB; o visualizador abre arquivos de até 500 KB.'],
      ["dados.bin", 415, '"dados.bin" é um arquivo binário e não dá para mostrar como texto.'],
    ])("recusa %j com %i e mensagem pronta", async (caminho, status, erro) => {
      const resposta = await fetch(urlDoArquivo(caminho));

      expect(resposta.status).toBe(status);
      expect(await resposta.json()).toEqual({ erro });
    });
  });
});
