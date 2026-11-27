import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";

import { criarPastasDeTeste, pedidoDeTeste, PastasDeTeste } from "./fixtures/pedidoDeTeste";
import { mensagemDoTurno, promptComRegras } from "./PromptDoTurno";

describe("PromptDoTurno e os vínculos", () => {
  let pastas: PastasDeTeste;

  beforeEach(() => {
    pastas = criarPastasDeTeste();
  });

  afterEach(() => {
    rmSync(pastas.raiz, { recursive: true, force: true });
  });

  it("sem vínculos nem origem, a mensagem é o pedido e mais nada", () => {
    const mensagem = mensagemDoTurno(pedidoDeTeste(pastas, "codex"), "unix");

    expect(mensagem).not.toContain("<vinculos>");
    expect(mensagem.endsWith("\n\nFaça o trabalho.")).toBe(true);
  });

  it("leva ao Codex e ao Copilot os vinculados, as notas e a linha de quem enviou a mensagem", () => {
    for (const motor of ["codex", "copilot"] as const) {
      const pedido = pedidoDeTeste(pastas, motor, {
        vinculados: [{ id: "o2", nome: "Front", pasta: "C:\\projetos\\front", notas: "API em /v1" }],
        origemDaMensagem: { orquestradorId: "o2", nome: "Front", saltos: 2, natureza: "pedido" },
      });

      const mensagem = mensagemDoTurno(pedido, "unix");

      expect(mensagem).toContain("<vinculos>");
      expect(mensagem).toContain("API em /v1");
      expect(mensagem).toContain("```mensagem-para-vinculado");
      expect(mensagem.endsWith("\n\nMensagem do orquestrador Front (salto 2):\nFaça o trabalho.")).toBe(true);
      // O Copilot não tem prompt de sistema: as regras vão junto, e os vínculos também.
      expect(promptComRegras(pedido, "unix")).toContain("<vinculos>");
    }
  });
});
