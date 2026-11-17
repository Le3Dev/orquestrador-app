import { once } from "node:events";
import { rmSync } from "node:fs";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import path from "node:path";

import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MotorDeAgentes, ResultadoDoTurno } from "../../orquestracao/MotorDeAgentes";
import { ServidorMcpDoApp } from "../mcp/ServidorMcpDoApp";
import { SaidaCurta } from "./ExecucaoCurtaDeCli";
import { criarPastasDeTeste, pedidoDeTeste } from "./fixtures/pedidoDeTeste";
import { caminhosDosMotoresDoAmbiente, montarMotores } from "./montarMotores";

const SUCESSO: ResultadoDoTurno = {
  sucesso: true,
  resposta: "do claude",
  uso: { duracaoMs: 1, tokensDeEntrada: 0, tokensDeSaida: 0, subagentesLancados: 0 },
};

const SEM_CLI: SaidaCurta = { codigoDeSaida: 1, saida: "", erro: "", tempoEsgotado: false, falhaAoIniciar: "ENOENT" };

describe("montarMotores", () => {
  const servidores: ServidorMcpDoApp[] = [];
  const http: Server[] = [];
  const pastasCriadas: string[] = [];
  const novasPastas = () => {
    const pastas = criarPastasDeTeste();
    pastasCriadas.push(pastas.raiz);
    return pastas;
  };

  afterEach(async () => {
    for (const raiz of pastasCriadas.splice(0)) rmSync(raiz, { recursive: true, force: true });
    for (const servidor of servidores.splice(0)) await servidor.encerrar();
    for (const servidor of http.splice(0)) {
      servidor.closeAllConnections();
      servidor.close();
      await once(servidor, "close");
    }
  });

  function montar(opcoes: Partial<Parameters<typeof montarMotores>[0]> = {}) {
    const servidorMcp = new ServidorMcpDoApp();
    servidores.push(servidorMcp);
    const motorClaudeCode: MotorDeAgentes = { executarTurno: vi.fn(async () => SUCESSO) };
    const inexistente = path.join(novasPastas().raiz, "nao-existe");
    const montados = montarMotores({
      motorClaudeCode,
      servidorMcp,
      caminhos: { "claude-code": "claude", codex: inexistente, copilot: inexistente },
      ...opcoes,
    });
    return { montados, servidorMcp, motorClaudeCode };
  }

  it("roteia o claude-code para o motor recebido e os outros para os motores novos", async () => {
    const { montados, motorClaudeCode } = montar({ executarComando: async () => SEM_CLI });
    await montados.iniciar();
    const pastas = novasPastas();
    const aoObservar = vi.fn();
    const sinal = new AbortController().signal;

    expect(await montados.motor.executarTurno(pedidoDeTeste(pastas, "claude-code"), aoObservar, sinal)).toBe(SUCESSO);
    expect(motorClaudeCode.executarTurno).toHaveBeenCalledTimes(1);

    // Com os CLIs inexistentes, quem responde são os motores do Codex e do Copilot (cada um com o nome do seu CLI).
    const codex = await montados.motor.executarTurno(pedidoDeTeste(pastas, "codex"), aoObservar, sinal);
    const copilot = await montados.motor.executarTurno(pedidoDeTeste(pastas, "copilot"), aoObservar, sinal);
    expect(codex.sucesso === false && codex.motivo).toContain("O Codex não foi encontrado");
    expect(copilot.sucesso === false && copilot.motivo).toContain("O GitHub Copilot CLI não foi encontrado");
    expect(motorClaudeCode.executarTurno).toHaveBeenCalledTimes(1);
  });

  it("registra o grupo delegar_subtarefas no servidor MCP e não registra duas vezes no mesmo servidor", () => {
    const { servidorMcp } = montar();

    expect(() => servidorMcp.registrarTurno({ orquestradorId: "o", ferramentas: { delegar_subtarefas: true } })).toThrow(
      /não foi iniciado/,
    );
    expect(() => montarMotores({ motorClaudeCode: { executarTurno: vi.fn() }, servidorMcp })).toThrow(/já está registrado/);
  });

  it("iniciar() sobe o servidor MCP, que passa a aceitar turnos com a delegação ligada", async () => {
    const { montados, servidorMcp } = montar({
      executarComando: async () => SEM_CLI,
    });

    await montados.iniciar();

    const registro = servidorMcp.registrarTurno({ orquestradorId: "o", ferramentas: { delegar_subtarefas: true } });
    expect(registro.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    registro.encerrar();
    await montados.encerrar();
  });

  it("GET /motores responde com o catálogo, no formato que a tela espera", async () => {
    const respostas: Record<string, Partial<SaidaCurta>> = {
      "claude --version": { saida: "2.1.322 (Claude Code)" },
      "claude auth status": { saida: '{"loggedIn":true}' },
    };
    const executarComando = vi.fn(async (executavel: string, argumentos: readonly string[]): Promise<SaidaCurta> => ({
      codigoDeSaida: 0,
      saida: "",
      erro: "",
      tempoEsgotado: false,
      falhaAoIniciar: null,
      ...respostas[`${executavel} ${argumentos.join(" ")}`],
    }));
    const { montados } = montar({ executarComando, verificarLoginDoCopilot: async () => null });
    // O "claude" vem do PATH: o catálogo o acha pelo `procurar` real, que aqui não existe; então usa o caminho absoluto desta máquina.
    const aplicacao = express();
    aplicacao.use("/api", montados.rotas);
    const servidor = aplicacao.listen(0, "127.0.0.1");
    http.push(servidor);
    await once(servidor, "listening");

    const resposta = await fetch(`http://127.0.0.1:${(servidor.address() as AddressInfo).port}/api/motores`);

    expect(resposta.status).toBe(200);
    const motores = (await resposta.json()) as Array<{ motor: string; instalado: boolean; mensagem: string | null }>;
    expect(motores.map((motor) => motor.motor)).toEqual(["claude-code", "codex", "copilot"]);
    expect(motores.filter((motor) => motor.motor !== "claude-code").every((motor) => !motor.instalado && motor.mensagem !== null)).toBe(true);
  });
});

describe("caminhosDosMotoresDoAmbiente", () => {
  it("usa os nomes dos CLIs, e CODEX_BIN, COPILOT_BIN e o caminho do Claude Code quando informados", () => {
    expect(caminhosDosMotoresDoAmbiente({})).toEqual({ "claude-code": "claude", codex: "codex", copilot: "copilot" });
    expect(caminhosDosMotoresDoAmbiente({ CODEX_BIN: "/opt/codex", COPILOT_BIN: "/opt/copilot" }, "/opt/claude")).toEqual({
      "claude-code": "/opt/claude",
      codex: "/opt/codex",
      copilot: "/opt/copilot",
    });
  });
});
