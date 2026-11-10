import {
  ConfirmadorDeTranscricao,
  fimDoUltimoSegmentoConfirmado,
  normalizarPalavra,
  type PassadaConfirmada,
} from "./ConfirmadorDeTranscricao";

/** Passa as hipóteses em sequência e devolve a última passada. */
function passadas(...hipoteses: string[]): PassadaConfirmada {
  let confirmador = ConfirmadorDeTranscricao.vazio();
  let ultima: PassadaConfirmada | null = null;
  for (const hipotese of hipoteses) {
    ultima = confirmador.comHipotese(hipotese);
    confirmador = ultima.confirmador;
  }
  if (ultima === null) throw new Error("Nenhuma hipótese.");
  return ultima;
}

/** Só os textos de uma passada, para comparar com toEqual. */
const textos = (passada: PassadaConfirmada) => ({
  novasConfirmadas: passada.novasConfirmadas,
  parcial: passada.parcial,
  confirmado: passada.confirmador.confirmado,
});

describe("normalizarPalavra", () => {
  it("minúsculas e sem pontuação só nas pontas", () => {
    expect(normalizarPalavra("Olá,")).toBe("olá");
    expect(normalizarPalavra("«Bem?»")).toBe("bem");
    expect(normalizarPalavra("guarda-chuva.")).toBe("guarda-chuva");
    expect(normalizarPalavra("...")).toBe("");
  });
});

