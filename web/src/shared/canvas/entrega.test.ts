import { ENTREGA_AO_VIVO_MS, entregaRecente, houveEntrega } from "./entrega";

describe("houveEntrega", () => {
  it("só executando → concluído entrega o relatório", () => {
    expect(houveEntrega("executando", "concluido")).toBe(true);
    expect(houveEntrega("executando", "falhou")).toBe(false);
    expect(houveEntrega("executando", "cancelado")).toBe(false);
    expect(houveEntrega(undefined, "concluido")).toBe(false);
    expect(houveEntrega("concluido", "concluido")).toBe(false);
  });
});

describe("entregaRecente", () => {
  const fim = "2026-10-28T12:00:00Z";
  const instanteDoFim = Date.parse(fim);

  it("é recente até antes de ENTREGA_AO_VIVO_MS depois do fim", () => {
    expect(entregaRecente(fim, instanteDoFim)).toBe(true);
    expect(entregaRecente(fim, instanteDoFim + ENTREGA_AO_VIVO_MS - 1)).toBe(true);
  });

  it("a partir de ENTREGA_AO_VIVO_MS (histórico reenviado ao recarregar a página), não é", () => {
    expect(entregaRecente(fim, instanteDoFim + ENTREGA_AO_VIVO_MS)).toBe(false);
    expect(entregaRecente(fim, instanteDoFim + 30 * 60_000)).toBe(false);
  });

  it("sem a hora do fim, não é", () => {
    expect(entregaRecente(null, instanteDoFim)).toBe(false);
  });
});
