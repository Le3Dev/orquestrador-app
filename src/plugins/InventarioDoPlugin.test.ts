import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { lerInventarioDoPlugin } from "./InventarioDoPlugin";

describe("inventário de um plugin instalado", () => {
  let pasta: string;
  let claude: string;
  let plugin: string;

  async function escrever(relativo: string, conteudo: string, raiz: string = plugin): Promise<void> {
    const caminho = path.join(raiz, relativo);
    await mkdir(path.dirname(caminho), { recursive: true });
    await writeFile(caminho, conteudo);
  }

  beforeEach(async () => {
    pasta = await mkdtemp(path.join(tmpdir(), "inventario-plugin-teste-"));
    claude = path.join(pasta, ".claude");
    plugin = path.join(claude, "plugins", "cache", "mercado", "exemplo", "1.0.0");
    await mkdir(plugin, { recursive: true });
  });

  afterEach(async () => {
    await rm(pasta, { recursive: true, force: true });
  });

  it("lê skills, subagentes, servidores MCP e hooks", async () => {
    await escrever("skills/zeta/SKILL.md", "---\nname: zeta\ndescription: Faz Z\n---\nCorpo secreto");
    await escrever("skills/alfa/SKILL.md", "---\ndescription: >\n  Faz A\n  em duas linhas\n---\n");
    await escrever("agents/revisor.md", "---\nname: revisor\n---\n");
    await escrever("agents/outro.md", "x");
    await escrever("agents/notas.txt", "não é agente");
    await escrever(".mcp.json", JSON.stringify({ mcpServers: { a: { command: "x" }, b: { url: "https://x" } } }));
    await escrever(
      "hooks/hooks.json",
      JSON.stringify({
        hooks: {
          SessionStart: [{ hooks: [{ type: "command", command: "a" }] }],
          PostToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: "b" }, { type: "command", command: "c" }] }],
        },
      }),
    );

    const inventario = await lerInventarioDoPlugin(claude, plugin);

    expect(inventario).toEqual({
      skills: [
        { nome: "alfa", descricao: "Faz A em duas linhas" },
        { nome: "zeta", descricao: "Faz Z" },
      ],
      subagentes: 2,
      servidoresMcp: 2,
      hooks: 3,
      verificado: true,
      temBin: false,
    });
    expect(JSON.stringify(inventario)).not.toContain("Corpo secreto");
  });

  it("aceita o .mcp.json direto, sem a chave mcpServers (formato do plugin github)", async () => {
    await escrever(".mcp.json", JSON.stringify({ github: { type: "http", url: "https://api.exemplo/mcp/" } }));

    expect((await lerInventarioDoPlugin(claude, plugin)).servidoresMcp).toBe(1);
  });

  it("lê mcpServers e hooks do plugin.json, inline ou por caminho, sem contar duas vezes o mesmo arquivo", async () => {
    await escrever(
      ".claude-plugin/plugin.json",
      JSON.stringify({
        name: "exemplo",
        mcpServers: { de_manifesto: { command: "x" } },
        hooks: "./hooks/hooks.json",
      }),
    );
    await escrever(".mcp.json", JSON.stringify({ mcpServers: { de_arquivo: { command: "y" } } }));
    await escrever("hooks/hooks.json", JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "a" }] }] } }));

    const inventario = await lerInventarioDoPlugin(claude, plugin);

    expect(inventario.servidoresMcp).toBe(2);
    expect(inventario.hooks).toBe(1);
  });

  it("hooks inline no plugin.json contam", async () => {
    await escrever(
      ".claude-plugin/plugin.json",
      JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "a" }] }] } }),
    );

    expect((await lerInventarioDoPlugin(claude, plugin)).hooks).toBe(1);
  });

  it("plugin sem nada devolve tudo zerado", async () => {
    expect(await lerInventarioDoPlugin(claude, plugin)).toEqual({
      skills: [],
      subagentes: 0,
      servidoresMcp: 0,
      hooks: 0,
      verificado: true,
      temBin: false,
    });
  });

  describe("falha fechada: leitura que não prova a ausência de hooks deixa verificado false", () => {
    it("hooks.json acima de 256 KB", async () => {
      await escrever("hooks/hooks.json", JSON.stringify({ hooks: {}, enchimento: "x".repeat(300 * 1024) }));
      await escrever("skills/ok/SKILL.md", "---\nname: ok\ndescription: Funciona\n---\n");

      const inventario = await lerInventarioDoPlugin(claude, plugin);

      expect(inventario.verificado).toBe(false);
      expect(inventario.skills).toEqual([{ nome: "ok", descricao: "Funciona" }]);
    });

    it.each([
      ["hooks.json inválido", "hooks/hooks.json", "{ não é json"],
      [".mcp.json inválido", ".mcp.json", "{ não é json"],
      ["plugin.json inválido", ".claude-plugin/plugin.json", "{ não é json"],
      ["hooks.json que não é objeto", "hooks/hooks.json", "[1, 2]"],
    ])("%s", async (_nome, relativo, conteudo) => {
      await escrever(relativo, conteudo);

      expect((await lerInventarioDoPlugin(claude, plugin)).verificado).toBe(false);
    });

    it("hooks.json que é link para fora da pasta do plugin", async () => {
      const segredo = path.join(pasta, "segredo");
      await escrever("hooks.json", JSON.stringify({ hooks: {} }), segredo);
      await mkdir(path.join(plugin, "hooks"), { recursive: true });
      await symlink(path.join(segredo, "hooks.json"), path.join(plugin, "hooks", "hooks.json"));

      expect((await lerInventarioDoPlugin(claude, plugin)).verificado).toBe(false);
    });

    it("caminho de hooks no plugin.json que não existe ou sai da pasta", async () => {
      await escrever(".claude-plugin/plugin.json", JSON.stringify({ hooks: "./nao-existe.json" }));
      expect((await lerInventarioDoPlugin(claude, plugin)).verificado).toBe(false);

      await escrever(".claude-plugin/plugin.json", JSON.stringify({ hooks: "../../../../../../fora.json" }));
      expect((await lerInventarioDoPlugin(claude, plugin)).verificado).toBe(false);
    });

    it("installPath que não resolve ou fica fora de ~/.claude/plugins", async () => {
      const fora = path.join(pasta, "fora");
      await escrever("skills/x/SKILL.md", "---\nname: x\ndescription: fora\n---\n", fora);

      for (const instalacao of [fora, path.join(pasta, "nao-existe")]) {
        expect(await lerInventarioDoPlugin(claude, instalacao)).toEqual({
          skills: [],
          subagentes: 0,
          servidoresMcp: 0,
          hooks: 0,
          verificado: false,
          temBin: false,
        });
      }
    });

    it("pasta skills que é link simbólico, skill que é link para fora e frontmatter que não fecha", async () => {
      const segredo = path.join(pasta, "segredo");
      await escrever("a/SKILL.md", "---\nname: a\n---\n", segredo);
      await symlink(segredo, path.join(plugin, "skills"));
      expect((await lerInventarioDoPlugin(claude, plugin)).verificado).toBe(false);

      await rm(path.join(plugin, "skills"));
      await mkdir(path.join(plugin, "skills", "vazada"), { recursive: true });
      await symlink(path.join(segredo, "a", "SKILL.md"), path.join(plugin, "skills", "vazada", "SKILL.md"));
      expect((await lerInventarioDoPlugin(claude, plugin)).verificado).toBe(false);

      await rm(path.join(plugin, "skills"), { recursive: true });
      await escrever("skills/aberta/SKILL.md", `---\nname: aberta\n${"d: x\n".repeat(20_000)}`);
      expect((await lerInventarioDoPlugin(claude, plugin)).verificado).toBe(false);
    });

    it("agente que é link simbólico e manifesto com skills fora da pasta padrão", async () => {
      await escrever("fora.md", "---\nname: x\n---\n", pasta);
      await mkdir(path.join(plugin, "agents"), { recursive: true });
      await symlink(path.join(pasta, "fora.md"), path.join(plugin, "agents", "x.md"));
      expect((await lerInventarioDoPlugin(claude, plugin)).verificado).toBe(false);

      await rm(path.join(plugin, "agents"), { recursive: true });
      await escrever(".claude-plugin/plugin.json", JSON.stringify({ skills: "./outras/" }));
      expect((await lerInventarioDoPlugin(claude, plugin)).verificado).toBe(false);
    });

    it("manifesto que aponta para as pastas padrão não tira a verificação", async () => {
      await escrever(".claude-plugin/plugin.json", JSON.stringify({ skills: "./skills/", agents: ["./agents/a.md"] }));
      await escrever("agents/a.md", "---\nname: a\n---\n");

      expect((await lerInventarioDoPlugin(claude, plugin)).verificado).toBe(true);
    });

    it("formato de hooks inesperado e não vazio conta como hook", async () => {
      await escrever("hooks/hooks.json", JSON.stringify({ hooks: { Stop: { command: "x" } } }));

      expect((await lerInventarioDoPlugin(claude, plugin)).hooks).toBe(1);
    });
  });

  it("bin/ do plugin marca temBin", async () => {
    await escrever("bin/ferramenta", "#!/bin/sh\n");

    expect(await lerInventarioDoPlugin(claude, plugin)).toMatchObject({ temBin: true, verificado: true, hooks: 0 });
  });

  it("hooks declarados no frontmatter de skill, agente e comando contam", async () => {
    await escrever("skills/a/SKILL.md", "---\nname: a\ndescription: D\nhooks:\n  PreToolUse:\n    - matcher: Bash\n---\n");
    await escrever("agents/b.md", "---\nname: b\nhooks:\n  Stop:\n    - hooks: []\n---\n");
    await escrever("commands/c.md", "---\ndescription: C\nhooks:\n  Stop: []\n---\n");
    await escrever("commands/d.md", "---\ndescription: sem hooks\n---\n");

    const inventario = await lerInventarioDoPlugin(claude, plugin);

    expect(inventario).toMatchObject({ hooks: 3, subagentes: 1, verificado: true });
    expect(inventario.skills).toEqual([{ nome: "a", descricao: "D" }]);
  });

  it("installPath fora de ~/.claude/plugins não é lido", async () => {
    const fora = path.join(pasta, "fora");
    await escrever("skills/x/SKILL.md", "---\nname: x\ndescription: fora\n---\n", fora);
    await escrever(".mcp.json", JSON.stringify({ a: { command: "x" } }), fora);

    expect(await lerInventarioDoPlugin(claude, fora)).toMatchObject({ skills: [], servidoresMcp: 0, hooks: 0, verificado: false });
  });

  it("links simbólicos que saem do plugin são ignorados", async () => {
    const segredo = path.join(pasta, "segredo");
    await escrever("SKILL.md", "---\nname: vazada\ndescription: de fora\n---\n", segredo);
    await escrever("mcp.json", JSON.stringify({ vazado: { command: "x" } }), segredo);
    await mkdir(path.join(plugin, "skills", "vazada"), { recursive: true });
    await symlink(path.join(segredo, "SKILL.md"), path.join(plugin, "skills", "vazada", "SKILL.md"));
    await symlink(path.join(segredo, "mcp.json"), path.join(plugin, ".mcp.json"));

    const inventario = await lerInventarioDoPlugin(claude, plugin);

    expect(inventario.skills).toEqual([]);
    expect(inventario.servidoresMcp).toBe(0);
    expect(inventario.verificado).toBe(false);
  });

  it("caminho do plugin.json que sai da pasta do plugin é ignorado", async () => {
    await escrever("hooks-de-fora.json", JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command" }] }] } }), pasta);
    await escrever(".claude-plugin/plugin.json", JSON.stringify({ hooks: "../../../../../../hooks-de-fora.json" }));

    const inventario = await lerInventarioDoPlugin(claude, plugin);

    expect(inventario.hooks).toBe(0);
    expect(inventario.verificado).toBe(false);
  });
});
