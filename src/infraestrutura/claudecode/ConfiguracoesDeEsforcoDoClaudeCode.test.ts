import path from "node:path";

import { describe, expect, it } from "vitest";

import type { ModeloClaude } from "../../orquestracao/ModeloClaude";
import { ConfiguracoesDeEsforcoDoClaudeCode, lerIdDoModelo, modeloEfetivo } from "./ConfiguracoesDeEsforcoDoClaudeCode";

const PESSOAL = path.join("C:", "Users", "fulano");
const PROJETO = path.join("C:", "projetos", "obra");
const DO_USUARIO = path.join(PESSOAL, ".claude", "settings.json");
const DO_PROJETO = path.join(PROJETO, ".claude", "settings.json");
const LOCAL = path.join(PROJETO, ".claude", "settings.local.json");

/** Exemplo real da máquina do usuário (sintético aqui). */
const CONFIG_DO_USUARIO = {
  effortLevel: "high",
  modelSettings: { "claude-opus-5": { effortLevel: "high" }, "claude-opus-5-5": { effortLevel: "xhigh" } },
};

function configuracoes(arquivos: Record<string, unknown>, ambiente: NodeJS.ProcessEnv = {}): ConfiguracoesDeEsforcoDoClaudeCode {
  return new ConfiguracoesDeEsforcoDoClaudeCode({
    ambiente,
    pastaPessoal: PESSOAL,
    lerArquivo: async (caminho) => {
      const conteudo = arquivos[caminho];
      if (conteudo === undefined) {
        throw new Error("ENOENT");
      }
      return typeof conteudo === "string" ? conteudo : JSON.stringify(conteudo);
    },
  });
}

async function herdado(
  arquivos: Record<string, unknown>,
  modelo: ModeloClaude,
  modeloReal: string | null = null,
  ambiente: NodeJS.ProcessEnv = {},
): Promise<{ nivel: string; origem: string; modelo: string | null } | null> {
  const resultado = await configuracoes(arquivos, ambiente).herdadoPara({ modelo, pastaDoProjeto: PROJETO, modeloReal });
  return resultado === null ? null : { nivel: resultado.nivel, origem: resultado.origem, modelo: resultado.modelo };
}

