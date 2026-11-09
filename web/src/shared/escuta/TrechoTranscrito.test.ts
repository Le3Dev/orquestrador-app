import { TrechoTranscrito } from "./TrechoTranscrito";

describe("TrechoTranscrito", () => {
  it("guarda o texto sem espaços sobrando e os tempos", () => {
    const trecho = TrechoTranscrito.criar({ texto: "  Qual é a  complexidade?\n", inicioMs: 1_000, fimMs: 3_500 });
    expect(trecho.texto).toBe("Qual é a complexidade?");
    expect(trecho.inicioMs).toBe(1_000);
    expect(trecho.fimMs).toBe(3_500);
    expect(trecho.duracaoMs).toBe(2_500);
  });

  it("aceita duração zero", () => {
    expect(TrechoTranscrito.criar({ texto: "oi", inicioMs: 10, fimMs: 10 }).duracaoMs).toBe(0);
  });

  it("recusa texto vazio", () => {
    expect(() => TrechoTranscrito.criar({ texto: "   ", inicioMs: 0, fimMs: 1 })).toThrow(/vazio/);
  });

  it("recusa fim antes do início e tempos inválidos", () => {
    expect(() => TrechoTranscrito.criar({ texto: "oi", inicioMs: 2_000, fimMs: 1_999 })).toThrow(/anterior ao início/);
    expect(() => TrechoTranscrito.criar({ texto: "oi", inicioMs: Number.NaN, fimMs: 1 })).toThrow(/inválidos/);
  });

  it("é imutável", () => {
    const trecho = TrechoTranscrito.criar({ texto: "oi", inicioMs: 0, fimMs: 1 });
    expect(Object.isFrozen(trecho)).toBe(true);
    expect(() => {
      (trecho as unknown as { texto: string }).texto = "outro";
    }).toThrow(TypeError);
  });
});
