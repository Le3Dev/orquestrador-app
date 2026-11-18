import { once } from "node:events";
import { Server } from "node:http";
import { AddressInfo } from "node:net";

import express from "express";
import { afterEach, beforeEach, describe, expect, it, Mock, vi } from "vitest";

import { SituacaoDoMotor } from "../infraestrutura/motores/CatalogoDeMotores";
import { criarMotoresRoutes } from "./motoresRoutes";

const SITUACOES: SituacaoDoMotor[] = [
  { motor: "claude-code", rotulo: "Claude Code", instalado: true, versao: "2.1.322", caminho: "/bin/claude", logado: true, mensagem: null },
  {
    motor: "codex",
    rotulo: "Codex",
    instalado: false,
    versao: null,
    caminho: null,
    logado: null,
    mensagem: "Instale o Codex (npm install -g @openai/codex) e rode `codex login` para entrar.",
  },
  { motor: "copilot", rotulo: "GitHub Copilot CLI", instalado: true, versao: "1.0.83", caminho: "/bin/copilot", logado: false, mensagem: "Entre: copilot login" },
];

describe("rotas dos motores", () => {
  let servidor: Server;
  let base: string;
  let listar: Mock<(renovar?: boolean) => Promise<SituacaoDoMotor[]>>;

  beforeEach(async () => {
    listar = vi.fn(async () => SITUACOES);
    const aplicacao = express();
    aplicacao.use("/api", criarMotoresRoutes({ catalogo: { listar } }));
    servidor = aplicacao.listen(0, "127.0.0.1");
    await once(servidor, "listening");
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/api`;
  });

  afterEach(async () => {
    servidor.closeAllConnections();
    servidor.close();
    await once(servidor, "close");
  });

  it("GET /motores devolve um item por motor, no formato que a tela espera", async () => {
    const resposta = await fetch(`${base}/motores`);

    expect(resposta.status).toBe(200);
    const motores = (await resposta.json()) as SituacaoDoMotor[];
    expect(motores).toEqual(SITUACOES);
    for (const motor of motores) {
      expect(Object.keys(motor).sort()).toEqual(["caminho", "instalado", "logado", "mensagem", "motor", "rotulo", "versao"]);
    }
    expect(listar).toHaveBeenCalledWith(false);
  });

  it("?atualizar=1 ignora a resposta guardada", async () => {
    await fetch(`${base}/motores?atualizar=1`);

    expect(listar).toHaveBeenCalledWith(true);
  });

  it("responde 500 com a mensagem quando a consulta falha", async () => {
    listar.mockRejectedValueOnce(new Error("o catálogo quebrou"));
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const resposta = await fetch(`${base}/motores`);

    expect(resposta.status).toBe(500);
    expect(((await resposta.json()) as { erro: string }).erro).toContain("o catálogo quebrou");
    erro.mockRestore();
  });
});
