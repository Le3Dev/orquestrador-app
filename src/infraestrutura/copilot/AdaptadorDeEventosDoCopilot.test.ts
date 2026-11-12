import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { EventoDoMotor } from "../../orquestracao/EventoDeOrquestracao";
import {
  AdaptadorDeEventosDoCopilot,
  classificarFalhaDoCopilot,
  janelasDaCotaDoCopilot,
  resumirEntradaDoCopilot,
} from "./AdaptadorDeEventosDoCopilot";
import { EventoDaSessaoCopilot } from "./FachadaCopilotSdk";

/**
 * As fixtures `*.jsonl` são eventos REAIS da sessão do Copilot SDK 1.0.31
 * (modelo claude-haiku-5.5, capturados por `scripts/spike-copilot.mts`, já sem
 * dados da máquina e com os deltas repetitivos amostrados). As `*.sintetica.jsonl`
 * foram montadas à mão a partir dos tipos do SDK: o spike não conseguiu provocar
 * um limite de uso, uma sobrecarga nem uma falha de rede de verdade.
 */
function lerFixture(nome: string): EventoDaSessaoCopilot[] {
  return readFileSync(path.join(__dirname, "fixtures", `${nome}.jsonl`), "utf8")
    .split(/\r?\n/)
    .filter((linha) => linha.trim() !== "")
    .map((linha) => JSON.parse(linha) as EventoDaSessaoCopilot);
}

function traduzir(nome: string): { eventos: EventoDoMotor[]; adaptador: AdaptadorDeEventosDoCopilot } {
  const adaptador = new AdaptadorDeEventosDoCopilot();
  const eventos = lerFixture(nome).flatMap((evento) => adaptador.traduzir(evento));
  return { eventos, adaptador };
}

function dosTipos<T extends EventoDoMotor["tipo"]>(eventos: readonly EventoDoMotor[], tipo: T): Extract<EventoDoMotor, { tipo: T }>[] {
  return eventos.filter((evento): evento is Extract<EventoDoMotor, { tipo: T }> => evento.tipo === tipo);
}

describe("AdaptadorDeEventosDoCopilot — turno simples (fixture real)", () => {
  const { eventos, adaptador } = traduzir("turno-simples");

  it("traduz a resposta em texto_do_orquestrador, sem ferramenta", () => {
    expect(dosTipos(eventos, "texto_do_orquestrador")).toEqual([{ tipo: "texto_do_orquestrador", texto: "PONG" }]);
    expect(dosTipos(eventos, "ferramenta_do_orquestrador")).toEqual([]);
  });

  it("termina no session.idle com sucesso e o consumo do assistant.usage", () => {
    expect(adaptador.terminou).toBe(true);
    expect(adaptador.interrompidoPeloAbort).toBe(false);
    expect(adaptador.resultado).toMatchObject({
      sucesso: true,
      resposta: "PONG",
      uso: { tokensDeEntrada: 6914, tokensDeSaida: 5, subagentesLancados: 0 },
    });
  });

  it("calcula a duração pelos instantes dos eventos e o custo em créditos de IA", () => {
    expect(adaptador.uso.duracaoMs).toBeGreaterThan(1_000);
    expect(adaptador.uso.duracaoMs).toBeLessThan(10_000);
    expect(adaptador.creditosDeIA).toBeCloseTo(0.0867, 3);
  });

  it("lê a cota do quotaSnapshots: só a janela que não é ilimitada, com o dia em que renova", () => {
    expect(dosTipos(eventos, "uso_da_cota")).toEqual([
      {
        tipo: "uso_da_cota",
        janelas: [{ nome: "Requisições premium (mês)", utilizacao: 0, renovaEm: "2026-12-01T00:00:00Z", situacao: "allowed" }],
      },
    ]);
  });

  it("não tem resultado antes do session.idle", () => {
    const parcial = new AdaptadorDeEventosDoCopilot();
    for (const evento of lerFixture("turno-simples").filter((item) => item.type !== "session.idle")) {
      parcial.traduzir(evento);
    }
    expect(parcial.terminou).toBe(false);
    expect(parcial.resultado).toBeNull();
  });
});

