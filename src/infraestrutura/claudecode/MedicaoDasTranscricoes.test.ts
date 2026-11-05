import { describe, expect, it } from "vitest";

import {
  ehCompactacao,
  indiceDeCusto,
  janelaDoTurno,
  lerLinhaJson,
  linhaNaJanela,
  medirTranscricoes,
  totalDeTokens,
  TranscricaoLida,
} from "./MedicaoDasTranscricoes";

function assistente(
  id: string,
  modelo: string,
  uso: { i: number; cl: number; cc: number; o: number },
  conteudo: unknown[] = [{ type: "text", text: "ok" }],
  extras: Record<string, unknown> = {},
): unknown {
  return {
    type: "assistant",
    ...extras,
    message: {
      id,
      model: modelo,
      content: conteudo,
      usage: {
        input_tokens: uso.i,
        cache_read_input_tokens: uso.cl,
        cache_creation_input_tokens: uso.cc,
        output_tokens: uso.o,
      },
    },
  };
}

const usoA = { i: 2, cl: 1000, cc: 500, o: 100 };
const usoB = { i: 3, cl: 2000, cc: 0, o: 50 };
const usoSub = { i: 1, cl: 300, cc: 4000, o: 200 };

describe("medirTranscricoes", () => {
  it("conta cada message.id uma vez, mesmo repetido em várias linhas", () => {
    const principal: TranscricaoLida = {
      papel: "principal",
      agenteId: null,
      tipoDeAgente: null,
      linhas: [
        { type: "user", message: { content: "oi" } },
        assistente("msg_1", "claude-opus", usoA, [{ type: "thinking" }]),
        assistente("msg_1", "claude-opus", usoA, [{ type: "tool_use", id: "tu_1", name: "Read", input: {} }]),
        assistente("msg_1", "claude-opus", usoA, [{ type: "tool_use", id: "tu_2", name: "Grep", input: {} }]),
        assistente("msg_2", "claude-opus", usoB),
        { type: "api-request" },
        "linha inválida",
      ],
    };
    const medicao = medirTranscricoes([principal]);
    expect(medicao.mensagens).toBe(2);
    expect(medicao.principal).toEqual({ entrada: 5, leituraDeCache: 3000, criacaoDeCache: 500, saida: 150 });
    expect(medicao.subagentes).toEqual({ entrada: 0, leituraDeCache: 0, criacaoDeCache: 0, saida: 0 });
    expect(medicao.ferramentas).toEqual({ Read: 1, Grep: 1 });
    expect(medicao.subagentesLancados).toBe(0);
  });

  it("separa principal e subagentes e soma por modelo", () => {
    const transcricoes: TranscricaoLida[] = [
      {
        papel: "principal",
        agenteId: null,
        tipoDeAgente: null,
        linhas: [
          assistente("msg_p", "claude-opus", usoA, [{ type: "tool_use", id: "tu_a", name: "Agent", input: {} }]),
          assistente("msg_p", "claude-opus", usoA, [{ type: "tool_use", id: "tu_b", name: "Agent", input: {} }]),
          assistente("msg_sint", "<synthetic>", { i: 0, cl: 0, cc: 0, o: 0 }),
        ],
      },
      {
        papel: "subagente",
        agenteId: "a1",
        tipoDeAgente: "executor",
        linhas: [
          assistente("msg_s1", "claude-sonnet", usoSub, [{ type: "tool_use", id: "tu_s1", name: "Edit", input: {} }], {
            isSidechain: true,
          }),
          assistente("msg_s1", "claude-sonnet", usoSub, [{ type: "text", text: "pronto" }], { isSidechain: true }),
        ],
      },
      {
        papel: "subagente",
        agenteId: "a2",
        tipoDeAgente: "executor",
        linhas: [assistente("msg_s2", "claude-opus", usoB, [], { isSidechain: true })],
      },
    ];
    const medicao = medirTranscricoes(transcricoes);
    expect(medicao.principal).toEqual({ entrada: 2, leituraDeCache: 1000, criacaoDeCache: 500, saida: 100 });
    expect(medicao.subagentes).toEqual({ entrada: 4, leituraDeCache: 2300, criacaoDeCache: 4000, saida: 250 });
    expect(medicao.total).toEqual({ entrada: 6, leituraDeCache: 3300, criacaoDeCache: 4500, saida: 350 });
    expect(medicao.porModelo["claude-sonnet"]).toEqual({ entrada: 1, leituraDeCache: 300, criacaoDeCache: 4000, saida: 200 });
    expect(medicao.porModelo["<synthetic>"]).toBeUndefined();
    expect(medicao.subagentesLancados).toBe(2);
    expect(medicao.subagentesPorTipo).toEqual({ executor: 2 });
    expect(medicao.ferramentas).toEqual({ Agent: 2, Edit: 1 });
    expect(medicao.modeloDoPrincipal).toBe("claude-opus");
  });

  it("associa cada subagente à chamada Agent pelo toolUseId do meta.json", () => {
    const medicao = medirTranscricoes([
      {
        papel: "principal",
        agenteId: null,
        tipoDeAgente: null,
        linhas: [
          assistente("p1", "opus", usoA, [
            { type: "tool_use", id: "toolu_1", name: "Agent", input: {} },
            { type: "tool_use", id: "toolu_2", name: "Agent", input: {} },
          ]),
        ],
      },
      { papel: "subagente", agenteId: "a1", tipoDeAgente: "executor", chamadaId: "toolu_1", linhas: [assistente("s1", "opus", usoSub)] },
      { papel: "subagente", agenteId: "a9", tipoDeAgente: "executor", chamadaId: "toolu_x", linhas: [assistente("s9", "opus", usoSub)] },
    ]);
    expect(medicao.subagentesLancados).toBe(2);
    expect(medicao.subagentesSemChamada).toEqual(["a9"]);
    expect(medicao.chamadasSemSubagente).toEqual(["toolu_2"]);
  });

  it("compactação (agent-acompact-*) conta para a principal e não é subagente", () => {
    const medicao = medirTranscricoes([
      { papel: "principal", agenteId: null, tipoDeAgente: null, linhas: [assistente("p1", "opus", usoA)] },
      { papel: "subagente", agenteId: "acompact-123", tipoDeAgente: null, chamadaId: null, linhas: [assistente("c1", "opus", usoB)] },
    ]);
    expect(ehCompactacao("acompact-123")).toBe(true);
    expect(medicao.subagentesLancados).toBe(0);
    expect(totalDeTokens(medicao.subagentes)).toBe(0);
    expect(medicao.principal.leituraDeCache).toBe(3000);
    expect(medicao.subagentesSemChamada).toEqual([]);
  });

  it("trata linhas isSidechain no arquivo principal como subagente (versões antigas)", () => {
    const medicao = medirTranscricoes([
      {
        papel: "principal",
        agenteId: null,
        tipoDeAgente: null,
        linhas: [
          assistente("m1", "opus", usoA),
          assistente("m2", "opus", usoB, [], { isSidechain: true, agentId: "x" }),
          assistente("m3", "opus", usoB, [], { isSidechain: true, agentId: "x" }),
        ],
      },
    ]);
    expect(totalDeTokens(medicao.subagentes)).toBe(2 * (3 + 2000 + 50));
    expect(medicao.subagentesLancados).toBe(1);
  });

  it("subagente sem linhas (ex.: fora do recorte) não conta como lançado", () => {
    const medicao = medirTranscricoes([
      { papel: "principal", agenteId: null, tipoDeAgente: null, linhas: [assistente("p1", "opus", usoA)] },
      { papel: "subagente", agenteId: "antigo", tipoDeAgente: "executor", chamadaId: "toolu_velho", linhas: [] },
    ]);
    expect(medicao.subagentesLancados).toBe(0);
    expect(medicao.subagentesSemChamada).toEqual([]);
  });

  it("modeloDoPrincipal é o de mais saída no principal, sem compactação nem subagentes", () => {
    const medicao = medirTranscricoes([
      {
        papel: "principal",
        agenteId: null,
        tipoDeAgente: null,
        linhas: [
          assistente("p1", "claude-haiku-5-5", { i: 0, cl: 0, cc: 0, o: 10 }),
          assistente("p2", "claude-opus-5-5", { i: 0, cl: 0, cc: 0, o: 300 }),
          assistente("p3", "<synthetic>", { i: 0, cl: 0, cc: 0, o: 9999 }),
        ],
      },
      { papel: "subagente", agenteId: "acompact-1", tipoDeAgente: null, linhas: [assistente("c1", "claude-sonnet-5-5", { i: 0, cl: 0, cc: 0, o: 5000 })] },
      { papel: "subagente", agenteId: "a1", tipoDeAgente: null, linhas: [assistente("s1", "claude-fable-5-1", { i: 0, cl: 0, cc: 0, o: 5000 })] },
    ]);
    expect(medicao.modeloDoPrincipal).toBe("claude-opus-5-5");
    expect(medirTranscricoes([]).modeloDoPrincipal).toBeNull();
  });
});

