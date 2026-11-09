import type { SituacaoDoSubagente } from "../api/tipos";
import type { TurnoNaTela } from "./aplicarEvento";
import { estadoDeVida, SILENCIO_PREOCUPANTE_MS, VALIDADE_DO_DIAGNOSTICO_MS } from "./sinalDeVida";

const INICIO = Date.parse("2026-10-28T12:00:00Z");
const em = (segundos: number) => new Date(INICIO + segundos * 1000).toISOString();

function turno(ultimaAtividadeEm: string, subagentes: SituacaoDoSubagente[] = []): TurnoNaTela {
  return {
    id: "t1",
    texto: "",
    anexos: [],
    ultimaAtividadeEm,
    iniciadoEm: em(0),
    encerradoEm: null,
    situacao: "em_andamento",
    configuracao: {
      modeloDoOrquestrador: "opus",
      esforcoDoOrquestrador: "padrao",
      modeloDosSubagentes: "opus",
      esforcoDosSubagentes: "padrao",
      quantidadeDeSubagentes: { modo: "automatica", limite: 3 },
      nivelDePermissao: "leitura",
      permitirCommitEPush: false,
      instrucoesPersonalizadas: "",
    },
    modo: "execucao",
    decisaoDoPlano: null,
    textosDoOrquestrador: [],
    resposta: null,
    motivoDaFalha: null,
    uso: null,
    subagentes: subagentes.map((situacao, indice) => ({
      id: `s${indice}`,
      descricao: "",
      tarefa: "",
      papel: null,
      situacao,
      iniciadoEm: em(0),
      encerradoEm: null,
      atividade: "",
      ultimaFerramenta: null,
      tokens: 0,
      ferramentasUsadas: 0,
      duracaoMs: 0,
      resumo: "",
      resultado: null,
      textos: [],
    })),
    ferramentasDiretas: [],
    permissoesNegadas: [],
    log: [],
  };
}

describe("estadoDeVida", () => {
  it("pensando: mostra os tokens de raciocínio e conta o tempo desde o último sinal", () => {
    const vida = estadoDeVida(turno(em(10)), { turnoId: "t1", em: em(40), tokensPensando: 1200 }, new Date(INICIO + 45_000));

    expect(vida).toEqual({
      ultimoSinalHaMs: 5_000,
      tokensPensando: 1200,
      preocupante: false,
      duracaoMs: 45_000,
      diagnostico: null,
    });
  });

  it("depois de um evento mais novo que o sinal, a contagem de tokens já não vale", () => {
    const vida = estadoDeVida(turno(em(50)), { turnoId: "t1", em: em(40), tokensPensando: 1200 }, new Date(INICIO + 52_000));

    expect(vida.tokensPensando).toBeNull();
    expect(vida.ultimoSinalHaMs).toBe(2_000);
  });

  it("ignora o sinal de outro turno", () => {
    const vida = estadoDeVida(turno(em(0)), { turnoId: "antigo", em: em(100), tokensPensando: 9 }, new Date(INICIO + 101_000));

    expect(vida.tokensPensando).toBeNull();
    expect(vida.ultimoSinalHaMs).toBe(101_000);
  });

  it("pensando, preocupa depois de 90 s de silêncio", () => {
    const limite = SILENCIO_PREOCUPANTE_MS.pensando / 1000;

    expect(estadoDeVida(turno(em(0)), undefined, new Date(INICIO + limite * 1000)).preocupante).toBe(false);
    expect(estadoDeVida(turno(em(0)), undefined, new Date(INICIO + (limite + 1) * 1000)).preocupante).toBe(true);
  });

  it("com subagentes executando, tolera mais silêncio (comandos longos)", () => {
    const tresMinutos = new Date(INICIO + 3 * 60_000);

    expect(estadoDeVida(turno(em(0), ["executando"]), undefined, tresMinutos).preocupante).toBe(false);
    expect(estadoDeVida(turno(em(0)), undefined, tresMinutos).preocupante).toBe(true);
  });

  describe("com o diagnóstico do servidor", () => {
    const trabalhando = { situacao: "trabalhando" as const, resumo: "rodando `npm test` há 6 min" };
    const suspeito = { situacao: "suspeito" as const, resumo: "sem saída há 3 min, sem CPU" };

    it("não conta como notícia nova: o silêncio segue contando do último evento", () => {
      const vida = estadoDeVida(
        turno(em(0)),
        { turnoId: "t1", em: em(120), tokensPensando: 800, diagnostico: trabalhando },
        new Date(INICIO + 125_000),
      );

      expect(vida.ultimoSinalHaMs).toBe(125_000);
      expect(vida.tokensPensando).toBeNull();
      expect(vida.diagnostico).toEqual(trabalhando);
    });

    it("trabalhando não preocupa mesmo além do limite; suspeito preocupa mesmo antes dele", () => {
      const dezMinutos = new Date(INICIO + 10 * 60_000);
      const comTrabalho = estadoDeVida(
        turno(em(0)),
        { turnoId: "t1", em: em(590), tokensPensando: 0, diagnostico: trabalhando },
        dezMinutos,
      );
      expect(comTrabalho.ultimoSinalHaMs).toBe(10 * 60_000);
      expect(comTrabalho.preocupante).toBe(false);

      // Executando, a tela só se preocuparia depois de 5 min; o servidor desconfia antes.
      const doisMinutos = new Date(INICIO + 2 * 60_000);
      const comSuspeita = estadoDeVida(
        turno(em(0), ["executando"]),
        { turnoId: "t1", em: em(115), tokensPensando: 0, diagnostico: suspeito },
        doisMinutos,
      );
      expect(comSuspeita.preocupante).toBe(true);
      expect(comSuspeita.diagnostico).toEqual(suspeito);
    });

    it("um evento depois do diagnóstico, ou um diagnóstico velho, fazem a tela voltar a decidir pelo tempo", () => {
      const depoisDeEvento = estadoDeVida(
        turno(em(130)),
        { turnoId: "t1", em: em(120), tokensPensando: 0, diagnostico: suspeito },
        new Date(INICIO + 135_000),
      );
      expect(depoisDeEvento.diagnostico).toBeNull();
      expect(depoisDeEvento.preocupante).toBe(false);

      const velho = estadoDeVida(
        turno(em(0)),
        { turnoId: "t1", em: em(100), tokensPensando: 0, diagnostico: trabalhando },
        new Date(INICIO + 100_000 + VALIDADE_DO_DIAGNOSTICO_MS + 1_000),
      );
      expect(velho.diagnostico).toBeNull();
      expect(velho.preocupante).toBe(true);
    });
  });
});
