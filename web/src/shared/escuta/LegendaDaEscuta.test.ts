import {
  DURACAO_MAXIMA_DA_FRASE_MS,
  type FalaDaLegenda,
  LegendaDaEscuta,
  MAXIMO_DE_FRASES_NA_LEGENDA,
} from "./LegendaDaEscuta";

const fala = (numero: number, inicioMs = numero * 10_000): FalaDaLegenda => ({ numero, inicioMs });

const textos = (legenda: LegendaDaEscuta): [string, string][] => legenda.frases.map((frase) => [frase.id, frase.texto]);

describe("LegendaDaEscuta", () => {
  it("vazia: sem frases, sem frase em andamento (sempre a mesma instância)", () => {
    const vazia = LegendaDaEscuta.vazia();
    expect(vazia.frases).toEqual([]);
    expect(vazia.emAndamento).toBeNull();
    expect(vazia.falaEmAndamento).toBeNull();
    expect(LegendaDaEscuta.vazia()).toBe(vazia);
    expect(Object.isFrozen(vazia)).toBe(true);
  });

  it("só parcial: nenhuma frase ainda; a frase em andamento tem só o parcial", () => {
    const { legenda, fechadasAgora } = LegendaDaEscuta.vazia().comConfirmado(fala(1), "", "Hoje vamos", 11_000);
    expect(legenda.frases).toEqual([]);
    expect(legenda.emAndamento).toEqual({ confirmado: "", parcial: "Hoje vamos", inicioMs: 10_000 });
    expect(legenda.falaEmAndamento).toBe("Hoje vamos");
    expect(fechadasAgora).toEqual([]);
  });

  it("frases só têm as FECHADAS (ids frase-<fala>-<posição>); a aberta fica em emAndamento com o confirmado e o parcial", () => {
    const { legenda, fechadasAgora } = LegendaDaEscuta.vazia().comConfirmado(
      fala(3, 30_000),
      "Hoje vamos falar de listas. E depois",
      "filas",
      32_000,
    );
    expect(textos(legenda)).toEqual([["frase-3-1", "Hoje vamos falar de listas."]]);
    expect(legenda.frases[0]).toMatchObject({ inicioMs: 30_000, fimMs: 32_000, pergunta: false, motivo: "pontuacao" });
    expect(legenda.emAndamento).toEqual({ confirmado: "E depois", parcial: "filas", inicioMs: 32_000 });
    expect(legenda.falaEmAndamento).toBe("Hoje vamos falar de listas. E depois filas");
    expect(fechadasAgora.map((frase) => frase.id)).toEqual(["frase-3-1"]);
  });

  it("a frase aberta cresce em emAndamento; a fechada fica a mesma e não fecha de novo", () => {
    const primeira = LegendaDaEscuta.vazia().comConfirmado(fala(1), "Hoje vamos falar de listas. E depois", "filas", 11_000);
    const fechada = primeira.legenda.frases[0];

    const segunda = primeira.legenda.comConfirmado(fala(1), "Hoje vamos falar de listas. E depois filas", null, 12_000);
    expect(textos(segunda.legenda)).toEqual([["frase-1-1", "Hoje vamos falar de listas."]]);
    expect(segunda.legenda.frases[0]).toBe(fechada);
    expect(segunda.legenda.emAndamento).toEqual({ confirmado: "E depois filas", parcial: "", inicioMs: 11_000 });
    expect(segunda.fechadasAgora).toEqual([]);

    const terceira = segunda.legenda.comConfirmado(fala(1), "Hoje vamos falar de listas. E depois filas e pilhas. Mas", "antes", 13_000);
    expect(textos(terceira.legenda)).toEqual([
      ["frase-1-1", "Hoje vamos falar de listas."],
      ["frase-1-2", "E depois filas e pilhas."],
    ]);
    expect(terceira.fechadasAgora.map((frase) => [frase.texto, frase.motivo])).toEqual([["E depois filas e pilhas.", "pontuacao"]]);
    expect(terceira.legenda.emAndamento).toEqual({ confirmado: "Mas", parcial: "antes", inicioMs: 13_000 });
  });

  it("a mesma passada de novo (antes dos 5 s) devolve a mesma legenda, sem fechar nada", () => {
    const { legenda } = LegendaDaEscuta.vazia().comConfirmado(fala(1), "Uma frase. Outra", "mais", 12_000);
    const repetida = legenda.comConfirmado(fala(1), "Uma frase. Outra", "mais", 12_500);
    expect(repetida.legenda).toBe(legenda);
    expect(repetida.fechadasAgora).toEqual([]);
  });

  it(`sem pontuação, a frase fecha por tempo aos ${DURACAO_MAXIMA_DA_FRASE_MS / 1000} s, com todo o confirmado e sem cortar palavra`, () => {
    expect(DURACAO_MAXIMA_DA_FRASE_MS).toBe(5_000);
    let legenda = LegendaDaEscuta.vazia().comConfirmado(fala(1, 10_000), "pessoal hoje vamos", "falar", 12_000).legenda;
    expect(legenda.frases).toEqual([]);

    // 4,999 s desde o começo da frase: ainda aberta.
    const quase = legenda.comConfirmado(fala(1, 10_000), "pessoal hoje vamos falar de", "estru", 14_999);
    expect(quase.fechadasAgora).toEqual([]);
    expect(quase.legenda.emAndamento).toEqual({ confirmado: "pessoal hoje vamos falar de", parcial: "estru", inicioMs: 10_000 });

    // 5 s: fecha com tudo o que já estava confirmado; o parcial fica na frase seguinte, que começa ali.
    const corte = quase.legenda.comConfirmado(fala(1, 10_000), "pessoal hoje vamos falar de estruturas", "de dados", 15_000);
    expect(corte.fechadasAgora).toEqual([
      { id: "frase-1-1", texto: "pessoal hoje vamos falar de estruturas", inicioMs: 10_000, fimMs: 15_000, pergunta: false, motivo: "tempo" },
    ]);
    legenda = corte.legenda;
    expect(legenda.emAndamento).toEqual({ confirmado: "", parcial: "de dados", inicioMs: 15_000 });

    // O que é confirmado depois abre a próxima, que fecha 5 s depois do corte anterior.
    legenda = legenda.comConfirmado(fala(1, 10_000), "pessoal hoje vamos falar de estruturas de dados", "e", 17_000).legenda;
    expect(legenda.emAndamento).toEqual({ confirmado: "de dados", parcial: "e", inicioMs: 15_000 });
    expect(legenda.comConfirmado(fala(1, 10_000), "pessoal hoje vamos falar de estruturas de dados e", null, 19_999).fechadasAgora).toEqual([]);
    const segundoCorte = legenda.comConfirmado(fala(1, 10_000), "pessoal hoje vamos falar de estruturas de dados e algoritmos", null, 20_000);
    expect(segundoCorte.fechadasAgora).toMatchObject([
      { id: "frase-1-2", texto: "de dados e algoritmos", inicioMs: 15_000, fimMs: 20_000, motivo: "tempo" },
    ]);
    expect(segundoCorte.legenda.emAndamento).toBeNull();
    // Nenhuma palavra cortada ou perdida.
    expect(segundoCorte.legenda.frases.map((frase) => frase.texto).join(" ")).toBe(
      "pessoal hoje vamos falar de estruturas de dados e algoritmos",
    );
  });

  it("passados os 5 s sem nada confirmado, nada fecha; a primeira palavra confirmada depois fecha a frase", () => {
    const soParcial = LegendaDaEscuta.vazia().comConfirmado(fala(1, 10_000), "", "hipótese instável", 16_000);
    expect(soParcial.fechadasAgora).toEqual([]);
    const { fechadasAgora } = soParcial.legenda.comConfirmado(fala(1, 10_000), "hipótese", "estável", 17_000);
    expect(fechadasAgora).toMatchObject([{ texto: "hipótese", motivo: "tempo" }]);
  });

  it("passados os 5 s, a pontuação fecha a sua frase e o resto confirmado fecha por tempo, na mesma passada", () => {
    const aberta = LegendaDaEscuta.vazia().comConfirmado(fala(1, 10_000), "um dois", null, 12_000).legenda;
    const { legenda, fechadasAgora } = aberta.comConfirmado(fala(1, 10_000), "um dois três. quatro cinco", "seis", 15_500);
    expect(fechadasAgora.map((frase) => [frase.id, frase.texto, frase.motivo])).toEqual([
      ["frase-1-1", "um dois três.", "pontuacao"],
      ["frase-1-2", "quatro cinco", "tempo"],
    ]);
    expect(legenda.emAndamento).toEqual({ confirmado: "", parcial: "seis", inicioMs: 15_500 });
  });

  it("no fim da fala, o que ainda estava aberto fecha (motivo fim_da_fala) e a frase em andamento some", () => {
    const aberta = LegendaDaEscuta.vazia().comConfirmado(fala(1), "Bom dia a todos. Vamos", "começar", 11_000).legenda;
    const { legenda, fechadasAgora } = aberta.comFimDaFala(fala(1), "Bom dia a todos. Vamos começar", 12_000);
    expect(textos(legenda)).toEqual([
      ["frase-1-1", "Bom dia a todos."],
      ["frase-1-2", "Vamos começar"],
    ]);
    expect(fechadasAgora.map((frase) => [frase.texto, frase.motivo])).toEqual([["Vamos começar", "fim_da_fala"]]);
    expect(legenda.emAndamento).toBeNull();
    expect(legenda.falaEmAndamento).toBeNull();
  });

  it("fala curta, sem passada parcial: o fim já traz as frases fechadas", () => {
    const { legenda, fechadasAgora } = LegendaDaEscuta.vazia().comFimDaFala(fala(2), "Qual a complexidade do quicksort?", 21_000);
    expect(textos(legenda)).toEqual([["frase-2-1", "Qual a complexidade do quicksort?"]]);
    expect(fechadasAgora).toHaveLength(1);
    expect(fechadasAgora[0]?.motivo).toBe("pontuacao");
  });

  it("fim de fala sem texto e sem nada aberto não muda a legenda", () => {
    const vazia = LegendaDaEscuta.vazia();
    const { legenda, fechadasAgora } = vazia.comFimDaFala(fala(1), "", 11_000);
    expect(legenda).toBe(vazia);
    expect(fechadasAgora).toEqual([]);
  });

  it("uma fala nova com outra aberta encerra a anterior como está", () => {
    const anterior = LegendaDaEscuta.vazia().comConfirmado(fala(1), "Primeira fala", "quase", 11_000).legenda;
    const { legenda } = anterior.comConfirmado(fala(2), "", "Segunda", 21_000);
    expect(textos(legenda)).toEqual([["frase-1-1", "Primeira fala"]]);
    expect(legenda.frases[0]?.motivo).toBe("fim_da_fala");
    expect(legenda.emAndamento).toEqual({ confirmado: "", parcial: "Segunda", inicioMs: 20_000 });
    expect(legenda.falaEmAndamento).toBe("Segunda");
  });

  it("semFalaAberta encerra a fala em andamento como está: o confirmado vira frase, o parcial some", () => {
    const aberta = LegendaDaEscuta.vazia().comConfirmado(fala(1), "Até aqui", "e mais", 11_000).legenda;
    const encerrada = aberta.semFalaAberta();
    expect(encerrada.frases).toEqual([
      { id: "frase-1-1", texto: "Até aqui", inicioMs: 10_000, fimMs: 11_000, pergunta: false, motivo: "fim_da_fala" },
    ]);
    expect(encerrada.emAndamento).toBeNull();
    expect(encerrada.falaEmAndamento).toBeNull();
    expect(encerrada.semFalaAberta()).toBe(encerrada);

    // Só com o parcial, não sobra nada.
    const soParcial = LegendaDaEscuta.vazia().comConfirmado(fala(1), "", "e mais", 11_000).legenda;
    expect(soParcial.semFalaAberta()).toBe(LegendaDaEscuta.vazia());
  });

  it("semFrases (o /clear) esquece as frases fechadas; a frase em andamento continua e os ids não se repetem", () => {
    const aberta = LegendaDaEscuta.vazia().comConfirmado(fala(1), "Uma frase. Outra frase. E", "mais", 11_000).legenda;
    const limpa = aberta.semFrases();
    expect(limpa.frases).toEqual([]);
    expect(limpa.emAndamento).toEqual(aberta.emAndamento);
    expect(limpa.semFrases()).toBe(limpa);

    const depois = limpa.comConfirmado(fala(1), "Uma frase. Outra frase. E mais uma.", null, 12_000);
    expect(textos(depois.legenda)).toEqual([["frase-1-3", "E mais uma."]]);

    // Sem nada aberto, limpa vira a vazia.
    const encerrada = LegendaDaEscuta.vazia().comFimDaFala(fala(2), "Uma frase.", 21_000).legenda;
    expect(encerrada.semFrases()).toBe(LegendaDaEscuta.vazia());
    expect(LegendaDaEscuta.vazia().semFrases()).toBe(LegendaDaEscuta.vazia());
  });

  it("comPergunta marca a frase fechada; a marca fica quando a fala cresce; id desconhecido não muda nada", () => {
    const aberta = LegendaDaEscuta.vazia().comConfirmado(fala(1), "Qual a complexidade do quicksort? E", null, 11_000).legenda;
    const marcada = aberta.comPergunta("frase-1-1");
    expect(marcada.frases[0]?.pergunta).toBe(true);
    expect(aberta.frases[0]?.pergunta).toBe(false);
    expect(marcada.comPergunta("frase-1-1")).toBe(marcada);
    expect(marcada.comPergunta("frase-9-9")).toBe(marcada);
    expect(marcada.emAndamento).toEqual(aberta.emAndamento);

    const cresceu = marcada.comConfirmado(fala(1), "Qual a complexidade do quicksort? E o heap", null, 12_000).legenda;
    expect(cresceu.frases[0]?.pergunta).toBe(true);
    const fim = cresceu.comFimDaFala(fala(1), "Qual a complexidade do quicksort? E o heap sort?", 13_000).legenda;
    expect(fim.frases[0]?.pergunta).toBe(true);
    expect(fim.frases[1]?.pergunta).toBe(false);
    expect(fim.comPergunta("frase-1-2").frases[1]?.pergunta).toBe(true);
  });

  it("fraseAnterior devolve a frase fechada logo antes; null para a primeira ou id desconhecido", () => {
    const { legenda } = LegendaDaEscuta.vazia().comFimDaFala(fala(1), "Primeira. Segunda. Terceira", 11_000);
    expect(legenda.fraseAnterior("frase-1-3")?.texto).toBe("Segunda.");
    expect(legenda.fraseAnterior("frase-1-1")).toBeNull();
    expect(legenda.fraseAnterior("frase-9-9")).toBeNull();
  });

  it(`guarda no máximo ${MAXIMO_DE_FRASES_NA_LEGENDA} frases: as mais antigas saem`, () => {
    expect(MAXIMO_DE_FRASES_NA_LEGENDA).toBe(200);
    let legenda = LegendaDaEscuta.vazia();
    for (let numero = 1; numero <= 205; numero++) {
      legenda = legenda.comFimDaFala(fala(numero), `Frase da fala ${numero}.`, numero * 10_000 + 1_000).legenda;
    }
    expect(legenda.frases).toHaveLength(200);
    expect(legenda.frases[0]?.texto).toBe("Frase da fala 6.");

    const comAberta = legenda.comConfirmado(fala(206), "Mais uma. E outra", null, 2_061_000).legenda;
    expect(comAberta.frases).toHaveLength(200);
    expect(comAberta.frases.at(-1)?.texto).toBe("Mais uma.");
    expect(comAberta.emAndamento?.confirmado).toBe("E outra");
  });

  it("é imutável: as mudanças devolvem legendas novas e as frases e a frase em andamento são congeladas", () => {
    const vazia = LegendaDaEscuta.vazia();
    const { legenda } = vazia.comConfirmado(fala(1), "Uma frase. Outra", "mais", 11_000);
    expect(legenda).not.toBe(vazia);
    expect(vazia.frases).toEqual([]);
    expect(Object.isFrozen(legenda)).toBe(true);
    expect(Object.isFrozen(legenda.frases)).toBe(true);
    expect(Object.isFrozen(legenda.frases[0])).toBe(true);
    expect(Object.isFrozen(legenda.emAndamento)).toBe(true);
  });
});