describe("AdaptadorDeEventosDoCopilot — ferramenta em streaming (fixture real)", () => {
  const { eventos, adaptador } = traduzir("streaming-com-ferramenta");

  it("traduz a ferramenta com o caminho como detalhe curto e depois o texto", () => {
    const ferramentas = dosTipos(eventos, "ferramenta_do_orquestrador");
    expect(ferramentas).toHaveLength(1);
    expect(ferramentas[0]?.ferramenta).toBe("view");
    expect(ferramentas[0]?.detalhe).toMatch(/nota\.txt$/);
    expect(eventos.findIndex((evento) => evento.tipo === "ferramenta_do_orquestrador")).toBeLessThan(
      eventos.findIndex((evento) => evento.tipo === "texto_do_orquestrador" && evento.texto === "Girassol"),
    );
  });

  it("soma o consumo das duas chamadas ao modelo do turno e responde Girassol", () => {
    expect(adaptador.resultado).toMatchObject({ sucesso: true, resposta: "Girassol" });
    expect(adaptador.uso.tokensDeEntrada).toBe(6998 + 7111);
  });

  it("uma leitura aprovada não vira permissao_negada", () => {
    expect(dosTipos(eventos, "permissao_negada")).toEqual([]);
  });
});

describe("AdaptadorDeEventosDoCopilot — raciocínio vira sinal de vida", () => {
  it("emite sinal_de_vida a partir dos reasoning_delta, no máximo um por segundo, com tokens estimados que só crescem", () => {
    const adaptador = new AdaptadorDeEventosDoCopilot();
    const base = Date.parse("2026-11-12T14:00:00.000Z");
    const delta = (deslocamentoMs: number, conteudo: string): EventoDaSessaoCopilot => ({
      type: "assistant.reasoning_delta",
      timestamp: new Date(base + deslocamentoMs).toISOString(),
      data: { reasoningId: "r1", deltaContent: conteudo },
    });
    const eventos = [
      delta(0, "a".repeat(40)),
      delta(300, "b".repeat(40)),
      delta(900, "c".repeat(40)),
      delta(1_200, "d".repeat(40)),
      delta(2_500, "e".repeat(40)),
    ].flatMap((evento) => adaptador.traduzir(evento));
    expect(eventos).toEqual([
      { tipo: "sinal_de_vida", tokensPensando: 10 },
      { tipo: "sinal_de_vida", tokensPensando: 40 },
      { tipo: "sinal_de_vida", tokensPensando: 50 },
    ]);
  });

  it("o raciocínio de um subagente não vira sinal de vida do orquestrador", () => {
    const adaptador = new AdaptadorDeEventosDoCopilot();
    expect(
      adaptador.traduzir({ type: "assistant.reasoning_delta", agentId: "sub-1", data: { reasoningId: "r1", deltaContent: "x" } }),
    ).toEqual([]);
  });
});

describe("AdaptadorDeEventosDoCopilot — trava somente leitura (fixture real)", () => {
  const { eventos, adaptador } = traduzir("trava-somente-leitura");

  it("traduz as recusas da política em permissao_negada, com a ferramenta e o caminho", () => {
    const negadas = dosTipos(eventos, "permissao_negada");
    expect(negadas).toHaveLength(2);
    expect(negadas.map((negada) => negada.ferramenta).sort()).toEqual(["create", "view"]);
    expect(negadas.find((negada) => negada.ferramenta === "create")?.detalhe).toMatch(/criado-pelo-agente\.txt$/);
    expect(negadas.find((negada) => negada.ferramenta === "view")?.detalhe).toMatch(/\.env$/);
  });

  it("a gravação aprovada na pasta de artefatos aparece só como ferramenta", () => {
    const criacoes = dosTipos(eventos, "ferramenta_do_orquestrador").filter((evento) => evento.ferramenta === "create");
    expect(criacoes).toHaveLength(2);
    expect(dosTipos(eventos, "permissao_negada").some((negada) => /relatorio\.md$/.test(negada.detalhe))).toBe(false);
  });

  it("o turno conclui com sucesso mesmo com recusas: o modelo explicou o que foi negado", () => {
    expect(adaptador.resultado?.sucesso).toBe(true);
  });
});

