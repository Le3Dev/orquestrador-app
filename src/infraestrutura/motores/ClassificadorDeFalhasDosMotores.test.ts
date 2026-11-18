import { describe, expect, it } from "vitest";

import { classificarFalhaDoMotor, epochEmIso, falhaDoMotor, liberaEmDoTexto } from "./ClassificadorDeFalhasDosMotores";

const AGORA = Date.parse("2026-11-17T12:00:00.000Z");

describe("classificarFalhaDoMotor", () => {
  it.each([
    ["You've hit your usage limit. Upgrade to Pro"],
    ["429 Too Many Requests"],
    ["Quota exceeded for premium requests"],
    ["You have run out of AI credits"],
    ["rate limit exceeded"],
    ["Sorry, your request was rate-limited."],
    ["You've hit a rate limit"],
    ["user_weekly_rate_limited"],
    ["You have exceeded your premium request allowance."],
    ["You exceeded your 5-hour session limit"],
  ])("reconhece o limite de uso: %s", (texto) => {
    expect(classificarFalhaDoMotor([texto]).causa).toBe("limite_de_uso");
  });

  it.each([["503 Service Unavailable"], ["The model is overloaded"], ["Selected model is at capacity"], ["Internal server error"]])(
    "reconhece a sobrecarga: %s",
    (texto) => {
      expect(classificarFalhaDoMotor([texto]).causa).toBe("sobrecarga");
    },
  );

  it.each([["fetch failed"], ["connect ECONNRESET 1.2.3.4:443"], ["request timed out"], ["getaddrinfo ENOTFOUND api.github.com"]])(
    "reconhece a falha de rede: %s",
    (texto) => {
      expect(classificarFalhaDoMotor([texto]).causa).toBe("rede");
    },
  );

  it("deixa o resto como 'outro' e dá preferência ao limite quando há mais de um sinal", () => {
    expect(classificarFalhaDoMotor(["syntax error no arquivo"]).causa).toBe("outro");
    expect(classificarFalhaDoMotor(["network error: 429 rate limit"]).causa).toBe("limite_de_uso");
  });

  it("lê o horário em que o limite libera quando o texto o diz", () => {
    expect(classificarFalhaDoMotor(["usage limit reached. Try again in 20 minutes"], () => AGORA).liberaEm).toBe(
      "2026-11-17T12:20:00.000Z",
    );
  });
});

describe("liberaEmDoTexto", () => {
  it("entende data ISO, epoch, retry-after e 'try again in'", () => {
    expect(liberaEmDoTexto("limit resets at 2026-11-17T20:00:00Z")).toBe("2026-11-17T20:00:00.000Z");
    expect(liberaEmDoTexto("limit resetsAt: 1794936160")).toBe(epochEmIso(1794936160));
    expect(liberaEmDoTexto("Retry-After: 90", () => AGORA)).toBe("2026-11-17T12:01:30.000Z");
    expect(liberaEmDoTexto("try again in 2 hours", () => AGORA)).toBe("2026-11-17T14:00:00.000Z");
  });

  it("devolve nulo sem horário e não toma 'retry 3 times' por uma espera", () => {
    expect(liberaEmDoTexto("usage limit reached")).toBeNull();
    expect(liberaEmDoTexto("will retry 3 times")).toBeNull();
  });
});

describe("falhaDoMotor", () => {
  const uso = { duracaoMs: 10, tokensDeEntrada: 1, tokensDeSaida: 2, subagentesLancados: 0 };

  it("escreve o motivo em português com o nome do motor e o detalhe original", () => {
    const falha = falhaDoMotor("copilot", "Quota exceeded for premium requests", [], uso);

    expect(falha).toMatchObject({ sucesso: false, causa: "limite_de_uso", uso });
    expect(falha.motivo).toBe("Limite de uso do GitHub Copilot CLI atingido (Quota exceeded for premium requests).");
  });

  it("só informa liberaEm no limite de uso", () => {
    expect(falhaDoMotor("codex", "usage limit", [], uso)).toHaveProperty("liberaEm");
    expect(falhaDoMotor("codex", "503 overloaded", [], uso)).not.toHaveProperty("liberaEm");
  });

  it("mantém o motivo de sempre em 'outro' e leva o id da sessão que o motor criou", () => {
    const falha = falhaDoMotor("codex", "Algo estranho aconteceu.", [], null, null, "thread-1");

    expect(falha).toEqual({ sucesso: false, motivo: "Algo estranho aconteceu.", uso: null, causa: "outro", sessaoDoMotor: "thread-1" });
  });

  it("vale a causa que o próprio protocolo diz sobre o texto", () => {
    const falha = falhaDoMotor("codex", "Mensagem sem pista.", [], uso, { causa: "sobrecarga", liberaEm: null });

    expect(falha.causa).toBe("sobrecarga");
    expect(falha.motivo).toContain("Os servidores do Codex estão sobrecarregados");
  });
});
