import { descreverConfiguracao, formatarDuracao, formatarMomento, formatarPercentual } from "./formatacao";

describe("formatacao", () => {
  it("formata durações curtas e longas", () => {
    expect(formatarDuracao(900)).toBe("1s");
    expect(formatarDuracao(59_400)).toBe("59s");
    expect(formatarDuracao(65_000)).toBe("1min 05s");
  });

  it("formata a utilização da cota como percentual", () => {
    expect(formatarPercentual(0.094)).toBe("9%");
  });

  it("mostra só o horário para hoje e a data para dias anteriores", () => {
    const agora = new Date(2026, 9, 28, 15, 0);

    expect(formatarMomento(new Date(2026, 9, 28, 9, 5).toISOString(), agora)).toBe("09:05");
    expect(formatarMomento(new Date(2026, 9, 27, 9, 5).toISOString(), agora)).toMatch(/^27\/10/);
  });

  it("descreve a configuração em uma linha", () => {
    expect(
      descreverConfiguracao({
        modeloDoOrquestrador: "opus",
        modeloDosSubagentes: "haiku",
        quantidadeDeSubagentes: { modo: "automatica", limite: 3 },
        nivelDePermissao: "edicao",
      }),
    ).toBe("Opus → Haiku · até 3 subagentes · Ler e editar arquivos");

    expect(
      descreverConfiguracao({
        modeloDoOrquestrador: "sonnet",
        modeloDosSubagentes: "sonnet",
        quantidadeDeSubagentes: { modo: "fixa", limite: 1 },
        nivelDePermissao: "leitura",
      }),
    ).toBe("Sonnet → Sonnet · 1 subagente · Somente leitura");
  });
});
