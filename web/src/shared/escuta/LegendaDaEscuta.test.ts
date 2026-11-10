import {
  DURACAO_MAXIMA_DO_ENUNCIADO_MS,
  type FalaDaLegenda,
  LegendaDaEscuta,
  MAXIMO_DE_FRASES_NA_LEGENDA,
  PAUSA_DO_ENUNCIADO_MS,
} from "./LegendaDaEscuta";

const fala = (numero: number, inicioMs = numero * 10_000): FalaDaLegenda => ({ numero, inicioMs });

const textos = (legenda: LegendaDaEscuta): [string, string][] => legenda.frases.map((frase) => [frase.id, frase.texto]);

describe("LegendaDaEscuta", () => {
  it("constantes combinadas", () => {
    expect(PAUSA_DO_ENUNCIADO_MS).toBe(1_200);
    expect(DURACAO_MAXIMA_DO_ENUNCIADO_MS).toBe(20_000);
    expect(MAXIMO_DE_FRASES_NA_LEGENDA).toBe(200);
  });

  it("vazia: sem enunciados, sem enunciado em andamento (sempre a mesma instância)", () => {
    const vazia = LegendaDaEscuta.vazia();
    expect(vazia.frases).toEqual([]);
    expect(vazia.emAndamento).toBeNull();
    expect(vazia.falaEmAndamento).toBeNull();
    expect(LegendaDaEscuta.vazia()).toBe(vazia);
    expect(Object.isFrozen(vazia)).toBe(true);
  });

  it("só parcial: o enunciado abre com o id da primeira fala e só o parcial", () => {
    const { legenda, fechadasAgora } = LegendaDaEscuta.vazia().comConfirmado(fala(1), "", "Hoje vamos", 11_000);
    expect(legenda.frases).toEqual([]);
    expect(legenda.emAndamento).toEqual({ id: "enunciado-1", confirmado: "", parcial: "Hoje vamos", inicioMs: 10_000 });
    expect(legenda.falaEmAndamento).toBe("Hoje vamos");
    expect(fechadasAgora).toEqual([]);
  });

  it("não divide por pontuação: o confirmado inteiro fica no enunciado aberto", () => {
    const { legenda, fechadasAgora } = LegendaDaEscuta.vazia().comConfirmado(
      fala(3, 30_000),
      "Hoje vamos falar de listas. E depois? Mais tarde!",
      "filas",
      32_000,
    );
    expect(legenda.frases).toEqual([]);
    expect(fechadasAgora).toEqual([]);
    expect(legenda.emAndamento).toEqual({
      id: "enunciado-3",
      confirmado: "Hoje vamos falar de listas. E depois? Mais tarde!",
      parcial: "filas",
      inicioMs: 30_000,
    });
    expect(legenda.falaEmAndamento).toBe("Hoje vamos falar de listas. E depois? Mais tarde! filas");
  });

  it("não divide por tempo: a fala de 8 s continua num enunciado só", () => {
    let legenda = LegendaDaEscuta.vazia().comConfirmado(fala(1, 10_000), "pessoal hoje vamos", "falar", 12_000).legenda;
    legenda = legenda.comConfirmado(fala(1, 10_000), "pessoal hoje vamos falar de estruturas", "de dados", 15_000).legenda;
    const { legenda: depois, fechadasAgora } = legenda.comConfirmado(
      fala(1, 10_000),
      "pessoal hoje vamos falar de estruturas de dados e algoritmos",
      null,
      18_000,
    );
    expect(fechadasAgora).toEqual([]);
    expect(depois.frases).toEqual([]);
    expect(depois.emAndamento).toEqual({
      id: "enunciado-1",
      confirmado: "pessoal hoje vamos falar de estruturas de dados e algoritmos",
      parcial: "",
      inicioMs: 10_000,
    });
  });

  it("a mesma passada de novo devolve a mesma legenda", () => {
    const { legenda } = LegendaDaEscuta.vazia().comConfirmado(fala(1), "Uma frase. Outra", "mais", 12_000);
    const repetida = legenda.comConfirmado(fala(1), "Uma frase. Outra", "mais", 12_500);
    expect(repetida.legenda).toBe(legenda);
    expect(repetida.fechadasAgora).toEqual([]);
  });

  it("no fim da fala, o confirmado final passa ao enunciado, o parcial some e o enunciado continua aberto", () => {
    const aberta = LegendaDaEscuta.vazia().comConfirmado(fala(1), "Bom dia a todos. Vamos", "começar", 11_000).legenda;
    const { legenda, fechadasAgora } = aberta.comFimDaFala(fala(1), "Bom dia a todos. Vamos começar", 12_000);
    expect(fechadasAgora).toEqual([]);
    expect(legenda.frases).toEqual([]);
    expect(legenda.emAndamento).toEqual({ id: "enunciado-1", confirmado: "Bom dia a todos. Vamos começar", parcial: "", inicioMs: 10_000 });
    expect(legenda.falaEmAndamento).toBe("Bom dia a todos. Vamos começar");
  });

  it("fala curta, sem passada parcial: o fim abre o enunciado, que fica aberto esperando a pausa", () => {
    const { legenda, fechadasAgora } = LegendaDaEscuta.vazia().comFimDaFala(fala(2), "Qual a complexidade do quicksort?", 21_000);
    expect(fechadasAgora).toEqual([]);
    expect(legenda.emAndamento).toEqual({ id: "enunciado-2", confirmado: "Qual a complexidade do quicksort?", parcial: "", inicioMs: 20_000 });
  });

  it("falas seguidas (a próxima começa até a pausa depois do fim da anterior) entram no mesmo enunciado, unidas por espaço", () => {
    let legenda = LegendaDaEscuta.vazia().comFimDaFala(fala(1, 10_000), "Pessoal, eu queria saber", 12_000).legenda;
    const segunda = fala(2, 12_000 + PAUSA_DO_ENUNCIADO_MS);
    const parcial = legenda.comConfirmado(segunda, "qual a melhor", "forma", 15_000);
    expect(parcial.fechadasAgora).toEqual([]);
    expect(parcial.legenda.emAndamento).toEqual({
      id: "enunciado-1",
      confirmado: "Pessoal, eu queria saber qual a melhor",
      parcial: "forma",
      inicioMs: 10_000,
    });
    legenda = parcial.legenda.comFimDaFala(segunda, "qual a melhor forma de fazer isso?", 16_000).legenda;
    expect(legenda.frases).toEqual([]);
    expect(legenda.emAndamento?.confirmado).toBe("Pessoal, eu queria saber qual a melhor forma de fazer isso?");

    // A pausa passou: a sessão fecha o enunciado, com o mesmo id que ele tinha aberto.
    const { legenda: fechada, fechadasAgora } = legenda.semEnunciadoAberto();
    expect(fechadasAgora).toEqual([
      {
        id: "enunciado-1",
        texto: "Pessoal, eu queria saber qual a melhor forma de fazer isso?",
        inicioMs: 10_000,
        fimMs: 16_000,
        pergunta: false,
      },
    ]);
    expect(fechada.frases).toEqual(fechadasAgora);
    expect(fechada.emAndamento).toBeNull();
    expect(fechada.falaEmAndamento).toBeNull();
  });

  it("a fala que começa depois da pausa fecha o enunciado anterior e abre outro", () => {
    const anterior = LegendaDaEscuta.vazia().comFimDaFala(fala(1, 10_000), "Bom dia a todos.", 12_000).legenda;
    const { legenda, fechadasAgora } = anterior.comConfirmado(fala(2, 12_001 + PAUSA_DO_ENUNCIADO_MS), "", "Hoje", 14_000);
    expect(fechadasAgora).toEqual([{ id: "enunciado-1", texto: "Bom dia a todos.", inicioMs: 10_000, fimMs: 12_000, pergunta: false }]);
    expect(textos(legenda)).toEqual([["enunciado-1", "Bom dia a todos."]]);
    expect(legenda.emAndamento).toEqual({ id: "enunciado-2", confirmado: "", parcial: "Hoje", inicioMs: 12_001 + PAUSA_DO_ENUNCIADO_MS });

    // Também quando a fala nova chega já no fim (sem passada parcial).
    const curta = anterior.comFimDaFala(fala(3, 20_000), "Vamos começar.", 21_000);
    expect(curta.fechadasAgora.map((frase) => frase.id)).toEqual(["enunciado-1"]);
    expect(curta.legenda.emAndamento?.id).toBe("enunciado-3");
  });

  it(`limite de ${DURACAO_MAXIMA_DO_ENUNCIADO_MS / 1000} s: a fala que termina com o enunciado nessa duração o fecha na hora`, () => {
    let legenda = LegendaDaEscuta.vazia().comFimDaFala(fala(1, 10_000), "um", 18_000).legenda;
    legenda = legenda.comFimDaFala(fala(2, 18_000), "dois", 26_000).legenda;
    // 16 s desde o começo: ainda aberto.
    expect(legenda.frases).toEqual([]);
    expect(legenda.emAndamento?.confirmado).toBe("um dois");

    const corte = legenda.comFimDaFala(fala(3, 26_000), "três", 30_000);
    expect(corte.fechadasAgora).toEqual([{ id: "enunciado-1", texto: "um dois três", inicioMs: 10_000, fimMs: 30_000, pergunta: false }]);
    expect(corte.legenda.emAndamento).toBeNull();

    // A fala seguinte, mesmo colada, abre outro enunciado.
    const seguinte = corte.legenda.comConfirmado(fala(4, 30_000), "quatro", null, 31_000);
    expect(seguinte.fechadasAgora).toEqual([]);
    expect(seguinte.legenda.emAndamento).toMatchObject({ id: "enunciado-4", confirmado: "quatro" });
  });

  it(`a fala que começa ${DURACAO_MAXIMA_DO_ENUNCIADO_MS / 1000} s depois do começo do enunciado não entra nele, mesmo sem pausa`, () => {
    const legenda = LegendaDaEscuta.vazia().comFimDaFala(fala(1, 10_000), "fala longa", 29_500).legenda;
    expect(legenda.emAndamento?.id).toBe("enunciado-1");
    const { legenda: depois, fechadasAgora } = legenda.comConfirmado(fala(2, 10_000 + DURACAO_MAXIMA_DO_ENUNCIADO_MS), "mais", null, 31_000);
    expect(fechadasAgora.map((frase) => frase.texto)).toEqual(["fala longa"]);
    expect(depois.emAndamento?.id).toBe("enunciado-2");
  });

  it("uma fala nova com outra em andamento: a anterior termina como está e as duas ficam no mesmo enunciado", () => {
    const anterior = LegendaDaEscuta.vazia().comConfirmado(fala(1, 10_000), "Primeira fala", "quase", 11_000).legenda;
    const junto = anterior.comConfirmado(fala(2, 11_500), "", "Segunda", 12_000).legenda;
    expect(junto.frases).toEqual([]);
    expect(junto.emAndamento).toEqual({ id: "enunciado-1", confirmado: "Primeira fala", parcial: "Segunda", inicioMs: 10_000 });

    // Longe demais (depois da pausa): a anterior fecha como está.
    const separada = anterior.comConfirmado(fala(2, 20_000), "", "Segunda", 21_000);
    expect(separada.fechadasAgora).toEqual([{ id: "enunciado-1", texto: "Primeira fala", inicioMs: 10_000, fimMs: 11_000, pergunta: false }]);
    expect(separada.legenda.emAndamento).toEqual({ id: "enunciado-2", confirmado: "", parcial: "Segunda", inicioMs: 20_000 });
  });

  it("enunciado sem nenhum texto confirmado é esquecido: no fim da fala vazia ou quando chega outra fala", () => {
    const vazia = LegendaDaEscuta.vazia();
    const semNada = vazia.comFimDaFala(fala(1), "", 11_000);
    expect(semNada.legenda).toBe(vazia);
    expect(semNada.fechadasAgora).toEqual([]);

    const soParcial = vazia.comConfirmado(fala(1), "", "hipótese", 11_000).legenda;
    expect(soParcial.comFimDaFala(fala(1), "", 12_000).legenda).toBe(LegendaDaEscuta.vazia());
    const outra = soParcial.comConfirmado(fala(2, 11_500), "", "outra", 12_000);
    expect(outra.fechadasAgora).toEqual([]);
    expect(outra.legenda.emAndamento?.id).toBe("enunciado-2");
  });

  it("semEnunciadoAberto fecha como está: o confirmado (com o da fala em andamento) fecha, o parcial some", () => {
    const anterior = LegendaDaEscuta.vazia().comFimDaFala(fala(1, 10_000), "Até aqui", 11_000).legenda;
    const aberta = anterior.comConfirmado(fala(2, 11_500), "e mais", "um pouco", 12_000).legenda;
    const { legenda: encerrada, fechadasAgora } = aberta.semEnunciadoAberto();
    expect(fechadasAgora).toEqual([{ id: "enunciado-1", texto: "Até aqui e mais", inicioMs: 10_000, fimMs: 12_000, pergunta: false }]);
    expect(encerrada.frases).toEqual(fechadasAgora);
    expect(encerrada.emAndamento).toBeNull();
    expect(encerrada.falaEmAndamento).toBeNull();
    expect(encerrada.semEnunciadoAberto().legenda).toBe(encerrada);
    expect(encerrada.semEnunciadoAberto().fechadasAgora).toEqual([]);

    // Só com o parcial, nada fecha.
    const soParcial = LegendaDaEscuta.vazia().comConfirmado(fala(1), "", "e mais", 11_000).legenda;
    expect(soParcial.semEnunciadoAberto()).toEqual({ legenda: LegendaDaEscuta.vazia(), fechadasAgora: [] });
  });

  it("semFrases (o /clear) esquece os enunciados fechados; o aberto continua com o mesmo id", () => {
    const fechada = LegendaDaEscuta.vazia().comFimDaFala(fala(1), "Uma frase.", 11_000).legenda;
    const aberta = fechada.comConfirmado(fala(2), "Outra", "mais", 21_000).legenda;
    expect(aberta.frases).toHaveLength(1);
    const limpa = aberta.semFrases();
    expect(limpa.frases).toEqual([]);
    expect(limpa.emAndamento).toEqual(aberta.emAndamento);
    expect(limpa.semFrases()).toBe(limpa);
    expect(textos(limpa.semEnunciadoAberto().legenda)).toEqual([["enunciado-2", "Outra"]]);

    // Sem nada aberto, limpa vira a vazia.
    expect(fechada.semEnunciadoAberto().legenda.semFrases()).toBe(LegendaDaEscuta.vazia());
    expect(LegendaDaEscuta.vazia().semFrases()).toBe(LegendaDaEscuta.vazia());
  });

  it("comPergunta marca o enunciado aberto (a marca vai junto ao fechar) e o fechado; id desconhecido não muda nada", () => {
    const aberta = LegendaDaEscuta.vazia().comFimDaFala(fala(1), "Qual a complexidade do quicksort?", 11_000).legenda;
    const marcada = aberta.comPergunta("enunciado-1");
    expect(marcada).not.toBe(aberta);
    expect(marcada.emAndamento).toEqual(aberta.emAndamento);
    expect(marcada.comPergunta("enunciado-1")).toBe(marcada);
    expect(marcada.comPergunta("enunciado-9")).toBe(marcada);

    const cresceu = marcada.comFimDaFala(fala(2, 11_500), "E o heap sort?", 13_000).legenda;
    const { legenda: fechada } = cresceu.semEnunciadoAberto();
    expect(fechada.frases).toMatchObject([{ id: "enunciado-1", texto: "Qual a complexidade do quicksort? E o heap sort?", pergunta: true }]);
    expect(aberta.semEnunciadoAberto().legenda.frases[0]?.pergunta).toBe(false);

    const outra = aberta.semEnunciadoAberto().legenda;
    const fechadaMarcada = outra.comPergunta("enunciado-1");
    expect(fechadaMarcada.frases[0]?.pergunta).toBe(true);
    expect(fechadaMarcada.comPergunta("enunciado-1")).toBe(fechadaMarcada);
  });

  it(`guarda no máximo ${MAXIMO_DE_FRASES_NA_LEGENDA} enunciados: os mais antigos saem`, () => {
    let legenda = LegendaDaEscuta.vazia();
    // Cada fala começa 10 s depois da anterior: a pausa separa um enunciado por fala.
    for (let numero = 1; numero <= 205; numero++) {
      legenda = legenda.comFimDaFala(fala(numero), `Frase da fala ${numero}.`, numero * 10_000 + 1_000).legenda;
    }
    expect(legenda.frases).toHaveLength(200);
    expect(legenda.frases[0]?.texto).toBe("Frase da fala 5.");
    expect(legenda.frases.at(-1)?.texto).toBe("Frase da fala 204.");
    expect(legenda.emAndamento?.confirmado).toBe("Frase da fala 205.");

    const fechada = legenda.semEnunciadoAberto().legenda;
    expect(fechada.frases).toHaveLength(200);
    expect(fechada.frases.at(-1)?.texto).toBe("Frase da fala 205.");
  });

  it("é imutável: as mudanças devolvem legendas novas e os enunciados e o em andamento são congelados", () => {
    const vazia = LegendaDaEscuta.vazia();
    const { legenda } = vazia.comFimDaFala(fala(1), "Uma frase.", 11_000).legenda.comConfirmado(fala(2), "Outra", "mais", 21_000);
    expect(legenda).not.toBe(vazia);
    expect(vazia.frases).toEqual([]);
    expect(Object.isFrozen(legenda)).toBe(true);
    expect(Object.isFrozen(legenda.frases)).toBe(true);
    expect(Object.isFrozen(legenda.frases[0])).toBe(true);
    expect(Object.isFrozen(legenda.emAndamento)).toBe(true);
  });
});
