import path from "node:path";

import { describe, expect, it } from "vitest";

import { ConfiguracaoDoOrquestrador, DadosDaConfiguracao } from "./ConfiguracaoDoOrquestrador";
import { ErroDeOrquestracao } from "./ErroDeOrquestracao";
import { ESFORCOS_DE_RACIOCINIO } from "./EsforcoDeRaciocinio";
import {
  instrucoesDoOrquestrador,
  instrucoesDoSubagente,
  MARCADOR_DE_PLANO,
  mensagemDeAprovacaoDoPlano,
  mensagemParaOOrquestrador,
  REGRA_DOS_SERVIDORES_UNIX,
  REGRA_DOS_SERVIDORES_WINDOWS,
  regraDosServidores,
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

  describe("qualquer", () => {
    it("aceita um caminho absoluto fora da raiz, escolhido à mão", () => {
      const fora = path.resolve("/outro", "projeto");

      expect(PastaDeTrabalho.qualquer(fora).caminho).toBe(fora);
      expect(PastaDeTrabalho.qualquer(fora).nome).toBe("projeto");
    });

    it("recusa caminho relativo, que só o seletor de projetos usa", () => {
      expect(() => PastaDeTrabalho.qualquer("projeto")).toThrow(/caminho completo/);
    });

    it("recusa pasta vazia", () => {
      expect(() => PastaDeTrabalho.qualquer("  ")).toThrow(/Informe/);
    });
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
  // Sem instruções personalizadas, o campo existe e fica vazio.
  const semInstrucoes = { instrucoesPersonalizadas: "" } as const;

  it("nasce com commit e push desligados quando a opção não é informada", () => {
    const configuracao = ConfiguracaoDoOrquestrador.de(dados);

    expect(configuracao.permitirCommitEPush).toBe(false);
    expect(configuracao.paraDados()).toEqual({
      ...dados,
      permitirCommitEPush: false,
      ...esforcosPadrao,
      ...semInstrucoes,
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
      ...semInstrucoes,
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

    it.each(ESFORCOS_DE_RACIOCINIO.filter((esforco) => esforco !== "ultracode"))("aceita o esforço %s nos dois papéis", (esforco) => {
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

    it("aceita o ultracode só no orquestrador", () => {
      const configuracao = ConfiguracaoDoOrquestrador.de({ ...dados, esforcoDoOrquestrador: "ultracode" });

      expect(configuracao.paraDados()).toMatchObject({ esforcoDoOrquestrador: "ultracode", esforcoDosSubagentes: "padrao" });
    });

    it("recusa o ultracode nos subagentes, também ao alterar, com mensagem clara", () => {
      const erro = new ErroDeOrquestracao(
        "dados_invalidos",
        'O esforço "ultracode" vale só para o orquestrador e o chat. Escolha outro esforço para os subagentes.',
      );

      expect(() => ConfiguracaoDoOrquestrador.de({ ...dados, esforcoDosSubagentes: "ultracode" })).toThrow(erro);
      expect(() => ConfiguracaoDoOrquestrador.de(dados).com({ esforcoDosSubagentes: "ultracode" })).toThrow(erro);
    });
  });

  describe("trivial e plano em pedidos grandes, sempre ligados (ADR-28)", () => {
    /** Configuração gravada quando as duas ainda eram opções da tela. */
    function gravadosComAsOpcoesAntigas(trivial: unknown, plano: unknown): DadosDaConfiguracao {
      return JSON.parse(
        JSON.stringify({
          ...dados,
          permitirCommitEPush: true,
          ...esforcosPadrao,
          permitirTrabalhoDireto: trivial,
          proporPlanoEmPedidosGrandes: plano,
        }),
      ) as DadosDaConfiguracao;
    }

    it("os dois campos não fazem mais parte da configuração", () => {
      const configuracao = ConfiguracaoDoOrquestrador.de(dados);

      expect(Object.keys(configuracao.paraDados()).sort()).toEqual(
        [
          "esforcoDoOrquestrador",
          "esforcoDosSubagentes",
          "instrucoesPersonalizadas",
          "modeloDoOrquestrador",
          "modeloDosSubagentes",
          "nivelDePermissao",
          "permitirCommitEPush",
          "quantidadeDeSubagentes",
        ].sort(),
      );
    });

    it.each<[unknown, unknown]>([
      [true, true],
      [false, false],
      [true, false],
      [false, true],
    ])("lê dados antigos com trivial=%j e plano=%j sem erro e os descarta ao salvar de novo", (trivial, plano) => {
      const configuracao = ConfiguracaoDoOrquestrador.de(gravadosComAsOpcoesAntigas(trivial, plano));

      expect(configuracao.paraDados()).toEqual({
        ...dados,
        permitirCommitEPush: true,
        ...esforcosPadrao,
        ...semInstrucoes,
      });
      expect(configuracao.paraDados()).not.toHaveProperty("permitirTrabalhoDireto");
      expect(configuracao.paraDados()).not.toHaveProperty("proporPlanoEmPedidosGrandes");
    });

    it("dados antigos com valores fora do esperado também são lidos, sem erro", () => {
      expect(() => ConfiguracaoDoOrquestrador.de(gravadosComAsOpcoesAntigas("sim", 1))).not.toThrow();
    });

    it("um orquestrador antigo com as duas desligadas passa a propor plano na execução", () => {
      const antiga = ConfiguracaoDoOrquestrador.de(gravadosComAsOpcoesAntigas(false, false));

      expect(antiga.propoePlanoEmPedidosGrandes("execucao")).toBe(true);
    });

    it("alterar outro campo não traz os campos antigos de volta", () => {
      const alterada = ConfiguracaoDoOrquestrador.de(gravadosComAsOpcoesAntigas(false, false)).com({
        nivelDePermissao: "edicao",
      });

      expect(alterada.paraDados()).not.toHaveProperty("permitirTrabalhoDireto");
      expect(alterada.paraDados()).not.toHaveProperty("proporPlanoEmPedidosGrandes");
    });

    it("propõe plano em pedidos grandes em todo turno de execução e nunca no planejamento", () => {
      const configuracao = ConfiguracaoDoOrquestrador.de(dados);

      expect(configuracao.propoePlanoEmPedidosGrandes("execucao")).toBe(true);
      expect(configuracao.propoePlanoEmPedidosGrandes("planejamento")).toBe(false);
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

  it("só com comandos liberados explica como subir servidor sem prender o pedido", () => {
    const quantidadeDeSubagentes = { modo: "fixa", limite: 1 } as const;
    const comComandos = ConfiguracaoDoOrquestrador.de({
      ...base,
      quantidadeDeSubagentes,
      nivelDePermissao: "edicao_e_comandos",
    });
    const soLeitura = ConfiguracaoDoOrquestrador.de({ ...base, quantidadeDeSubagentes });

    expect(mensagemParaOOrquestrador("suba o site", comComandos)).toContain(`- ${REGRA_DOS_SERVIDORES_UNIX}`);
    expect(mensagemParaOOrquestrador("suba o site", comComandos, [], "planejamento")).not.toContain(
      REGRA_DOS_SERVIDORES_UNIX,
    );
    expect(mensagemParaOOrquestrador("suba o site", soLeitura)).not.toContain(REGRA_DOS_SERVIDORES_UNIX);
    expect(REGRA_DOS_SERVIDORES_UNIX).toContain("Não abra o navegador do computador");
  });

  it("no Windows explica a subida pelo PowerShell, e não a do unix", () => {
    const comComandos = ConfiguracaoDoOrquestrador.de({
      ...base,
      quantidadeDeSubagentes: { modo: "fixa", limite: 1 },
      nivelDePermissao: "edicao_e_comandos",
    });
    const noWindows = mensagemParaOOrquestrador("suba o site", comComandos, [], "execucao", null, null, false, [], "windows");
    const semPlataforma = mensagemParaOOrquestrador("suba o site", comComandos);

    expect(noWindows).toContain(`- ${REGRA_DOS_SERVIDORES_WINDOWS}`);
    expect(noWindows).not.toContain(REGRA_DOS_SERVIDORES_UNIX);
    expect(semPlataforma).toContain(`- ${REGRA_DOS_SERVIDORES_UNIX}`);
    expect(semPlataforma).not.toContain(REGRA_DOS_SERVIDORES_WINDOWS);
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
    expect(texto).toContain("a única exceção é gravar artefatos na pasta de artefatos do pedido");
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
    // A exceção dos artefatos só precisa ser dita no nível só leitura.
    expect(DESCRICAO_DO_NIVEL.edicao).not.toContain("artefatos");
  });

  describe("regra de commit e push", () => {
    const PROIBIDOS = "Commits e push são sempre proibidos.";
    const POR_FEATURE =
      "Commits e push: por feature. Ao terminar CADA feature ou correção (testada, com lint e build ok), faça um commit só dela e dê push da branch logo em seguida (git push -u no primeiro). Um commit por feature: não misture features e adicione só os arquivos dela, um a um (nunca git add -A nem git add . às cegas). Antes do primeiro commit, crie ou use uma branch feature/, fix/, hotfix/ ou refactor/ com nome descritivo. Nunca commitar na main, nunca push forçado, nunca a linha Co-authored-by. Mensagem em Conventional Commits, em português. Com subagentes em paralelo, só um faz os commits (você ou um subagente designado na subtarefa), uma feature de cada vez. Abrir PR e mergear continuam proibidos sem pedido explícito do usuário.";

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
      expect(texto).not.toContain("Commits e push: por feature");
    });

    it("com a opção ligada, manda commitar e dar push a cada feature pronta", () => {
      const texto = bloco(true, "execucao");

      expect(texto).toContain(`- Permissões: ${DESCRICAO_DO_NIVEL.edicao_e_comandos}. ${POR_FEATURE}`);
      expect(texto).not.toContain(PROIBIDOS);
      expect(texto).not.toContain("somente quando o usuário pedir");
    });

    it("com a opção ligada, um commit por feature, push em seguida e sem git add às cegas", () => {
      const texto = bloco(true, "execucao");

      expect(texto).toContain("Ao terminar CADA feature ou correção (testada, com lint e build ok)");
      expect(texto).toContain("um commit só dela e dê push da branch logo em seguida");
      expect(texto).toContain("Um commit por feature: não misture features");
      expect(texto).toContain("um a um (nunca git add -A nem git add . às cegas)");
    });

    it("com a opção ligada, só um commita com subagentes em paralelo", () => {
      const texto = bloco(true, "execucao");

      expect(texto).toContain("Com subagentes em paralelo, só um faz os commits");
      expect(texto).toContain("uma feature de cada vez");
    });

    it("com a opção ligada, mantém branch, main, push forçado e Co-authored-by proibidos, e PR e merge só a pedido", () => {
      const texto = bloco(true, "execucao");

      expect(texto).toContain("feature/, fix/, hotfix/ ou refactor/");
      expect(texto).toContain("Nunca commitar na main, nunca push forçado, nunca a linha Co-authored-by");
      expect(texto).toContain("Abrir PR e mergear continuam proibidos sem pedido explícito do usuário");
    });

    it("com a opção ligada, no planejamento continua proibindo", () => {
      const texto = bloco(true, "planejamento");

      expect(texto).toContain(PROIBIDOS);
      expect(texto).not.toContain("Commits e push: por feature");
    });
  });
});

describe("mensagemParaOOrquestrador: delegação e pedidos grandes", () => {
  const dadosDoBloco: DadosDaConfiguracao = {
    modeloDoOrquestrador: "opus",
    modeloDosSubagentes: "haiku",
    quantidadeDeSubagentes: { modo: "automatica", limite: 3 },
    nivelDePermissao: "edicao_e_comandos",
  };

  function blocoDe(configuracao: ConfiguracaoDoOrquestrador, modo: ModoDoTurno = "execucao"): string {
    const texto = mensagemParaOOrquestrador("refatore o módulo", configuracao, [], modo);
    return texto.slice(0, texto.indexOf("</configuracao-do-pedido>"));
  }

  function bloco(nivelDePermissao: NivelDePermissao = "edicao_e_comandos", modo: ModoDoTurno = "execucao"): string {
    return blocoDe(ConfiguracaoDoOrquestrador.de({ ...dadosDoBloco, nivelDePermissao }), modo);
  }

  /** A regra de "delegar tudo", que existia quando o trivial era uma opção desligável. */
  const REGRA_ESTRITA_ANTIGA = "Não faça o trabalho você mesmo";

  describe("trivial", () => {
    it("sempre: faz o trivial, delega o que vale a pena e não edita arquivos", () => {
      const texto = bloco();

      expect(texto).toContain(`- Faça você mesmo o trivial: ${TRABALHO_DIRETO_NO_NIVEL.edicao_e_comandos}.`);
      expect(texto).toContain("rodar um comando curto (ex.: git status, listar pasta)");
      expect(texto).toContain("Cada subagente custa dezenas de milhares de tokens só para começar.");
      expect(texto).toContain(
        '- Delegue a subagentes "executor" quando houver alteração de arquivos, quando o trabalho exigir ler muitos arquivos ou rodar comandos demorados (build, testes), ou quando der para dividir em partes paralelas.',
      );
      expect(texto).toContain("Não use subagente para conferir o próprio trabalho.");
      expect(texto).toContain("- Você não edita arquivos: toda alteração no projeto vai para um subagente");
      expect(texto).not.toContain(REGRA_ESTRITA_ANTIGA);
    });

    it.each<NivelDePermissao>(["leitura", "edicao"])("no nível %s, não promete terminal ao orquestrador", (nivel) => {
      const texto = bloco(nivel);

      expect(texto).toContain(`- Faça você mesmo o trivial: ${TRABALHO_DIRETO_NO_NIVEL[nivel]}.`);
      expect(texto).toContain("não tem terminal");
      expect(texto).not.toContain("git status");
    });

    it("no planejamento, usa o que o orquestrador pode fazer só lendo e investiga ele mesmo ou delegando", () => {
      const texto = bloco("edicao_e_comandos", "planejamento");

      expect(texto).toContain(`- Faça você mesmo o trivial: ${TRABALHO_DIRETO_NO_NIVEL.leitura}.`);
      expect(texto).toContain("  Investigue (você mesmo, se for rápido, ou delegando) e responda com um PLANO, sem executá-lo:");
      expect(texto).not.toContain("Delegue a investigação");
      expect(texto).not.toContain(REGRA_ESTRITA_ANTIGA);
    });
  });

  describe("orquestrador salvo com as opções antigas desligadas", () => {
    const antiga = ConfiguracaoDoOrquestrador.de(
      JSON.parse(
        JSON.stringify({ ...dadosDoBloco, permitirTrabalhoDireto: false, proporPlanoEmPedidosGrandes: false }),
      ) as DadosDaConfiguracao,
    );

    it("na execução, passa a ter o trivial e a regra de pedidos grandes", () => {
      const texto = blocoDe(antiga);

      expect(texto).toContain(`- Faça você mesmo o trivial: ${TRABALHO_DIRETO_NO_NIVEL.edicao_e_comandos}.`);
      expect(texto).toContain("- Você não edita arquivos:");
      expect(texto).toContain("investigue só lendo (você ou subagentes com subtarefas só de leitura)");
      expect(texto).toContain(`termine a resposta com a linha ${MARCADOR_DE_PLANO}.`);
      expect(texto).not.toContain(REGRA_ESTRITA_ANTIGA);
      expect(texto).toBe(bloco());
    });

    it("no planejamento, recebe o mesmo bloco de um orquestrador novo", () => {
      expect(blocoDe(antiga, "planejamento")).toBe(bloco("edicao_e_comandos", "planejamento"));
    });
  });

  describe("plano em pedidos grandes", () => {
    it.each<NivelDePermissao>(["leitura", "edicao", "edicao_e_comandos"])(
      "em todo turno de execução (nível %s), manda propor plano com o marcador e executar o pequeno",
      (nivel) => {
        const texto = bloco(nivel);

        expect(texto).toContain("- Pedidos grandes: antes de alterar qualquer coisa, avalie o tamanho.");
        expect(texto).toContain("investigue só lendo (você ou subagentes com subtarefas só de leitura)");
        expect(texto).toContain(`termine a resposta com a linha ${MARCADOR_DE_PLANO}.`);
      },
    );

    it("o texto da regra: limiar, investigação só lendo, marcador e pedido pequeno", () => {
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

    it("a investigação nunca fica só com subagentes", () => {
      expect(bloco()).not.toContain("com subagentes em subtarefas só de leitura");
    });

    it.each<NivelDePermissao>(["leitura", "edicao", "edicao_e_comandos"])(
      "não aparece no planejamento (nível de execução %s)",
      (nivel) => {
        const texto = bloco(nivel, "planejamento");

        expect(texto).not.toContain("Pedidos grandes");
        expect(texto).not.toContain(MARCADOR_DE_PLANO);
      },
    );
  });
});

describe("regraDosServidores", () => {
  it("no unix é o texto de sempre, com nohup e /tmp", () => {
    expect(regraDosServidores("unix")).toBe(
      "Servidor que deve continuar no ar (npm run dev, vite, next dev e afins): não use a execução em segundo plano da ferramenta (run_in_background), que prende o pedido até o servidor parar. Suba desacoplado, com a saída num log fora do projeto, e mostre o começo do log para o endereço aparecer, por exemplo: `nohup npm run dev > /tmp/servidor-<nome>.log 2>&1 & sleep 4; tail -n 20 /tmp/servidor-<nome>.log`. Ele continua rodando depois do pedido; para parar, use kill no processo. Não abra o navegador do computador (open, xdg-open, start): o aplicativo já mostra a página numa prévia ao vivo quando o endereço aparece; para conferir, use curl e cite o endereço completo na resposta.",
    );
    expect(regraDosServidores("unix")).toBe(REGRA_DOS_SERVIDORES_UNIX);
  });

  it("no Windows sobe pelo PowerShell sem herdar handles e para com taskkill", () => {
    const regra = regraDosServidores("windows");

    expect(regra).toBe(REGRA_DOS_SERVIDORES_WINDOWS);
    expect(regra).toContain("Start-Process -WindowStyle Hidden cmd");
    expect(regra).toContain(String.raw`$env:TEMP\servidor-<nome>.log`);
    expect(regra).toContain("taskkill /PID <PID> /T /F");
    expect(regra).toContain("-NoNewWindow");
    expect(regra).toContain("curl.exe");
    expect(regra).toContain("Não abra o navegador do computador");
    expect(regra).not.toContain("nohup");
    expect(regra).not.toContain("/tmp");
  });
});

describe("instrucoesDoSubagente e a plataforma", () => {
  const pasta = PastaDeTrabalho.dentroDe(raiz, "painel");

  it("no Windows leva a regra dos servidores do Windows; sem a plataforma, a do unix", () => {
    const noWindows = instrucoesDoSubagente(pasta, false, null, null, "windows");

    expect(noWindows).toContain(REGRA_DOS_SERVIDORES_WINDOWS);
    expect(noWindows).not.toContain(REGRA_DOS_SERVIDORES_UNIX);
    expect(instrucoesDoSubagente(pasta)).toContain(REGRA_DOS_SERVIDORES_UNIX);
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
