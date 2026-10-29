import path from "node:path";

import { describe, expect, it } from "vitest";

import { ConfiguracaoDoOrquestrador } from "./ConfiguracaoDoOrquestrador";
import { ErroDeOrquestracao } from "./ErroDeOrquestracao";
import { instrucoesDoOrquestrador, mensagemParaOOrquestrador } from "./InstrucoesDoOrquestrador";
import { PastaDeTrabalho } from "./PastaDeTrabalho";
import { LIMITE_DE_SUBAGENTES, QuantidadeDeSubagentes } from "./QuantidadeDeSubagentes";

const raiz = path.resolve("/projetos");

describe("QuantidadeDeSubagentes", () => {
  it("aceita de 1 até o limite, nos dois modos", () => {
    expect(QuantidadeDeSubagentes.fixa(1).paraDados()).toEqual({ modo: "fixa", limite: 1 });
    expect(QuantidadeDeSubagentes.automatica(LIMITE_DE_SUBAGENTES).limite).toBe(LIMITE_DE_SUBAGENTES);
  });

  it.each([0, -1, 2.5, LIMITE_DE_SUBAGENTES + 1, Number.NaN])("recusa %s", (valor) => {
    expect(() => QuantidadeDeSubagentes.fixa(valor)).toThrow(ErroDeOrquestracao);
  });
});

describe("PastaDeTrabalho", () => {
  it("resolve caminhos relativos a partir da raiz", () => {
    const pasta = PastaDeTrabalho.dentroDe(raiz, "salasdereuniao-painel-app");

    expect(pasta.caminho).toBe(path.join(raiz, "salasdereuniao-painel-app"));
    expect(pasta.nome).toBe("salasdereuniao-painel-app");
  });

  it("aceita caminho absoluto dentro da raiz e a própria raiz", () => {
    expect(PastaDeTrabalho.dentroDe(raiz, path.join(raiz, "a", "b")).caminho).toBe(path.join(raiz, "a", "b"));
    expect(PastaDeTrabalho.dentroDe(raiz, raiz).caminho).toBe(raiz);
  });

  it.each(["..", path.join("..", "Windows"), path.join("app", "..", "..", "outro"), path.resolve("/fora")])(
    "recusa %s, que sai da raiz",
    (caminho) => {
      expect(() => PastaDeTrabalho.dentroDe(raiz, caminho)).toThrow(/fora de/);
    },
  );

  it("não confunde uma pasta cujo nome começa com '..' com sair da raiz", () => {
    expect(PastaDeTrabalho.dentroDe(raiz, "..rascunho").nome).toBe("..rascunho");
  });

  it("recusa pasta vazia", () => {
    expect(() => PastaDeTrabalho.dentroDe(raiz, "  ")).toThrow(/Informe/);
  });
});

describe("instrucoesDoOrquestrador", () => {
  const pasta = PastaDeTrabalho.dentroDe(raiz, "painel");

  it("traz as regras fixas e a pasta, sem a configuração — que muda entre pedidos", () => {
    const texto = instrucoesDoOrquestrador(pasta);

    expect(texto).toContain(pasta.caminho);
    expect(texto).toContain("<configuracao-do-pedido>");
    expect(texto).not.toMatch(/exatamente \d|no máximo \d/);
  });
});

describe("mensagemParaOOrquestrador", () => {
  const pasta = PastaDeTrabalho.dentroDe(raiz, "painel");
  const base = {
    modeloDoOrquestrador: "opus",
    modeloDosSubagentes: "opus",
    nivelDePermissao: "leitura",
  } as const;

  it("no modo fixo exige o número exato de subagentes", () => {
    const configuracao = ConfiguracaoDoOrquestrador.de({ ...base, quantidadeDeSubagentes: { modo: "fixa", limite: 4 } });

    expect(mensagemParaOOrquestrador("analise", configuracao)).toContain("exatamente 4 subagentes");
  });

  it("no modo automático informa o máximo", () => {
    const configuracao = ConfiguracaoDoOrquestrador.de({
      ...base,
      quantidadeDeSubagentes: { modo: "automatica", limite: 3 },
    });
    const texto = mensagemParaOOrquestrador("analise", configuracao);

    expect(texto).toContain("no máximo 3");
    expect(texto).not.toContain("exatamente");
  });

  it("declara que substitui configurações anteriores, descreve a permissão e termina com o pedido", () => {
    const configuracao = ConfiguracaoDoOrquestrador.de({ ...base, quantidadeDeSubagentes: { modo: "fixa", limite: 1 } });
    const texto = mensagemParaOOrquestrador("liste os testes", configuracao);

    expect(texto).toMatch(/^<configuracao-do-pedido>/);
    expect(texto).toContain("substitui qualquer quantidade");
    expect(texto).toContain("só podem ler arquivos");
    expect(texto).toContain("exatamente 1 subagente ");
    expect(texto.endsWith("\n\nliste os testes")).toBe(true);
    expect(texto).not.toContain(pasta.caminho);
  });
});
