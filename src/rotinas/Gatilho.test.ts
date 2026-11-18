import { describe, expect, it } from "vitest";

import { ErroDeRotina } from "./ErroDeRotina";
import { fusoDe } from "./duplasDeTeste";
import {
  DadosDoGatilho,
  Gatilho,
  MENSAGEM_DE_DATA_INVALIDA,
  MENSAGEM_DE_DIAS_INVALIDOS,
  MENSAGEM_DE_GATILHO_INVALIDO,
  MENSAGEM_DE_HORA_INVALIDA,
  MENSAGEM_DE_INTERVALO_INVALIDO,
} from "./Gatilho";

const UTC = fusoDe("UTC");
const NOVA_YORK = fusoDe("America/New_York");

function proxima(dados: DadosDoGatilho, depoisDe: string, fuso = UTC): string | null {
  return Gatilho.criar(dados).proximaOcorrencia(new Date(depoisDe), fuso)?.toISOString() ?? null;
}

function dadosInvalidos(valor: unknown): DadosDoGatilho {
  return valor as DadosDoGatilho;
}

function erroDe(acao: () => unknown): ErroDeRotina {
  try {
    acao();
  } catch (erro) {
    if (erro instanceof ErroDeRotina) {
      return erro;
    }
    throw erro;
  }
  throw new Error("Esperava um ErroDeRotina, mas nada foi lançado.");
}

describe("Gatilho diário", () => {
  const diario: DadosDoGatilho = { tipo: "diario", hora: "09:00" };

  it("antes da hora, dispara hoje", () => {
    expect(proxima(diario, "2026-06-10T08:00:00Z")).toBe("2026-06-10T09:00:00.000Z");
  });

  it("na hora exata ou depois, dispara amanhã (a ocorrência é estritamente depois)", () => {
    expect(proxima(diario, "2026-06-10T09:00:00Z")).toBe("2026-06-11T09:00:00.000Z");
    expect(proxima(diario, "2026-06-10T09:00:01Z")).toBe("2026-06-11T09:00:00.000Z");
    expect(proxima(diario, "2026-06-10T23:59:00Z")).toBe("2026-06-11T09:00:00.000Z");
  });

  it("vira o dia, o mês, o ano e o dia 29 de fevereiro", () => {
    expect(proxima({ tipo: "diario", hora: "00:15" }, "2026-12-31T23:30:00Z")).toBe("2027-01-01T00:15:00.000Z");
    expect(proxima({ tipo: "diario", hora: "00:00" }, "2026-02-28T23:59:00Z")).toBe("2026-03-01T00:00:00.000Z");
    expect(proxima(diario, "2028-02-28T12:00:00Z")).toBe("2028-02-29T09:00:00.000Z");
    expect(proxima(diario, "2028-02-29T12:00:00Z")).toBe("2028-03-01T09:00:00.000Z");
  });

  it("a hora é a do relógio do fuso, não a de UTC", () => {
    // 08:00 em Nova York (EDT, UTC-4) = 12:00Z: ainda dá tempo de ser hoje às 9h locais (13:00Z).
    expect(proxima(diario, "2026-06-10T12:00:00Z", NOVA_YORK)).toBe("2026-06-10T13:00:00.000Z");
    expect(proxima(diario, "2026-06-10T13:00:00Z", NOVA_YORK)).toBe("2026-06-11T13:00:00.000Z");
  });

  it("no salto do horário de verão, continua às 9h do relógio (23 horas depois, e não 24)", () => {
    // 07/03/2026 09:00 EST = 14:00Z; no dia 08 o relógio adianta 1h e as 9h passam a ser 13:00Z.
    expect(proxima(diario, "2026-03-07T14:00:00Z", NOVA_YORK)).toBe("2026-03-08T13:00:00.000Z");
    expect(proxima(diario, "2026-03-08T13:00:00Z", NOVA_YORK)).toBe("2026-03-09T13:00:00.000Z");
  });

  it("na volta do horário de verão, continua às 9h do relógio (25 horas depois)", () => {
    // 31/10/2026 09:00 EDT = 13:00Z; no dia 01/11 o relógio atrasa 1h e as 9h passam a ser 14:00Z.
    expect(proxima(diario, "2026-10-31T13:00:00Z", NOVA_YORK)).toBe("2026-11-01T14:00:00.000Z");
  });

  it("hora que não existe no salto vale como a hora seguinte (02:30 vira 03:30)", () => {
    expect(proxima({ tipo: "diario", hora: "02:30" }, "2026-03-08T05:00:00Z", NOVA_YORK)).toBe("2026-03-08T07:30:00.000Z");
  });

  it("hora que existe duas vezes na volta vale como a primeira (01:30 de EDT)", () => {
    expect(proxima({ tipo: "diario", hora: "01:30" }, "2026-11-01T00:00:00Z", NOVA_YORK)).toBe("2026-11-01T05:30:00.000Z");
  });

  it("no fuso do sistema, é a hora do relógio local", () => {
    const antes = new Date(2026, 10, 17, 8, 30);
    const depois = new Date(2026, 10, 17, 9, 30);

    expect(Gatilho.criar(diario).proximaOcorrencia(antes)?.getTime()).toBe(new Date(2026, 10, 17, 9, 0).getTime());
    expect(Gatilho.criar(diario).proximaOcorrencia(depois)?.getTime()).toBe(new Date(2026, 10, 18, 9, 0).getTime());
  });
});

