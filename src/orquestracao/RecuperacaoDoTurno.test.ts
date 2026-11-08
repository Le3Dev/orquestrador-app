import { describe, expect, it } from "vitest";

import {
  descreverEsperas,
  ehRecuperavel,
  ESPERA_MAXIMA_MS,
  esperaAntesDaTentativa,
  formatarDuracao,
  maximoDeTentativas,
  mensagemDeRetomada,
  resumoDaEspera,
} from "./RecuperacaoDoTurno";

const SEGUNDO = 1_000;
const MINUTO = 60 * SEGUNDO;
const agora = new Date("2026-11-08T12:00:00Z");

describe("ehRecuperavel", () => {
  it("aceita silêncio, limite de uso, sobrecarga e rede", () => {
    expect(ehRecuperavel("silencio")).toBe(true);
    expect(ehRecuperavel("limite_de_uso")).toBe(true);
    expect(ehRecuperavel("sobrecarga")).toBe(true);
    expect(ehRecuperavel("rede")).toBe(true);
  });

  it("recusa outra causa e a ausência de causa", () => {
    expect(ehRecuperavel("outro")).toBe(false);
    expect(ehRecuperavel(undefined)).toBe(false);
  });
});

describe("maximoDeTentativas", () => {
  it("silêncio tenta 2 vezes; sobrecarga, rede e limite de uso, 3", () => {
    expect(maximoDeTentativas("silencio")).toBe(2);
    expect(maximoDeTentativas("sobrecarga")).toBe(3);
    expect(maximoDeTentativas("rede")).toBe(3);
    expect(maximoDeTentativas("limite_de_uso")).toBe(3);
  });
});

describe("esperaAntesDaTentativa", () => {
  it("silêncio espera 30 s e depois 2 min", () => {
    expect(esperaAntesDaTentativa("silencio", 1, null, agora)).toBe(30 * SEGUNDO);
    expect(esperaAntesDaTentativa("silencio", 2, null, agora)).toBe(2 * MINUTO);
  });

  it("sobrecarga e rede esperam 1, 3 e 5 min", () => {
    for (const causa of ["sobrecarga", "rede"] as const) {
      expect(esperaAntesDaTentativa(causa, 1, null, agora)).toBe(1 * MINUTO);
      expect(esperaAntesDaTentativa(causa, 2, null, agora)).toBe(3 * MINUTO);
      expect(esperaAntesDaTentativa(causa, 3, null, agora)).toBe(5 * MINUTO);
    }
  });

  it("depois da última tentativa repete a maior espera, e tentativa 0 usa a primeira", () => {
    expect(esperaAntesDaTentativa("silencio", 3, null, agora)).toBe(2 * MINUTO);
    expect(esperaAntesDaTentativa("rede", 9, null, agora)).toBe(5 * MINUTO);
    expect(esperaAntesDaTentativa("sobrecarga", 0, null, agora)).toBe(1 * MINUTO);
  });

  it("limite de uso espera até liberar mais 1 min, em qualquer tentativa", () => {
    const liberaEm = new Date(agora.getTime() + 2 * 60 * MINUTO).toISOString();
    expect(esperaAntesDaTentativa("limite_de_uso", 1, liberaEm, agora)).toBe(2 * 60 * MINUTO + MINUTO);
    expect(esperaAntesDaTentativa("limite_de_uso", 3, liberaEm, agora)).toBe(2 * 60 * MINUTO + MINUTO);
  });

  it("limite de uso já liberado espera só o que falta da folga, nunca negativo", () => {
    const ha30s = new Date(agora.getTime() - 30 * SEGUNDO).toISOString();
    const ha1h = new Date(agora.getTime() - 60 * MINUTO).toISOString();
    expect(esperaAntesDaTentativa("limite_de_uso", 1, ha30s, agora)).toBe(30 * SEGUNDO);
    expect(esperaAntesDaTentativa("limite_de_uso", 1, ha1h, agora)).toBe(0);
  });

  it("limite de uso sem horário (ou com horário ilegível) espera 15 min", () => {
    expect(esperaAntesDaTentativa("limite_de_uso", 1, null, agora)).toBe(15 * MINUTO);
    expect(esperaAntesDaTentativa("limite_de_uso", 2, "amanhã cedo", agora)).toBe(15 * MINUTO);
  });

  it("limite de uso muito distante para no teto do setTimeout", () => {
    const daqui60Dias = new Date(agora.getTime() + 60 * 24 * 60 * MINUTO).toISOString();
    expect(esperaAntesDaTentativa("limite_de_uso", 1, daqui60Dias, agora)).toBe(ESPERA_MAXIMA_MS);
    expect(ESPERA_MAXIMA_MS).toBe(2_147_483_647);
  });
});