describe("ConfirmadorDeTranscricao", () => {
  it("vazio não tem nada confirmado nem provisório", () => {
    const vazio = ConfirmadorDeTranscricao.vazio();
    expect(vazio.confirmado).toBe("");
    expect(vazio.parcial).toBe("");
  });

  it("a primeira hipótese é toda provisória", () => {
    expect(textos(passadas("Bom dia, tudo bem"))).toEqual({
      novasConfirmadas: "",
      parcial: "Bom dia, tudo bem",
      confirmado: "",
    });
  });

  it("concordância simples: duas passadas iguais confirmam tudo o que coincide", () => {
    expect(textos(passadas("Bom dia", "Bom dia tudo bem"))).toEqual({
      novasConfirmadas: "Bom dia",
      parcial: "tudo bem",
      confirmado: "Bom dia",
    });
  });

  it("divergência no fim: confirma só o prefixo comum", () => {
    expect(textos(passadas("Eu vou para casa", "Eu fui para casa agora"))).toEqual({
      novasConfirmadas: "Eu",
      parcial: "fui para casa agora",
      confirmado: "Eu",
    });
  });

  it("ignora caixa e pontuação ao comparar; devolve a forma da hipótese mais recente", () => {
    expect(textos(passadas("olá, tudo bem", "Olá tudo bem? Sim"))).toEqual({
      novasConfirmadas: "Olá tudo bem?",
      parcial: "Sim",
      confirmado: "Olá tudo bem?",
    });
  });

  it("hipótese com o prefixo já confirmado (buffer não aparado): a repetição sai da frente", () => {
    const passada = passadas("Eu queria", "Eu queria saber", "Eu queria saber o preço");
    expect(textos(passada)).toEqual({
      novasConfirmadas: "saber",
      parcial: "o preço",
      confirmado: "Eu queria saber",
    });
    expect(passada.confirmadoNaHipotese).toBe("Eu queria saber");
  });

  it("hipótese sem o prefixo confirmado (buffer aparado): nada sai da frente", () => {
    const passada = passadas("Eu queria", "Eu queria saber", "saber o preço", "o preço do plano");
    expect(textos(passada)).toEqual({
      novasConfirmadas: "o preço",
      parcial: "do plano",
      confirmado: "Eu queria saber o preço",
    });
    expect(passada.confirmadoNaHipotese).toBe("o preço");
  });

  it("buffer aparado no meio do texto confirmado: tira só a parte repetida", () => {
    // Confirmado: "um dois três quatro cinco seis"; o buffer ainda tem "cinco seis".
    const passada = passadas("um dois três quatro cinco seis", "um dois três quatro cinco seis sete", "cinco seis sete oito");
    expect(textos(passada)).toEqual({
      novasConfirmadas: "sete",
      parcial: "oito",
      confirmado: "um dois três quatro cinco seis sete",
    });
  });

  it("acha a cauda confirmada mesmo se o Whisper mudou uma palavra antiga", () => {
    const passada = passadas(
      "Então eu acho que a gente pode",
      "Então eu acho que a gente pode marcar",
      "Aí eu acho que a gente pode marcar amanhã cedo",
    );
    expect(passada.novasConfirmadas).toBe("marcar");
    expect(passada.parcial).toBe("amanhã cedo");
  });

  it("uma palavra comum no meio da fala nova não é tomada por repetição", () => {
    // Confirmado termina em "de"; o buffer foi aparado e a hipótese nova tem "de" no meio.
    const passada = passadas("vou de", "vou de", "carro de passeio");
    expect(passada.confirmador.confirmado).toBe("vou de");
    expect(passada.parcial).toBe("carro de passeio");
    expect(passada.novasConfirmadas).toBe("");
  });

  it("palavras repetidas na fala", () => {
    const passada = passadas("não não", "não não não quero", "não não não quero isso");
    expect(textos(passada)).toEqual({
      novasConfirmadas: "não quero",
      parcial: "isso",
      confirmado: "não não não quero",
    });
  });

  it("frase repetida: fica a ocorrência que cobre mais texto confirmado", () => {
    const passada = passadas("a b c x a b c", "a b c x a b c", "a b c y a b c d");
    // "x" virou "y", mas a cauda "a b c" só cabe na segunda ocorrência.
    expect(passada.confirmador.confirmado).toBe("a b c x a b c");
    expect(passada.parcial).toBe("d");
  });

  it("finalizar confirma o resto, sem repetir o que já estava confirmado", () => {
    const meio = passadas("Bom dia", "Bom dia eu queria");
    const final = meio.confirmador.finalizar("Bom dia, eu queria falar com a Ana.");
    expect(textos(final)).toEqual({
      novasConfirmadas: "eu queria falar com a Ana.",
      parcial: "",
      confirmado: "Bom dia eu queria falar com a Ana.",
    });
    expect(final.confirmador.parcial).toBe("");
  });

  it("finalizar com o buffer já aparado confirma o texto todo", () => {
    const meio = passadas("Bom dia", "Bom dia eu");
    expect(meio.confirmador.finalizar("eu queria falar").confirmador.confirmado).toBe("Bom dia eu queria falar");
  });

  it("texto vazio: nada é confirmado e o provisório some", () => {
    expect(textos(passadas(""))).toEqual({ novasConfirmadas: "", parcial: "", confirmado: "" });
    expect(textos(passadas("Bom dia", ""))).toEqual({ novasConfirmadas: "", parcial: "", confirmado: "" });
    // Sem provisório, a passada seguinte não tem com o que concordar.
    expect(textos(passadas("Bom dia", "", "Bom dia"))).toEqual({ novasConfirmadas: "", parcial: "Bom dia", confirmado: "" });
    expect(textos(passadas("   "))).toEqual({ novasConfirmadas: "", parcial: "", confirmado: "" });
    expect(passadas("Bom dia", "Bom dia").confirmador.finalizar("").confirmador.confirmado).toBe("Bom dia");
  });

  it("pontuação solta fica grudada à palavra e não atrapalha a concordância", () => {
    expect(textos(passadas("Bom dia — tudo bem", "Bom dia tudo bem ..."))).toEqual({
      novasConfirmadas: "Bom dia tudo bem ...",
      parcial: "",
      confirmado: "Bom dia tudo bem ...",
    });
  });

  it("imutável: a passada não muda o confirmador anterior", () => {
    const primeiro = ConfirmadorDeTranscricao.vazio().comHipotese("Bom dia").confirmador;
    const segundo = primeiro.comHipotese("Bom dia tudo").confirmador;
    expect(primeiro.confirmado).toBe("");
    expect(primeiro.parcial).toBe("Bom dia");
    expect(segundo.confirmado).toBe("Bom dia");
    expect(Object.isFrozen(segundo)).toBe(true);
    expect(segundo.paraNovaFala().confirmado).toBe("");
    expect(segundo.paraNovaFala().parcial).toBe("");
  });

  it("sequência realista: uma frase em PT-BR crescendo em 4 passadas", () => {
    let confirmador = ConfirmadorDeTranscricao.vazio();
    const resultados: ReturnType<typeof textos>[] = [];
    for (const hipotese of [
      "Boa tarde, eu",
      "Boa tarde, eu queria saber",
      "Boa tarde. Eu queria saber se o pedido",
      "Boa tarde. Eu queria saber se o pedido já saiu para entrega.",
    ]) {
      const passada = confirmador.comHipotese(hipotese);
      resultados.push(textos(passada));
      confirmador = passada.confirmador;
    }
    expect(resultados).toEqual([
      { novasConfirmadas: "", parcial: "Boa tarde, eu", confirmado: "" },
      { novasConfirmadas: "Boa tarde, eu", parcial: "queria saber", confirmado: "Boa tarde, eu" },
      { novasConfirmadas: "queria saber", parcial: "se o pedido", confirmado: "Boa tarde, eu queria saber" },
      { novasConfirmadas: "se o pedido", parcial: "já saiu para entrega.", confirmado: "Boa tarde, eu queria saber se o pedido" },
    ]);
    const final = confirmador.finalizar("Boa tarde. Eu queria saber se o pedido já saiu para entrega.");
    expect(final.novasConfirmadas).toBe("já saiu para entrega.");
    expect(final.confirmador.confirmado).toBe("Boa tarde, eu queria saber se o pedido já saiu para entrega.");
  });
});