describe("AdaptadorDeEventosDoCopilot — commit/push (fixture real)", () => {
  const { eventos } = traduzir("git-push-negado");

  it("recusa o git push com o comando inteiro como detalhe e deixa o git status passar", () => {
    const negadas = dosTipos(eventos, "permissao_negada");
    expect(negadas).toEqual([{ tipo: "permissao_negada", ferramenta: "powershell", detalhe: "git push origin main" }]);
    const comandos = dosTipos(eventos, "ferramenta_do_orquestrador").map((evento) => evento.detalhe);
    expect(comandos).toEqual(["git status --short", "git push origin main"]);
  });
});

describe("AdaptadorDeEventosDoCopilot — cancelamento (fixture real)", () => {
  const { adaptador } = traduzir("cancelamento");

  it("o session.idle com aborted marca o turno como interrompido, não como sucesso", () => {
    expect(adaptador.terminou).toBe(true);
    expect(adaptador.interrompidoPeloAbort).toBe(true);
    expect(adaptador.resultado).toMatchObject({ sucesso: false, motivo: "O turno foi interrompido antes de terminar." });
  });
});

describe("AdaptadorDeEventosDoCopilot — subagente (fixture real)", () => {
  const { eventos, adaptador } = traduzir("subagente");

  it("traduz o início com o id da instância, o papel, a descrição e a tarefa da chamada task", () => {
    const iniciados = dosTipos(eventos, "subagente_iniciado");
    expect(iniciados).toHaveLength(1);
    expect(iniciados[0]).toMatchObject({ papel: "executor", descricao: "Ler primeira palavra" });
    expect(iniciados[0]?.subagenteId).toMatch(/^[0-9a-f-]{36}$/);
    expect(iniciados[0]?.tarefa).toContain("nota.txt");
  });

  it("a chamada task não aparece como ferramenta do orquestrador", () => {
    expect(dosTipos(eventos, "ferramenta_do_orquestrador").map((evento) => evento.ferramenta)).not.toContain("task");
  });

  it("acompanha o subagente: progresso por ferramenta, texto, conclusão com tokens e duração, e o relatório", () => {
    const [iniciado] = dosTipos(eventos, "subagente_iniciado");
    const id = iniciado?.subagenteId;
    const progresso = dosTipos(eventos, "progresso_do_subagente");
    expect(progresso).toHaveLength(1);
    expect(progresso[0]).toMatchObject({ subagenteId: id, ultimaFerramenta: "view", ferramentasUsadas: 1 });
    expect(progresso[0]?.tokens).toBeGreaterThan(0);
    expect(dosTipos(eventos, "texto_do_subagente")).toEqual([{ tipo: "texto_do_subagente", subagenteId: id, texto: "Girassol" }]);
    expect(dosTipos(eventos, "subagente_concluido")).toEqual([
      { tipo: "subagente_concluido", subagenteId: id, situacao: "concluido", resumo: "Girassol", tokens: 6367, duracaoMs: 3201 },
    ]);
    expect(dosTipos(eventos, "resultado_do_subagente")).toEqual([
      { tipo: "resultado_do_subagente", subagenteId: id, resultado: "Girassol" },
    ]);
  });

  it("conta os subagentes lançados, e os tokens do subagente não entram no consumo do orquestrador", () => {
    expect(adaptador.uso.subagentesLancados).toBe(1);
    expect(adaptador.uso.tokensDeEntrada).toBe(10773 + 11254);
    expect(adaptador.resultado).toMatchObject({ sucesso: true });
  });

  it("o texto do subagente não vira texto_do_orquestrador", () => {
    expect(dosTipos(eventos, "texto_do_orquestrador").map((evento) => evento.texto)).toEqual([
      expect.stringContaining("executor respondeu"),
    ]);
  });
});

