import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { EventoDoMotorDeChat } from "../../chat/MotorDeChat";
import { AdaptadorDeEventosDoChat } from "./AdaptadorDeEventosDoChat";

/**
 * `chat-turno1` é a saída real de `claude -p --output-format stream-json
 * --include-partial-messages` (Claude Code 2.1.317, Haiku, esforço baixo) para
 * "Pesquise na web qual é a versão LTS mais recente do Node.js e responda em
 * uma frase.": um WebSearch, um WebFetch e a resposta em pedaços.
 */
function traduzirTudo(mensagens: unknown[]): { adaptador: AdaptadorDeEventosDoChat; eventos: EventoDoMotorDeChat[] } {
  const adaptador = new AdaptadorDeEventosDoChat();
  return { adaptador, eventos: mensagens.flatMap((mensagem) => adaptador.traduzir(mensagem)) };
}

function doTipo<Tipo extends EventoDoMotorDeChat["tipo"]>(
  eventos: EventoDoMotorDeChat[],
  tipo: Tipo,
): Extract<EventoDoMotorDeChat, { tipo: Tipo }>[] {
  return eventos.filter((evento): evento is Extract<EventoDoMotorDeChat, { tipo: Tipo }> => evento.tipo === tipo);
}

const linhasDaFixture = readFileSync(path.join(__dirname, "fixtures", "chat-turno1.ndjson"), "utf8")
  .split("\n")
  .filter((linha) => linha.trim() !== "")
  .map((linha): unknown => JSON.parse(linha));

describe("AdaptadorDeEventosDoChat — pergunta real com pesquisa na web", () => {
  const { adaptador, eventos } = traduzirTudo(linhasDaFixture);

  it("entrega a resposta em vários trechos que, juntos, formam a resposta final", () => {
    const trechos = doTipo(eventos, "trecho_da_resposta");
    const resposta = adaptador.resultado?.sucesso === true ? adaptador.resultado.resposta : "";

    expect(trechos.length).toBeGreaterThan(1);
    expect(resposta).toContain("Node.js");
    expect(trechos.map((trecho) => trecho.texto).join("").trim()).toBe(resposta.trim());
  });

  it("não vaza o JSON de entrada das ferramentas nem o raciocínio como trecho", () => {
    const texto = doTipo(eventos, "trecho_da_resposta")
      .map((trecho) => trecho.texto)
      .join("");

    expect(texto).not.toContain('"query"');
  });

  it("mostra as ferramentas usadas com a consulta e a URL", () => {
    expect(doTipo(eventos, "ferramenta_do_chat")).toEqual([
      { tipo: "ferramenta_do_chat", ferramenta: "WebSearch", detalhe: "Node.js latest LTS version release" },
      { tipo: "ferramenta_do_chat", ferramenta: "WebFetch", detalhe: "https://nodejs.org/en/about/previous-releases" },
    ]);
  });

  it("traduz o uso da cota da assinatura", () => {
    const [cota] = doTipo(eventos, "uso_da_cota");

    expect(cota?.janelas.map((janela) => janela.nome)).toEqual(["5 horas", "7 dias"]);
    expect(cota?.janelas[0]?.renovaEm).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("monta o resultado com o consumo e o modelo usado", () => {
    expect(adaptador.resultado).toMatchObject({
      sucesso: true,
      uso: {
        duracaoMs: 24603,
        tokensDeEntrada: 16506 + 51328 + 20264,
        tokensDeSaida: 1368,
        modeloUsado: "claude-haiku-5-5",
      },
    });
  });
});

describe("AdaptadorDeEventosDoChat — linhas sintéticas", () => {
  const uso = (entrada: number, saida: number) => ({
    inputTokens: entrada,
    outputTokens: saida,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  });

  it("com vários result, usa o último acumulado — nunca a soma", () => {
    const { adaptador } = traduzirTudo([
      {
        type: "result",
        subtype: "success",
        is_error: false,
        result: "primeira",
        duration_ms: 100,
        modelUsage: { "claude-opus-5-5": uso(10, 100) },
      },
      {
        type: "result",
        subtype: "success",
        is_error: false,
        result: "final",
        duration_ms: 300,
        modelUsage: { "claude-opus-5-5": uso(30, 250), "claude-haiku-5-5": uso(5, 20) },
      },
    ]);

    expect(adaptador.resultado).toEqual({
      sucesso: true,
      resposta: "final",
      uso: { duracaoMs: 300, tokensDeEntrada: 35, tokensDeSaida: 270, modeloUsado: "claude-opus-5-5" },
    });
  });

  it("em sessão retomada, conta só o consumo desde o último result, não o da conversa inteira", () => {
    const { adaptador } = traduzirTudo([
      {
        type: "result",
        subtype: "success",
        is_error: false,
        result: "ok",
        duration_ms: 50,
        modelUsage: { "claude-haiku-5-5": uso(1000, 900) },
        model_usage_since_last_result: { "claude-haiku-5-5": uso(40, 30) },
      },
    ]);

    expect(adaptador.resultado).toMatchObject({ uso: { tokensDeEntrada: 40, tokensDeSaida: 30 } });
  });

  it("transforma o limite de uso em falha com motivo em português", () => {
    const { adaptador } = traduzirTudo([
      { type: "result", subtype: "success", is_error: true, result: "Claude AI usage limit reached|1793221200" },
    ]);

    expect(adaptador.resultado).toMatchObject({
      sucesso: false,
      motivo: expect.stringContaining("Limite de uso da assinatura"),
    });
  });

  it("explica o subtipo de erro quando não há texto", () => {
    const { adaptador } = traduzirTudo([{ type: "result", subtype: "error_during_execution", is_error: true }]);

    expect(adaptador.resultado).toMatchObject({ sucesso: false, motivo: expect.stringContaining("erro durante") });
  });

  it("ignora linhas desconhecidas, deltas de pensamento e eventos de subagentes", () => {
    const { adaptador, eventos } = traduzirTudo([
      "texto solto",
      null,
      { type: "coisa_nova", campo: 1 },
      { type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "hm" } } },
      { type: "stream_event", parent_tool_use_id: "toolu_x", event: { type: "content_block_delta", delta: { type: "text_delta", text: "sub" } } },
      { type: "assistant", parent_tool_use_id: "toolu_x", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "a" } }] } },
      { type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", delta: { type: "text_delta", text: "oi" } } },
    ]);

    expect(eventos).toEqual([{ tipo: "trecho_da_resposta", texto: "oi" }]);
    expect(adaptador.resultado).toBeNull();
  });

  it("resume Read pelo caminho e Glob/Grep pelo padrão", () => {
    const { eventos } = traduzirTudo([
      {
        type: "assistant",
        parent_tool_use_id: null,
        message: {
          content: [
            { type: "tool_use", name: "Read", input: { file_path: "C:\\p\\a.ts" } },
            { type: "tool_use", name: "Grep", input: { pattern: "TODO", path: "C:\\p" } },
            { type: "tool_use", name: "Glob", input: { pattern: "**/*.ts" } },
          ],
        },
      },
    ]);

    expect(doTipo(eventos, "ferramenta_do_chat").map((evento) => evento.detalhe)).toEqual([
      "C:\\p\\a.ts",
      "TODO",
      "**/*.ts",
    ]);
  });
});
