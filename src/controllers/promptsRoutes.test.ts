import { once } from "node:events";
import { Server } from "node:http";
import { AddressInfo } from "node:net";

import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ControleDeExecucoesEmMemoria } from "../infraestrutura/execucoes/ControleDeExecucoesEmMemoria";
import type {
  MotorDeMelhoriaDePrompt,
  PedidoAoMotorDeMelhoria,
  ResultadoDoMotorDeMelhoria,
} from "../prompts/MotorDeMelhoriaDePrompt";
import { ServicoDeMelhoriaDePrompt } from "../prompts/ServicoDeMelhoriaDePrompt";
import { criarPromptsRoutes } from "./promptsRoutes";

const USO = { entrada: 2, criacaoDeCache: 600, leituraDeCache: 2000, saida: 150 };

type Roteiro = (pedido: PedidoAoMotorDeMelhoria, sinal: AbortSignal) => Promise<ResultadoDoMotorDeMelhoria>;

class MotorFalso implements MotorDeMelhoriaDePrompt {
  pedidos: PedidoAoMotorDeMelhoria[] = [];
  roteiro: Roteiro = async () => ({ sucesso: true, texto: '"Corrija o bug intermitente no login."', uso: USO });

  melhorar(pedido: PedidoAoMotorDeMelhoria, sinal: AbortSignal): Promise<ResultadoDoMotorDeMelhoria> {
    this.pedidos.push(pedido);
    return this.roteiro(pedido, sinal);
  }
}

describe("rotas de prompts", () => {
  let servidor: Server;
  let base: string;
  let motor: MotorFalso;
  let instante: number;

  beforeEach(async () => {
    motor = new MotorFalso();
    instante = 0;
    const aplicacao = express();
    aplicacao.use(express.json({ limit: "40mb" }));
    aplicacao.use(
      "/api",
      criarPromptsRoutes({
        servico: new ServicoDeMelhoriaDePrompt({
          motor,
          execucoes: new ControleDeExecucoesEmMemoria(),
          gerarId: () => "id",
          agora: () => new Date((instante += 400)),
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

  function melhorar(corpo: unknown, sinal?: AbortSignal): Promise<Response> {
    return fetch(`${base}/prompts/melhorar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
      ...(sinal === undefined ? {} : { signal: sinal }),
    });
  }

  it("200 com o texto limpo, o uso, o índice de custo e a duração", async () => {
    const resposta = await melhorar({ texto: "arruma o bug do login", onde: "orquestrador", pasta: "PIR_app" });

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({
      texto: "Corrija o bug intermitente no login.",
      uso: USO,
      indiceDeCusto: 1702,
      duracaoMs: 400,
    });
    expect(motor.pedidos[0]?.texto).toBe("arruma o bug do login");
    expect(motor.pedidos[0]?.instrucoes).toMatch(/no projeto "PIR_app"\.$/);
  });

  it.each<[string, unknown, string]>([
    ["texto vazio", { texto: "   ", onde: "chat" }, "Escreva o pedido para melhorar."],
    ["texto longo", { texto: "x".repeat(20_001), onde: "chat" }, "O pedido deve ter até 20000 caracteres para ser melhorado."],
    ["onde inválido", { texto: "oi", onde: "terminal" }, "Destino do pedido inválido."],
    ["onde ausente", { texto: "oi" }, "Destino do pedido inválido."],
    ["texto que não é texto", { texto: 42, onde: "chat" }, "Envie o texto do pedido."],
    ["pasta que não é texto", { texto: "oi", onde: "orquestrador", pasta: 1 }, "A pasta deve ser um texto."],
    ["corpo que não é objeto", ["oi"], "Envie o pedido para melhorar."],
  ])("400 com %s, sem chamar o motor", async (_caso, corpo, mensagem) => {
    const resposta = await melhorar(corpo);

    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toEqual({ erro: mensagem });
    expect(motor.pedidos).toEqual([]);
  });

  it("502 com a mensagem do motor quando o Claude Code falha", async () => {
    motor.roteiro = async () => ({ sucesso: false, motivo: "O Claude Code encerrou sem devolver o pedido melhorado (código 1)." });

    const resposta = await melhorar({ texto: "oi", onde: "chat" });

    expect(resposta.status).toBe(502);
    expect(await resposta.json()).toEqual({ erro: "O Claude Code encerrou sem devolver o pedido melhorado (código 1)." });
  });

  it("502 quando a resposta vem vazia", async () => {
    motor.roteiro = async () => ({ sucesso: true, texto: "  ", uso: USO });

    const resposta = await melhorar({ texto: "oi", onde: "chat" });

    expect(resposta.status).toBe(502);
    expect(((await resposta.json()) as { erro: string }).erro).toMatch(/resposta vazia/);
  });

  it("500 com erro inesperado do motor", async () => {
    motor.roteiro = async () => {
      throw new Error("pane");
    };

    const resposta = await melhorar({ texto: "oi", onde: "chat" });

    expect(resposta.status).toBe(500);
    expect(await resposta.json()).toEqual({ erro: "Erro inesperado no servidor: pane" });
  });

  it("o cliente desistir aborta o sinal do motor", async () => {
    let sinalDoMotor: AbortSignal | null = null;
    let avisarInicio: () => void = () => undefined;
    const iniciou = new Promise<void>((resolver) => (avisarInicio = resolver));
    let avisarAborto: () => void = () => undefined;
    const abortou = new Promise<void>((resolver) => (avisarAborto = resolver));
    motor.roteiro = (_pedido, sinal) => {
      sinalDoMotor = sinal;
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

    const pedido = melhorar({ texto: "oi", onde: "chat" }, cliente.signal).catch((erro: unknown) => erro);
    await iniciou;
    cliente.abort();
    await abortou;

    expect((sinalDoMotor as AbortSignal | null)?.aborted).toBe(true);
    expect(await pedido).toBeInstanceOf(Error);
  });
});
