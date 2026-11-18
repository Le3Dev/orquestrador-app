import { describe, expect, it } from "vitest";

import { DetectorDeEnderecosLocais } from "../motores/DetectorDeEnderecosLocais";
import { AdaptadorDeEventosDoCodex, causaDoErroDoCodex, erroDeFaltaDeLoginDoCodex } from "./AdaptadorDeEventosDoCodex";

function criar(): AdaptadorDeEventosDoCodex {
  return new AdaptadorDeEventosDoCodex({ detector: new DetectorDeEnderecosLocais(), nomeDoTerminal: "Bash" });
}

const mensagem = (id: string, texto: string, fase?: string) => ({ item: { id, type: "agentMessage", text: texto, ...(fase === undefined ? {} : { phase: fase }) } });

describe("AdaptadorDeEventosDoCodex", () => {
  it("prefere a mensagem marcada como resposta final; sem marca, vale a última", () => {
    const comMarca = criar();
    comMarca.traduzir("item/completed", mensagem("1", "Resposta final.", "final_answer"));
    comMarca.traduzir("item/completed", mensagem("2", "Comentário depois.", "commentary"));
    expect(comMarca.respostaFinal).toBe("Resposta final.");

    const semMarca = criar();
    semMarca.traduzir("item/completed", mensagem("1", "Primeira."));
    semMarca.traduzir("item/completed", mensagem("2", "Última."));
    expect(semMarca.respostaFinal).toBe("Última.");
  });

  it("soma o uso de cada chamada ao modelo (last), não o total acumulado da thread", () => {
    const adaptador = criar();
    const uso = (entrada: number, saida: number, total: number) => ({ tokenUsage: { last: { inputTokens: entrada, outputTokens: saida }, total: { inputTokens: total, outputTokens: total } } });

    adaptador.traduzir("thread/tokenUsage/updated", uso(100, 10, 100));
    adaptador.traduzir("thread/tokenUsage/updated", uso(40, 5, 140));

    expect(adaptador.uso).toEqual({ tokensDeEntrada: 140, tokensDeSaida: 15 });
  });

  it("dá nome às janelas de limite pela duração e marca como recusada a que bateu no teto", () => {
    const adaptador = criar();

    const eventos = adaptador.traduzir("account/rateLimits/updated", {
      rateLimits: {
        primary: { usedPercent: 30, windowDurationMins: 300, resetsAt: 1_794_936_160 },
        secondary: { usedPercent: 100, windowDurationMins: 4_320, resetsAt: null },
      },
    });

    expect(eventos).toEqual([
      {
        tipo: "uso_da_cota",
        janelas: [
          { nome: "5 horas", utilizacao: 0.3, renovaEm: new Date(1_794_936_160_000).toISOString(), situacao: "allowed" },
          { nome: "3 dias", utilizacao: 1, renovaEm: null, situacao: "rejected" },
        ],
      },
    ]);
    expect(adaptador.pistaDeLimite).toBeNull();
  });

  it("guarda o horário em que o limite libera quando o Codex diz que bateu nele", () => {
    const adaptador = criar();

    adaptador.traduzir("account/rateLimits/updated", {
      rateLimits: { primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: 1_794_936_160 }, rateLimitReachedType: "rate_limit_reached" },
    });

    expect(adaptador.pistaDeLimite).toEqual({ causa: "limite_de_uso", liberaEm: new Date(1_794_936_160_000).toISOString() });
  });

  it("ignora o erro com nova tentativa e guarda só o definitivo", () => {
    const adaptador = criar();

    adaptador.traduzir("error", { willRetry: true, error: { message: "Reconnecting... 1/5", codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 503 } } } });
    expect(adaptador.ultimoErro).toBeNull();

    adaptador.traduzir("error", { willRetry: false, error: { message: "acabou" } });
    expect(adaptador.ultimoErro).toEqual({ message: "acabou" });
  });

  it("detecta a falta de login mesmo com nova tentativa em andamento", () => {
    const adaptador = criar();

    adaptador.traduzir("error", { willRetry: true, error: { message: "Reconnecting... 2/5", codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: 401 } } } });

    expect(adaptador.faltaDeLogin).toBe(true);
  });

  it("lê o fim do turno: concluído, interrompido ou com falha", () => {
    for (const [status, esperado] of [["completed", "completed"], ["interrupted", "interrupted"], ["failed", "failed"], ["inProgress", "failed"]] as const) {
      const adaptador = criar();
      adaptador.traduzir("turn/completed", { turn: { id: "t", status, error: status === "failed" ? { message: "x" } : null } });
      expect(adaptador.fimDoTurno?.status).toBe(esperado);
    }
  });

  it("guarda os arquivos de uma alteração para a política julgar o pedido de aprovação", () => {
    const adaptador = criar();

    adaptador.traduzir("item/started", { item: { id: "f1", type: "fileChange", changes: [{ path: "/p/a.ts" }, { path: "/p/b.ts" }] } });

    expect(adaptador.caminhosDoItem("f1")).toEqual(["/p/a.ts", "/p/b.ts"]);
    expect(adaptador.caminhosDoItem("outro")).toEqual([]);
  });
});

describe("causaDoErroDoCodex", () => {
  const causa = (codexErrorInfo: unknown) => causaDoErroDoCodex({ message: "x", codexErrorInfo } as Record<string, unknown>, null)?.causa ?? null;

  it("traduz o codexErrorInfo em causa", () => {
    expect(causa("usageLimitExceeded")).toBe("limite_de_uso");
    expect(causa("rateLimitExceeded")).toBe("limite_de_uso");
    expect(causa("serverOverloaded")).toBe("sobrecarga");
    expect(causa("internalServerError")).toBe("sobrecarga");
    expect(causa({ httpConnectionFailed: { httpStatusCode: 429 } })).toBe("limite_de_uso");
    expect(causa({ responseStreamDisconnected: { httpStatusCode: 503 } })).toBe("sobrecarga");
    expect(causa({ responseStreamConnectionFailed: {} })).toBe("rede");
    expect(causa({ responseTooManyFailedAttempts: { httpStatusCode: null } })).toBe("rede");
  });

  it("deixa sem causa o que o código não diz (o chamador usa o texto) e a falta de login", () => {
    expect(causa("badRequest")).toBeNull();
    expect(causa("contextWindowExceeded")).toBeNull();
    expect(causa(undefined)).toBeNull();
    expect(causa({ httpConnectionFailed: { httpStatusCode: 401 } })).toBeNull();
  });

  it("a pista dos limites da conta vale sobre o código", () => {
    const pista = { causa: "limite_de_uso" as const, liberaEm: "2026-11-17T20:00:00.000Z" };

    expect(causaDoErroDoCodex({ codexErrorInfo: "other" }, pista)).toBe(pista);
  });

  it("reconhece a falta de login", () => {
    expect(erroDeFaltaDeLoginDoCodex({ codexErrorInfo: "unauthorized" })).toBe(true);
    expect(erroDeFaltaDeLoginDoCodex({ codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 403 } } })).toBe(true);
    expect(erroDeFaltaDeLoginDoCodex({ codexErrorInfo: "usageLimitExceeded" })).toBe(false);
    expect(erroDeFaltaDeLoginDoCodex(null)).toBe(false);
  });
});
