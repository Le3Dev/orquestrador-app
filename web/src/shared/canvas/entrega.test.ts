import { atrasoDoPacote, ENTREGA_AO_VIVO_MS, entregaRecente, estadoDoFio, houveEntrega } from "./entrega";

describe("fio do bixinho", () => {
  it("o pacote parte 110 ms depois do anterior da fila", () => {
    expect(atrasoDoPacote(0)).toBe(120);
    expect(atrasoDoPacote(3) - atrasoDoPacote(2)).toBe(110);
    expect(atrasoDoPacote(-1)).toBe(120);
  });

  it("o fio corre ao trabalhar, fica verde ao concluir e vermelho ao falhar", () => {
    expect(estadoDoFio("executando")).toBe("correndo");
    expect(estadoDoFio("concluido")).toBe("ok");
    expect(estadoDoFio("falhou")).toBe("erro");
    expect(estadoDoFio("cancelado")).toBe("parado");
    expect(estadoDoFio(undefined)).toBe("parado");
  });
});

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