describe("Gatilho semanal", () => {
  // 13/11/2026 é sexta; 16/11 segunda; 15/11 domingo.
  const segundaAs9: DadosDoGatilho = { tipo: "semanal", dias: [1], hora: "09:00" };

  it("da sexta, vai para a segunda seguinte", () => {
    expect(proxima(segundaAs9, "2026-11-13T10:00:00Z")).toBe("2026-11-16T09:00:00.000Z");
  });

  it("na própria segunda: antes da hora é hoje; na hora ou depois, só na semana seguinte", () => {
    expect(proxima(segundaAs9, "2026-11-16T08:00:00Z")).toBe("2026-11-16T09:00:00.000Z");
    expect(proxima(segundaAs9, "2026-11-16T09:00:00Z")).toBe("2026-11-23T09:00:00.000Z");
    expect(proxima(segundaAs9, "2026-11-16T18:00:00Z")).toBe("2026-11-23T09:00:00.000Z");
  });

  it("com vários dias, escolhe o mais próximo (e aceita os dias fora de ordem)", () => {
    const segundaQuartaESexta: DadosDoGatilho = { tipo: "semanal", dias: [5, 1, 3], hora: "09:00" };

    expect(proxima(segundaQuartaESexta, "2026-11-16T10:00:00Z")).toBe("2026-11-18T09:00:00.000Z");
    expect(proxima(segundaQuartaESexta, "2026-11-18T10:00:00Z")).toBe("2026-11-20T09:00:00.000Z");
    expect(proxima(segundaQuartaESexta, "2026-11-20T10:00:00Z")).toBe("2026-11-23T09:00:00.000Z");
  });

  it("vira a semana (sábado para domingo) e o ano", () => {
    expect(proxima({ tipo: "semanal", dias: [0], hora: "09:00" }, "2026-11-14T23:59:00Z")).toBe("2026-11-15T09:00:00.000Z");
    expect(proxima({ tipo: "semanal", dias: [0], hora: "09:00" }, "2026-11-15T10:00:00Z")).toBe("2026-11-22T09:00:00.000Z");
    // 31/12/2026 é quinta; a próxima segunda é 04/01/2027.
    expect(proxima(segundaAs9, "2026-12-31T12:00:00Z")).toBe("2027-01-04T09:00:00.000Z");
  });

  it("o dia da semana é o do fuso: a segunda às 22h de Nova York já é terça em UTC", () => {
    const segundaAs22: DadosDoGatilho = { tipo: "semanal", dias: [1], hora: "22:00" };

    // 22:00 EST de segunda 16/11 = 03:00Z de terça 17/11.
    expect(proxima(segundaAs22, "2026-11-16T12:00:00Z", NOVA_YORK)).toBe("2026-11-17T03:00:00.000Z");
  });

  it("atravessa o horário de verão mantendo a hora do relógio", () => {
    // Domingo 08/03/2026 (dia do salto) às 09:00 EDT = 13:00Z; o domingo anterior foi às 14:00Z (EST).
    const domingoAs9: DadosDoGatilho = { tipo: "semanal", dias: [0], hora: "09:00" };

    expect(proxima(domingoAs9, "2026-03-01T14:00:00Z", NOVA_YORK)).toBe("2026-03-08T13:00:00.000Z");
  });
});

describe("Gatilho por intervalo", () => {
  it("soma os minutos exatos à âncora, sem olhar o relógio de parede", () => {
    const quinzeMinutos: DadosDoGatilho = { tipo: "intervalo", minutos: 15 };

    expect(proxima(quinzeMinutos, "2026-11-17T08:00:00Z")).toBe("2026-11-17T08:15:00.000Z");
    // Atravessando o salto do horário de verão, 24 horas continuam sendo 24 horas.
    expect(proxima({ tipo: "intervalo", minutos: 1440 }, "2026-03-07T10:00:00Z", NOVA_YORK)).toBe("2026-03-08T10:00:00.000Z");
  });

  it("aceita de 15 minutos a um ano", () => {
    expect(Gatilho.criar({ tipo: "intervalo", minutos: 15 }).tipo).toBe("intervalo");
    expect(Gatilho.criar({ tipo: "intervalo", minutos: 525_600 }).tipo).toBe("intervalo");
  });
});

describe("Gatilho de uma vez só", () => {
  const umaVez: DadosDoGatilho = { tipo: "uma_vez", em: "2026-12-01T09:00:00-03:00" };

  it("guarda o instante normalizado e só dispara se ainda não passou", () => {
    expect(Gatilho.criar(umaVez).paraDados()).toEqual({ tipo: "uma_vez", em: "2026-12-01T12:00:00.000Z" });
    expect(proxima(umaVez, "2026-12-01T11:59:59Z")).toBe("2026-12-01T12:00:00.000Z");
  });

  it("na hora exata ou depois, não há mais ocorrência", () => {
    expect(proxima(umaVez, "2026-12-01T12:00:00Z")).toBeNull();
    expect(proxima(umaVez, "2027-01-01T00:00:00Z")).toBeNull();
  });
});

