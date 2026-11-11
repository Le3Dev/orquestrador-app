import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LeitorDeSkills, lerFrontmatter } from "./LeitorDeSkills";

describe("lerFrontmatter", () => {
  it("lê name e description simples, com ou sem aspas", () => {
    expect(lerFrontmatter('---\nname: pdf\ndescription: "Mexe com PDF: ler e criar"\nlicense: MIT\n---\n# Corpo')).toEqual({
      name: "pdf",
      description: "Mexe com PDF: ler e criar",
      license: "MIT",
    });
    expect(lerFrontmatter("---\nname: 'a'\ndescription: 'it''s'\n---\n")).toEqual({ name: "a", description: "it's" });
  });

  it("junta a descrição em várias linhas (>, | e continuação indentada) numa linha só", () => {
    expect(lerFrontmatter("---\nname: x\ndescription: >\n  Primeira linha\n  segunda linha\nother: 1\n---\n").description).toBe(
      "Primeira linha segunda linha",
    );
    expect(lerFrontmatter("---\ndescription: |-\n  Linha um\n  Linha dois\n---\n").description).toBe("Linha um Linha dois");
    expect(lerFrontmatter("---\ndescription: Começa aqui\n  e continua ali\n---\n").description).toBe("Começa aqui e continua ali");
  });

  it("tolera CRLF e BOM, e ignora o que vem depois do fechamento", () => {
    const campos = lerFrontmatter("﻿---\r\nname: crlf\r\ndescription: ok\r\n---\r\nname: do-corpo\r\n");

    expect(campos).toEqual({ name: "crlf", description: "ok" });
  });

  it("sem frontmatter, nenhum campo", () => {
    expect(lerFrontmatter("# Só o corpo\nname: nao\n")).toEqual({});
  });
});