describe("AdaptadorDeEventosDoCopilot — subagente que falha ou é cancelado", () => {
  function fim(tipo: "subagent.failed" | "subagent.completed", dados: Record<string, unknown>): EventoDoMotor[] {
    const adaptador = new AdaptadorDeEventosDoCopilot();
    adaptador.traduzir({
      type: "subagent.started",
      agentId: "sub-1",
      timestamp: "2026-11-12T14:00:00.000Z",
      data: { toolCallId: "c1", agentName: "revisor", agentDisplayName: "revisar", agentDescription: "Revisa" },
    });
    return adaptador.traduzir({ type: tipo, agentId: "sub-1", data: { toolCallId: "c1", agentName: "revisor", ...dados } });
  }

  it("subagent.failed vira situacao falhou com o erro como resumo", () => {
    expect(fim("subagent.failed", { error: "estourou o contexto", durationMs: 40 })).toEqual([
      { tipo: "subagente_concluido", subagenteId: "sub-1", situacao: "falhou", resumo: "estourou o contexto", tokens: 0, duracaoMs: 40 },
    ]);
  });

  it("subagent.completed com cancelled vira situacao cancelado", () => {
    expect(fim("subagent.completed", { cancelled: true, durationMs: 10, totalTokens: 5 })).toMatchObject([
      { situacao: "cancelado", tokens: 5 },
    ]);
  });
});

describe("AdaptadorDeEventosDoCopilot — falhas (fixtures)", () => {
  it("sem login: causa outro, com a orientação de entrar no Copilot (fixture real)", () => {
    const { adaptador } = traduzir("erro-sem-autenticacao");
    const resultado = adaptador.resultado;
    expect(resultado).toMatchObject({ sucesso: false, causa: "outro" });
    expect(resultado?.sucesso === false && resultado.motivo).toContain("copilot login");
    expect(resultado?.sucesso === false && resultado.motivo).toContain("sem saldo");
  });

  it("modelo inexistente: causa outro, dizendo que o modelo não está disponível (fixture real)", () => {
    const { adaptador } = traduzir("erro-modelo-invalido");
    const resultado = adaptador.resultado;
    expect(resultado).toMatchObject({ sucesso: false, causa: "outro" });
    expect(resultado?.sucesso === false && resultado.motivo).toContain("modelo ou o esforço escolhido");
  });

  it("esforço inexistente: o mesmo aviso (fixture real)", () => {
    const resultado = traduzir("erro-esforco-invalido").adaptador.resultado;
    expect(resultado?.sucesso === false && resultado.motivo).toContain("modelo ou o esforço escolhido");
  });

  it("cota esgotada: limite_de_uso, e o liberaEm é o dia em que a janela renova (sintética)", () => {
    const { adaptador, eventos } = traduzir("cota-esgotada.sintetica");
    expect(adaptador.resultado).toMatchObject({ sucesso: false, causa: "limite_de_uso", liberaEm: "2026-12-01T00:00:00Z" });
    expect(dosTipos(eventos, "uso_da_cota")[0]?.janelas[0]).toMatchObject({ situacao: "rejected", utilizacao: 1 });
  });

  it("limite de taxa: limite_de_uso sem horário de liberação (sintética)", () => {
    const resultado = traduzir("limite-de-taxa.sintetica").adaptador.resultado;
    expect(resultado).toMatchObject({ sucesso: false, causa: "limite_de_uso", liberaEm: null });
    expect(resultado?.sucesso === false && resultado.motivo).toContain("Limite de uso do GitHub Copilot");
  });

  it("503 e texto de sobrecarga: sobrecarga (sintética)", () => {
    expect(traduzir("sobrecarga.sintetica").adaptador.resultado).toMatchObject({ sucesso: false, causa: "sobrecarga" });
  });

  it("fetch failed / ECONNRESET: rede (sintética)", () => {
    expect(traduzir("rede.sintetica").adaptador.resultado).toMatchObject({ sucesso: false, causa: "rede" });
  });

  it("um session.error seguido de uma resposta do modelo não é falha: ele se recuperou", () => {
    const adaptador = new AdaptadorDeEventosDoCopilot();
    for (const evento of [
      { type: "session.error", data: { errorType: "query", message: "fetch failed" } },
      { type: "assistant.message", data: { content: "Pronto." } },
      { type: "session.idle", data: {} },
    ]) {
      adaptador.traduzir(evento);
    }
    expect(adaptador.resultado).toMatchObject({ sucesso: true, resposta: "Pronto." });
  });
});

