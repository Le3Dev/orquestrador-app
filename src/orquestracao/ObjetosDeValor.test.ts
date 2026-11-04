import path from "node:path";

import { describe, expect, it } from "vitest";

import { ConfiguracaoDoOrquestrador, DadosDaConfiguracao } from "./ConfiguracaoDoOrquestrador";
import { ErroDeOrquestracao } from "./ErroDeOrquestracao";
import { ESFORCOS_DE_RACIOCINIO } from "./EsforcoDeRaciocinio";
import {
  instrucoesDoOrquestrador,
  MARCADOR_DE_PLANO,
  mensagemDeAprovacaoDoPlano,
  mensagemParaOOrquestrador,
  separarPropostaDePlano,
} from "./InstrucoesDoOrquestrador";
import { ehModeloClaude, MODELOS_CLAUDE } from "./ModeloClaude";
import { ModoDoTurno } from "./ModoDoTurno";
import { DESCRICAO_DO_NIVEL, NivelDePermissao, TRABALHO_DIRETO_NO_NIVEL } from "./NivelDePermissao";
import { PastaDeTrabalho } from "./PastaDeTrabalho";
import { LIMITE_DE_SUBAGENTES, QuantidadeDeSubagentes } from "./QuantidadeDeSubagentes";

const raiz = path.resolve("/projetos");

