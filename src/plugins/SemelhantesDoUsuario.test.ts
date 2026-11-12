import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  arquivoDeConfiguracaoDoClaude,
  criarLeitorDeNomesDoUsuario,
  normalizarNomeParaComparar,
  semelhantesAoPlugin,
} from "./SemelhantesDoUsuario";

describe("nomes parecidos entre plugins e o que o usuário já tem", () => {
  let pasta: string;
  let claude: string;
  let configuracao: string;

  beforeEach(async () => {
    pasta = await mkdtemp(path.join(tmpdir(), "semelhantes-teste-"));
    claude = path.join(pasta, ".claude");
    configuracao = path.join(pasta, ".claude.json");
    await mkdir(path.join(claude, "skills"), { recursive: true });
  });

  afterEach(async () => {
    await rm(pasta, { recursive: true, force: true });
  });

  async function criarSkill(nome: string, raiz = path.join(claude, "skills")): Promise<void> {
    await mkdir(path.join(raiz, nome), { recursive: true });
    await writeFile(path.join(raiz, nome, "SKILL.md"), `---\nname: ${nome}\n---\ncorpo\n`);
  }

  const ler = () => criarLeitorDeNomesDoUsuario({ pastaDoClaude: claude, arquivoDeConfiguracao: configuracao })();

  describe("normalização e comparação", () => {
    it("tira prefixo mcp- e sufixos -mcp, -skill e -plugin, com _ no lugar de -, em minúsculas", () => {
      expect(normalizarNomeParaComparar("Context7-MCP")).toBe("context7");
      expect(normalizarNomeParaComparar("context7_mcp")).toBe("context7");
      expect(normalizarNomeParaComparar("mcp-context7")).toBe("context7");
      expect(normalizarNomeParaComparar("MCP_context7")).toBe("context7");
      expect(normalizarNomeParaComparar("context7-skill")).toBe("context7");
      expect(normalizarNomeParaComparar("context7-plugin")).toBe("context7");
      expect(normalizarNomeParaComparar("mcp-context7-plugin")).toBe("context7");
      expect(normalizarNomeParaComparar("context7-mcp-server")).toBe("context7-mcp-server");
    });

    it("context7-mcp bate com context7, e o nome precisa ficar igual depois de normalizar", () => {
      const usuario = { skills: ["context7-mcp", "context7-extras"], servidoresMcp: ["context7", "outro"] };

      expect(semelhantesAoPlugin("context7", usuario)).toEqual({ skills: ["context7-mcp"], servidoresMcp: ["context7"] });
      expect(semelhantesAoPlugin("context", usuario)).toEqual({ skills: [], servidoresMcp: [] });
    });

    it("nome normalizado com menos de 3 caracteres não compara", () => {
      const usuario = { skills: ["ab", "ab-mcp", "mcp-ab"], servidoresMcp: ["ab"] };

      expect(semelhantesAoPlugin("ab", usuario)).toEqual({ skills: [], servidoresMcp: [] });
      expect(semelhantesAoPlugin("ab-plugin", usuario)).toEqual({ skills: [], servidoresMcp: [] });
      expect(semelhantesAoPlugin("abc", { skills: ["abc-skill"], servidoresMcp: [] }).skills).toEqual(["abc-skill"]);
    });
  });

  describe("leitura do disco", () => {
    it("devolve as skills avulsas com SKILL.md e as chaves de mcpServers, ordenadas", async () => {
      await criarSkill("context7-mcp");
      await criarSkill("alfa");
      await mkdir(path.join(claude, "skills", "sem-arquivo"), { recursive: true });
      await writeFile(path.join(claude, "skills", "solto.md"), "x");
      await mkdir(path.join(claude, "skills", ".oculta"), { recursive: true });
      await writeFile(configuracao, JSON.stringify({ mcpServers: { zeta: {}, context7: {} }, outros: 1 }));

      expect(await ler()).toEqual({ skills: ["alfa", "context7-mcp"], servidoresMcp: ["context7", "zeta"] });
    });

    it("ignora a pasta synced", async () => {
      await criarSkill("docx", path.join(claude, "skills", "synced", "bucket"));
      await mkdir(path.join(claude, "skills", "synced"), { recursive: true });
      await writeFile(path.join(claude, "skills", "synced", "SKILL.md"), "x");

      expect((await ler()).skills).toEqual([]);
    });

    it("ignora link simbólico que aponta para fora da pasta de skills e aceita o que fica dentro", async () => {
      const fora = path.join(pasta, "fora");
      await criarSkill("externa", fora);
      await symlink(path.join(fora, "externa"), path.join(claude, "skills", "externa"));
      await criarSkill("real");
      await symlink(path.join(claude, "skills", "real"), path.join(claude, "skills", "apelido"));

      expect((await ler()).skills).toEqual(["apelido", "real"]);
    });

    it("sem a pasta de skills ou sem o arquivo de configuração, lista vazia", async () => {
      await rm(path.join(claude, "skills"), { recursive: true });

      expect(await ler()).toEqual({ skills: [], servidoresMcp: [] });
    });

    it("JSON inválido, sem mcpServers ou com mcpServers que não é objeto: lista vazia", async () => {
      await writeFile(configuracao, "{ não é json");
      expect((await ler()).servidoresMcp).toEqual([]);

      await writeFile(configuracao, JSON.stringify({ projects: {} }));
      expect((await ler()).servidoresMcp).toEqual([]);

      await writeFile(configuracao, JSON.stringify({ mcpServers: ["context7"] }));
      expect((await ler()).servidoresMcp).toEqual([]);

      await writeFile(configuracao, "[]");
      expect((await ler()).servidoresMcp).toEqual([]);
    });

    it("só olha mcpServers do nível de cima, nunca os de projetos", async () => {
      await writeFile(
        configuracao,
        JSON.stringify({ projects: { "/x": { mcpServers: { escondido: {} } } }, mcpServers: { visivel: {} } }),
      );

      expect((await ler()).servidoresMcp).toEqual(["visivel"]);
    });

    it("arquivo acima do teto de tamanho é ignorado", async () => {
      const enorme = JSON.stringify({ mcpServers: { context7: {} }, lixo: "x".repeat(5 * 1024 * 1024) });
      await writeFile(configuracao, enorme);

      expect((await ler()).servidoresMcp).toEqual([]);
    });

    it("limita a quantidade de nomes", async () => {
      const servidores = Object.fromEntries(Array.from({ length: 800 }, (_, indice) => [`s${indice}`, {}]));
      await writeFile(configuracao, JSON.stringify({ mcpServers: servidores }));

      expect((await ler()).servidoresMcp).toHaveLength(500);
    });

    it("os valores de mcpServers nunca aparecem no resultado", async () => {
      await writeFile(
        configuracao,
        JSON.stringify({
          mcpServers: {
            context7: {
              type: "http",
              url: "https://mcp.exemplo.com/mcp",
              headers: { CONTEXT7_API_KEY: "segredo-super-sensivel" },
              env: { TOKEN: "ghp_token_secreto" },
            },
          },
        }),
      );

      const resultado = await ler();
      const texto = JSON.stringify(resultado);

      expect(resultado.servidoresMcp).toEqual(["context7"]);
      expect(texto).not.toContain("segredo-super-sensivel");
      expect(texto).not.toContain("ghp_token_secreto");
      expect(texto).not.toContain("mcp.exemplo.com");
    });
  });

  describe("arquivo de configuração do Claude Code", () => {
    it("usa CLAUDE_CONFIG_DIR quando existe e a pasta pessoal quando não", () => {
      expect(arquivoDeConfiguracaoDoClaude({ CLAUDE_CONFIG_DIR: "/c/claude" }, "/home/u")).toBe(path.join("/c/claude", ".claude.json"));
      expect(arquivoDeConfiguracaoDoClaude({ CLAUDE_CONFIG_DIR: "  " }, "/home/u")).toBe(path.join("/home/u", ".claude.json"));
      expect(arquivoDeConfiguracaoDoClaude({}, "/home/u")).toBe(path.join("/home/u", ".claude.json"));
    });
  });
});
