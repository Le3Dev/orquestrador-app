import { dividirEmFrases, SegmentadorDeFrases } from "./SegmentadorDeFrases";

describe("SegmentadorDeFrases.dividir", () => {
  it("divide pela pontuação final; o que sobra sem pontuação é a frase aberta", () => {
    expect(dividirEmFrases("Bom dia a todos. Hoje vamos falar de listas! Alguém tem dúvida? E depois")).toEqual({
      fechadas: ["Bom dia a todos.", "Hoje vamos falar de listas!", "Alguém tem dúvida?"],
      aberta: "E depois",
    });
    expect(dividirEmFrases("Tudo certo.")).toEqual({ fechadas: ["Tudo certo."], aberta: "" });
    expect(dividirEmFrases("sem pontuação nenhuma")).toEqual({ fechadas: [], aberta: "sem pontuação nenhuma" });
  });

  it("pontuação repetida ou combinada e aspas ou parênteses de fechamento ficam na frase", () => {
    expect(dividirEmFrases('Sério?! Sim... Ele disse "pode ser." (E saiu.) Fim')).toEqual({
      fechadas: ["Sério?!", "Sim...", 'Ele disse "pode ser."', "(E saiu.)"],
      aberta: "Fim",
    });
    expect(dividirEmFrases("Espera… E agora")).toEqual({ fechadas: ["Espera…"], aberta: "E agora" });
  });

  it("número decimal e sigla com ponto não fecham frase no meio", () => {
    expect(dividirEmFrases("Custa 3.5 reais nos U.S.A hoje. Certo")).toEqual({
      fechadas: ["Custa 3.5 reais nos U.S.A hoje."],
      aberta: "Certo",
    });
  });

  it("pedaço só de pontuação não vira frase", () => {
    expect(dividirEmFrases("... Olá. ?")).toEqual({ fechadas: ["Olá."], aberta: "" });
    expect(dividirEmFrases("   ")).toEqual({ fechadas: [], aberta: "" });
    expect(dividirEmFrases("— —")).toEqual({ fechadas: [], aberta: "" });
  });

  it("junta espaços repetidos e tira os das pontas", () => {
    expect(dividirEmFrases("  Olá   mundo.   Tudo\n bem  ")).toEqual({ fechadas: ["Olá mundo."], aberta: "Tudo bem" });
  });

  it("é estável para texto que só cresce no fim: frase fechada continua igual", () => {
    const passos = ["Hoje vamos", "Hoje vamos falar de listas.", "Hoje vamos falar de listas. E depois", "Hoje vamos falar de listas. E depois filas."];
    let anteriores: readonly string[] = [];
    for (const texto of passos) {
      const { fechadas } = dividirEmFrases(texto);
      expect(fechadas.slice(0, anteriores.length)).toEqual(anteriores);
      anteriores = fechadas;
    }
    expect(anteriores).toEqual(["Hoje vamos falar de listas.", "E depois filas."]);
  });

  it("o resultado é imutável e o serviço expõe a mesma função", () => {
    const frases = dividirEmFrases("Uma. Duas");
    expect(Object.isFrozen(frases)).toBe(true);
    expect(Object.isFrozen(frases.fechadas)).toBe(true);
    expect(SegmentadorDeFrases.dividir).toBe(dividirEmFrases);
  });
});