describe("ModeloClaude", () => {
  it("aceita fable, opus, sonnet e haiku", () => {
    expect(MODELOS_CLAUDE).toEqual(["fable", "opus", "sonnet", "haiku"]);
    for (const modelo of MODELOS_CLAUDE) {
      expect(ehModeloClaude(modelo)).toBe(true);
    }
  });

  it.each(["claude-opus-4", "Opus", "", null, 3])("recusa %s", (valor) => {
    expect(ehModeloClaude(valor)).toBe(false);
  });

  it("vale para os orquestradores: aceita fable na configuração", () => {
    const configuracao = ConfiguracaoDoOrquestrador.de({
      modeloDoOrquestrador: "fable",
      modeloDosSubagentes: "fable",
      quantidadeDeSubagentes: { modo: "fixa", limite: 1 },
      nivelDePermissao: "leitura",
    });
    expect(configuracao.paraDados().modeloDoOrquestrador).toBe("fable");
  });
});

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
  const opcoesDeTrabalhoPadrao = { permitirTrabalhoDireto: true, proporPlanoEmPedidosGrandes: true } as const;

  it("nasce com commit e push desligados quando a opção não é informada", () => {
    const configuracao = ConfiguracaoDoOrquestrador.de(dados);

    expect(configuracao.permitirCommitEPush).toBe(false);
    expect(configuracao.paraDados()).toEqual({
      ...dados,
      permitirCommitEPush: false,
      ...esforcosPadrao,
      ...opcoesDeTrabalhoPadrao,
    });
  });

  it("reconstitui dados gravados antes da opção existir como desligada", () => {
    const gravados = JSON.parse(JSON.stringify(dados)) as typeof dados;

    expect(ConfiguracaoDoOrquestrador.de(gravados).paraDados().permitirCommitEPush).toBe(false);
  });

  it("altera só a opção informada e mantém o resto", () => {
    const ligada = ConfiguracaoDoOrquestrador.de(dados).com({ permitirCommitEPush: true });

    expect(ligada.paraDados()).toEqual({
      ...dados,
      permitirCommitEPush: true,
      ...esforcosPadrao,
      ...opcoesDeTrabalhoPadrao,
    });
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

  describe("trabalho direto e plano em pedidos grandes", () => {
    it("nasce com as duas opções ligadas quando não são informadas", () => {
      const configuracao = ConfiguracaoDoOrquestrador.de(dados);

      expect(configuracao.permitirTrabalhoDireto).toBe(true);
      expect(configuracao.proporPlanoEmPedidosGrandes).toBe(true);
      expect(configuracao.paraDados()).toMatchObject(opcoesDeTrabalhoPadrao);
    });

    it("reconstitui dados gravados antes das opções existirem com as duas ligadas", () => {
      const gravados = JSON.parse(
        JSON.stringify({ ...dados, permitirCommitEPush: true, ...esforcosPadrao }),
      ) as DadosDaConfiguracao;

      expect(gravados).not.toHaveProperty("permitirTrabalhoDireto");
      expect(ConfiguracaoDoOrquestrador.de(gravados).paraDados()).toMatchObject(opcoesDeTrabalhoPadrao);
    });

    it("aceita as opções desligadas e as devolve em paraDados", () => {
      const desligadas = ConfiguracaoDoOrquestrador.de({
        ...dados,
        permitirTrabalhoDireto: false,
        proporPlanoEmPedidosGrandes: false,
      });

      expect(desligadas.paraDados()).toMatchObject({ permitirTrabalhoDireto: false, proporPlanoEmPedidosGrandes: false });
    });

    it("altera só a opção informada e mantém o resto", () => {
      const semTrabalhoDireto = ConfiguracaoDoOrquestrador.de(dados).com({ permitirTrabalhoDireto: false });

      expect(semTrabalhoDireto.permitirTrabalhoDireto).toBe(false);
      expect(semTrabalhoDireto.proporPlanoEmPedidosGrandes).toBe(true);
      expect(semTrabalhoDireto.com({ nivelDePermissao: "edicao" }).permitirTrabalhoDireto).toBe(false);
      expect(semTrabalhoDireto.com({ permitirTrabalhoDireto: undefined }).permitirTrabalhoDireto).toBe(false);
      expect(semTrabalhoDireto.com({ proporPlanoEmPedidosGrandes: false }).paraDados()).toMatchObject({
        permitirTrabalhoDireto: false,
        proporPlanoEmPedidosGrandes: false,
      });
    });

    it.each<[string, Record<string, unknown>, string]>([
      [
        "permitirTrabalhoDireto",
        { permitirTrabalhoDireto: "sim" },
        'A opção "Deixar o orquestrador fazer o trivial sozinho" deve ser verdadeira ou falsa.',
      ],
      [
        "proporPlanoEmPedidosGrandes",
        { proporPlanoEmPedidosGrandes: 1 },
        'A opção "Propor plano antes de mudanças grandes" deve ser verdadeira ou falsa.',
      ],
    ])("recusa %s que não é verdadeiro ou falso, com mensagem clara", (_campo, invalido, mensagem) => {
      const dadosInvalidos = { ...dados, ...invalido } as unknown as DadosDaConfiguracao;

      expect(() => ConfiguracaoDoOrquestrador.de(dadosInvalidos)).toThrow(new ErroDeOrquestracao("dados_invalidos", mensagem));
    });

    it("só propõe plano em pedidos grandes com a opção ligada e num turno de execução", () => {
      const ligada = ConfiguracaoDoOrquestrador.de(dados);
      const desligada = ligada.com({ proporPlanoEmPedidosGrandes: false });

      expect(ligada.propoePlanoEmPedidosGrandes("execucao")).toBe(true);
      expect(ligada.propoePlanoEmPedidosGrandes("planejamento")).toBe(false);
      expect(desligada.propoePlanoEmPedidosGrandes("execucao")).toBe(false);
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

  it("coordena, deixa a delegação para o bloco do pedido e nunca edita arquivos", () => {
    const texto = instrucoesDoOrquestrador(pasta);

    expect(texto).not.toContain("não leia, edite nem execute nada diretamente");
    expect(texto).toContain("Faça você mesmo o trivial quando o bloco <configuracao-do-pedido> permitir");
    expect(texto).toContain("Nunca edite arquivos você mesmo");
    expect(texto).toContain("as regras de delegação, a quantidade de subagentes e as permissões");
    expect(texto).toContain("Responda sempre em português.");
  });
});

describe("mensagemParaOOrquestrador", () => {
  const pasta = PastaDeTrabalho.dentroDe(raiz, "painel");
  const base = {
    modeloDoOrquestrador: "opus",
    modeloDosSubagentes: "opus",
    nivelDePermissao: "leitura",
  } as const;

  it("no modo fixo exige o número exato de subagentes quando delegar, sem forçar a divisão", () => {
    const configuracao = ConfiguracaoDoOrquestrador.de({ ...base, quantidadeDeSubagentes: { modo: "fixa", limite: 4 } });
    const texto = mensagemParaOOrquestrador("analise", configuracao);

    expect(texto).toContain('- Subagentes: quando delegar, use exatamente 4 subagentes "executor"');
    expect(texto).not.toContain("Se o pedido for pequeno, divida-o");
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
    expect(texto).toContain(
      "Ela substitui qualquer regra de delegação, quantidade de subagentes ou permissão mencionada antes nesta conversa, inclusive nas suas instruções iniciais.",
    );
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

describe("mensagemParaOOrquestrador: delegação e pedidos grandes", () => {
  interface Opcoes {
    permitirTrabalhoDireto?: boolean;
    proporPlanoEmPedidosGrandes?: boolean;
    nivelDePermissao?: NivelDePermissao;
  }

  function bloco(opcoes: Opcoes = {}, modo: ModoDoTurno = "execucao"): string {
    const configuracao = ConfiguracaoDoOrquestrador.de({
      modeloDoOrquestrador: "opus",
      modeloDosSubagentes: "haiku",
      quantidadeDeSubagentes: { modo: "automatica", limite: 3 },
      nivelDePermissao: opcoes.nivelDePermissao ?? "edicao_e_comandos",
      permitirTrabalhoDireto: opcoes.permitirTrabalhoDireto,
      proporPlanoEmPedidosGrandes: opcoes.proporPlanoEmPedidosGrandes,
    });
    const texto = mensagemParaOOrquestrador("refatore o módulo", configuracao, [], modo);
    return texto.slice(0, texto.indexOf("</configuracao-do-pedido>"));
  }

  const REGRA_ESTRITA =
    '- Não faça o trabalho você mesmo: não leia, edite nem execute nada diretamente; delegue cada subtarefa a um subagente "executor". Perguntas simples sobre o que já foi feito podem ser respondidas diretamente.';

  describe("trabalho direto", () => {
    it("ligado (padrão): faz o trivial, delega o que vale a pena e não edita arquivos", () => {
      const texto = bloco();

      expect(texto).toContain(`- Faça você mesmo o trivial: ${TRABALHO_DIRETO_NO_NIVEL.edicao_e_comandos}.`);
      expect(texto).toContain("rodar um comando curto (ex.: git status, listar pasta)");
      expect(texto).toContain("Cada subagente custa dezenas de milhares de tokens só para começar.");
      expect(texto).toContain(
        '- Delegue a subagentes "executor" quando houver alteração de arquivos, quando o trabalho exigir ler muitos arquivos ou rodar comandos demorados (build, testes), ou quando der para dividir em partes paralelas.',
      );
      expect(texto).toContain("Não use subagente para conferir o próprio trabalho.");
      expect(texto).toContain("- Você não edita arquivos: toda alteração vai para um subagente");
      expect(texto).not.toContain(REGRA_ESTRITA);
    });

    it.each<NivelDePermissao>(["leitura", "edicao"])("ligado no nível %s, não promete terminal ao orquestrador", (nivel) => {
      const texto = bloco({ nivelDePermissao: nivel });

      expect(texto).toContain(`- Faça você mesmo o trivial: ${TRABALHO_DIRETO_NO_NIVEL[nivel]}.`);
      expect(texto).toContain("não tem terminal");
      expect(texto).not.toContain("git status");
    });

    it("ligado no planejamento, usa o que o orquestrador pode fazer só lendo", () => {
      const texto = bloco({}, "planejamento");

      expect(texto).toContain(`- Faça você mesmo o trivial: ${TRABALHO_DIRETO_NO_NIVEL.leitura}.`);
      expect(texto).toContain("  Investigue (você mesmo, se for rápido, ou delegando) e responda com um PLANO, sem executá-lo:");
    });

    it("desligado: volta à regra estrita de delegar tudo", () => {
      const texto = bloco({ permitirTrabalhoDireto: false });

      expect(texto).toContain(REGRA_ESTRITA);
      expect(texto).not.toContain("Faça você mesmo o trivial");
      expect(texto).not.toContain("Você não edita arquivos");
    });

    it("desligado no planejamento, delega a investigação", () => {
      const texto = bloco({ permitirTrabalhoDireto: false }, "planejamento");

      expect(texto).toContain("  Delegue a investigação e responda com um PLANO, sem executá-lo:");
      expect(texto).not.toContain("você mesmo, se for rápido");
    });
  });

  describe("plano em pedidos grandes", () => {
    it("ligado (padrão) num turno de execução, manda propor plano com o marcador e executar o pequeno", () => {
      const texto = bloco();

      expect(texto).toContain("- Pedidos grandes: antes de alterar qualquer coisa, avalie o tamanho.");
      expect(texto).toContain("mais de cerca de 3 arquivos, mudar contratos, dados ou arquitetura");
      expect(texto).toContain("investigue só lendo (você ou subagentes com subtarefas só de leitura)");
      expect(texto).toContain(`termine a resposta com a linha ${MARCADOR_DE_PLANO}.`);
      expect(texto).toContain("- Pedido pequeno, ou plano já aprovado");
      expect(texto).toContain("execute direto, sem o marcador.");
    });

    it("deixa executar sem novo marcador a mensagem que aprova o plano", () => {
      const aprovacao = mensagemDeAprovacaoDoPlano("");

      expect(bloco()).toContain(`(mensagem que começa com "${aprovacao.slice(0, aprovacao.indexOf(".") + 1)}")`);
    });

    it("com o trabalho direto desligado, a investigação fica com subagentes", () => {
      expect(bloco({ permitirTrabalhoDireto: false })).toContain(
        "investigue só lendo (com subagentes em subtarefas só de leitura)",
      );
    });

    it("não aparece no planejamento", () => {
      const texto = bloco({}, "planejamento");

      expect(texto).not.toContain("Pedidos grandes");
      expect(texto).not.toContain(MARCADOR_DE_PLANO);
    });

    it("não aparece com a opção desligada", () => {
      const texto = bloco({ proporPlanoEmPedidosGrandes: false });

      expect(texto).not.toContain("Pedidos grandes");
      expect(texto).not.toContain(MARCADOR_DE_PLANO);
    });
  });
});

describe("separarPropostaDePlano", () => {
  it("o marcador é a linha esperada", () => {
    expect(MARCADOR_DE_PLANO).toBe("<plano-para-aprovacao/>");
  });

  it.each<[string, string, string]>([
    ["no fim", "Plano:\n1. Alterar A\n\n<plano-para-aprovacao/>", "Plano:\n1. Alterar A"],
    ["no fim, com espaços e quebras", "Plano:\n1. Alterar A\n   <plano-para-aprovacao/>  \n\n", "Plano:\n1. Alterar A"],
    ["entre crases", "Plano:\n1. Alterar A\n\n`<plano-para-aprovacao/>`", "Plano:\n1. Alterar A"],
    ["entre crases, com espaços", "Plano pronto. ` <plano-para-aprovacao /> `", "Plano pronto."],
    ["no meio de uma linha", "Veja <plano-para-aprovacao/> o plano", "Veja o plano"],
    ["no meio, em linha própria", "Plano:\n<plano-para-aprovacao/>\n1. Alterar A", "Plano:\n1. Alterar A"],
    ["repetido", "<plano-para-aprovacao/>\nPlano\n<plano-para-aprovacao/>\n`<plano-para-aprovacao/>`", "Plano"],
    ["com quebra do Windows", "Plano\r\n<plano-para-aprovacao/>\r\n", "Plano"],
  ])("com o marcador %s, remove todos e informa a proposta", (_caso, resposta, esperada) => {
    expect(separarPropostaDePlano(resposta)).toEqual({ resposta: esperada, planoProposto: true });
  });

  it.each(["Pronto: alterei o arquivo.\n", "", "Use <plano> e </plano-para-aprovacao>", "plano-para-aprovacao"])(
    "sem o marcador (%j), devolve a resposta inalterada",
    (resposta) => {
      expect(separarPropostaDePlano(resposta)).toEqual({ resposta, planoProposto: false });
    },
  );
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
