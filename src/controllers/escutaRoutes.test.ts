import { once } from "node:events";
import { Server } from "node:http";
import { AddressInfo } from "node:net";

import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  ClassificadorDePergunta,
  PedidoAoClassificador,
  ResultadoDoClassificador,
} from "../escuta/ClassificadorDePergunta";
import { ServicoDeEscuta } from "../escuta/ServicoDeEscuta";
import { ControleDeExecucoesEmMemoria } from "../infraestrutura/execucoes/ControleDeExecucoesEmMemoria";
import { criarEscutaRoutes } from "./escutaRoutes";

const USO = { entrada: 2, criacaoDeCache: 400, leituraDeCache: 1200, saida: 30 };

type Roteiro = (pedido: PedidoAoClassificador, sinal: AbortSignal) => Promise<ResultadoDoClassificador>;

class ClassificadorFalso implements ClassificadorDePergunta {
  pedidos: PedidoAoClassificador[] = [];
  roteiro: Roteiro = async () => ({
    sucesso: true,
    texto: '```json\n{"ehPergunta": true, "pergunta": "Como resolver o LeetCode 42?"}\n```',
    uso: USO,
  });

  classificar(pedido: PedidoAoClassificador, sinal: AbortSignal): Promise<ResultadoDoClassificador> {
    this.pedidos.push(pedido);
    return this.roteiro(pedido, sinal);
  }
}

describe("rotas da escuta", () => {
  let servidor: Server;
  let base: string;
  let classificador: ClassificadorFalso;

  beforeEach(async () => {
    classificador = new ClassificadorFalso();
    const aplicacao = express();
    aplicacao.use(express.json({ limit: "40mb" }));
    aplicacao.use(
      "/api",
      criarEscutaRoutes({
        servico: new ServicoDeEscuta({
          classificador,
          execucoes: new ControleDeExecucoesEmMemoria(),
          gerarId: () => "id",
        }),
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

  function classificar(corpo: unknown, sinal?: AbortSignal): Promise<Response> {
    return fetch(`${base}/escuta/classificar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
      ...(sinal === undefined ? {} : { signal: sinal }),
    });
  }

  it("200 com a pergunta autocontida", async () => {
    const resposta = await classificar({ trecho: "precisa resolver o LeetCode 42", contexto: "aula de algoritmos" });

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ ehPergunta: true, pergunta: "Como resolver o LeetCode 42?" });
    expect(classificador.pedidos[0]).toMatchObject({
      trecho: "precisa resolver o LeetCode 42",
      contexto: "aula de algoritmos",
    });
  });

  it("200 quando não é pergunta", async () => {
    classificador.roteiro = async () => ({ sucesso: true, texto: '{"ehPergunta": false, "pergunta": null}', uso: USO });

    const resposta = await classificar({ trecho: "bom dia, pessoal" });

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ ehPergunta: false, pergunta: null });
    expect(classificador.pedidos[0]?.contexto).toBeNull();
  });

  it.each<[string, unknown, string]>([
    ["trecho vazio", { trecho: "   " }, "Envie o trecho da escuta para classificar."],
    ["trecho longo", { trecho: "x".repeat(4_001) }, "O trecho deve ter até 4000 caracteres para ser classificado."],
    ["contexto longo", { trecho: "oi?", contexto: "x".repeat(12_001) }, "O contexto deve ter até 12000 caracteres."],
    ["trecho ausente", {}, "Envie o trecho da escuta."],
    ["trecho que não é texto", { trecho: 42 }, "Envie o trecho da escuta."],
    ["contexto que não é texto", { trecho: "oi?", contexto: 1 }, "O contexto deve ser um texto."],
    ["corpo que não é objeto", ["oi"], "Envie o trecho da escuta para classificar."],
  ])("400 com %s, sem chamar o classificador", async (_caso, corpo, mensagem) => {
    const resposta = await classificar(corpo);

    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toEqual({ erro: mensagem });
    expect(classificador.pedidos).toEqual([]);
  });

  it("502 com a mensagem do classificador quando o Claude Code falha", async () => {
    classificador.roteiro = async () => ({
      sucesso: false,
      motivo: "O Claude Code encerrou sem devolver a classificação do trecho (código 1).",
    });

    const resposta = await classificar({ trecho: "oi?" });

    expect(resposta.status).toBe(502);
    expect(await resposta.json()).toEqual({
      erro: "O Claude Code encerrou sem devolver a classificação do trecho (código 1).",
    });
  });

  it("502 quando o motor devolve um JSON inválido", async () => {
    classificador.roteiro = async () => ({ sucesso: true, texto: "Sim, é uma pergunta.", uso: USO });

    const resposta = await classificar({ trecho: "oi?" });

    expect(resposta.status).toBe(502);
    expect(((await resposta.json()) as { erro: string }).erro).toMatch(/não é um JSON válido/);
  });

  it("502 quando o JSON vem fora do formato", async () => {
    classificador.roteiro = async () => ({ sucesso: true, texto: '{"pergunta": "x"}', uso: USO });

    const resposta = await classificar({ trecho: "oi?" });

    expect(resposta.status).toBe(502);
    expect(((await resposta.json()) as { erro: string }).erro).toMatch(/fora do formato esperado/);
  });

  it("500 com erro inesperado do classificador", async () => {
    classificador.roteiro = async () => {
      throw new Error("pane");
    };

    const resposta = await classificar({ trecho: "oi?" });

    expect(resposta.status).toBe(500);
    expect(await resposta.json()).toEqual({ erro: "Erro inesperado no servidor: pane" });
  });

  it("o cliente desistir aborta o sinal do classificador", async () => {
    let sinalDoClassificador: AbortSignal | null = null;
    let avisarInicio: () => void = () => undefined;
    const iniciou = new Promise<void>((resolver) => (avisarInicio = resolver));
    let avisarAborto: () => void = () => undefined;
    const abortou = new Promise<void>((resolver) => (avisarAborto = resolver));
    classificador.roteiro = (_pedido, sinal) => {
      sinalDoClassificador = sinal;
      avisarInicio();
      return new Promise((resolver) => {
        sinal.addEventListener(
          "abort",
          () => {
            avisarAborto();
            resolver({ sucesso: false, motivo: "Cancelada." });
          },
          { once: true },
        );
      });
    };
    const cliente = new AbortController();

    const pedido = classificar({ trecho: "oi?" }, cliente.signal).catch((erro: unknown) => erro);
    await iniciou;
    cliente.abort();
    await abortou;

    expect((sinalDoClassificador as AbortSignal | null)?.aborted).toBe(true);
    expect(await pedido).toBeInstanceOf(Error);
  });
});
