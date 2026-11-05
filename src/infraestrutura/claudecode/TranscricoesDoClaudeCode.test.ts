import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { lerLinhasDoArquivo, localizarTranscricoes, pastaDoClaude, slugDaPasta } from "./TranscricoesDoClaudeCode";

describe("pastaDoClaude", () => {
  it("usa CLAUDE_CONFIG_DIR quando definida; senão ~/.claude", () => {
    expect(pastaDoClaude({ CLAUDE_CONFIG_DIR: "D:/config" }, "C:/Users/x")).toBe("D:/config");
    expect(pastaDoClaude({ CLAUDE_CONFIG_DIR: " " }, "C:/Users/x")).toBe(path.join("C:/Users/x", ".claude"));
    expect(pastaDoClaude({}, "C:/Users/x")).toBe(path.join("C:/Users/x", ".claude"));
  });
});

describe("slugDaPasta", () => {
  it("troca todo caractere não alfanumérico por -", () => {
    expect(slugDaPasta("C:\\Users\\leandro.canha\\projetos")).toBe("C--Users-leandro-canha-projetos");
  });
});

describe("localizarTranscricoes e lerLinhasDoArquivo", () => {
  let raiz = "";

  beforeEach(async () => {
    raiz = await mkdtemp(path.join(tmpdir(), "transcricoes-"));
  });

  afterEach(async () => {
    await rm(raiz, { recursive: true, force: true });
  });

  it("acha a principal pelo slug, os subagentes e lê o meta.json", async () => {
    const projeto = path.join(raiz, "projects", slugDaPasta("C:\\obra"));
    const subagentes = path.join(projeto, "s1", "subagents");
    await mkdir(subagentes, { recursive: true });
    await writeFile(path.join(projeto, "s1.jsonl"), "{}\n");
    await writeFile(path.join(subagentes, "agent-a1.jsonl"), "{}\n");
    await writeFile(path.join(subagentes, "agent-a1.meta.json"), JSON.stringify({ agentType: "executor", toolUseId: "toolu_1" }));
    await writeFile(path.join(subagentes, "agent-a2.jsonl"), "{}\n");

    const arquivos = await localizarTranscricoes("C:\\obra", ["s1", "inexistente"], raiz);
    expect(arquivos.map((arquivo) => [arquivo.papel, arquivo.agenteId, arquivo.tipoDeAgente, arquivo.chamadaId])).toEqual([
      ["principal", null, null, null],
      ["subagente", "a1", "executor", "toolu_1"],
      ["subagente", "a2", null, null],
    ]);
  });

  it("procura em todas as pastas de projeto quando o slug não bate", async () => {
    const outra = path.join(raiz, "projects", "slug-truncado");
    await mkdir(outra, { recursive: true });
    await writeFile(path.join(outra, "s9.jsonl"), "{}\n");
    const arquivos = await localizarTranscricoes("C:\\caminho\\muito\\longo", ["s9"], raiz);
    expect(arquivos).toHaveLength(1);
    expect(arquivos[0]?.caminho).toBe(path.join(outra, "s9.jsonl"));
  });

  it("sem pasta de projetos devolve lista vazia", async () => {
    expect(await localizarTranscricoes("C:\\obra", ["s1"], path.join(raiz, "nao-existe"))).toEqual([]);
  });

  it("lê linha a linha, ignora linhas inválidas e aplica o filtro", async () => {
    const arquivo = path.join(raiz, "x.jsonl");
    await writeFile(arquivo, '{"n":1}\r\n\nlixo\n{"n":2}\n{"n":3}\n{"n":4');
    expect(await lerLinhasDoArquivo(arquivo)).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
    expect(await lerLinhasDoArquivo(arquivo, (linha) => (linha as { n: number }).n !== 2)).toEqual([{ n: 1 }, { n: 3 }]);
    expect(await lerLinhasDoArquivo(path.join(raiz, "sumiu.jsonl"))).toEqual([]);
  });
});
