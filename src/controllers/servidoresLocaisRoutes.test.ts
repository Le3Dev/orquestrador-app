import { once } from "node:events";
import { Server } from "node:http";
import { AddressInfo } from "node:net";

import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { criarServidoresLocaisRoutes } from "./servidoresLocaisRoutes";

describe("rotas dos servidores locais", () => {
  let servidor: Server;
  let base: string;
  let sondadas: string[];
  let noAr: (url: string) => boolean | Promise<boolean>;

  beforeEach(async () => {
    sondadas = [];
    noAr = () => true;
    const aplicacao = express();
    aplicacao.use(
      "/api",
      criarServidoresLocaisRoutes({
        sondar: async (url) => {
          sondadas.push(url);
          return noAr(url);
        },
      }),
    );
    servidor = aplicacao.listen(0, "127.0.0.1");
    await once(servidor, "listening");
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/api`;
  });

  afterEach(async () => {
    servidor.closeAllConnections();
    servidor.close();
    await once(servidor, "close");
  });

  function consultar(...urls: string[]): Promise<Response> {
    const consulta = urls.map((url) => `url=${encodeURIComponent(url)}`).join("&");
    return fetch(`${base}/servidores-locais/situacao?${consulta}`);
  }

  it("diz quem está no ar e quem parou, na ordem pedida", async () => {
    noAr = (url) => url.endsWith(":5173");

    const resposta = await consultar("http://localhost:5173", "http://localhost:4000/api");

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({
      situacoes: [
        { url: "http://localhost:5173", noAr: true },
        { url: "http://localhost:4000/api", noAr: false },
      ],
    });
  });

  it("normaliza o endereço e conta repetidos uma vez só", async () => {
    const resposta = await consultar("http://127.0.0.1:5173/", "http://localhost:5173", "http://0.0.0.0:5173");

    expect(await resposta.json()).toEqual({ situacoes: [{ url: "http://localhost:5173", noAr: true }] });
    expect(sondadas).toEqual(["http://localhost:5173"]);
  });

  it("sonda em paralelo", async () => {
    let emAndamento = 0;
    let maximo = 0;
    noAr = async () => {
      emAndamento += 1;
      maximo = Math.max(maximo, emAndamento);
      await new Promise((resolver) => setTimeout(resolver, 30));
      emAndamento -= 1;
      return true;
    };

    await consultar("http://localhost:3001", "http://localhost:3002", "http://localhost:3003");

    expect(maximo).toBe(3);
  });

  it("trata falha da sonda como servidor parado", async () => {
    noAr = () => Promise.reject(new Error("falhou"));

    const resposta = await consultar("http://localhost:3000");

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ situacoes: [{ url: "http://localhost:3000", noAr: false }] });
  });

  it("aceita exatamente 10 endereços e recusa 11", async () => {
    const dez = Array.from({ length: 10 }, (_, indice) => `http://localhost:${3000 + indice}`);

    const aceita = await consultar(...dez);
    expect(aceita.status).toBe(200);
    expect(((await aceita.json()) as { situacoes: unknown[] }).situacoes).toHaveLength(10);

    sondadas = [];
    const recusada = await consultar(...dez, "http://localhost:3010");
    expect(recusada.status).toBe(400);
    expect(await recusada.json()).toEqual({ erro: "Informe até 10 endereços por consulta." });
    expect(sondadas).toEqual([]);
  });

  it("recusa a consulta sem url", async () => {
    const resposta = await fetch(`${base}/servidores-locais/situacao`);

    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toEqual({ erro: "Informe ao menos um endereço local em url." });
  });

  it("recusa url que não é texto simples", async () => {
    const resposta = await fetch(`${base}/servidores-locais/situacao?url[a]=http://localhost:3000`);

    expect(resposta.status).toBe(400);
    expect(sondadas).toEqual([]);
  });

  it.each([
    ["host externo", "https://exemplo.com:443"],
    ["IP de rede", "http://192.168.0.2:3000"],
    ["sem porta", "http://localhost/"],
    ["porta inválida", "http://localhost:99999"],
    ["outro esquema", "ftp://localhost:21"],
    ["sem esquema", "localhost:5173"],
    ["credenciais", "http://localhost:3000@exemplo.com"],
    ["lixo de template", "http://localhost:4391/ilha-teste-tmp.html?v=${v"],
    ["vazia", ""],
  ])("recusa %s com 400 e não sonda nada", async (_nome, url) => {
    const resposta = await consultar("http://localhost:5173", url);

    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toEqual({
      erro: "Só endereços locais com porta são aceitos (ex.: http://localhost:5173).",
    });
    expect(sondadas).toEqual([]);
  });
});
