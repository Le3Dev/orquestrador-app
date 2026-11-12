import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Orquestrador } from "../orquestracao/Orquestrador";
import { montarAplicacao } from "../root";
import { LeitorDeSkills } from "../skills/LeitorDeSkills";
import { criarSkillsRoutes } from "./skillsRoutes";

describe("rotas das skills", () => {
  let pasta: string;
  let claude: string;
  let projeto: string;
  let servidor: Server;
  let base: string;
  let orquestradores: Map<string, Orquestrador>;

  function orquestradorFalso(nivelDePermissao: string): Orquestrador {
    return {
      pastaDeTrabalho: { caminho: projeto },
      configuracao: { nivelDePermissao },
    } as unknown as Orquestrador;
  }

  async function skill(pastaDaSkill: string, nome: string, descricao: string): Promise<void> {
    await mkdir(pastaDaSkill, { recursive: true });
    await writeFile(path.join(pastaDaSkill, "SKILL.md"), `---\nname: ${nome}\ndescription: ${descricao}\n---\nCorpo secreto`);
  }

  beforeEach(async () => {
    pasta = await mkdtemp(path.join(tmpdir(), "rotas-skills-teste-"));
    claude = path.join(pasta, ".claude");
    projeto = path.join(pasta, "projeto");
    await skill(path.join(claude, "skills", "context7-mcp"), "context7-mcp", "Docs de bibliotecas");
    await skill(path.join(projeto, ".claude", "skills", "deploy"), "deploy", "Sobe o app");
    orquestradores = new Map([
      ["leitura", orquestradorFalso("leitura")],
      ["edicao", orquestradorFalso("edicao")],
      ["comandos", orquestradorFalso("edicao_e_comandos")],
    ]);
    const aplicacao = express();
    aplicacao.use(
      "/api",
      criarSkillsRoutes({
        leitor: new LeitorDeSkills({ pastaDoClaude: claude }),
        repositorio: { buscarPorId: (id) => orquestradores.get(id) ?? null },
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
    await rm(pasta, { recursive: true, force: true });
  });

  it("sem orquestrador, devolve só as do usuário e dos plugins, com liberadasNoNivel nulo", async () => {
    const resposta = await fetch(`${base}/skills`);

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({
      skills: [{ nome: "context7-mcp", descricao: "Docs de bibliotecas", origem: "usuario", plugin: null }],
      liberadasNoNivel: null,
    });
  });

  it("com orquestrador, inclui as do projeto e ordena por origem e nome", async () => {
    await skill(path.join(claude, "skills", "alfa"), "alfa", "A");

    const resposta = await fetch(`${base}/skills?orquestrador=edicao`);
    const corpo = (await resposta.json()) as { skills: { nome: string; origem: string }[] };

    expect(resposta.status).toBe(200);
    expect(corpo.skills.map((item) => `${item.origem}:${item.nome}`)).toEqual([
      "usuario:alfa",
      "usuario:context7-mcp",
      "projeto:deploy",
    ]);
  });

  it.each([
    ["leitura", false],
    ["edicao", true],
    ["comandos", true],
  ])("no orquestrador de nível %s, liberadasNoNivel é %s", async (id, liberadas) => {
    const corpo = (await (await fetch(`${base}/skills?orquestrador=${id}`)).json()) as { liberadasNoNivel: boolean };

    expect(corpo.liberadasNoNivel).toBe(liberadas);
  });

  it("nunca devolve o corpo da skill nem caminhos", async () => {
    const texto = await (await fetch(`${base}/skills?orquestrador=edicao`)).text();

    expect(texto).not.toContain("Corpo secreto");
    expect(texto).not.toContain(pasta);
  });

  it("orquestrador inexistente dá 404", async () => {
    const resposta = await fetch(`${base}/skills?orquestrador=nao-existe`);

    expect(resposta.status).toBe(404);
    expect(await resposta.json()).toEqual({ erro: "Orquestrador não encontrado." });
  });

  it("orquestrador que não é texto simples dá 400", async () => {
    const resposta = await fetch(`${base}/skills?orquestrador=a&orquestrador=b`);

    expect(resposta.status).toBe(400);
  });
});

describe("skills atrás da trava do aplicativo", () => {
  const CHAVE = "0123456789abcdef".repeat(4);
  let servidor: Server;

  afterEach(async () => {
    servidor.close();
    await once(servidor, "close");
  });

  it("sem a chave do app a rota responde 403 e não lê nada", async () => {
    let leituras = 0;
    const aplicacao = montarAplicacao(
      { chaveDeAcesso: CHAVE, permitirNavegador: false, urlDeDownload: null, pastaDaTela: path.join(tmpdir(), "nao-existe-tela") },
      (rotas) => {
        rotas.use(
          "/api",
          criarSkillsRoutes({
            leitor: {
              listar: async () => {
                leituras += 1;
                return [];
              },
            },
            repositorio: { buscarPorId: () => null },
          }),
        );
      },
    );
    servidor = aplicacao.listen(0, "127.0.0.1");
    await once(servidor, "listening");

    const resposta = await fetch(`http://127.0.0.1:${(servidor.address() as AddressInfo).port}/api/skills`);

    expect(resposta.status).toBe(403);
    expect(leituras).toBe(0);
  });
});
