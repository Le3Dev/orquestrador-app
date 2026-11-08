import { once } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import { ExploradorDePastas } from "../infraestrutura/arquivos/ExploradorDePastas";
import { Orquestrador } from "../orquestracao/Orquestrador";
import { AberturaDoPty, ProcessoDoPty, PtyDoTerminal } from "../terminais/PtyDoTerminal";
import { ServicoDeTerminais } from "../terminais/ServicoDeTerminais";
import { NOME_DO_COOKIE_DE_ACESSO } from "./acessoSoPeloApp";
import { acessoDoUpgrade, criarConexaoDosTerminais, criarTerminaisRoutes, origensPermitidas } from "./terminaisRoutes";

class ProcessoFalso implements ProcessoDoPty {
  readonly escritos: string[] = [];
  readonly tamanhos: Array<[number, number]> = [];
  encerrado = false;
  private ouvinteDaSaida: (dados: string) => void = () => undefined;
  private ouvinteDoFim: (codigo: number | null) => void = () => undefined;

  constructor(readonly abertura: AberturaDoPty) {}

  escrever(dados: string): void {
    this.escritos.push(dados);
  }
  redimensionar(colunas: number, linhas: number): void {
    this.tamanhos.push([colunas, linhas]);
  }
  encerrar(): void {
    this.encerrado = true;
  }
  aoReceber(ouvinte: (dados: string) => void): void {
    this.ouvinteDaSaida = ouvinte;
  }
  aoTerminar(ouvinte: (codigo: number | null) => void): void {
    this.ouvinteDoFim = ouvinte;
  }
  emitir(dados: string): void {
    this.ouvinteDaSaida(dados);
  }
  terminar(codigo: number | null): void {
    this.ouvinteDoFim(codigo);
  }
}

class PtyFalso implements PtyDoTerminal {
  readonly processos: ProcessoFalso[] = [];
  abrir(abertura: AberturaDoPty): ProcessoFalso {
    const processo = new ProcessoFalso(abertura);
    this.processos.push(processo);
    return processo;
  }
}

const CHAVE = "ab".repeat(32);

/** Espera até a condição valer (as mensagens do WebSocket chegam de forma assíncrona). */
async function aguardar(condicao: () => boolean): Promise<void> {
  for (let tentativa = 0; tentativa < 100 && !condicao(); tentativa++) {
    await new Promise((resolver) => setTimeout(resolver, 10));
  }
  expect(condicao()).toBe(true);
}