describe("fimDoUltimoSegmentoConfirmado", () => {
  const segmentos = [
    { texto: " Boa tarde.", fimS: 1.2 },
    { texto: " Eu queria saber", fimS: 2.6 },
    { texto: " se o pedido já saiu.", fimS: 4.1 },
  ];

  it("o fim do último segmento todo confirmado", () => {
    expect(fimDoUltimoSegmentoConfirmado(segmentos, "Boa tarde. Eu queria saber se o")).toBe(2.6);
    expect(fimDoUltimoSegmentoConfirmado(segmentos, "Boa tarde. Eu queria saber")).toBe(2.6);
    expect(fimDoUltimoSegmentoConfirmado(segmentos, "boa tarde eu queria saber se o pedido já saiu")).toBe(4.1);
  });

  it("null quando nem o primeiro segmento está todo confirmado", () => {
    expect(fimDoUltimoSegmentoConfirmado(segmentos, "Boa")).toBeNull();
    expect(fimDoUltimoSegmentoConfirmado(segmentos, "")).toBeNull();
    expect(fimDoUltimoSegmentoConfirmado([], "Boa tarde")).toBeNull();
  });

  it("para na primeira palavra que não casa", () => {
    expect(fimDoUltimoSegmentoConfirmado(segmentos, "Boa tarde. Eu quero saber se o pedido já saiu.")).toBe(1.2);
  });

  it("segmentos sem palavras não avançam o corte", () => {
    const comVazio = [{ texto: " Boa tarde.", fimS: 1.2 }, { texto: " ", fimS: 3 }, { texto: " Eu", fimS: 3.5 }];
    expect(fimDoUltimoSegmentoConfirmado(comVazio, "Boa tarde.")).toBe(1.2);
    expect(fimDoUltimoSegmentoConfirmado(comVazio, "Boa tarde. Eu")).toBe(3.5);
  });
});
