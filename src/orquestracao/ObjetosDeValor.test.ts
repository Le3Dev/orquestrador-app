import path from "node:path";

import { describe, expect, it } from "vitest";

import { ConfiguracaoDoOrquestrador, DadosDaConfiguracao } from "./ConfiguracaoDoOrquestrador";
import { ErroDeOrquestracao } from "./ErroDeOrquestracao";
import { ESFORCOS_DE_RACIOCINIO } from "./EsforcoDeRaciocinio";
import {
  instrucoesDoOrquestrador,
  mensagemDeAprovacaoDoPlano,
  mensagemParaOOrquestrador,
} from "./InstrucoesDoOrquestrador";
import { DESCRICAO_DO_NIVEL } from "./NivelDePermissao";
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

describe("ConfiguracaoDoOrquestrador", () => {
  const dados = {
    modeloDoOrquestrador: "opus",
    modeloDosSubagentes: "haiku",
    quantidadeDeSubagentes: { modo: "fixa", limite: 2 },
    nivelDePermissao: "edicao_e_comandos",
  } as const;
  const esforcosPadrao = { esforcoDoOrquestrador: "padrao", esforcoDosSubagentes: "padrao" } as const;

  it("nasce com commit e push desligados quando a opção não é informada", () => {
    const configuracao = ConfiguracaoDoOrquestrador.de(dados);

    expect(configuracao.permitirCommitEPush).toBe(false);
    expect(configuracao.paraDados()).toEqual({ ...dados, permitirCommitEPush: false, ...esforcosPadrao });
  });

  it("reconstitui dados gravados antes da opção existir como desligada", () => {
    const gravados = JSON.parse(JSON.stringify(dados)) as typeof dados;

    expect(ConfiguracaoDoOrquestrador.de(gravados).paraDados().permitirCommitEPush).toBe(false);
  });

  it("altera só a opção informada e mantém o resto", () => {
    const ligada = ConfiguracaoDoOrquestrador.de(dados).com({ permitirCommitEPush: true });

    expect(ligada.paraDados()).toEqual({ ...dados, permitirCommitEPush: true, ...esforcosPadrao });
    expect(ligada.com({ nivelDePermissao: "edicao" }).permitirCommitEPush).toBe(true);
    expect(ligada.com({ permitirCommitEPush: undefined }).permitirCommitEPush).toBe(true);
  });

  it("recusa valor que não é verdadeiro ou falso", () => {
    const invalido = { ...dados, permitirCommitEPush: "sim" as unknown as boolean };

    expect(() => ConfiguracaoDoOrquestrador.de(invalido)).toThrow(ErroDeOrquestracao);
  });

  it("só libera commit e push com a opção ligada e num turno de execução", () => {
    const ligada = ConfiguracaoDoOrquestrador.de({ ...dados, permitirCommitEPush: true });
    const desligada = ConfiguracaoDoOrquestrador.de(dados);

    expect(ligada.permiteCommitEPush("execucao")).toBe(true);
    expect(ligada.permiteCommitEPush("planejamento")).toBe(false);
    expect(desligada.permiteCommitEPush("execucao")).toBe(false);
  });

  describe("esforço de raciocínio", () => {
    it("nasce com o esforço padrão nos dois papéis quando não é informado", () => {
      const configuracao = ConfiguracaoDoOrquestrador.de(dados);

      expect(configuracao.esforcoDoOrquestrador).toBe("padrao");
      expect(configuracao.esforcoDosSubagentes).toBe("padrao");
      expect(configuracao.paraDados()).toMatchObject(esforcosPadrao);
    });

    it("reconstitui dados gravados antes da opção existir com o esforço padrão", () => {
      const gravados = JSON.parse(JSON.stringify({ ...dados, permitirCommitEPush: true })) as typeof dados;

      expect(ConfiguracaoDoOrquestrador.de(gravados).paraDados()).toMatchObject(esforcosPadrao);
    });

    it.each(ESFORCOS_DE_RACIOCINIO)("aceita o esforço %s nos dois papéis", (esforco) => {
      const configuracao = ConfiguracaoDoOrquestrador.de({
        ...dados,
        esforcoDoOrquestrador: esforco,
        esforcoDosSubagentes: esforco,
      });

      expect(configuracao.paraDados()).toMatchObject({ esforcoDoOrquestrador: esforco, esforcoDosSubagentes: esforco });
    });

    it("altera só o esforço informado e mantém o resto", () => {
      const alta = ConfiguracaoDoOrquestrador.de(dados).com({ esforcoDoOrquestrador: "alto" });

      expect(alta.esforcoDoOrquestrador).toBe("alto");
      expect(alta.esforcoDosSubagentes).toBe("padrao");
      expect(alta.com({ esforcoDosSubagentes: "maximo" }).paraDados()).toMatchObject({
        esforcoDoOrquestrador: "alto",
        esforcoDosSubagentes: "maximo",
      });
      expect(alta.com({ esforcoDoOrquestrador: undefined }).esforcoDoOrquestrador).toBe("alto");
    });

    it.each<[string, Record<string, unknown>, string]>([
      ["do orquestrador", { esforcoDoOrquestrador: "turbo" }, "Esforço do orquestrador inválido."],
      ["dos subagentes", { esforcoDosSubagentes: "high" }, "Esforço dos subagentes inválido."],
      ["dos subagentes", { esforcoDosSubagentes: 3 }, "Esforço dos subagentes inválido."],
    ])("recusa esforço inválido %s com mensagem clara", (_papel, invalido, mensagem) => {
      const dadosInvalidos = { ...dados, ...invalido } as unknown as DadosDaConfiguracao;

      expect(() => ConfiguracaoDoOrquestrador.de(dadosInvalidos)).toThrow(new ErroDeOrquestracao("dados_invalidos", mensagem));
    });
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

  it("deixa commit e push para o bloco do pedido, proibidos sem ele", () => {
    const texto = instrucoesDoOrquestrador(pasta);

    expect(texto).toContain(
      "Commits e push seguem a permissão do bloco <configuracao-do-pedido> mais recente; sem o bloco, são proibidos.",
    );
    expect(texto).not.toContain("sempre proibidos");
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

  it("no planejamento trava em leitura, pede um plano e diz o que valerá na execução", () => {
    const configuracao = ConfiguracaoDoOrquestrador.de({
      ...base,
      nivelDePermissao: "edicao_e_comandos",
      quantidadeDeSubagentes: { modo: "automatica", limite: 3 },
    });
    const texto = mensagemParaOOrquestrador("migre o banco", configuracao, [], "planejamento");
    const bloco = texto.slice(0, texto.indexOf("</configuracao-do-pedido>"));

    expect(bloco).toContain("PLANEJAMENTO");
    expect(bloco).toContain(`- Permissões: ${DESCRICAO_DO_NIVEL.leitura}.`);
    expect(bloco).toContain(`Na execução valerá: ${DESCRICAO_DO_NIVEL.edicao_e_comandos}.`);
    expect(bloco).toContain("aprovar, ajustar ou descartar");
    expect(texto.endsWith("\n\nmigre o banco")).toBe(true);
  });

  it("na execução não fala de planejamento", () => {
    const configuracao = ConfiguracaoDoOrquestrador.de({
      ...base,
      nivelDePermissao: "edicao",
      quantidadeDeSubagentes: { modo: "fixa", limite: 1 },
    });
    const texto = mensagemParaOOrquestrador("corrija", configuracao);

    expect(texto).not.toContain("PLANEJAMENTO");
    expect(texto).toContain(`- Permissões: ${DESCRICAO_DO_NIVEL.edicao}.`);
  });

  describe("regra de commit e push", () => {
    const PROIBIDOS = "Commits e push são sempre proibidos.";
    const QUANDO_PEDIDOS =
      "Commits e push: permitidos somente quando o usuário pedir explicitamente nesta mensagem. Nunca commitar direto na main; usar branch conforme a política (feature/, fix/, hotfix/, refactor/). Nunca adicionar a linha Co-authored-by.";

    function bloco(permitirCommitEPush: boolean, modo: "execucao" | "planejamento"): string {
      const configuracao = ConfiguracaoDoOrquestrador.de({
        ...base,
        nivelDePermissao: "edicao_e_comandos",
        quantidadeDeSubagentes: { modo: "fixa", limite: 1 },
        permitirCommitEPush,
      });
      const texto = mensagemParaOOrquestrador("faça o commit", configuracao, [], modo);
      return texto.slice(0, texto.indexOf("</configuracao-do-pedido>"));
    }

    it("com a opção desligada, proíbe sempre", () => {
      const texto = bloco(false, "execucao");

      expect(texto).toContain(`- Permissões: ${DESCRICAO_DO_NIVEL.edicao_e_comandos}. ${PROIBIDOS}`);
      expect(texto).not.toContain("permitidos somente");
    });

    it("com a opção ligada, permite só quando o usuário pedir nesta mensagem", () => {
      const texto = bloco(true, "execucao");

      expect(texto).toContain(`- Permissões: ${DESCRICAO_DO_NIVEL.edicao_e_comandos}. ${QUANDO_PEDIDOS}`);
      expect(texto).not.toContain(PROIBIDOS);
    });

    it("com a opção ligada, no planejamento continua proibindo", () => {
      const texto = bloco(true, "planejamento");

      expect(texto).toContain(PROIBIDOS);
      expect(texto).not.toContain("permitidos somente");
    });
  });
});

describe("mensagemDeAprovacaoDoPlano", () => {
  it("manda executar o plano anterior e só cita observações quando houver", () => {
    expect(mensagemDeAprovacaoDoPlano("  ")).toBe(
      "Plano aprovado. Execute agora o plano da sua resposta anterior, delegando as subtarefas como planejado.",
    );
    expect(mensagemDeAprovacaoDoPlano(" use a branch nova ")).toMatch(
      /delegando as subtarefas como planejado\.\n\nObservações do usuário: use a branch nova$/,
    );
  });
});
