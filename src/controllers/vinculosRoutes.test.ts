import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RepositorioDeVinculosEmArquivo } from "../infraestrutura/arquivos/RepositorioDeVinculosEmArquivo";
import { ErroDeOrquestracao } from "../orquestracao/ErroDeOrquestracao";
import { OrigemDoPedido } from "../orquestracao/PedidoNaFila";
import { ServicoDeVinculos } from "../vinculos/ServicoDeVinculos";
import { DadosDoVinculo } from "../vinculos/Vinculo";
import { criarVinculosRoutes } from "./vinculosRoutes";

describe("rotas de vínculos", () => {
  let pasta: string;
  let servidor: Server;
  let base: string;
  let repositorio: RepositorioDeVinculosEmArquivo;
  let entregas: Array<{ destinoId: string; texto: string; origem: OrigemDoPedido }>;
  let falhaNaEntrega: Error | null;
  let ids: number;

  beforeEach(async () => {
    pasta = await mkdtemp(path.join(tmpdir(), "rotas-vinculos-teste-"));
    repositorio = await RepositorioDeVinculosEmArquivo.abrir(pasta);
    entregas = [];
    falhaNaEntrega = null;
    ids = 0;
    const nomes = new Map([
      ["api", "API"],
      ["front", "Front"],
      ["infra", "Infra"],
    ]);

    const aplicacao = express();
    aplicacao.use(express.json());
    aplicacao.use(
      "/api",
      criarVinculosRoutes({
        servico: new ServicoDeVinculos({
          repositorio,
          orquestradores: { nomeDe: (id) => nomes.get(id) ?? null },
          entregar: async (destinoId, texto, origem) => {
            if (falhaNaEntrega !== null) {
              throw falhaNaEntrega;
            }
            entregas.push({ destinoId, texto, origem });
          },
          gerarId: () => `v${++ids}`,
          agora: () => new Date("2026-11-14T10:00:00Z"),
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

  async function vincular(a = "api", b = "front"): Promise<DadosDoVinculo> {
    const resposta = await enviar("POST", "/vinculos", { orquestradorAId: a, orquestradorBId: b });
    expect(resposta.status).toBe(201);
    return ((await resposta.json()) as { vinculo: DadosDoVinculo }).vinculo;
  }

  it("GET sem vínculos responde 200 com lista vazia", async () => {
    const resposta = await enviar("GET", "/vinculos");

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ vinculos: [] });
  });

  it("POST cria o vínculo (201) e o GET o lista", async () => {
    const vinculo = await vincular();

    expect(vinculo).toEqual({
      id: "v1",
      orquestradorAId: "api",
      orquestradorBId: "front",
      notas: "",
      criadoEm: "2026-11-14T10:00:00.000Z",
      atualizadoEm: "2026-11-14T10:00:00.000Z",
    });
    expect(await (await enviar("GET", "/vinculos")).json()).toEqual({ vinculos: [vinculo] });
  });

  it("POST responde 404 se um orquestrador não existe, 409 se já vinculados e 400 se iguais", async () => {
    await vincular("api", "front");

    const inexistente = await enviar("POST", "/vinculos", { orquestradorAId: "api", orquestradorBId: "fantasma" });
    const repetido = await enviar("POST", "/vinculos", { orquestradorAId: "front", orquestradorBId: "api" });
    const iguais = await enviar("POST", "/vinculos", { orquestradorAId: "api", orquestradorBId: "api" });

    expect(inexistente.status).toBe(404);
    expect(await inexistente.json()).toEqual({ erro: "Orquestrador não encontrado." });
    expect(repetido.status).toBe(409);
    expect(iguais.status).toBe(400);
  });

  it("POST sem os dois ids responde 400 com a mensagem", async () => {
    const resposta = await enviar("POST", "/vinculos", { orquestradorAId: "api" });

    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toEqual({ erro: "Informe o segundo orquestrador." });
  });

  it("DELETE desfaz o vínculo (204) e depois responde 404", async () => {
    const vinculo = await vincular();

    expect((await enviar("DELETE", `/vinculos/${vinculo.id}`)).status).toBe(204);
    expect(await (await enviar("GET", "/vinculos")).json()).toEqual({ vinculos: [] });
    expect((await enviar("DELETE", `/vinculos/${vinculo.id}`)).status).toBe(404);
  });

  it("PUT notas substitui o texto e devolve o vínculo", async () => {
    const vinculo = await vincular();

    const resposta = await enviar("PUT", `/vinculos/${vinculo.id}/notas`, { texto: "contrato v1" });

    expect(resposta.status).toBe(200);
    expect(((await resposta.json()) as { vinculo: DadosDoVinculo }).vinculo.notas).toBe("contrato v1");
  });

  it("PUT notas responde 400 acima de 8000 caracteres, 400 sem texto e 404 sem vínculo", async () => {
    const vinculo = await vincular();

    expect((await enviar("PUT", `/vinculos/${vinculo.id}/notas`, { texto: "x".repeat(8001) })).status).toBe(400);
    expect((await enviar("PUT", `/vinculos/${vinculo.id}/notas`, {})).status).toBe(400);
    expect((await enviar("PUT", "/vinculos/nao-existe/notas", { texto: "x" })).status).toBe(404);
  });

  it("POST mensagens responde 202 e entrega ao outro lado com 0 saltos", async () => {
    const vinculo = await vincular("api", "front");

    const resposta = await enviar("POST", `/vinculos/${vinculo.id}/mensagens`, { de: "front", texto: "suba a API" });

    expect(resposta.status).toBe(202);
    expect(await resposta.json()).toEqual({ enfileirada: true });
    expect(entregas).toEqual([
      { destinoId: "api", texto: "suba a API", origem: { orquestradorId: "front", nome: "Front", saltos: 0 } },
    ]);
  });

  it("POST mensagens responde 400 para remetente de fora ou texto vazio, 404 sem vínculo", async () => {
    const vinculo = await vincular("api", "front");

    expect((await enviar("POST", `/vinculos/${vinculo.id}/mensagens`, { de: "infra", texto: "oi" })).status).toBe(400);
    expect((await enviar("POST", `/vinculos/${vinculo.id}/mensagens`, { de: "api", texto: " " })).status).toBe(400);
    expect((await enviar("POST", `/vinculos/${vinculo.id}/mensagens`, { texto: "oi" })).status).toBe(400);
    expect((await enviar("POST", "/vinculos/nao-existe/mensagens", { de: "api", texto: "oi" })).status).toBe(404);
  });

  it("POST mensagens devolve o erro da fila do destino no formato das outras rotas", async () => {
    const vinculo = await vincular("api", "front");
    falhaNaEntrega = new ErroDeOrquestracao("nao_encontrado", "Orquestrador não encontrado.");

    const resposta = await enviar("POST", `/vinculos/${vinculo.id}/mensagens`, { de: "api", texto: "oi" });

    expect(resposta.status).toBe(404);
    expect(await resposta.json()).toEqual({ erro: "Orquestrador não encontrado." });
  });
});
