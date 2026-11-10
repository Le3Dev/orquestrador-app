import { type FraseNoTempo, frasesSemAsEnviadas, type MensagemNoTempo, PRAZO_DO_ENVIO_DA_PERGUNTA_MS } from "./frasesOuvidas";

interface Frase extends FraseNoTempo {
  readonly id: string;
}

const T0 = Date.parse("2026-11-04T12:00:00Z");

const frase = (id: string, inicioMs: number, pergunta = false, duracaoMs = 2_000): Frase => ({
  id,
  inicioMs,
  fimMs: inicioMs + duracaoMs,
  pergunta,
});

const daEscuta = (emMs: number): MensagemNoTempo => ({
  papel: "usuario",
  origem: "escuta",
  criadaEm: new Date(emMs).toISOString(),
});

const ids = (frases: readonly Frase[]): string[] => frases.map((item) => item.id);

describe("frasesSemAsEnviadas", () => {
  it("esconde a pergunta que virou mensagem da escuta e mantém as outras frases", () => {
    const frases = [frase("f1", T0), frase("f2", T0 + 3_000, true), frase("f3", T0 + 6_000)];
    expect(ids(frasesSemAsEnviadas(frases, [daEscuta(T0 + 5_500)]))).toEqual(["f1", "f3"]);
  });

  it("vale do início da frase até 60 s depois do fim dela, inclusive", () => {
    const pergunta = frase("p", T0, true);
    const limite = pergunta.fimMs + PRAZO_DO_ENVIO_DA_PERGUNTA_MS;
    expect(frasesSemAsEnviadas([pergunta], [daEscuta(T0)])).toEqual([]);
    expect(frasesSemAsEnviadas([pergunta], [daEscuta(limite)])).toEqual([]);
    expect(ids(frasesSemAsEnviadas([pergunta], [daEscuta(limite + 1)]))).toEqual(["p"]);
    expect(ids(frasesSemAsEnviadas([pergunta], [daEscuta(T0 - 1)]))).toEqual(["p"]);
  });

  it("frase que não é pergunta nunca some, mesmo dentro do prazo", () => {
    const frases = [frase("f1", T0)];
    expect(frasesSemAsEnviadas(frases, [daEscuta(T0 + 1_000)])).toBe(frases);
  });

  it("só a mensagem do usuário enviada pela escuta conta: a digitada e a do Claude, não", () => {
    const frases = [frase("p", T0, true)];
    const criadaEm = new Date(T0 + 2_500).toISOString();
    const mensagens: MensagemNoTempo[] = [
      { papel: "usuario", criadaEm },
      { papel: "claude", origem: "escuta", criadaEm },
    ];
    expect(frasesSemAsEnviadas(frases, mensagens)).toBe(frases);
  });

  it("pergunta nunca enviada (ex.: deduplicada depois do envio) continua aparecendo", () => {
    const frases = [frase("p1", T0, true), frase("p2", T0 + 20_000, true)];
    expect(ids(frasesSemAsEnviadas(frases, [daEscuta(T0 + 2_500)]))).toEqual(["p2"]);
  });

  it("cada mensagem esconde uma frase só: a pergunta mais recente do prazo", () => {
    // p1 ficou esperando o chat e foi trocada por p2, a única enviada.
    const frases = [frase("p1", T0, true), frase("p2", T0 + 10_000, true)];
    expect(ids(frasesSemAsEnviadas(frases, [daEscuta(T0 + 30_000)]))).toEqual(["p1"]);
  });

  it("duas mensagens da escuta escondem as duas perguntas", () => {
    const frases = [frase("p1", T0, true), frase("f", T0 + 4_000), frase("p2", T0 + 10_000, true)];
    const mensagens = [daEscuta(T0 + 2_500), daEscuta(T0 + 12_500)];
    expect(ids(frasesSemAsEnviadas(frases, mensagens))).toEqual(["f"]);
  });

  it("sem nada a esconder devolve a mesma lista; data inválida é ignorada", () => {
    const frases = [frase("p", T0, true)];
    expect(frasesSemAsEnviadas(frases, [])).toBe(frases);
    expect(frasesSemAsEnviadas(frases, [{ papel: "usuario", origem: "escuta", criadaEm: "não é data" }])).toBe(frases);
  });
});