describe("recorte por período", () => {
  it("janelaDoTurno aplica 2 s antes e 5 s depois, inclusive nas bordas", () => {
    const janela = janelaDoTurno(new Date("2026-11-04T10:00:00.000Z"), new Date("2026-11-04T10:01:00.000Z"));
    expect(linhaNaJanela({ timestamp: "2026-11-04T09:59:58.000Z" }, janela)).toBe(true);
    expect(linhaNaJanela({ timestamp: "2026-11-04T09:59:57.999Z" }, janela)).toBe(false);
    expect(linhaNaJanela({ timestamp: "2026-11-04T10:01:05.000Z" }, janela)).toBe(true);
    expect(linhaNaJanela({ timestamp: "2026-11-04T10:01:05.001Z" }, janela)).toBe(false);
    expect(linhaNaJanela({ type: "assistant" }, janela)).toBe(false);
    expect(linhaNaJanela("texto", janela)).toBe(false);
  });

  it("lerLinhaJson ignora linha vazia ou inválida", () => {
    expect(lerLinhaJson("")).toBeUndefined();
    expect(lerLinhaJson("{truncad")).toBeUndefined();
    expect(lerLinhaJson('{"a":1}')).toEqual({ a: 1 });
  });
});

describe("indiceDeCusto", () => {
  it("pondera entrada, cache e saída", () => {
    expect(indiceDeCusto({ entrada: 100, criacaoDeCache: 1000, leituraDeCache: 10_000, saida: 10 })).toBe(100 + 1250 + 1000 + 50);
  });
});
