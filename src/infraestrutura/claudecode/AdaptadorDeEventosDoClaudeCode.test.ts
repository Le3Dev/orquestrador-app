import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { EventoDoMotor } from "../../orquestracao/EventoDeOrquestracao";
import { AdaptadorDeEventosDoClaudeCode } from "./AdaptadorDeEventosDoClaudeCode";

/**
 * As fixtures são saídas reais de `claude -p --output-format stream-json`
 * (Claude Code 2.1.312), capturadas no spike de validação:
 * - turno1: orquestrador lança 2 subagentes em paralelo, cada um lê um arquivo;
 * - turno2: sessão retomada; o orquestrador tenta um `git commit`, que é negado.
 */
function traduzirFixture(nome: string): { adaptador: AdaptadorDeEventosDoClaudeCode; eventos: EventoDoMotor[] } {
  const adaptador = new AdaptadorDeEventosDoClaudeCode();
  const linhas = readFileSync(path.join(__dirname, "fixtures", `${nome}.ndjson`), "utf8")
    .split("\n")
    .filter((linha) => linha.trim() !== "");
  const eventos = linhas.flatMap((linha) => adaptador.traduzir(JSON.parse(linha)));
  return { adaptador, eventos };
}

function doTipo<Tipo extends EventoDoMotor["tipo"]>(
  eventos: EventoDoMotor[],
  tipo: Tipo,
): Extract<EventoDoMotor, { tipo: Tipo }>[] {
  return eventos.filter((evento): evento is Extract<EventoDoMotor, { tipo: Tipo }> => evento.tipo === tipo);
}

const PERIODO = "a41787646eec07830";
const RESERVA = "a6a6ac08da859dc4b";

