import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { request as pedidoHttp, Server } from "node:http";
import { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import express, { Express } from "express";
import { afterEach, describe, expect, it } from "vitest";

import { montarAplicacao } from "../root";
import { acessoSoPeloApp, hostDoServidorLocal, lerCookie, MENSAGEM_DE_ACESSO_NEGADO, NOME_DO_COOKIE_DE_ACESSO } from "./acessoSoPeloApp";

const CHAVE = "0123456789abcdef".repeat(4);
const URL_DE_DOWNLOAD = "https://exemplo.com/baixar";

let servidor: Server | undefined;

async function subir(aplicacao: Express): Promise<string> {
  servidor = aplicacao.listen(0, "127.0.0.1");
  await once(servidor, "listening");
  return `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
}

afterEach(async () => {
  if (servidor !== undefined) {
    servidor.close();
    await once(servidor, "close");
    servidor = undefined;
  }
});

function aplicacaoComTrava(urlDeDownload: string | null = null): Express {
  const aplicacao = express();
  aplicacao.use(acessoSoPeloApp({ chave: CHAVE, urlDeDownload }));
  aplicacao.get("/api/saude", (_requisicao, resposta) => {
    resposta.json({ ok: true });
  });
  aplicacao.get("/", (_requisicao, resposta) => {
    resposta.send("tela");
  });
  return aplicacao;
}

describe("lerCookie", () => {
  it("acha o cookie entre vários, com espaços e valores com =", () => {
    const cabecalho = `a=1;  ${NOME_DO_COOKIE_DE_ACESSO} = ${CHAVE} ; b=x=y==`;
    expect(lerCookie(cabecalho, NOME_DO_COOKIE_DE_ACESSO)).toBe(CHAVE);
    expect(lerCookie(cabecalho, "b")).toBe("x=y==");
    expect(lerCookie(cabecalho, "c")).toBeNull();
    expect(lerCookie(undefined, "a")).toBeNull();
    expect(lerCookie("semigual; a=\"aspas\"", "a")).toBe("aspas");
  });
});

/** Um GET com o cabeçalho Host à escolha (o `fetch` não deixa trocá-lo). */
function pedirComHost(base: string, host: string | undefined, cabecalhos: Record<string, string>): Promise<number> {
  const { hostname, port } = new URL(base);
  return new Promise((resolver, rejeitar) => {
    const pedido = pedidoHttp(
      { hostname, port, path: "/api/saude", headers: { ...cabecalhos, ...(host === undefined ? {} : { Host: host }) } },
      (resposta) => {
        resposta.resume();
        resposta.on("end", () => resolver(resposta.statusCode ?? 0));
      },
    );
    pedido.on("error", rejeitar);
    pedido.end();
  });
}

describe("hostDoServidorLocal", () => {
  it("aceita 127.0.0.1 e localhost só na porta em que a conexão chegou", () => {
    expect(hostDoServidorLocal("127.0.0.1:3200", 3200)).toBe(true);
    expect(hostDoServidorLocal("localhost:3200", 3200)).toBe(true);
    expect(hostDoServidorLocal("LocalHost:3200", 3200)).toBe(true);
    expect(hostDoServidorLocal("127.0.0.1:3201", 3200)).toBe(false);
    expect(hostDoServidorLocal("127.0.0.1", 3200)).toBe(false);
    expect(hostDoServidorLocal("atacante.example.com:3200", 3200)).toBe(false);
    expect(hostDoServidorLocal("127.0.0.1.atacante.com:3200", 3200)).toBe(false);
    expect(hostDoServidorLocal("localhost.atacante.com:3200", 3200)).toBe(false);
    expect(hostDoServidorLocal("[::1]:3200", 3200)).toBe(false);
    expect(hostDoServidorLocal(undefined, 3200)).toBe(false);
    expect(hostDoServidorLocal("127.0.0.1:3200", undefined)).toBe(false);
  });
});

describe("acessoSoPeloApp", () => {
  it("com o cookie certo mas o Host de outro nome (DNS rebinding): 403", async () => {
    const base = await subir(aplicacaoComTrava());
    const porta = new URL(base).port;
    const cookie = { Cookie: `${NOME_DO_COOKIE_DE_ACESSO}=${CHAVE}` };
    expect(await pedirComHost(base, `127.0.0.1:${porta}`, cookie)).toBe(200);
    expect(await pedirComHost(base, `localhost:${porta}`, cookie)).toBe(200);
    expect(await pedirComHost(base, `atacante.example.com:${porta}`, cookie)).toBe(403);
    expect(await pedirComHost(base, "atacante.example.com", cookie)).toBe(403);
    expect(await pedirComHost(base, `127.0.0.1:${Number(porta) + 1}`, cookie)).toBe(403);
  });

  it("sem cookie, pedindo HTML: 403 com a página do aplicativo", async () => {
    const base = await subir(aplicacaoComTrava());
    const resposta = await fetch(`${base}/`, { headers: { Accept: "text/html,application/xhtml+xml,*/*;q=0.8" } });
    expect(resposta.status).toBe(403);
    expect(resposta.headers.get("cache-control")).toBe("no-store");
    expect(resposta.headers.get("content-type")).toMatch(/text\/html/);
    const corpo = await resposta.text();
    expect(corpo).toContain("<title>Orquestrador de Agentes</title>");
    expect(corpo).toContain("O Orquestrador de Agentes roda só no aplicativo.");
    expect(corpo).not.toContain("Baixe o aplicativo");
    expect(corpo).not.toContain("<script");
    expect(corpo).not.toContain(CHAVE);
  });

  it("mostra o link de download só quando configurado", async () => {
    const base = await subir(aplicacaoComTrava(URL_DE_DOWNLOAD));
    const corpo = await (await fetch(`${base}/`, { headers: { Accept: "text/html" } })).text();
    expect(corpo).toContain(`<a href="${URL_DE_DOWNLOAD}">Baixe o aplicativo</a>`);
  });

  it("sem cookie, em /api: 403 em JSON, mesmo pedindo HTML", async () => {
    const base = await subir(aplicacaoComTrava());
    for (const accept of ["text/html", "application/json", "text/event-stream"]) {
      const resposta = await fetch(`${base}/api/saude`, { headers: { Accept: accept } });
      expect(resposta.status).toBe(403);
      expect(resposta.headers.get("cache-control")).toBe("no-store");
      expect(await resposta.json()).toEqual({ erro: MENSAGEM_DE_ACESSO_NEGADO });
    }
  });

  it("fora de /api, pedindo JSON: 403 em JSON", async () => {
    const base = await subir(aplicacaoComTrava());
    const resposta = await fetch(`${base}/`, { headers: { Accept: "application/json" } });
    expect(resposta.status).toBe(403);
    expect(await resposta.json()).toEqual({ erro: MENSAGEM_DE_ACESSO_NEGADO });
  });

  it("com cookie errado ou de outro tamanho: 403, sem lançar e sem vazar a chave", async () => {
    const base = await subir(aplicacaoComTrava(URL_DE_DOWNLOAD));
    for (const valor of ["f".repeat(64), "abc", `${CHAVE}00`, ""]) {
      for (const accept of ["text/html", "application/json"]) {
        const resposta = await fetch(`${base}/`, {
          headers: { Accept: accept, Cookie: `${NOME_DO_COOKIE_DE_ACESSO}=${valor}` },
        });
        expect(resposta.status).toBe(403);
        expect(await resposta.text()).not.toContain(CHAVE);
      }
    }
  });

  it("com o cookie certo entre outros cookies: passa", async () => {
    const base = await subir(aplicacaoComTrava());
    const cookie = `tema=escuro; ${NOME_DO_COOKIE_DE_ACESSO}=${CHAVE}; outro=a=b`;
    const saude = await fetch(`${base}/api/saude`, { headers: { Cookie: cookie } });
    expect(saude.status).toBe(200);
    expect(await saude.json()).toEqual({ ok: true });
    const tela = await fetch(`${base}/`, { headers: { Cookie: cookie, Accept: "text/html" } });
    expect(await tela.text()).toBe("tela");
  });
});

describe("montarAplicacao", () => {
  const base = { urlDeDownload: null, pastaDaTela: path.join(tmpdir(), "nao-existe-tela-orquestrador") };

  it("com chave, a trava vem antes das rotas, do corpo JSON e da tela", async () => {
    const pastaDaTela = await mkdtemp(path.join(tmpdir(), "tela-teste-"));
    try {
      await writeFile(path.join(pastaDaTela, "index.html"), "<p>tela</p>");
      let rotaChamada = false;
      const aplicacao = montarAplicacao(
        { ...base, pastaDaTela, chaveDeAcesso: CHAVE, permitirNavegador: false },
        (rotas) => {
          rotas.post("/api/coisa", (_requisicao, resposta) => {
            rotaChamada = true;
            resposta.json({ ok: true });
          });
        },
      );
      const url = await subir(aplicacao);

      // Corpo inválido: se o express.json viesse antes, responderia 400.
      const negado = await fetch(`${url}/api/coisa`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{ não é json",
      });
      expect(negado.status).toBe(403);
      expect(rotaChamada).toBe(false);

      const tela = await fetch(`${url}/index.html`, { headers: { Accept: "text/html" } });
      expect(tela.status).toBe(403);
      expect(await tela.text()).not.toContain("<p>tela</p>");

      const cookie = `${NOME_DO_COOKIE_DE_ACESSO}=${CHAVE}`;
      const liberado = await fetch(`${url}/api/coisa`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: "{}",
      });
      expect(liberado.status).toBe(200);
      const telaLiberada = await fetch(`${url}/qualquer/rota`, { headers: { Cookie: cookie } });
      expect(await telaLiberada.text()).toBe("<p>tela</p>");
    } finally {
      await rm(pastaDaTela, { recursive: true, force: true });
    }
  });

  it("com a liberação do navegador, não há trava mesmo com chave", async () => {
    const aplicacao = montarAplicacao({ ...base, chaveDeAcesso: CHAVE, permitirNavegador: true }, (rotas) => {
      rotas.get("/api/saude", (_requisicao, resposta) => {
        resposta.json({ ok: true });
      });
    });
    const url = await subir(aplicacao);
    expect((await fetch(`${url}/api/saude`)).status).toBe(200);
  });

  it("sem chave e sem liberação, recusa montar", () => {
    expect(() =>
      montarAplicacao({ ...base, chaveDeAcesso: null, permitirNavegador: false }, () => undefined),
    ).toThrow(/roda só dentro do aplicativo/);
  });
});
