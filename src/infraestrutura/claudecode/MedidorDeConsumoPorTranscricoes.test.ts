import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MedidorDeConsumoPorTranscricoes } from "./MedidorDeConsumoPorTranscricoes";
import { slugDaPasta } from "./TranscricoesDoClaudeCode";

const PASTA_DE_TRABALHO = "C:\\projetos\\obra";
const SESSAO = "sessao-1";
const INICIO = new Date("2026-11-04T10:00:00.000Z");
const FIM = new Date("2026-11-04T10:05:00.000Z");

function em(segundosDepoisDoInicio: number): string {
  return new Date(INICIO.getTime() + segundosDepoisDoInicio * 1000).toISOString();
}

function assistente(
  id: string,
  instante: string,
  uso: { i: number; cc: number; cl: number; o: number },
  modelo = "claude-opus-5-5",
): Record<string, unknown> {
  return {
    type: "assistant",
    timestamp: instante,
    message: {
      id,
      model: modelo,
      content: [{ type: "text", text: "ok" }],
      usage: {
        input_tokens: uso.i,
        cache_creation_input_tokens: uso.cc,
        cache_read_input_tokens: uso.cl,
        output_tokens: uso.o,
      },
    },
  };
}

function jsonl(linhas: readonly unknown[]): string {
  return `${linhas.map((linha) => JSON.stringify(linha)).join("\n")}\n`;
}

describe("MedidorDeConsumoPorTranscricoes", () => {
  let pastaDoClaude = "";
  let projeto = "";
  let subagentes = "";

  beforeEach(async () => {
    pastaDoClaude = await mkdtemp(path.join(tmpdir(), "medidor-"));
    projeto = path.join(pastaDoClaude, "projects", slugDaPasta(PASTA_DE_TRABALHO));
    subagentes = path.join(projeto, SESSAO, "subagents");
    await mkdir(subagentes, { recursive: true });
  });

  afterEach(async () => {
    await rm(pastaDoClaude, { recursive: true, force: true });
  });

  const periodo = { sessaoId: SESSAO, pastaDeTrabalho: PASTA_DE_TRABALHO, inicio: INICIO, fim: FIM };

  it("mede só o turno: deduplica, separa subagentes, conta compactação no principal e ignora turnos anteriores", async () => {
    await writeFile(
      path.join(projeto, `${SESSAO}.jsonl`),
      [
        // Turno anterior da mesma sessão (--resume): fica de fora.
        JSON.stringify(assistente("antigo", "2026-11-04T09:00:00.000Z", { i: 999, cc: 999, cl: 999, o: 999 })),
        JSON.stringify({ type: "user", timestamp: em(0), message: { content: "oi" } }),
        JSON.stringify(assistente("m1", em(-2), { i: 10, cc: 100, cl: 1000, o: 50 })),
        JSON.stringify(assistente("m1", em(1), { i: 10, cc: 100, cl: 1000, o: 50 })),
        "linha truncada {",
        JSON.stringify(assistente("m2", em(305), { i: 1, cc: 0, cl: 500, o: 20 })),
        JSON.stringify(assistente("haiku", em(10), { i: 1, cc: 0, cl: 0, o: 5 }, "claude-haiku-5-5")),
        JSON.stringify(assistente("sint", em(11), { i: 0, cc: 0, cl: 0, o: 0 }, "<synthetic>")),
        // Depois da folga de 5 s: fora.
        JSON.stringify(assistente("depois", em(306), { i: 999, cc: 0, cl: 0, o: 0 })),
      ].join("\n"),
    );
    await writeFile(path.join(subagentes, "agent-a1.jsonl"), jsonl([assistente("s1", em(30), { i: 2, cc: 4000, cl: 300, o: 200 }, "claude-sonnet-5-5")]));
    await writeFile(path.join(subagentes, "agent-a1.meta.json"), JSON.stringify({ agentType: "executor", toolUseId: "toolu_1" }));
    // Subagente de um turno anterior: fora.
    await writeFile(path.join(subagentes, "agent-velho.jsonl"), jsonl([assistente("v1", "2026-11-04T09:00:10.000Z", { i: 7, cc: 7, cl: 7, o: 7 })]));
    // Compactação: soma no principal e não conta como subagente.
    await writeFile(path.join(subagentes, "agent-acompact-1.jsonl"), jsonl([assistente("c1", em(60), { i: 3, cc: 0, cl: 0, o: 30 })]));

    const consumo = await new MedidorDeConsumoPorTranscricoes(pastaDoClaude).medirTurno(periodo);

    expect(consumo).not.toBeNull();
    expect(consumo?.principal.paraDados()).toEqual({ entrada: 15, criacaoDeCache: 100, leituraDeCache: 1500, saida: 105 });
    expect(consumo?.subagentes.paraDados()).toEqual({ entrada: 2, criacaoDeCache: 4000, leituraDeCache: 300, saida: 200 });
    expect(consumo?.subagentesMedidos).toBe(1);
    expect(consumo?.parcial).toBe(false);
    expect(consumo?.modeloDoPrincipal).toBe("claude-opus-5-5");
  });

  it("sem transcrição da sessão devolve null", async () => {
    expect(await new MedidorDeConsumoPorTranscricoes(pastaDoClaude).medirTurno({ ...periodo, sessaoId: "outra" })).toBeNull();
  });

  it("sem mensagens na janela devolve null", async () => {
    await writeFile(
      path.join(projeto, `${SESSAO}.jsonl`),
      jsonl([assistente("antigo", "2026-11-04T09:00:00.000Z", { i: 1, cc: 1, cl: 1, o: 1 })]),
    );
    expect(await new MedidorDeConsumoPorTranscricoes(pastaDoClaude).medirTurno(periodo)).toBeNull();
  });
});