describe("descreverEsperas e formatarDuracao", () => {
  it("descreve as esperas de cada causa", () => {
    expect(descreverEsperas("silencio")).toBe("com esperas de 30 s, 2 min");
    expect(descreverEsperas("rede")).toBe("com esperas de 1 min, 3 min, 5 min");
    expect(descreverEsperas("limite_de_uso")).toBe("esperando a liberação do limite a cada vez");
  });

  it("formata segundos, minutos e horas", () => {
    expect(formatarDuracao(-5)).toBe("0 s");
    expect(formatarDuracao(45 * SEGUNDO)).toBe("45 s");
    expect(formatarDuracao(3 * MINUTO)).toBe("3 min");
    expect(formatarDuracao(2 * 60 * MINUTO)).toBe("2 h");
    expect(formatarDuracao(2 * 60 * MINUTO + 5 * MINUTO)).toBe("2 h 5 min");
  });
});

describe("resumoDaEspera", () => {
  // Datas no fuso local, para a hora formatada não depender do fuso da máquina.
  const retomaEm = new Date(2026, 10, 8, 14, 30);

  it("mostra quando retoma, ou quando o limite libera", () => {
    expect(resumoDaEspera("silencio", null, retomaEm)).toBe("o Claude ficou sem dar notícias; retoma às 14:30");
    expect(resumoDaEspera("rede", null, retomaEm)).toBe("falha de rede; tenta de novo às 14:30");
    expect(resumoDaEspera("limite_de_uso", new Date(2026, 10, 8, 9, 5).toISOString(), retomaEm)).toBe(
      "limite de uso, libera às 09:05",
    );
    expect(resumoDaEspera("limite_de_uso", null, retomaEm)).toBe(
      "limite de uso, sem horário de liberação; tenta de novo às 14:30",
    );
  });
});

describe("mensagemDeRetomada", () => {
  const fim =
    "Confira o estado atual da worktree e do que já foi feito, sem desfazer nada, e continue de onde parou. " +
    "Se a tarefa já estiver concluída, apenas resuma o resultado.";

  it("explica a interrupção de cada causa e pede para continuar sem desfazer", () => {
    expect(mensagemDeRetomada("silencio", true)).toBe(
      `Você foi interrompido pelo app porque ficou sem dar notícias. ${fim}`,
    );
    expect(mensagemDeRetomada("limite_de_uso", true)).toBe(
      `Você foi interrompido porque o limite de uso da assinatura foi atingido (ele já foi liberado). ${fim}`,
    );
    expect(mensagemDeRetomada("sobrecarga", true)).toBe(
      `Você foi interrompido porque a API do Claude estava sobrecarregada. ${fim}`,
    );
    expect(mensagemDeRetomada("rede", true)).toBe(`Você foi interrompido por uma falha de rede. ${fim}`);
  });

  it("fala da pasta de trabalho quando não há worktree", () => {
    expect(mensagemDeRetomada("rede", false)).toBe(
      "Você foi interrompido por uma falha de rede. Confira o estado atual da pasta de trabalho e do que já foi feito, " +
        "sem desfazer nada, e continue de onde parou. Se a tarefa já estiver concluída, apenas resuma o resultado.",
    );
  });
});