describe("validação do Gatilho", () => {
  it.each<[string, unknown, string]>([
    ["hora sem zero à esquerda", { tipo: "diario", hora: "9:00" }, MENSAGEM_DE_HORA_INVALIDA],
    ["hora 24:00", { tipo: "diario", hora: "24:00" }, MENSAGEM_DE_HORA_INVALIDA],
    ["minuto 60", { tipo: "diario", hora: "09:60" }, MENSAGEM_DE_HORA_INVALIDA],
    ["hora que não é texto", { tipo: "diario", hora: 900 }, MENSAGEM_DE_HORA_INVALIDA],
    ["semanal sem hora", { tipo: "semanal", dias: [1] }, MENSAGEM_DE_HORA_INVALIDA],
    ["semanal sem dias", { tipo: "semanal", dias: [], hora: "09:00" }, MENSAGEM_DE_DIAS_INVALIDOS],
    ["dia 7", { tipo: "semanal", dias: [7], hora: "09:00" }, MENSAGEM_DE_DIAS_INVALIDOS],
    ["dia repetido", { tipo: "semanal", dias: [1, 1], hora: "09:00" }, MENSAGEM_DE_DIAS_INVALIDOS],
    ["dia fracionado", { tipo: "semanal", dias: [1.5], hora: "09:00" }, MENSAGEM_DE_DIAS_INVALIDOS],
    ["dias em texto", { tipo: "semanal", dias: "1", hora: "09:00" }, MENSAGEM_DE_DIAS_INVALIDOS],
    ["intervalo de 14 minutos", { tipo: "intervalo", minutos: 14 }, MENSAGEM_DE_INTERVALO_INVALIDO],
    ["intervalo de mais de um ano", { tipo: "intervalo", minutos: 525_601 }, MENSAGEM_DE_INTERVALO_INVALIDO],
    ["intervalo fracionado", { tipo: "intervalo", minutos: 15.5 }, MENSAGEM_DE_INTERVALO_INVALIDO],
    ["intervalo em texto", { tipo: "intervalo", minutos: "30" }, MENSAGEM_DE_INTERVALO_INVALIDO],
    ["data sem hora", { tipo: "uma_vez", em: "2026-12-01" }, MENSAGEM_DE_DATA_INVALIDA],
    ["data que não existe", { tipo: "uma_vez", em: "2026-13-01T09:00:00Z" }, MENSAGEM_DE_DATA_INVALIDA],
    ["data em texto livre", { tipo: "uma_vez", em: "amanhã" }, MENSAGEM_DE_DATA_INVALIDA],
    ["data que não é texto", { tipo: "uma_vez", em: 1_800_000_000_000 }, MENSAGEM_DE_DATA_INVALIDA],
    ["tipo desconhecido", { tipo: "mensal" }, MENSAGEM_DE_GATILHO_INVALIDO],
    ["sem tipo", {}, MENSAGEM_DE_GATILHO_INVALIDO],
    ["nulo", null, MENSAGEM_DE_GATILHO_INVALIDO],
  ])("recusa %s com a mensagem certa", (_caso, dados, mensagem) => {
    const erro = erroDe(() => Gatilho.criar(dadosInvalidos(dados)));

    expect(erro.motivo).toBe("dados_invalidos");
    expect(erro.message).toBe(mensagem);
  });

  it("reconstituir aplica as mesmas regras (um arquivo editado à mão não escapa)", () => {
    expect(erroDe(() => Gatilho.reconstituir({ tipo: "intervalo", minutos: 5 })).message).toBe(MENSAGEM_DE_INTERVALO_INVALIDO);
  });
});

describe("Gatilho como objeto de valor", () => {
  it("é imutável e não se mexe pelas cópias que entrega", () => {
    const original: DadosDoGatilho = { tipo: "semanal", dias: [3, 1], hora: "09:00" };
    const gatilho = Gatilho.criar(original);

    original.dias.push(6);
    const copia = gatilho.paraDados();
    if (copia.tipo === "semanal") {
      copia.dias.push(5);
    }

    expect(Object.isFrozen(gatilho)).toBe(true);
    expect(gatilho.paraDados()).toEqual({ tipo: "semanal", dias: [1, 3], hora: "09:00" });
  });

  it("dois gatilhos com os mesmos dados são iguais; com dados diferentes, não", () => {
    const a = Gatilho.criar({ tipo: "semanal", dias: [3, 1], hora: "09:00" });

    expect(a.igualA(Gatilho.criar({ tipo: "semanal", dias: [1, 3], hora: "09:00" }))).toBe(true);
    expect(a.igualA(Gatilho.criar({ tipo: "semanal", dias: [1, 3], hora: "09:01" }))).toBe(false);
    expect(a.igualA(Gatilho.criar({ tipo: "diario", hora: "09:00" }))).toBe(false);
  });
});
