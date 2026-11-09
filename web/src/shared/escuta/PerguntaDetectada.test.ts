import { normalizarTexto, PerguntaDetectada } from "./PerguntaDetectada";

describe("normalizarTexto", () => {
  it("tira acentos, pontuação, maiúsculas e espaços repetidos", () => {
    expect(normalizarTexto("  Qual é  a Complexidade?! ")).toBe("qual e a complexidade");
    expect(normalizarTexto("Ação, coração; PÃO.")).toBe("acao coracao pao");
  });

  it("apóstrofo some sem separar a palavra; outros sinais viram espaço", () => {
    expect(normalizarTexto("What's O(n)?")).toBe("whats o n");
    expect(normalizarTexto("Inscreva-se em Amara.org")).toBe("inscreva se em amara org");
  });

  it("só pontuação ou símbolos vira texto vazio", () => {
    expect(normalizarTexto("... ♪ !?")).toBe("");
  });
});

describe("PerguntaDetectada", () => {
  it("guarda pergunta, contexto e momento, sem espaços sobrando", () => {
    const pergunta = PerguntaDetectada.criar({
      pergunta: "  Como inverter  uma lista ligada? ",
      contexto: " bom dia\n pessoal ",
      detectadaEmMs: 42,
    });
    expect(pergunta.pergunta).toBe("Como inverter uma lista ligada?");
    expect(pergunta.contexto).toBe("bom dia pessoal");
    expect(pergunta.detectadaEmMs).toBe(42);
    expect(Object.isFrozen(pergunta)).toBe(true);
  });

  it("normalizada serve para comparar repetidas", () => {
    const a = PerguntaDetectada.criar({ pergunta: "Qual é a complexidade?", contexto: "", detectadaEmMs: 0 });
    const b = PerguntaDetectada.criar({ pergunta: "qual e a complexidade", contexto: "", detectadaEmMs: 1 });
    expect(a.normalizada).toBe("qual e a complexidade");
    expect(a.normalizada).toBe(b.normalizada);
  });

  it("recusa pergunta vazia ou só com pontuação", () => {
    expect(() => PerguntaDetectada.criar({ pergunta: "  ", contexto: "", detectadaEmMs: 0 })).toThrow(/vazia/);
    expect(() => PerguntaDetectada.criar({ pergunta: "?!", contexto: "", detectadaEmMs: 0 })).toThrow(/vazia/);
  });

  it("recusa momento inválido", () => {
    expect(() => PerguntaDetectada.criar({ pergunta: "oi?", contexto: "", detectadaEmMs: Number.NaN })).toThrow(/inválido/);
  });
});
