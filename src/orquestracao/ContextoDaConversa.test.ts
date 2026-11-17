import { describe, expect, it } from "vitest";

import {
  contextoDaTroca,
  MAXIMO_DA_RESPOSTA_NO_CONTEXTO,
  MAXIMO_DE_CARACTERES_DO_CONTEXTO,
  MAXIMO_DE_TURNOS_NO_CONTEXTO,
  MAXIMO_DO_PEDIDO_NO_CONTEXTO,
  TurnoDoContexto,
} from "./ContextoDaConversa";

function turno(texto: string, resposta: string, extra: Partial<TurnoDoContexto> = {}): TurnoDoContexto {
  return { texto, resposta, situacao: "concluido", motivoDaFalha: null, motor: "claude-code", ...extra };
}

describe("contextoDaTroca", () => {
  it("sem turnos, ou com todos já vistos pela sessão do motor, não há contexto (null)", () => {
    expect(contextoDaTroca([], "codex")).toBeNull();
    expect(contextoDaTroca([turno("a", "A"), turno("b", "B")], "claude-code")).toBeNull();
    expect(contextoDaTroca([turno("a", "A", { motor: "codex" })], "codex")).toBeNull();
  });

  it("um motor que ainda não participou recebe todos os turnos, do mais antigo ao mais recente, com pedido e resposta final", () => {
    const texto = contextoDaTroca([turno("faça A", "Feito A."), turno("faça B", "Feito B.")], "codex");

    expect(texto).not.toBeNull();
    expect(texto).toContain("[Pedido 1, atendido por Claude Code]");
    expect(texto).toContain("[Pedido 2, atendido por Claude Code]");
    expect(texto).toContain("Pedido do usuário:\nfaça A");
    expect(texto).toContain("Resposta final:\nFeito A.");
    expect(texto?.indexOf("faça A")).toBeLessThan(texto?.indexOf("faça B") ?? -1);
  });

  it("só entram os turnos depois da última participação do motor: o que ele mesmo atendeu a sessão dele já tem", () => {
    const historico = [
      turno("a", "A", { motor: "claude-code" }),
      turno("b", "B", { motor: "codex" }),
      turno("c", "C", { motor: "claude-code" }),
      turno("d", "D", { motor: "copilot" }),
    ];

    const paraOCodex = contextoDaTroca(historico, "codex");
    expect(paraOCodex).toContain("Pedido do usuário:\nc");
    expect(paraOCodex).toContain("Pedido do usuário:\nd");
    expect(paraOCodex).not.toContain("Pedido do usuário:\na");
    expect(paraOCodex).not.toContain("Pedido do usuário:\nb");
    expect(paraOCodex).toContain("atendido por GitHub Copilot CLI");

    const paraOClaude = contextoDaTroca(historico, "claude-code");
    expect(paraOClaude).toContain("Pedido do usuário:\nd");
    expect(paraOClaude).not.toContain("Pedido do usuário:\nc");
  });

  it("turnos gravados antes dos outros motores (sem o campo) valem Claude Code", () => {
    const antigos: TurnoDoContexto[] = [
      { texto: "a", resposta: "A", situacao: "concluido", motivoDaFalha: null },
      { texto: "b", resposta: "B", situacao: "concluido", motivoDaFalha: null },
    ];

    expect(contextoDaTroca(antigos, "claude-code")).toBeNull();
    expect(contextoDaTroca(antigos, "codex")).toContain("atendido por Claude Code");
  });

  it("o turno em andamento (o que vai rodar agora) não entra", () => {
    const historico = [turno("a", "A"), turno("pedido atual", "", { situacao: "em_andamento", motor: "codex" })];

    const texto = contextoDaTroca(historico, "codex");

    expect(texto).toContain("Pedido do usuário:\na");
    expect(texto).not.toContain("pedido atual");
    expect(contextoDaTroca([turno("pedido atual", "", { situacao: "em_andamento" })], "codex")).toBeNull();
  });

  it.each([
    ["falhou", { situacao: "falhou", motivoDaFalha: "Limite de uso atingido" }, /o turno falhou \(Limite de uso atingido\)/],
    ["cancelado", { situacao: "cancelado" }, /o usuário cancelou o turno/],
    ["interrompido", { situacao: "interrompido" }, /foi interrompido/],
  ] as const)("o turno %s entra sem resposta e avisa que pode ter deixado trabalho pela metade", (_nome, extra, esperado) => {
    const texto = contextoDaTroca([turno("migre tudo", "", extra)], "codex");

    expect(texto).toMatch(esperado);
    expect(texto).toContain("Pode ter deixado trabalho pela metade.");
  });

  it("um turno concluído sem texto de resposta diz isso", () => {
    expect(contextoDaTroca([turno("a", "   ")], "codex")).toContain("concluído, sem texto de resposta");
  });

  it("corta o pedido e a resposta longos, com a marca do corte", () => {
    const texto = contextoDaTroca(
      [turno("p".repeat(MAXIMO_DO_PEDIDO_NO_CONTEXTO + 500), "r".repeat(MAXIMO_DA_RESPOSTA_NO_CONTEXTO + 500))],
      "codex",
    );

    expect(texto).toContain(`${"p".repeat(MAXIMO_DO_PEDIDO_NO_CONTEXTO)}… [cortado]`);
    expect(texto).toContain(`${"r".repeat(MAXIMO_DA_RESPOSTA_NO_CONTEXTO)}… [cortado]`);
    expect(texto).not.toContain("p".repeat(MAXIMO_DO_PEDIDO_NO_CONTEXTO + 1));
    expect(texto).not.toContain("r".repeat(MAXIMO_DA_RESPOSTA_NO_CONTEXTO + 1));
  });

  it(`entram no máximo os ${MAXIMO_DE_TURNOS_NO_CONTEXTO} mais recentes, e avisa de quantos ficaram de fora`, () => {
    const historico = Array.from({ length: MAXIMO_DE_TURNOS_NO_CONTEXTO + 3 }, (_, indice) =>
      turno(`pedido-${indice + 1}`, `resposta-${indice + 1}`),
    );

    const texto = contextoDaTroca(historico, "codex") ?? "";

    expect(texto).toContain("3 pedidos mais antigos foram omitidos por tamanho");
    expect(texto).not.toContain("pedido-3\n");
    expect(texto).toContain("pedido-4\n");
    expect(texto).toContain(`pedido-${MAXIMO_DE_TURNOS_NO_CONTEXTO + 3}\n`);
    // A numeração continua a do histórico não visto.
    expect(texto).toContain("[Pedido 4, atendido por Claude Code]");
  });

  it("o texto inteiro respeita o limite de caracteres: saem os mais antigos, o mais recente sempre entra", () => {
    const grande = "x".repeat(MAXIMO_DA_RESPOSTA_NO_CONTEXTO);
    const historico = Array.from({ length: MAXIMO_DE_TURNOS_NO_CONTEXTO }, (_, indice) =>
      turno(`pedido-${indice + 1}`, grande),
    );

    const texto = contextoDaTroca(historico, "codex") ?? "";

    expect(texto.length).toBeLessThanOrEqual(MAXIMO_DE_CARACTERES_DO_CONTEXTO);
    expect(texto).toContain(`pedido-${MAXIMO_DE_TURNOS_NO_CONTEXTO}\n`);
    expect(texto).not.toContain("pedido-1\n");
    expect(texto).toMatch(/pedidos mais antigos foram omitidos por tamanho/);
  });

  it("a nota de um só omitido fala no singular", () => {
    const historico = Array.from({ length: MAXIMO_DE_TURNOS_NO_CONTEXTO + 1 }, (_, indice) =>
      turno(`pedido-${indice + 1}`, "r"),
    );

    expect(contextoDaTroca(historico, "codex")).toContain("(1 pedido mais antigo foi omitido por tamanho.)");
  });

  it("é pura: não altera o histórico recebido", () => {
    const historico = [turno("a", "A"), turno("b", "B", { motor: "codex" })];
    const copia = JSON.parse(JSON.stringify(historico)) as TurnoDoContexto[];

    contextoDaTroca(historico, "copilot");

    expect(historico).toEqual(copia);
  });
});
