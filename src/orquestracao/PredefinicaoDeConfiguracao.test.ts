import { describe, expect, it } from "vitest";

import { ConfiguracaoDoOrquestrador, DadosDaConfiguracao } from "./ConfiguracaoDoOrquestrador";
import {
  predefinicaoCorrespondente,
  PREDEFINICOES,
  predefinicaoPorNome,
} from "./PredefinicaoDeConfiguracao";

const configuracao = ConfiguracaoDoOrquestrador.de({
  modeloDoOrquestrador: "fable",
  modeloDosSubagentes: "haiku",
  quantidadeDeSubagentes: { modo: "fixa", limite: 4 },
  nivelDePermissao: "edicao_e_comandos",
  permitirCommitEPush: true,
  esforcoDoOrquestrador: "maximo",
  esforcoDosSubagentes: "padrao",
});

function economico() {
  const predefinicao = predefinicaoPorNome("economico");
  if (predefinicao === null) {
    throw new Error("predefinição econômica ausente");
  }
  return predefinicao;
}

describe("PredefinicaoDeConfiguracao", () => {
  it("o catálogo tem o modo econômico e nome desconhecido devolve null", () => {
    expect(PREDEFINICOES.map((predefinicao) => predefinicao.nome)).toEqual(["economico"]);
    expect(economico().rotulo).toBe("Modo econômico");
    expect(predefinicaoPorNome("turbo")).toBeNull();
    expect(predefinicaoPorNome("")).toBeNull();
  });

  it("aplica exatamente os campos do modo econômico e preserva permissão e commit/push", () => {
    const aplicada = economico().aplicarEm(configuracao);

    expect(aplicada.paraDados()).toEqual({
      modeloDoOrquestrador: "opus",
      esforcoDoOrquestrador: "medio",
      modeloDosSubagentes: "sonnet",
      esforcoDosSubagentes: "medio",
      quantidadeDeSubagentes: { modo: "automatica", limite: 1 },
      nivelDePermissao: "edicao_e_comandos",
      permitirCommitEPush: true,
      // Nem os artefatos online: seguem como estavam.
      permitirArtefatosOnline: false,
      // As instruções personalizadas não fazem parte da predefinição: ficam como estavam.
      instrucoesPersonalizadas: "",
      // Nem a escolha dos subagentes prontos.
      subagentesProntos: "todos",
      // Num orquestrador que já era do Claude Code, o motor e a reserva seguem como estavam.
      motorDoOrquestrador: "claude-code",
      motorDosSubagentes: "claude-code",
      ordemDeReserva: [],
    });
    // A configuração de origem não muda (objeto de valor).
    expect(configuracao.modeloDoOrquestrador).toBe("fable");
  });

  it("os modelos dela são do Claude: aplicada sobre outro motor, traz os dois papéis de volta ao Claude Code", () => {
    const noCodex = configuracao.com({
      motorDoOrquestrador: "codex",
      motorDosSubagentes: "copilot",
      ordemDeReserva: ["claude-code", "copilot"],
    });

    const aplicada = economico().aplicarEm(noCodex);

    expect(aplicada.paraDados()).toMatchObject({
      motorDoOrquestrador: "claude-code",
      motorDosSubagentes: "claude-code",
      modeloDoOrquestrador: "opus",
      modeloDosSubagentes: "sonnet",
      // O Claude Code saiu da reserva por ser agora o motor principal.
      ordemDeReserva: ["copilot"],
    });
  });

  it("uma configuração com os papéis em outro motor não corresponde a ela, mesmo com os mesmos campos", () => {
    const aplicada = economico().aplicarEm(configuracao);

    expect(economico().correspondeA(aplicada.com({ motorDoOrquestrador: "codex", modeloDoOrquestrador: "opus" }))).toBe(false);
    expect(economico().correspondeA(aplicada.com({ motorDosSubagentes: "copilot", modeloDosSubagentes: "sonnet" }))).toBe(false);
  });

  it("não mexe no trivial nem no plano em pedidos grandes, que valem sempre (ADR-28)", () => {
    const predefinicao = economico();
    const aplicada = predefinicao.aplicarEm(configuracao);

    expect(Object.keys(predefinicao.alteracoes).sort()).toEqual(
      [
        "esforcoDoOrquestrador",
        "esforcoDosSubagentes",
        "modeloDoOrquestrador",
        "modeloDosSubagentes",
        "quantidadeDeSubagentes",
      ].sort(),
    );
    expect(predefinicao.descricao).not.toMatch(/plano|trivial/i);
    expect(aplicada.propoePlanoEmPedidosGrandes("execucao")).toBe(true);
  });

  it("um orquestrador salvo com o modo econômico antigo (que desligava o plano) continua correspondendo a ele", () => {
    const salvaAntes = ConfiguracaoDoOrquestrador.de(
      JSON.parse(
        JSON.stringify({
          ...economico().aplicarEm(configuracao).paraDados(),
          permitirTrabalhoDireto: true,
          proporPlanoEmPedidosGrandes: false,
        }),
      ) as DadosDaConfiguracao,
    );

    expect(predefinicaoCorrespondente(salvaAntes)).toBe("economico");
    expect(salvaAntes.propoePlanoEmPedidosGrandes("execucao")).toBe(true);
  });

  it("correspondeA é verdadeiro depois de aplicar e falso se um campo dela muda", () => {
    const aplicada = economico().aplicarEm(configuracao);

    expect(economico().correspondeA(configuracao)).toBe(false);
    expect(economico().correspondeA(aplicada)).toBe(true);
    expect(economico().correspondeA(aplicada.com({ nivelDePermissao: "leitura" }))).toBe(true);
    expect(economico().correspondeA(aplicada.com({ esforcoDosSubagentes: "alto" }))).toBe(false);
    expect(
      economico().correspondeA(aplicada.com({ quantidadeDeSubagentes: { modo: "automatica", limite: 2 } })),
    ).toBe(false);
    expect(predefinicaoCorrespondente(aplicada)).toBe("economico");
    expect(predefinicaoCorrespondente(configuracao)).toBeNull();
  });

  it("paraDados devolve uma cópia; a predefinição é imutável", () => {
    const dados = economico().paraDados();
    dados.configuracao.modeloDoOrquestrador = "haiku";

    expect(economico().paraDados().configuracao.modeloDoOrquestrador).toBe("opus");
    expect(economico().paraDados()).toMatchObject({ nome: "economico", rotulo: "Modo econômico" });
    expect(Object.isFrozen(economico())).toBe(true);
    expect(Object.isFrozen(economico().alteracoes)).toBe(true);
  });
});