describe("AdaptadorDeEventosDoClaudeCode — turno com dois subagentes", () => {
  const { adaptador, eventos } = traduzirFixture("turno1");

  it("começa avisando que a sessão foi iniciada", () => {
    expect(eventos[0]).toEqual({ tipo: "sessao_iniciada" });
  });

  it("dá sinal de vida enquanto o Claude raciocina, com a estimativa de tokens", () => {
    const sinais = doTipo(eventos, "sinal_de_vida");

    expect(sinais.length).toBeGreaterThan(0);
    expect(sinais[0]).toEqual({ tipo: "sinal_de_vida", tokensPensando: 50 });
    expect(sinais[1]?.tokensPensando).toBe(267);
  });

  it("identifica os dois subagentes pelo task_id", () => {
    const iniciados = doTipo(eventos, "subagente_iniciado");

    expect(iniciados.map((evento) => evento.subagenteId)).toEqual([PERIODO, RESERVA]);
    expect(iniciados[0]?.descricao).toBe("Descrever Periodo.ts");
    expect(iniciados[0]?.tarefa).toContain("Periodo.ts");
  });

  it("atribui progresso, textos e conclusão ao subagente certo", () => {
    const progresso = doTipo(eventos, "progresso_do_subagente");
    expect(progresso.map((evento) => evento.subagenteId).sort()).toEqual([PERIODO, RESERVA].sort());
    expect(progresso[0]?.ultimaFerramenta).toBe("Read");

    const textos = doTipo(eventos, "texto_do_subagente");
    expect(textos.find((evento) => evento.subagenteId === PERIODO)?.texto).toContain("Periodo");
    expect(textos.find((evento) => evento.subagenteId === RESERVA)?.texto).toContain("Reserva");

    const concluidos = doTipo(eventos, "subagente_concluido");
    expect(concluidos.map((evento) => evento.situacao)).toEqual(["concluido", "concluido"]);
    expect(concluidos[0]?.tokens).toBeGreaterThan(0);
  });

  it("entrega o relatório final de cada subagente sem as marcações do Claude Code", () => {
    const resultados = doTipo(eventos, "resultado_do_subagente");

    expect(resultados.map((evento) => evento.subagenteId)).toEqual([PERIODO, RESERVA]);
    expect(resultados[0]?.resultado).toMatch(/^Objeto de valor imutável `Periodo`/);
    expect(resultados.every((evento) => !evento.resultado.includes("<tools-used-before-summary>"))).toBe(true);
  });

  it("não acusa o orquestrador de usar ferramentas: ele só lançou subagentes", () => {
    expect(doTipo(eventos, "ferramenta_do_orquestrador")).toEqual([]);
    expect(doTipo(eventos, "texto_do_orquestrador").at(-1)?.texto).toContain("Periodo.ts");
  });

  it("traduz o uso da cota da assinatura", () => {
    const [cota] = doTipo(eventos, "uso_da_cota");

    expect(cota?.janelas.map((janela) => janela.nome)).toEqual(["5 horas", "7 dias"]);
    expect(cota?.janelas[0]?.utilizacao).toBe(0.09);
    expect(cota?.janelas[0]?.renovaEm).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("monta o resultado do turno com a resposta e o consumo", () => {
    expect(adaptador.resultado).toMatchObject({
      sucesso: true,
      uso: { subagentesLancados: 2, tokensDeSaida: 1981 },
    });
    expect(adaptador.resultado?.sucesso && adaptador.resultado.resposta).toContain("Reserva.ts");
  });
});

describe("AdaptadorDeEventosDoClaudeCode — turno retomado com permissão negada", () => {
  const { adaptador, eventos } = traduzirFixture("turno2");

  it("aponta que o orquestrador usou uma ferramenta diretamente", () => {
    expect(doTipo(eventos, "ferramenta_do_orquestrador")).toEqual([
      { tipo: "ferramenta_do_orquestrador", ferramenta: "PowerShell", detalhe: "git commit -m teste" },
    ]);
  });

  it("registra a negação de permissão", () => {
    expect(doTipo(eventos, "permissao_negada")).toEqual([
      { tipo: "permissao_negada", ferramenta: "PowerShell", detalhe: "git commit -m teste" },
    ]);
  });

  it("conta só o consumo deste turno, não o acumulado da sessão", () => {
    expect(adaptador.resultado).toMatchObject({ sucesso: true, uso: { tokensDeSaida: 515 } });
  });
});

describe("AdaptadorDeEventosDoClaudeCode — subagente em segundo plano", () => {
  // Sequência observada no teste ponta a ponta: o Orquestrador lança o
  // Subagente em segundo plano, recebe um retorno vazio na hora e é retomado
  // num segundo ciclo (novo `init` e novo `result`) quando o Subagente acaba.
  function traduzirTudo(mensagens: unknown[]): { adaptador: AdaptadorDeEventosDoClaudeCode; eventos: EventoDoMotor[] } {
    const adaptador = new AdaptadorDeEventosDoClaudeCode();
    return { adaptador, eventos: mensagens.flatMap((mensagem) => adaptador.traduzir(mensagem)) };
  }

  const resultado = (tokensDeSaida: number, duracaoMs: number, resposta: string) => ({
    type: "result",
    subtype: "success",
    is_error: false,
    result: resposta,
    duration_ms: duracaoMs,
    subagent_stats: { spawned: 1 },
    model_usage_since_last_result: { "claude-haiku-5-5": { inputTokens: 10, outputTokens: tokensDeSaida } },
  });

  const { adaptador, eventos } = traduzirTudo([
    { type: "system", subtype: "init", session_id: "s" },
    { type: "system", subtype: "task_started", task_id: "t1", tool_use_id: "chamada-1", description: "Ler", prompt: "leia" },
    {
      type: "user",
      parent_tool_use_id: null,
      message: { content: [{ type: "tool_result", tool_use_id: "chamada-1", content: "" }] },
      tool_use_result: { status: "async_launched", agentId: "t1", content: [] },
    },
    resultado(100, 1000, "Aguardando o subagente."),
    { type: "system", subtype: "task_notification", task_id: "t1", status: "completed", summary: "Relatório do subagente", usage: {} },
    { type: "system", subtype: "init", session_id: "s" },
    resultado(50, 500, "Síntese final"),
  ]);

  it("o subagente iniciado leva o tipo; sem tipo no evento, vale o executor", () => {
    expect(doTipo(eventos, "subagente_iniciado")[0]?.papel).toBe("executor");
    const pronto = new AdaptadorDeEventosDoClaudeCode().traduzir({
      type: "system",
      subtype: "task_started",
      task_id: "t2",
      tool_use_id: "chamada-2",
      description: "Contar",
      subagent_type: "contador-de-linhas",
      prompt: "conte",
    });
    expect(pronto).toEqual([
      { tipo: "subagente_iniciado", subagenteId: "t2", descricao: "Contar", tarefa: "conte", papel: "contador-de-linhas" },
    ]);
  });

  it("não toma o retorno imediato do lançamento como resultado", () => {
    expect(doTipo(eventos, "resultado_do_subagente")).toEqual([]);
    expect(doTipo(eventos, "subagente_concluido")[0]?.resumo).toBe("Relatório do subagente");
  });

  it("anuncia a sessão uma vez só", () => {
    expect(doTipo(eventos, "sessao_iniciada")).toHaveLength(1);
  });

  it("fica com a resposta do último ciclo e soma o consumo de todos", () => {
    expect(adaptador.resultado).toEqual({
      sucesso: true,
      resposta: "Síntese final",
      // `subagent_stats` é acumulado no processo: os dois ciclos contam o mesmo subagente.
      uso: { duracaoMs: 1500, tokensDeEntrada: 20, tokensDeSaida: 150, subagentesLancados: 1 },
    });
  });
});

describe("AdaptadorDeEventosDoClaudeCode: endereços locais", () => {
  const VITE = "\n  VITE v6.0.0  ready in 300 ms\n\n  ➜  Local:   http://localhost:\x1b[1m5173\x1b[22m/\n";

  it("anuncia o endereço que o Bash do orquestrador imprimiu, mesmo colorido", () => {
    const eventos = new AdaptadorDeEventosDoClaudeCode().traduzir({
      type: "user",
      parent_tool_use_id: null,
      message: { content: [{ type: "tool_result", tool_use_id: "chamada-1", content: VITE }] },
      tool_use_result: { stdout: VITE, stderr: "", interrupted: false },
    });

    expect(eventos).toEqual([{ tipo: "endereco_local_detectado", url: "http://localhost:5173" }]);
  });

  it("anuncia o endereço achado por um subagente, com o retorno em blocos", () => {
    const eventos = new AdaptadorDeEventosDoClaudeCode().traduzir({
      type: "user",
      parent_tool_use_id: "chamada-do-subagente",
      agent_id: "t1",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "chamada-2",
            content: [{ type: "text", text: "ready - started server on 0.0.0.0:3000, url: http://0.0.0.0:3000" }],
          },
        ],
      },
    });

    expect(eventos).toEqual([{ tipo: "endereco_local_detectado", url: "http://localhost:3000" }]);
  });

  it("acha o endereço só na saída estruturada, quando o texto não o traz", () => {
    const eventos = new AdaptadorDeEventosDoClaudeCode().traduzir({
      type: "user",
      parent_tool_use_id: null,
      message: { content: [{ type: "tool_result", tool_use_id: "chamada-3", content: "" }] },
      tool_use_result: { stdout: "", stderr: "Listening on http://127.0.0.1:8080" },
    });

    expect(eventos).toEqual([{ tipo: "endereco_local_detectado", url: "http://localhost:8080" }]);
  });

  it("não repete o mesmo endereço no turno", () => {
    const adaptador = new AdaptadorDeEventosDoClaudeCode();
    const retorno = (conteudo: string) => ({
      type: "user",
      parent_tool_use_id: null,
      message: { content: [{ type: "tool_result", tool_use_id: "chamada", content: conteudo }] },
    });

    expect(adaptador.traduzir(retorno(VITE))).toHaveLength(1);
    expect(adaptador.traduzir(retorno("de novo: http://127.0.0.1:5173/"))).toEqual([]);
    expect(adaptador.traduzir(retorno("http://localhost:5173 e http://localhost:4173"))).toEqual([
      { tipo: "endereco_local_detectado", url: "http://localhost:4173" },
    ]);
  });

  it("ignora endereço citado num arquivo lido, mas vê o do comando", () => {
    const adaptador = new AdaptadorDeEventosDoClaudeCode();
    adaptador.traduzir({
      type: "assistant",
      parent_tool_use_id: null,
      message: {
        content: [
          { type: "tool_use", id: "leitura", name: "Read", input: { file_path: "README.md" } },
          { type: "tool_use", id: "comando", name: "Bash", input: { command: "npm run dev" } },
        ],
      },
    });
    const retorno = (chamada: string, conteudo: string) => ({
      type: "user",
      parent_tool_use_id: null,
      message: { content: [{ type: "tool_result", tool_use_id: chamada, content: conteudo }] },
    });

    expect(adaptador.traduzir(retorno("leitura", "Abra http://localhost:3000 no navegador."))).toEqual([]);
    expect(adaptador.traduzir(retorno("comando", VITE))).toEqual([
      { tipo: "endereco_local_detectado", url: "http://localhost:5173" },
    ]);
  });

  it("vê o endereço na leitura da saída de um comando em segundo plano", () => {
    const adaptador = new AdaptadorDeEventosDoClaudeCode();
    adaptador.traduzir({
      type: "assistant",
      parent_tool_use_id: null,
      message: {
        content: [
          {
            type: "tool_use",
            id: "saida",
            name: "Read",
            input: { file_path: "/private/tmp/claude-501/projeto/sessao/tasks/b9ogs3hfd.output" },
          },
        ],
      },
    });

    expect(
      adaptador.traduzir({
        type: "user",
        parent_tool_use_id: null,
        message: { content: [{ type: "tool_result", tool_use_id: "saida", content: VITE }] },
      }),
    ).toEqual([{ tipo: "endereco_local_detectado", url: "http://localhost:5173" }]);
  });

  it("guarda como candidato o endereço citado no comando e na fala, sem anunciar", () => {
    const adaptador = new AdaptadorDeEventosDoClaudeCode();
    const eventos = adaptador.traduzir({
      type: "assistant",
      parent_tool_use_id: null,
      message: {
        content: [
          { type: "text", text: "O servidor está no ar em **http://127.0.0.1:4173/**." },
          { type: "tool_use", id: "abrir", name: "Bash", input: { command: "open http://127.0.0.1:4173/" } },
          { type: "tool_use", id: "ler", name: "Read", input: { file_path: "http://localhost:9999" } },
        ],
      },
    });

    expect(doTipo(eventos, "endereco_local_detectado")).toEqual([]);
    expect(adaptador.retirarCandidatos()).toEqual(["http://localhost:4173"]);
    // Retirados uma vez: não voltam.
    expect(adaptador.retirarCandidatos()).toEqual([]);
  });

  it("acha candidatos na fala e no relatório de um subagente e na resposta final", () => {
    const adaptador = new AdaptadorDeEventosDoClaudeCode();
    adaptador.traduzir({
      type: "assistant",
      parent_tool_use_id: "chamada-do-subagente",
      agent_id: "t1",
      message: {
        content: [
          { type: "text", text: "Subi em http://localhost:3000" },
          { type: "tool_use", id: "c", name: "Bash", input: { command: "curl -s localhost:3001 http://localhost:3002" } },
        ],
      },
    });
    adaptador.traduzir({ type: "result", subtype: "success", is_error: false, result: "Pronto: http://localhost:8080/app" });

    expect(adaptador.retirarCandidatos()).toEqual([
      "http://localhost:3000",
      "http://localhost:3002",
      "http://localhost:8080/app",
    ]);
  });

  it("confirma um candidato uma vez só, e não repete o que a saída de um comando já anunciou", () => {
    const adaptador = new AdaptadorDeEventosDoClaudeCode();
    adaptador.traduzir({
      type: "user",
      parent_tool_use_id: null,
      message: { content: [{ type: "tool_result", tool_use_id: "x", content: VITE }] },
    });
    adaptador.traduzir({
      type: "assistant",
      parent_tool_use_id: null,
      message: { content: [{ type: "text", text: "http://localhost:5173 e http://localhost:4173" }] },
    });

    expect(adaptador.retirarCandidatos()).toEqual(["http://localhost:4173"]);
    expect(adaptador.confirmarEndereco("http://localhost:4173")).toEqual([
      { tipo: "endereco_local_detectado", url: "http://localhost:4173" },
    ]);
    expect(adaptador.confirmarEndereco("http://localhost:4173")).toEqual([]);
  });

  it("não vê endereço nos turnos gravados, que não sobem servidor", () => {
    expect(doTipo(traduzirFixture("turno1").eventos, "endereco_local_detectado")).toEqual([]);
    expect(doTipo(traduzirFixture("turno2").eventos, "endereco_local_detectado")).toEqual([]);
  });
});

describe("AdaptadorDeEventosDoClaudeCode — falhas", () => {
  it("transforma um resultado com erro em falha com o texto do Claude Code", () => {
    const adaptador = new AdaptadorDeEventosDoClaudeCode();
    adaptador.traduzir({ type: "result", subtype: "success", is_error: true, result: "Claude AI usage limit reached" });

    expect(adaptador.resultado).toMatchObject({ sucesso: false, motivo: "Claude AI usage limit reached" });
  });

  it("explica o subtipo quando não há texto", () => {
    const adaptador = new AdaptadorDeEventosDoClaudeCode();
    adaptador.traduzir({ type: "result", subtype: "error_max_turns", is_error: true });

    expect(adaptador.resultado).toMatchObject({ sucesso: false, motivo: expect.stringContaining("limite de passos") });
  });

  it("ignora o que não é objeto", () => {
    const adaptador = new AdaptadorDeEventosDoClaudeCode();

    expect(adaptador.traduzir("texto solto")).toEqual([]);
    expect(adaptador.traduzir(null)).toEqual([]);
    expect(adaptador.resultado).toBeNull();
  });
});