describe("LeitorDeSkills", () => {
  let raiz: string;
  let claude: string;
  let projeto: string;
  let leitor: LeitorDeSkills;

  beforeEach(async () => {
    raiz = await mkdtemp(path.join(tmpdir(), "leitor-de-skills-"));
    claude = path.join(raiz, "home", ".claude");
    projeto = path.join(raiz, "projeto");
    await mkdir(claude, { recursive: true });
    await mkdir(projeto, { recursive: true });
    leitor = new LeitorDeSkills({ pastaDoClaude: claude });
  });

  afterEach(async () => {
    await rm(raiz, { recursive: true, force: true });
  });

  async function skill(pasta: string, conteudo: string): Promise<void> {
    await mkdir(pasta, { recursive: true });
    await writeFile(path.join(pasta, "SKILL.md"), conteudo);
  }

  const doTipo = (nome: string, descricao: string): string => `---\nname: ${nome}\ndescription: ${descricao}\n---\n# ${nome}\nCorpo secreto.`;

  it("lista as do usuário e do projeto, com a origem, só nome e descrição", async () => {
    await skill(path.join(claude, "skills", "context7-mcp"), doTipo("context7-mcp", "Docs de bibliotecas"));
    await skill(path.join(projeto, ".claude", "skills", "deploy"), doTipo("deploy", "Sobe o app"));

    const skills = await leitor.listar(projeto);

    expect(skills).toEqual([
      { nome: "context7-mcp", descricao: "Docs de bibliotecas", origem: "usuario", plugin: null },
      { nome: "deploy", descricao: "Sobe o app", origem: "projeto", plugin: null },
    ]);
    expect(JSON.stringify(skills)).not.toContain("Corpo secreto");
    expect(JSON.stringify(skills)).not.toContain(raiz);
  });

  it("sem a pasta do projeto, não lê as do projeto", async () => {
    await skill(path.join(projeto, ".claude", "skills", "deploy"), doTipo("deploy", "Sobe o app"));

    expect(await leitor.listar(null)).toEqual([]);
  });

  it("sem frontmatter usa o nome da pasta e descrição vazia; sem name também usa a pasta", async () => {
    await skill(path.join(claude, "skills", "solta"), "# Só texto\n");
    await skill(path.join(claude, "skills", "sem-nome"), "---\ndescription: Tem descrição\n---\n");

    expect(await leitor.listar(null)).toEqual([
      { nome: "sem-nome", descricao: "Tem descrição", origem: "usuario", plugin: null },
      { nome: "solta", descricao: "", origem: "usuario", plugin: null },
    ]);
  });

  it("corta a descrição em 500 caracteres", async () => {
    await skill(path.join(claude, "skills", "longa"), doTipo("longa", "a".repeat(2000)));

    const [longa] = await leitor.listar(null);

    expect(longa?.descricao).toHaveLength(500);
    expect(longa?.descricao.endsWith("…")).toBe(true);
  });

  it("lê só o começo de arquivos grandes", async () => {
    await skill(path.join(claude, "skills", "grande"), `${doTipo("grande", "Cabe")}\n${"x".repeat(200 * 1024)}`);

    expect((await leitor.listar(null))[0]).toMatchObject({ nome: "grande", descricao: "Cabe" });
  });

  it("ordena por origem (usuário, projeto, plugin) e depois por nome", async () => {
    await skill(path.join(claude, "skills", "zeta"), doTipo("zeta", "z"));
    await skill(path.join(claude, "skills", "alfa"), doTipo("alfa", "a"));
    await skill(path.join(projeto, ".claude", "skills", "beta"), doTipo("beta", "b"));
    await instalarPlugin("logo@mercado", "logo", { habilitado: true, skills: { logo: doTipo("logo", "Cria logos") } });

    const nomes = (await leitor.listar(projeto)).map((item) => `${item.origem}:${item.nome}`);

    expect(nomes).toEqual(["usuario:alfa", "usuario:zeta", "projeto:beta", "plugin:logo:logo"]);
  });

  it("ignora skill com link simbólico que sai da pasta e pastas ocultas", async () => {
    const fora = path.join(raiz, "fora");
    await skill(fora, doTipo("vazada", "Não deve aparecer"));
    await mkdir(path.join(claude, "skills", "ligada"), { recursive: true });
    await symlink(path.join(fora, "SKILL.md"), path.join(claude, "skills", "ligada", "SKILL.md"));
    await symlink(fora, path.join(claude, "skills", "pasta-ligada"));
    await skill(path.join(claude, "skills", ".oculta"), doTipo("oculta", "x"));
    await skill(path.join(claude, "skills", "boa"), doTipo("boa", "Fica"));

    expect((await leitor.listar(null)).map((item) => item.nome)).toEqual(["boa"]);
  });

  it("não segue a pasta de skills do projeto quando ela é um link", async () => {
    const fora = path.join(raiz, "fora");
    await skill(path.join(fora, "vazada"), doTipo("vazada", "x"));
    await mkdir(path.join(projeto, ".claude"), { recursive: true });
    await symlink(fora, path.join(projeto, ".claude", "skills"));

    expect(await leitor.listar(projeto)).toEqual([]);
  });

  it("pula a skill ilegível e segue com as outras", async () => {
    await mkdir(path.join(claude, "skills", "sem-arquivo"), { recursive: true });
    await mkdir(path.join(claude, "skills", "arquivo-e-pasta", ARQUIVO), { recursive: true });
    await skill(path.join(claude, "skills", "boa"), doTipo("boa", "Fica"));

    expect((await leitor.listar(null)).map((item) => item.nome)).toEqual(["boa"]);
  });

  describe("plugins", () => {
    it("lista as skills dos plugins habilitados como <plugin>:<skill>", async () => {
      await instalarPlugin("logo-design@logo-design-skill", "logo-design", {
        habilitado: true,
        skills: { "logo-design": doTipo("logo-design", "Cria logos"), outra: "# sem frontmatter" },
      });

      expect(await leitor.listar(null)).toEqual([
        { nome: "logo-design:logo-design", descricao: "Cria logos", origem: "plugin", plugin: "logo-design" },
        { nome: "logo-design:outra", descricao: "", origem: "plugin", plugin: "logo-design" },
      ]);
    });

    it("ignora plugin instalado mas não habilitado, ou desligado", async () => {
      await instalarPlugin("a@m", "a", { habilitado: false, skills: { a: doTipo("a", "x") } });
      await instalarPlugin("b@m", "b", { habilitado: undefined, skills: { b: doTipo("b", "x") } });

      expect(await leitor.listar(null)).toEqual([]);
    });

    it("vale a habilitação nas configurações do projeto", async () => {
      await instalarPlugin("p@m", "p", { habilitado: undefined, skills: { p: doTipo("p", "Do projeto") } });
      await mkdir(path.join(projeto, ".claude"), { recursive: true });
      await writeFile(
        path.join(projeto, ".claude", "settings.json"),
        JSON.stringify({ enabledPlugins: { "p@m": true } }),
      );

      expect((await leitor.listar(null)).length).toBe(0);
      expect((await leitor.listar(projeto)).map((item) => item.nome)).toEqual(["p:p"]);
    });

    it("recusa installPath fora da pasta de plugins do Claude Code", async () => {
      const fora = path.join(raiz, "fora");
      await skill(path.join(fora, "skills", "x"), doTipo("x", "Não deve aparecer"));
      await mkdir(path.join(claude, "plugins"), { recursive: true });
      await writeFile(
        path.join(claude, "plugins", "installed_plugins.json"),
        JSON.stringify({ version: 2, plugins: { "mal@m": [{ scope: "user", installPath: fora }] } }),
      );
      await writeFile(path.join(claude, "settings.json"), JSON.stringify({ enabledPlugins: { "mal@m": true } }));

      expect(await leitor.listar(null)).toEqual([]);
    });

    it("JSON ausente ou inválido não derruba a lista", async () => {
      await skill(path.join(claude, "skills", "boa"), doTipo("boa", "Fica"));
      await mkdir(path.join(claude, "plugins"), { recursive: true });
      await writeFile(path.join(claude, "plugins", "installed_plugins.json"), "{ quebrado");
      await writeFile(path.join(claude, "settings.json"), "não é json");

      expect((await leitor.listar(null)).map((item) => item.nome)).toEqual(["boa"]);
    });
  });

  describe("sincronizadas da conta", () => {
    it("skills/synced/<bucket>/<skill> vira anthropic-skills:<skill> e a pasta synced não é skill", async () => {
      await skill(path.join(claude, "skills", "synced", "bucket-1", "docx"), doTipo("docx", "Word"));
      await skill(path.join(claude, "skills", "synced", "bucket-1", "pdf"), doTipo("pdf", "PDF"));

      expect(await leitor.listar(null)).toEqual([
        { nome: "anthropic-skills:docx", descricao: "Word", origem: "plugin", plugin: "anthropic-skills" },
        { nome: "anthropic-skills:pdf", descricao: "PDF", origem: "plugin", plugin: "anthropic-skills" },
      ]);
    });

    it("plugins/synced/<bucket>/<plugin>~g3/skills/<skill> vira <plugin>:<skill>", async () => {
      await skill(
        path.join(claude, "plugins", "synced", "bucket-1", "cowork-plugin-management~g3", "skills", "criar"),
        doTipo("criar", "Cria plugins"),
      );
      await skill(
        path.join(claude, "plugins", "synced", "bucket-1", "pdf-viewer", "skills", "view-pdf"),
        doTipo("view-pdf", "Abre PDF"),
      );

      expect((await leitor.listar(null)).map((item) => [item.nome, item.plugin])).toEqual([
        ["cowork-plugin-management:criar", "cowork-plugin-management"],
        ["pdf-viewer:view-pdf", "pdf-viewer"],
      ]);
    });
  });

  /** Cria `plugins/cache/<nome>/skills/<skill>/SKILL.md`, registra no installed_plugins.json e, se pedido, habilita. */
  async function instalarPlugin(
    chave: string,
    nome: string,
    { habilitado, skills }: { habilitado: boolean | undefined; skills: Record<string, string> },
  ): Promise<void> {
    const instalacao = path.join(claude, "plugins", "cache", nome, "1.0.0");
    for (const [pasta, conteudo] of Object.entries(skills)) {
      await skill(path.join(instalacao, "skills", pasta), conteudo);
    }
    const caminhoDoRegistro = path.join(claude, "plugins", "installed_plugins.json");
    const caminhoDasConfiguracoes = path.join(claude, "settings.json");
    const registro = await lerOuVazio<{ version: number; plugins: Record<string, unknown> }>(caminhoDoRegistro, {
      version: 2,
      plugins: {},
    });
    registro.plugins[chave] = [{ scope: "user", installPath: instalacao, version: "1.0.0" }];
    await writeFile(caminhoDoRegistro, JSON.stringify(registro));
    const configuracoes = await lerOuVazio<{ enabledPlugins: Record<string, boolean> }>(caminhoDasConfiguracoes, {
      enabledPlugins: {},
    });
    if (habilitado !== undefined) {
      configuracoes.enabledPlugins[chave] = habilitado;
    }
    await writeFile(caminhoDasConfiguracoes, JSON.stringify(configuracoes));
  }
});

const ARQUIVO = "SKILL.md";

async function lerOuVazio<T>(caminho: string, vazio: T): Promise<T> {
  try {
    return JSON.parse(await readFile(caminho, "utf8")) as T;
  } catch {
    return vazio;
  }
}
