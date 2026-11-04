import { describe, expect, it } from "vitest";

import { ConfiguracaoDoOrquestrador } from "./ConfiguracaoDoOrquestrador";
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
  permitirTrabalhoDireto: false,
  proporPlanoEmPedidosGrandes: true,
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
      permitirTrabalhoDireto: true,
      proporPlanoEmPedidosGrandes: false,
      nivelDePermissao: "edicao_e_comandos",
      permitirCommitEPush: true,
    });
    // A configuração de origem não muda (objeto de valor).
    expect(configuracao.modeloDoOrquestrador).toBe("fable");
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
