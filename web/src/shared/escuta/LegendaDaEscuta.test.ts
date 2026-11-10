import { type FalaDaLegenda, LegendaDaEscuta, MAXIMO_DE_FRASES_NA_LEGENDA } from "./LegendaDaEscuta";

const fala = (numero: number, inicioMs = numero * 10_000): FalaDaLegenda => ({ numero, inicioMs });

const textos = (legenda: LegendaDaEscuta): [string, string][] => legenda.frases.map((frase) => [frase.id, frase.texto]);

describe("LegendaDaEscuta", () => {
  it("vazia: sem frases, sem parcial, sem fala em andamento (sempre a mesma instância)", () => {
    const vazia = LegendaDaEscuta.vazia();
    expect(vazia.frases).toEqual([]);
    expect(vazia.parcial).toBeNull();
    expect(vazia.falaEmAndamento).toBeNull();
    expect(vazia.textoDaFalaAberta).toBe("");
    expect(LegendaDaEscuta.vazia()).toBe(vazia);
    expect(Object.isFrozen(vazia)).toBe(true);
  });

  it("só parcial: nenhuma frase ainda, mas a fala em andamento aparece", () => {
    const { legenda, fechadasAgora } = LegendaDaEscuta.vazia().comConfirmado(fala(1), "", "Hoje vamos", 11_000);
    expect(legenda.frases).toEqual([]);
    expect(legenda.parcial).toBe("Hoje vamos");
    expect(legenda.falaEmAndamento).toBe("Hoje vamos");
    expect(fechadasAgora).toEqual([]);
  });

  it("o confirmado vira frases com ids frase-<fala>-<posição>; só as fechadas por pontuação saem em fechadasAgora", () => {
    const { legenda, fechadasAgora } = LegendaDaEscuta.vazia().comConfirmado(
      fala(3, 30_000),
      "Hoje vamos falar de listas. E depois",
      "filas",
      32_000,
    );
    expect(textos(legenda)).toEqual([
      ["frase-3-1", "Hoje vamos falar de listas."],
      ["frase-3-2", "E depois"],
    ]);
    expect(legenda.frases[0]).toMatchObject({ inicioMs: 30_000, fimMs: 32_000, pergunta: false });
    expect(legenda.frases[1]?.inicioMs).toBe(32_000);
    expect(legenda.parcial).toBe("filas");
    expect(legenda.textoDaFalaAberta).toBe("Hoje vamos falar de listas. E depois");
    expect(legenda.falaEmAndamento).toBe("Hoje vamos falar de listas. E depois filas");
    expect(fechadasAgora.map((frase) => frase.id)).toEqual(["frase-3-1"]);
  });

  it("a frase aberta cresce com o mesmo id; a fechada fica a mesma e não fecha de novo", () => {
    const primeira = LegendaDaEscuta.vazia().comConfirmado(fala(1), "Hoje vamos falar de listas. E depois", "filas", 12_000);
    const fechada = primeira.legenda.frases[0];

    const segunda = primeira.legenda.comConfirmado(fala(1), "Hoje vamos falar de listas. E depois filas", null, 13_000);
    expect(textos(segunda.legenda)).toEqual([
      ["frase-1-1", "Hoje vamos falar de listas."],
      ["frase-1-2", "E depois filas"],
    ]);
    expect(segunda.legenda.frases[0]).toBe(fechada);
    expect(segunda.legenda.parcial).toBeNull();
    expect(segunda.fechadasAgora).toEqual([]);

    const terceira = segunda.legenda.comConfirmado(fala(1), "Hoje vamos falar de listas. E depois filas e pilhas. Mas", "antes", 14_000);
    expect(textos(terceira.legenda)).toEqual([
      ["frase-1-1", "Hoje vamos falar de listas."],
      ["frase-1-2", "E depois filas e pilhas."],
      ["frase-1-3", "Mas"],
    ]);
    expect(terceira.fechadasAgora.map((frase) => frase.texto)).toEqual(["E depois filas e pilhas."]);
  });

  it("a mesma passada de novo devolve a mesma legenda, sem fechar nada", () => {
    const { legenda } = LegendaDaEscuta.vazia().comConfirmado(fala(1), "Uma frase. Outra", "mais", 12_000);
    const repetida = legenda.comConfirmado(fala(1), "Uma frase. Outra", "mais", 12_500);
    expect(repetida.legenda).toBe(legenda);
    expect(repetida.fechadasAgora).toEqual([]);
  });

  it("no fim da fala, todas as frases fecham (até a última, sem pontuação) e o parcial some", () => {
    const aberta = LegendaDaEscuta.vazia().comConfirmado(fala(1), "Bom dia a todos. Vamos", "começar", 11_000).legenda;
    const { legenda, fechadasAgora } = aberta.comFimDaFala(fala(1), "Bom dia a todos. Vamos começar", 12_000);
    expect(textos(legenda)).toEqual([
      ["frase-1-1", "Bom dia a todos."],
      ["frase-1-2", "Vamos começar"],
    ]);
    expect(fechadasAgora.map((frase) => frase.texto)).toEqual(["Vamos começar"]);
    expect(legenda.parcial).toBeNull();
    expect(legenda.falaEmAndamento).toBeNull();
    expect(legenda.textoDaFalaAberta).toBe("");
  });

  it("fala curta, sem passada parcial: o fim já traz as frases fechadas", () => {
    const { legenda, fechadasAgora } = LegendaDaEscuta.vazia().comFimDaFala(fala(2), "Qual a complexidade do quicksort?", 21_000);
    expect(textos(legenda)).toEqual([["frase-2-1", "Qual a complexidade do quicksort?"]]);
    expect(fechadasAgora).toHaveLength(1);
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
    expect(legenda.parcial).toBe("Segunda");
    expect(legenda.falaEmAndamento).toBe("Segunda");
  });

  it("semFalaAberta encerra a fala em andamento como está: o confirmado fica, o parcial some", () => {
    const aberta = LegendaDaEscuta.vazia().comConfirmado(fala(1), "Até aqui", "e mais", 11_000).legenda;
    const encerrada = aberta.semFalaAberta();
    expect(textos(encerrada)).toEqual([["frase-1-1", "Até aqui"]]);
    expect(encerrada.parcial).toBeNull();
    expect(encerrada.falaEmAndamento).toBeNull();
    expect(encerrada.semFalaAberta()).toBe(encerrada);
  });

  it("comPergunta marca a frase; a marca fica quando a fala cresce; id desconhecido não muda nada", () => {
    const aberta = LegendaDaEscuta.vazia().comConfirmado(fala(1), "Qual a complexidade do quicksort? E", null, 11_000).legenda;
    const marcada = aberta.comPergunta("frase-1-1");
    expect(marcada.frases[0]?.pergunta).toBe(true);
    expect(aberta.frases[0]?.pergunta).toBe(false);
    expect(marcada.comPergunta("frase-1-1")).toBe(marcada);
    expect(marcada.comPergunta("frase-9-9")).toBe(marcada);

    const cresceu = marcada.comConfirmado(fala(1), "Qual a complexidade do quicksort? E o heap", null, 12_000).legenda;
    expect(cresceu.frases[0]?.pergunta).toBe(true);
    const fim = cresceu.comFimDaFala(fala(1), "Qual a complexidade do quicksort? E o heap sort?", 13_000).legenda;
    expect(fim.frases[0]?.pergunta).toBe(true);
    expect(fim.frases[1]?.pergunta).toBe(false);

    // Também nas frases de falas encerradas.
    expect(fim.comPergunta("frase-1-2").frases[1]?.pergunta).toBe(true);
  });

  it(`guarda no máximo ${MAXIMO_DE_FRASES_NA_LEGENDA} frases: as mais antigas saem`, () => {
    expect(MAXIMO_DE_FRASES_NA_LEGENDA).toBe(200);
    let legenda = LegendaDaEscuta.vazia();
    for (let numero = 1; numero <= 205; numero++) {
      legenda = legenda.comFimDaFala(fala(numero), `Frase da fala ${numero}.`, numero * 10_000 + 1_000).legenda;
    }
    expect(legenda.frases).toHaveLength(200);
    expect(legenda.frases[0]?.texto).toBe("Frase da fala 6.");

    // Com uma fala aberta, o total continua no máximo.
    const comAberta = legenda.comConfirmado(fala(206), "Mais uma. E outra", null, 2_061_000).legenda;
    expect(comAberta.frases).toHaveLength(200);
    expect(comAberta.frases.at(-1)?.texto).toBe("E outra");
  });

  it("é imutável: as mudanças devolvem legendas novas e as frases são congeladas", () => {
    const vazia = LegendaDaEscuta.vazia();
    const { legenda } = vazia.comConfirmado(fala(1), "Uma frase.", null, 11_000);
    expect(legenda).not.toBe(vazia);
    expect(vazia.frases).toEqual([]);
    expect(Object.isFrozen(legenda)).toBe(true);
    expect(Object.isFrozen(legenda.frases)).toBe(true);
    expect(Object.isFrozen(legenda.frases[0])).toBe(true);
  });
});