describe("classificarFalhaDoCopilot", () => {
  it.each([
    [{ errorType: "quota", errorCode: "billing_not_configured", message: "x" }, "limite_de_uso"],
    [{ errorType: "rate_limit", message: "x" }, "limite_de_uso"],
    [{ errorType: "query", message: "boom", statusCode: 429 }, "limite_de_uso"],
    [{ errorType: "query", message: "Too many requests" }, "limite_de_uso"],
    [{ errorType: "query", message: "boom", statusCode: 502 }, "sobrecarga"],
    [{ errorType: "query", message: "The model is overloaded (529)" }, "sobrecarga"],
    [{ errorType: "query", message: "socket hang up" }, "rede"],
    [{ errorType: "query", message: "getaddrinfo ENOTFOUND api.githubcopilot.com" }, "rede"],
    [{ errorType: "context_limit", message: "context window exceeded" }, "outro"],
    [{ errorType: "policy", message: "blocked by policy" }, "outro"],
  ] as const)("%j => %s", (erro, causa) => {
    expect(classificarFalhaDoCopilot(erro).causa).toBe(causa);
  });

  it("autenticação é causa outro, marcada como falta de login", () => {
    expect(classificarFalhaDoCopilot({ errorType: "authentication", message: "x" })).toMatchObject({ causa: "outro", semAutenticacao: true });
    expect(classificarFalhaDoCopilot({ errorType: "query", message: "Not authenticated. Please authenticate first." })).toMatchObject({
      semAutenticacao: true,
    });
  });
});

describe("janelasDaCotaDoCopilot", () => {
  const janela = (restante: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    isUnlimitedEntitlement: false,
    remainingPercentage: restante,
    usageAllowedWithExhaustedQuota: false,
    resetDate: "2026-12-01T00:00:00Z",
    ...extra,
  });

  it("ignora as janelas ilimitadas e as sem percentual", () => {
    expect(
      janelasDaCotaDoCopilot({ chat: janela(100, { isUnlimitedEntitlement: true }), completions: { isUnlimitedEntitlement: false } }),
    ).toEqual([]);
    expect(janelasDaCotaDoCopilot(undefined)).toEqual([]);
  });

  it("classifica a situação pelo saldo: allowed, allowed_warning e rejected", () => {
    const situacoes = [50, 10, 0].map((restante) => janelasDaCotaDoCopilot({ premium_interactions: janela(restante) })[0]?.situacao);
    expect(situacoes).toEqual(["allowed", "allowed_warning", "rejected"]);
  });

  it("com o saldo zerado mas o uso excedente permitido, não é rejected", () => {
    expect(janelasDaCotaDoCopilot({ premium_interactions: janela(0, { usageAllowedWithExhaustedQuota: true }) })[0]?.situacao).toBe(
      "allowed_warning",
    );
  });

  it("converte o saldo restante em utilização de 0 a 1", () => {
    expect(janelasDaCotaDoCopilot({ premium_interactions: janela(25) })[0]?.utilizacao).toBeCloseTo(0.75);
  });
});

describe("resumirEntradaDoCopilot", () => {
  it("escolhe o comando, o caminho, o padrão ou a URL, nesta ordem", () => {
    expect(resumirEntradaDoCopilot({ command: "git status", path: "x" })).toBe("git status");
    expect(resumirEntradaDoCopilot({ path: "src/a.ts", file_text: "…" })).toBe("src/a.ts");
    expect(resumirEntradaDoCopilot({ pattern: "**/*.ts" })).toBe("**/*.ts");
    expect(resumirEntradaDoCopilot({ url: "https://exemplo.com" })).toBe("https://exemplo.com");
  });

  it("sem campo conhecido, resume o JSON e corta no tamanho do detalhe", () => {
    expect(resumirEntradaDoCopilot({ a: 1 })).toBe('{"a":1}');
    expect(resumirEntradaDoCopilot({ command: "x".repeat(500) })).toHaveLength(160);
  });
});