describe("ConfiguracoesDeEsforcoDoClaudeCode", () => {
  it("exemplo da máquina do usuário: opus 5.5 → extra alto pelo modelSettings (com e sem modeloReal)", async () => {
    const esperado = {
      nivel: "extra_alto",
      origem: "~/.claude/settings.json (modelSettings › claude-opus-5-5)",
      modelo: "claude-opus-5-5",
    };
    expect(await herdado({ [DO_USUARIO]: CONFIG_DO_USUARIO }, "opus", "claude-opus-5-5")).toEqual(esperado);
    expect(await herdado({ [DO_USUARIO]: CONFIG_DO_USUARIO }, "opus")).toEqual(esperado);
    const resultado = await configuracoes({ [DO_USUARIO]: CONFIG_DO_USUARIO }).herdadoPara({
      modelo: "opus",
      pastaDoProjeto: PROJETO,
      modeloReal: null,
    });
    expect(resultado?.deveAvisar()).toBe(true);
  });

  it("modelo real mais antigo usa a própria entrada do modelSettings", async () => {
    expect(await herdado({ [DO_USUARIO]: CONFIG_DO_USUARIO }, "opus", "claude-opus-5-20260101")).toEqual({
      nivel: "alto",
      origem: "~/.claude/settings.json (modelSettings › claude-opus-5)",
      modelo: "claude-opus-5",
    });
  });

  it("o effortLevel de topo do usuário não vale para Opus 5.5 e posteriores, mas vale para modelos anteriores", async () => {
    const soTopo = { [DO_USUARIO]: { effortLevel: "high" } };
    expect(await herdado(soTopo, "opus", "claude-opus-5-5")).toBeNull();
    expect(await herdado(soTopo, "opus")).toBeNull();
    expect(await herdado(soTopo, "sonnet", "claude-sonnet-5-5")).toBeNull();
    expect(await herdado(soTopo, "opus", "claude-opus-5")).toEqual({
      nivel: "alto",
      origem: "~/.claude/settings.json",
      modelo: "claude-opus-5",
    });
    expect((await herdado(soTopo, "fable"))?.nivel).toBe("alto");
  });

  it("o effortLevel de topo do projeto vale para todos os modelos e vence o usuário", async () => {
    expect(await herdado({ [DO_PROJETO]: { effortLevel: "low" }, [DO_USUARIO]: CONFIG_DO_USUARIO }, "opus", "claude-opus-5-5")).toEqual({
      nivel: "baixo",
      origem: ".claude/settings.json do projeto",
      modelo: "claude-opus-5-5",
    });
  });

  it("local vence projeto; dentro do arquivo, modelSettings vence o topo", async () => {
    const arquivos = {
      [LOCAL]: { effortLevel: "low", modelSettings: { "claude-opus-5-5": { effortLevel: "medium" } } },
      [DO_PROJETO]: { effortLevel: "xhigh" },
    };
    expect(await herdado(arquivos, "opus", "claude-opus-5-5")).toEqual({
      nivel: "medio",
      origem: ".claude/settings.local.json do projeto (modelSettings › claude-opus-5-5)",
      modelo: "claude-opus-5-5",
    });
    expect((await herdado(arquivos, "haiku", "claude-haiku-5-5"))?.origem).toBe(".claude/settings.local.json do projeto");
  });

  it("CLAUDE_CODE_EFFORT_LEVEL vence tudo; auto/unset = nenhum nível", async () => {
    const arquivos = { [LOCAL]: { effortLevel: "low" }, [DO_USUARIO]: CONFIG_DO_USUARIO };
    expect(await herdado(arquivos, "opus", null, { CLAUDE_CODE_EFFORT_LEVEL: "max" })).toEqual({
      nivel: "maximo",
      origem: "variável CLAUDE_CODE_EFFORT_LEVEL",
      modelo: "claude-opus-5-5",
    });
    expect(await herdado(arquivos, "opus", null, { CLAUDE_CODE_EFFORT_LEVEL: "auto" })).toBeNull();
    expect((await herdado(arquivos, "opus", null, { CLAUDE_CODE_EFFORT_LEVEL: "invalido" }))?.nivel).toBe("baixo");
  });

  it("a variável no bloco env de um arquivo também vence os níveis dos arquivos", async () => {
    const arquivos = { [DO_PROJETO]: { effortLevel: "low" }, [DO_USUARIO]: { env: { CLAUDE_CODE_EFFORT_LEVEL: "medium" } } };
    expect((await herdado(arquivos, "opus"))?.origem).toBe("variável CLAUDE_CODE_EFFORT_LEVEL (env de ~/.claude/settings.json)");
  });

  it("max não é aceito nos arquivos; valores inválidos são ignorados", async () => {
    expect(await herdado({ [DO_PROJETO]: { effortLevel: "max" } }, "opus")).toBeNull();
    expect(await herdado({ [DO_PROJETO]: { modelSettings: { "claude-opus-5-5": "xhigh" } } }, "opus")).toBeNull();
  });

  it("arquivo ilegível ou JSON inválido é ignorado sem quebrar", async () => {
    expect(await herdado({ [LOCAL]: "{ inválido", [DO_PROJETO]: "[]", [DO_USUARIO]: CONFIG_DO_USUARIO }, "opus")).toMatchObject({
      nivel: "extra_alto",
    });
  });

  it("nada definido → null", async () => {
    expect(await herdado({}, "sonnet")).toBeNull();
  });

  it("respeita CLAUDE_CONFIG_DIR para o arquivo do usuário", async () => {
    const pasta = path.join("D:", "claude");
    const resultado = await herdado(
      { [path.join(pasta, "settings.json")]: { modelSettings: { "claude-sonnet-5-5": { effortLevel: "low" } } } },
      "sonnet",
      null,
      { CLAUDE_CONFIG_DIR: pasta },
    );
    expect(resultado?.origem).toBe(`${path.join(pasta, "settings.json")} (modelSettings › claude-sonnet-5-5)`);
  });
});

describe("IDs de modelo", () => {
  it("normaliza sufixo de data e [1m] e lê família e versão", () => {
    expect(lerIdDoModelo("claude-sonnet-4-5-20250929")).toEqual({ canonico: "claude-sonnet-4-5", familia: "sonnet", versao: [4, 5] });
    expect(lerIdDoModelo("claude-opus-4-6[1m]")?.canonico).toBe("claude-opus-4-6");
    expect(lerIdDoModelo("claude-3-5-haiku-20241022")).toEqual({ canonico: "claude-3-5-haiku", familia: "haiku", versao: [3, 5] });
    expect(lerIdDoModelo("<synthetic>")).toBeNull();
  });

  it("sem modelo real, usa a versão mais alta da família (chaves do modelSettings ou o padrão do apelido)", () => {
    expect(modeloEfetivo("opus", null, ["claude-opus-5", "claude-opus-6", "claude-sonnet-9"])?.canonico).toBe("claude-opus-6");
    expect(modeloEfetivo("opus", null, ["claude-opus-5"])?.canonico).toBe("claude-opus-5-5");
    expect(modeloEfetivo("opus", "claude-opus-4-7", ["claude-opus-6"])?.canonico).toBe("claude-opus-4-7");
  });
});
