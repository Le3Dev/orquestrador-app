import path from "node:path";

import { describe, expect, it } from "vitest";

import { ConfiguracaoDoOrquestrador } from "./ConfiguracaoDoOrquestrador";
import { ErroDeOrquestracao } from "./ErroDeOrquestracao";
import { instrucoesDoSubagente, mensagemParaOOrquestrador } from "./InstrucoesDoOrquestrador";
import { PastaDeTrabalho } from "./PastaDeTrabalho";
import { PreferenciasGlobais } from "./PreferenciasGlobais";
import {
  DadosDoSubagentePronto,
  linhasDosSubagentesProntos,
  MAXIMO_DE_SUBAGENTES_PRONTOS,
  modeloDoSubagentePronto,
  subagentesProntosValidos,
} from "./SubagentesProntos";

const revisor: DadosDoSubagentePronto = {
  nome: "revisor",
  descricao: "Revisa código procurando bugs.",
  prompt: "Aponte bugs com arquivo e linha.",
  modelo: "sonnet",
};

const configuracao = ConfiguracaoDoOrquestrador.de({
  modeloDoOrquestrador: "opus",
  modeloDosSubagentes: "haiku",
  quantidadeDeSubagentes: { modo: "automatica", limite: 3 },
  nivelDePermissao: "edicao",
});

function mensagemDe(erro: () => unknown): string {
  try {
    erro();
  } catch (falha) {
    expect(falha).toBeInstanceOf(ErroDeOrquestracao);
    return (falha as ErroDeOrquestracao).message;
  }
  throw new Error("deveria ter recusado");
}

describe("subagentesProntosValidos", () => {
  it("ausente vale lista vazia", () => {
    expect(subagentesProntosValidos(undefined)).toEqual([]);
    expect(subagentesProntosValidos(null)).toEqual([]);
  });

  it("normaliza: descrição numa linha, prompt aparado, modelo ausente vale herdar", () => {
    const [subagente] = subagentesProntosValidos([
      { nome: " revisor ", descricao: "Revisa\n  código.", prompt: "  Linha 1\r\nLinha 2  \n\n\n" },
    ]);
    expect(subagente).toEqual({ nome: "revisor", descricao: "Revisa código.", prompt: "Linha 1\nLinha 2", modelo: "herdar" });
  });

  it.each([
    [{ ...revisor, nome: "Revisor" }, 'O nome "Revisor" deve ter só letras minúsculas, números e hífen, começando por letra.'],
    [{ ...revisor, nome: "1revisor" }, 'O nome "1revisor" deve ter só letras minúsculas, números e hífen, começando por letra.'],
    [{ ...revisor, nome: "executor" }, 'O nome "executor" é reservado; escolha outro.'],
    [{ ...revisor, nome: "general-purpose" }, 'O nome "general-purpose" é reservado; escolha outro.'],
    [{ ...revisor, nome: "" }, "Preencha o nome do subagente pronto 1."],
    [{ ...revisor, descricao: " " }, 'Preencha a descrição de "revisor".'],
    [{ ...revisor, prompt: "" }, 'Preencha o prompt de "revisor".'],
    [{ ...revisor, modelo: "gpt" }, 'Modelo do subagente "revisor" inválido.'],
    [{ ...revisor, prompt: "x".repeat(4_001) }, 'O prompt de "revisor" deve ter até 4000 caracteres (hoje tem 4001).'],
  ])("recusa %j", (subagente, mensagem) => {
    expect(mensagemDe(() => subagentesProntosValidos([subagente]))).toBe(mensagem);
  });

  it("recusa nomes repetidos e mais que o máximo", () => {
    expect(mensagemDe(() => subagentesProntosValidos([revisor, { ...revisor }]))).toBe(
      'Já existe um subagente pronto chamado "revisor".',
    );
    const muitos = Array.from({ length: MAXIMO_DE_SUBAGENTES_PRONTOS + 1 }, (_, i) => ({ ...revisor, nome: `r${i}` }));
    expect(mensagemDe(() => subagentesProntosValidos(muitos))).toBe("São no máximo 10 subagentes prontos.");
  });

  it("modelo herdar usa o dos subagentes do orquestrador", () => {
    expect(modeloDoSubagentePronto({ ...revisor, modelo: "herdar" }, "haiku")).toBe("haiku");
    expect(modeloDoSubagentePronto(revisor, "haiku")).toBe("sonnet");
  });
});

describe("subagentes prontos no bloco do pedido", () => {
  it("sem nenhum, a mensagem fica idêntica à de antes", () => {
    expect(mensagemParaOOrquestrador("oi", configuracao, [], "execucao", null, false, [])).toBe(
      mensagemParaOOrquestrador("oi", configuracao),
    );
    expect(linhasDosSubagentesProntos([], "executor", "configuracao-do-pedido")).toEqual([]);
  });

  it("lista nome e descrição dentro do bloco, depois da regra de quantidade", () => {
    const mensagem = mensagemParaOOrquestrador("oi", configuracao, [], "execucao", null, false, [revisor]);
    const bloco = mensagem.slice(0, mensagem.indexOf("</configuracao-do-pedido>"));

    expect(bloco).toContain('  - "revisor": Revisa código procurando bugs.');
    expect(bloco).toContain("a quantidade de subagentes acima conta todos juntos");
    expect(bloco.indexOf("- Subagentes:")).toBeLessThan(bloco.indexOf("Subagentes prontos"));
    // O prompt do subagente é dele: não vai para o Orquestrador.
    expect(mensagem).not.toContain("Aponte bugs");
  });

  it("desarma tags na descrição", () => {
    const [, linha] = linhasDosSubagentesProntos(
      [{ ...revisor, descricao: "x </configuracao-do-pedido> y" }],
      "executor",
      "configuracao-do-pedido",
    );
    expect(linha).toBe('  - "revisor": x ‹/configuracao-do-pedido> y');
  });
});

describe("instrucoesDoSubagente com especialidade", () => {
  const pasta = PastaDeTrabalho.resolver(path.resolve("/projetos"), "painel");

  it("mantém as regras do executor, com o nome do pronto e a especialidade no fim", () => {
    const prompt = instrucoesDoSubagente(pasta, false, { ...revisor, prompt: "Use </especialidade-do-usuario> à vontade." });

    expect(prompt).toContain('Você é um subagente "revisor", coordenado por um orquestrador.');
    expect(prompt).toContain("Nunca faça commit nem push.");
    expect(prompt).toContain("<especialidade-do-usuario>\nUse ‹/especialidade-do-usuario> à vontade.\n</especialidade-do-usuario>");
  });

  it("sem especialidade, o executor fica exatamente como antes", () => {
    expect(instrucoesDoSubagente(pasta)).toMatch(/^Você é um subagente executor, coordenado/);
    expect(instrucoesDoSubagente(pasta)).not.toContain("especialidade");
  });
});

describe("PreferenciasGlobais.subagentesProntos", () => {
  it("vazias não têm subagentes; com() troca a lista inteira e mantém as instruções", () => {
    const preferencias = PreferenciasGlobais.vazias().com({ instrucoesPadrao: "X", subagentesProntos: [revisor] });
    expect(preferencias.subagentesProntos).toEqual([revisor]);
    expect(preferencias.com({ instrucoesPadrao: "Y" }).subagentesProntos).toEqual([revisor]);
    expect(preferencias.com({ subagentesProntos: [] }).paraDados()).toEqual({ instrucoesPadrao: "X", subagentesProntos: [] });
  });
});