describe("rotas de terminais", () => {
  let pasta: string;
  let raiz: string;
  let worktree: string;
  let servidor: Server;
  let porta: number;
  let base: string;
  let pty: PtyFalso;
  let servico: ServicoDeTerminais;
  let ids: number;
  let encerrarConexoes: () => void;
  let orquestradores: Map<string, Orquestrador>;

  function orquestradorFalso(pastaDeTrabalho: string, caminhoDoWorktree: string | null): Orquestrador {
    return {
      pastaDeTrabalho: { caminho: pastaDeTrabalho },
      worktree: caminhoDoWorktree === null ? null : { branch: "b", caminho: caminhoDoWorktree, ativo: true },
    } as unknown as Orquestrador;
  }

  async function subir(limite = 6): Promise<void> {
    servico = new ServicoDeTerminais({
      pty,
      gerarId: () => `t-${++ids}`,
      agora: () => new Date("2026-11-07T10:00:00Z"),
      limite,
    });
    const explorador = new ExploradorDePastas(raiz);
    const aplicacao = express();
    aplicacao.use(express.json());
    aplicacao.use(
      "/api",
      criarTerminaisRoutes({
        servico,
        repositorio: { buscarPorId: (id) => orquestradores.get(id) ?? null },
        pastaExiste: (caminho) => explorador.existe(caminho),
        pastaRaiz: raiz,
      }),
    );
    servidor = aplicacao.listen(0, "127.0.0.1");
    await once(servidor, "listening");
    porta = (servidor.address() as AddressInfo).port;
    base = `http://127.0.0.1:${porta}/api`;
    const conexao = criarConexaoDosTerminais({
      servico,
      temAcesso: acessoDoUpgrade(CHAVE),
      origemPermitida: origensPermitidas({ porta }),
    });
    servidor.on("upgrade", conexao.aoPedirUpgrade);
    encerrarConexoes = () => conexao.encerrar();
  }

  beforeEach(async () => {
    pasta = await mkdtemp(path.join(tmpdir(), "rotas-terminais-teste-"));
    raiz = path.join(pasta, "projetos");
    worktree = path.join(pasta, "worktree");
    await mkdir(path.join(raiz, "app"), { recursive: true });
    await mkdir(worktree, { recursive: true });
    pty = new PtyFalso();
    ids = 0;
    orquestradores = new Map([
      ["com-worktree", orquestradorFalso(path.join(raiz, "app"), worktree)],
      ["worktree-apagado", orquestradorFalso(path.join(raiz, "app"), path.join(pasta, "nao-existe"))],
      ["sem-worktree", orquestradorFalso(path.join(raiz, "app"), null)],
    ]);
    await subir();
  });

  afterEach(async () => {
    encerrarConexoes();
    servidor.closeAllConnections();
    servidor.close();
    await once(servidor, "close");
    await rm(pasta, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  function enviar(metodo: string, caminho: string, corpo?: unknown): Promise<Response> {
    return fetch(`${base}${caminho}`, {
      method: metodo,
      headers: corpo === undefined ? {} : { "Content-Type": "application/json" },
      ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
    });
  }

  async function reiniciarComLimite(limite: number): Promise<void> {
    encerrarConexoes();
    servidor.closeAllConnections();
    servidor.close();
    await once(servidor, "close");
    await subir(limite);
  }

  it("POST com pasta absoluta existente abre o terminal (201) e GET lista os vivos", async () => {
    const pastaDoApp = path.join(raiz, "app");
    const resposta = await enviar("POST", "/terminais", { pasta: pastaDoApp, colunas: 100, linhas: 30 });

    expect(resposta.status).toBe(201);
    const terminal = await resposta.json();
    expect(terminal).toEqual({ id: "t-1", pasta: pastaDoApp, orquestradorId: null, criadoEm: "2026-11-07T10:00:00.000Z" });
    expect(pty.processos[0]?.abertura).toEqual({ pasta: pastaDoApp, colunas: 100, linhas: 30 });

    const lista = await enviar("GET", "/terminais");
    expect(await lista.json()).toEqual([terminal]);
  });

  it("POST com pasta relativa resolve dentro da raiz; fora dela ou inexistente é 400", async () => {
    const relativa = await enviar("POST", "/terminais", { pasta: "app", colunas: 80, linhas: 24 });
    expect(relativa.status).toBe(201);
    expect((await relativa.json()).pasta).toBe(path.join(raiz, "app"));

    const fora = await enviar("POST", "/terminais", { pasta: "../worktree", colunas: 80, linhas: 24 });
    expect(fora.status).toBe(400);

    const inexistente = await enviar("POST", "/terminais", { pasta: path.join(pasta, "nada"), colunas: 80, linhas: 24 });
    expect(inexistente.status).toBe(400);
    expect((await inexistente.json()).erro).toContain("não existe");
  });

  it("POST sem pasta nem orquestrador é 400; tamanho inválido também", async () => {
    const semNada = await enviar("POST", "/terminais", { colunas: 80, linhas: 24 });
    expect(semNada.status).toBe(400);
    expect(await semNada.json()).toEqual({ erro: "Informe a pasta ou o orquestrador do terminal." });

    const semTamanho = await enviar("POST", "/terminais", { pasta: "app", colunas: 0, linhas: 24 });
    expect(semTamanho.status).toBe(400);
    expect(pty.processos).toHaveLength(0);
  });

  it("POST com orquestrador usa o worktree se existir, senão a pasta de trabalho; inexistente é 404", async () => {
    const comWorktree = await enviar("POST", "/terminais", { orquestradorId: "com-worktree", colunas: 80, linhas: 24 });
    expect(comWorktree.status).toBe(201);
    expect(await comWorktree.json()).toMatchObject({ pasta: worktree, orquestradorId: "com-worktree" });

    const apagado = await enviar("POST", "/terminais", { orquestradorId: "worktree-apagado", colunas: 80, linhas: 24 });
    expect((await apagado.json()).pasta).toBe(path.join(raiz, "app"));

    const semWorktree = await enviar("POST", "/terminais", { orquestradorId: "sem-worktree", colunas: 80, linhas: 24 });
    expect((await semWorktree.json()).pasta).toBe(path.join(raiz, "app"));

    const inexistente = await enviar("POST", "/terminais", { orquestradorId: "nada", colunas: 80, linhas: 24 });
    expect(inexistente.status).toBe(404);
  });

  it("acima do limite responde 409 com mensagem legível", async () => {
    await reiniciarComLimite(1);
    expect((await enviar("POST", "/terminais", { pasta: "app", colunas: 80, linhas: 24 })).status).toBe(201);

    const excedente = await enviar("POST", "/terminais", { pasta: "app", colunas: 80, linhas: 24 });
    expect(excedente.status).toBe(409);
    expect(await excedente.json()).toEqual({ erro: "Já há 1 terminais abertos. Feche um deles para abrir outro." });
  });

  it("DELETE encerra o shell (204); de novo é 404", async () => {
    await enviar("POST", "/terminais", { pasta: "app", colunas: 80, linhas: 24 });

    expect((await enviar("DELETE", "/terminais/t-1")).status).toBe(204);
    expect(pty.processos[0]?.encerrado).toBe(true);
    expect(await (await enviar("GET", "/terminais")).json()).toEqual([]);
    expect((await enviar("DELETE", "/terminais/t-1")).status).toBe(404);
  });

  describe("WebSocket", () => {
    function urlDaConexao(id: string): string {
      return `ws://127.0.0.1:${porta}/api/terminais/${id}/conexao`;
    }

    /** Status HTTP com que o upgrade foi recusado. */
    function statusDaRecusa(url: string, cabecalhos: Record<string, string>): Promise<number> {
      return new Promise((resolver, rejeitar) => {
        const ws = new WebSocket(url, { headers: cabecalhos });
        ws.on("unexpected-response", (_requisicao, resposta) => {
          resolver(resposta.statusCode ?? 0);
          ws.terminate();
        });
        ws.on("open", () => {
          ws.close();
          rejeitar(new Error("O upgrade deveria ter sido recusado."));
        });
        ws.on("error", () => undefined);
      });
    }

    const cookie = `${NOME_DO_COOKIE_DE_ACESSO}=${CHAVE}`;

    beforeEach(async () => {
      await enviar("POST", "/terminais", { pasta: "app", colunas: 80, linhas: 24 });
    });

    it("recusa o upgrade sem a chave do aplicativo (403)", async () => {
      expect(await statusDaRecusa(urlDaConexao("t-1"), { Origin: `http://127.0.0.1:${porta}` })).toBe(403);
      expect(
        await statusDaRecusa(urlDaConexao("t-1"), {
          Origin: `http://127.0.0.1:${porta}`,
          Cookie: `${NOME_DO_COOKIE_DE_ACESSO}=${"cd".repeat(32)}`,
        }),
      ).toBe(403);
    });

    it("recusa o upgrade de outra origem (403) e de terminal inexistente (404)", async () => {
      expect(await statusDaRecusa(urlDaConexao("t-1"), { Cookie: cookie, Origin: "https://site-malicioso.com" })).toBe(403);
      expect(await statusDaRecusa(urlDaConexao("t-1"), { Cookie: cookie, Origin: "http://127.0.0.1:1" })).toBe(403);
      expect(await statusDaRecusa(urlDaConexao("t-1"), { Cookie: cookie })).toBe(403);
      expect(await statusDaRecusa(urlDaConexao("nada"), { Cookie: cookie, Origin: `http://localhost:${porta}` })).toBe(404);
    });

    it("reenvia o histórico, repassa entrada e tamanho, ignora o inválido e avisa o fim", async () => {
      const processo = pty.processos[0] as ProcessoFalso;
      processo.emitir("$ ");

      const ws = new WebSocket(urlDaConexao("t-1"), {
        headers: { Cookie: cookie, Origin: `http://127.0.0.1:${porta}` },
      });
      const recebidas: unknown[] = [];
      ws.on("message", (dados) => recebidas.push(JSON.parse(String(dados))));
      await once(ws, "open");
      await aguardar(() => recebidas.length === 1);
      expect(recebidas[0]).toEqual({ tipo: "saida", dados: "$ " });

      ws.send(JSON.stringify({ tipo: "entrada", dados: "ls\r" }));
      ws.send(JSON.stringify({ tipo: "tamanho", colunas: 120, linhas: 40 }));
      ws.send(JSON.stringify({ tipo: "tamanho", colunas: -1, linhas: 40 }));
      ws.send("não é json");
      ws.send(JSON.stringify({ tipo: "desconhecido" }));
      await aguardar(() => processo.tamanhos.length === 1);
      expect(processo.escritos).toEqual(["ls\r"]);
      expect(processo.tamanhos).toEqual([[120, 40]]);

      processo.emitir("arquivo.txt\r\n");
      await aguardar(() => recebidas.length === 2);
      expect(recebidas[1]).toEqual({ tipo: "saida", dados: "arquivo.txt\r\n" });

      const fechou = once(ws, "close");
      processo.terminar(0);
      await fechou;
      expect(recebidas[2]).toEqual({ tipo: "fim", codigo: 0 });
      expect(servico.listar()).toEqual([]);
    });
  });
});

describe("origensPermitidas", () => {
  it("aceita 127.0.0.1 e localhost na porta do servidor e as extras", () => {
    const permitida = origensPermitidas({ porta: 3200, extras: ["http://localhost:5173/"] });
    expect(permitida("http://127.0.0.1:3200")).toBe(true);
    expect(permitida("http://localhost:3200")).toBe(true);
    expect(permitida("http://localhost:5173")).toBe(true);
    expect(permitida("http://localhost:5174")).toBe(false);
    expect(permitida("https://127.0.0.1:3200")).toBe(false);
    expect(permitida("http://evil.com:3200")).toBe(false);
    expect(permitida(undefined)).toBe(false);
    expect(permitida("null")).toBe(false);
  });

  it("com o navegador liberado, aceita qualquer porta local", () => {
    const permitida = origensPermitidas({ porta: 3200, qualquerPortaLocal: true });
    expect(permitida("http://localhost:5173")).toBe(true);
    expect(permitida("http://evil.com")).toBe(false);
  });
});
