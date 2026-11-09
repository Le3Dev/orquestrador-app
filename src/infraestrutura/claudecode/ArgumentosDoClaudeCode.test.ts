import path from "node:path";

import { describe, expect, it } from "vitest";

import { ConfiguracaoDoOrquestrador } from "../../orquestracao/ConfiguracaoDoOrquestrador";
import { EsforcoDeRaciocinio } from "../../orquestracao/EsforcoDeRaciocinio";
import { REGRA_DOS_SERVIDORES_UNIX, REGRA_DOS_SERVIDORES_WINDOWS } from "../../orquestracao/InstrucoesDoOrquestrador";
import { ModoDoTurno } from "../../orquestracao/ModoDoTurno";
import { PedidoDeTurno } from "../../orquestracao/MotorDeAgentes";
import { NivelDePermissao } from "../../orquestracao/NivelDePermissao";
import { PastaDeTrabalho } from "../../orquestracao/PastaDeTrabalho";
import {
  comandosProibidosDoTurno,
  configuracoesDaSessao,
  definicaoDosAgentes,
  FERRAMENTAS_POR_NIVEL,
  ferramentasDoEsforco,
  ferramentasDoTurno,
  linhaDeEntrada,
  montarAmbiente,
  montarArgumentos,
  NivelDeEsforcoDoClaudeCode,
  nivelDeEsforcoDoClaudeCode,
  nivelDeEsforcoDosSubagentes,
} from "./ArgumentosDoClaudeCode";

const arquivos = { agentes: "agentes.json", instrucoes: "instrucoes.txt", configuracoes: "configuracoes.json" };

const COMMIT_E_PUSH = ["PowerShell(git commit:*)", "PowerShell(git push:*)", "Bash(git commit:*)", "Bash(git push:*)"];

/** Pasta de artefatos do Orquestrador "o1", com espaço no caminho como a pasta de dados real. */
const PASTA_DE_ARTEFATOS = "C:\\Users\\ana\\Orquestrador de Agentes\\dados\\artefatos\\entrada\\orquestradores\\o1";
const REGRAS_DE_ARTEFATO = [
  "Write(//c/Users/ana/Orquestrador de Agentes/dados/artefatos/entrada/orquestradores/o1/**)",
  "Edit(//c/Users/ana/Orquestrador de Agentes/dados/artefatos/entrada/orquestradores/o1/**)",
];

interface Esforcos {
  esforcoDoOrquestrador?: EsforcoDeRaciocinio;
  esforcoDosSubagentes?: EsforcoDeRaciocinio;
}

function pedido(
  sessaoIniciada: boolean,
  nivelDePermissao: NivelDePermissao = "leitura",
  modo: ModoDoTurno = "execucao",
  permitirCommitEPush = false,
  esforcos: Esforcos = {},
): PedidoDeTurno {
  return {
    orquestradorId: "o1",
    imagens: [],
    pastaDasImagens: null,
    pastaDeArtefatos: PASTA_DE_ARTEFATOS,
    instrucoes: null,
    revogarInstrucoesAnteriores: false,
    subagentesProntos: [],
    sessaoId: "sessao-1",
    sessaoIniciada,
    texto: "analise",
    modo,
    pastaDeTrabalho: PastaDeTrabalho.dentroDe(path.resolve("/projetos"), "painel"),
    configuracao: ConfiguracaoDoOrquestrador.de({
      modeloDoOrquestrador: "opus",
      modeloDosSubagentes: "haiku",
      quantidadeDeSubagentes: { modo: "automatica", limite: 4 },
      nivelDePermissao,
      permitirCommitEPush,
      ...esforcos,
    }),
  };
}

/** Valores de uma opção variádica: tudo entre ela e a próxima opção. */
function valoresDe(argumentos: string[], opcao: string): string[] {
  const inicio = argumentos.indexOf(opcao) + 1;
  const fim = argumentos.findIndex((argumento, indice) => indice >= inicio && argumento.startsWith("--"));
  return argumentos.slice(inicio, fim === -1 ? undefined : fim);
}

/** Todas as pastas passadas em `--add-dir`, na ordem. */
function pastasLiberadas(argumentos: string[]): string[] {
  return argumentos.flatMap((argumento, indice) => (argumento === "--add-dir" ? [argumentos[indice + 1] ?? ""] : []));
}

describe("artefatos do Orquestrador e dos Subagentes", () => {
  const CASOS: [NivelDePermissao, ModoDoTurno, boolean][] = [
    ["leitura", "execucao", false],
    ["edicao", "execucao", true],
    ["edicao_e_comandos", "execucao", true],
    ["leitura", "planejamento", false],
    ["edicao", "planejamento", false],
    ["edicao_e_comandos", "planejamento", false],
  ];

  it.each(CASOS)("no nível %s, em %s, libera a pasta de artefatos e Write/Edit nela", (nivel, modo, edicaoLivre) => {
    const turno = pedido(true, nivel, modo);
    const argumentos = montarArgumentos(turno, arquivos);
    const ferramentas = valoresDe(argumentos, "--tools");
    const permitidas = valoresDe(argumentos, "--allowedTools");
    const executor = definicaoDosAgentes(turno).executor;

    expect(pastasLiberadas(argumentos)).toContain(PASTA_DE_ARTEFATOS);
    expect(ferramentas).toEqual(expect.arrayContaining(["Write", "Edit", "Agent"]));
    expect(executor?.tools).toEqual(expect.arrayContaining(["Write", "Edit"]));
    expect(valoresDe(argumentos, "--permission-mode")).toEqual(["dontAsk"]);
    if (edicaoLivre) {
      // Edição já liberada no projeto: nada de regra por caminho.
      expect(permitidas).toEqual(expect.arrayContaining(["Write", "Edit"]));
      expect(permitidas.some((regra) => regra.startsWith("Write(") || regra.startsWith("Edit("))).toBe(false);
    } else {
      // Só a regra de caminho: gravar fora da pasta de artefatos continua negado pelo dontAsk.
      expect(permitidas).toEqual(expect.arrayContaining(REGRAS_DE_ARTEFATO));
      expect(permitidas).not.toContain("Write");
      expect(permitidas).not.toContain("Edit");
      expect(permitidas).not.toContain("NotebookEdit");
    }
    // `--disallowedTools` é variádico: continua por último.
    expect(argumentos.at(-1)).toBe(comandosProibidosDoTurno(turno).at(-1));
    expect(argumentos.lastIndexOf("--disallowedTools")).toBe(argumentos.length - comandosProibidosDoTurno(turno).length - 1);
  });

  it("o executor recebe a pasta de artefatos nas instruções", () => {
    const prompt = definicaoDosAgentes(pedido(false)).executor?.prompt ?? "";

    expect(prompt).toContain(`grave UM arquivo autocontido na pasta ${PASTA_DE_ARTEFATOS}`);
    expect(prompt).toContain("permitido em qualquer permissão");
  });

  it("a definição gravada em agentes.json leva Write e Edit no nível só leitura", () => {
    const definicao = JSON.parse(JSON.stringify(definicaoDosAgentes(pedido(false, "leitura")))) as {
      executor: { tools: string[] };
    };

    expect(definicao.executor.tools).toEqual(["Read", "Glob", "Grep", "WebSearch", "WebFetch", "Write", "Edit"]);
  });
});

describe("montarArgumentos", () => {
  it("cria a sessão no primeiro turno e a retoma nos seguintes", () => {
    const primeiro = montarArgumentos(pedido(false), arquivos);
    const seguinte = montarArgumentos(pedido(true), arquivos);

    expect(valoresDe(primeiro, "--session-id")).toEqual(["sessao-1"]);
    expect(primeiro).not.toContain("--resume");
    expect(valoresDe(seguinte, "--resume")).toEqual(["sessao-1"]);
    expect(seguinte).not.toContain("--session-id");
  });

  it("nega por padrão o que não está liberado, sem perguntar", () => {
    const leitura = montarArgumentos(pedido(false), arquivos);
    const edicao = montarArgumentos(pedido(false, "edicao"), arquivos);

    expect(valoresDe(leitura, "--permission-mode")).toEqual(["dontAsk"]);
    // Só leitura: Write e Edit existem, mas só valem na pasta de artefatos.
    expect(valoresDe(leitura, "--tools")).toEqual(["Read", "Glob", "Grep", "WebSearch", "WebFetch", "Agent", "Write", "Edit"]);
    expect(valoresDe(leitura, "--allowedTools")).toEqual([
      "Read",
      "Glob",
      "Grep",
      "WebSearch",
      "WebFetch",
      "Agent",
      ...REGRAS_DE_ARTEFATO,
    ]);
    // Onde Write e Edit já são livres, as permitidas são as próprias ferramentas.
    expect(valoresDe(edicao, "--allowedTools")).toEqual(valoresDe(edicao, "--tools"));
  });

  it.each<[NivelDePermissao, string[], string[]]>([
    ["leitura", ["Read", "Grep", "Agent"], ["Edit", "Write", "NotebookEdit", "PowerShell", "Bash"]],
    ["edicao", ["Read", "Edit", "Write", "NotebookEdit", "Agent"], ["PowerShell", "Bash"]],
    ["edicao_e_comandos", ["Edit", "Write", "PowerShell", "Bash", "Agent"], []],
  ])("no nível %s libera só as ferramentas certas", (nivel, liberadas, ausentes) => {
    const permitidas = valoresDe(montarArgumentos(pedido(false, nivel), arquivos), "--allowedTools");

    expect(permitidas).toEqual(expect.arrayContaining(liberadas));
    for (const ferramenta of ausentes) {
      expect(permitidas).not.toContain(ferramenta);
    }
  });

  it.each<NivelDePermissao>(["leitura", "edicao", "edicao_e_comandos"])(
    "proíbe commit e push no nível %s",
    (nivel) => {
      const argumentos = montarArgumentos(pedido(false, nivel), arquivos);

      expect(valoresDe(argumentos, "--disallowedTools")).toEqual(expect.arrayContaining(COMMIT_E_PUSH));
      expect(argumentos).not.toContain("--settings");
    },
  );

  describe("com a opção \"Permitir commit e push\" ligada", () => {
    it("na execução libera commit e push, mas mantém o push forçado negado", () => {
      const argumentos = montarArgumentos(pedido(true, "edicao_e_comandos", "execucao", true), arquivos);
      const proibidos = valoresDe(argumentos, "--disallowedTools");

      for (const regra of COMMIT_E_PUSH) {
        expect(proibidos).not.toContain(regra);
      }
      expect(proibidos).toEqual(
        expect.arrayContaining([
          "PowerShell(git push *--force*)",
          "PowerShell(git push -f*)",
          "PowerShell(git push * -f*)",
          "PowerShell(git push * +*)",
          "Bash(git push *--force*)",
          "Bash(git push -f*)",
        ]),
      );
      expect(valoresDe(argumentos, "--allowedTools")).toContain("PowerShell");
    });

    it("na execução desliga a atribuição de commit e de PR nas configurações da sessão", () => {
      const ligado = pedido(true, "edicao_e_comandos", "execucao", true);

      expect(valoresDe(montarArgumentos(ligado, arquivos), "--settings")).toEqual(["configuracoes.json"]);
      expect(configuracoesDaSessao(ligado)).toEqual({ attribution: { commit: "", pr: "" } });
      expect(configuracoesDaSessao(pedido(true, "edicao_e_comandos", "execucao", false))).toBeNull();
    });

    it("no planejamento mantém commit e push negados e não passa configurações", () => {
      const planejamento = pedido(true, "edicao_e_comandos", "planejamento", true);
      const argumentos = montarArgumentos(planejamento, arquivos);

      expect(valoresDe(argumentos, "--disallowedTools")).toEqual(expect.arrayContaining(COMMIT_E_PUSH));
      expect(argumentos).not.toContain("--settings");
      expect(configuracoesDaSessao(planejamento)).toBeNull();
      expect(definicaoDosAgentes(planejamento).executor?.prompt).toContain("Nunca faça commit nem push.");
    });

    it("o executor só commita quando a subtarefa o designar, fora da main e sem Co-authored-by", () => {
      const prompt = definicaoDosAgentes(pedido(true, "edicao_e_comandos", "execucao", true)).executor?.prompt ?? "";

      expect(prompt).not.toContain("Nunca faça commit nem push.");
      expect(prompt).toContain("só se a subtarefa recebida o designar como responsável pelos commits");
      expect(prompt).toContain("sem essa designação, não faça commit nem push");
      expect(prompt).toContain("nunca na main");
      expect(prompt).toContain("nunca a linha Co-authored-by");
    });

    it("o executor responsável faz um commit por feature, push em seguida e sem git add às cegas", () => {
      const prompt = definicaoDosAgentes(pedido(true, "edicao_e_comandos", "execucao", true)).executor?.prompt ?? "";

      expect(prompt).toContain("um commit por feature pronta (testada, com lint e build ok)");
      expect(prompt).toContain("adicionados um a um (nunca git add -A nem git add . às cegas)");
      expect(prompt).toContain("dê push da branch logo em seguida");
      expect(prompt).toContain("feature/, fix/, hotfix/ ou refactor/");
      expect(prompt).toContain("nunca push forçado");
      expect(prompt).toContain("Conventional Commits, em português");
    });

    it("o executor não abre PR nem mergeia", () => {
      const prompt = definicaoDosAgentes(pedido(true, "edicao_e_comandos", "execucao", true)).executor?.prompt ?? "";

      expect(prompt).toContain("Abrir PR e mergear são proibidos");
    });

    it("com a opção desligada, o executor continua proibido de commitar e não recebe a regra por feature", () => {
      const prompt = definicaoDosAgentes(pedido(true, "edicao_e_comandos", "execucao", false)).executor?.prompt ?? "";

      expect(prompt).toContain("Nunca faça commit nem push.");
      expect(prompt).not.toContain("um commit por feature");
    });
  });

  it("não leva o texto do usuário na linha de comando", () => {
    expect(montarArgumentos(pedido(false), arquivos)).not.toContain("analise");
  });

  it("recebe a mensagem em stream-json, que é o formato que aceita imagens", () => {
    const argumentos = montarArgumentos(pedido(false), arquivos);

    expect(valoresDe(argumentos, "--input-format")).toEqual(["stream-json"]);
    // Sem imagens, só a pasta de artefatos fica liberada fora do projeto.
    expect(pastasLiberadas(argumentos)).toEqual([PASTA_DE_ARTEFATOS]);
  });

  it("libera a pasta das imagens para os subagentes quando há anexos", () => {
    const comImagens: PedidoDeTurno = {
      ...pedido(false),
      imagens: [{ caminho: "C:/dados/anexos/o1/a.png", tipoDeMidia: "image/png" }],
      pastaDasImagens: "C:/dados/anexos/o1",
    };

    expect(pastasLiberadas(montarArgumentos(comImagens, arquivos))).toEqual([PASTA_DE_ARTEFATOS, "C:/dados/anexos/o1"]);
  });

  it("no planejamento só libera leitura no projeto, mesmo no nível mais permissivo", () => {
    const planejamento = pedido(true, "edicao_e_comandos", "planejamento");
    const argumentos = montarArgumentos(planejamento, arquivos);
    const listas = {
      tools: valoresDe(argumentos, "--tools"),
      allowedTools: valoresDe(argumentos, "--allowedTools"),
      executor: definicaoDosAgentes(planejamento).executor?.tools ?? [],
    };

    for (const ferramentas of Object.values(listas)) {
      expect(ferramentas).toEqual(expect.arrayContaining(["Read", "Grep", "WebSearch"]));
      for (const ferramenta of ["NotebookEdit", "Bash", "PowerShell"]) {
        expect(ferramentas).not.toContain(ferramenta);
      }
    }
    // Write e Edit existem (artefatos), mas só valem na pasta de artefatos.
    expect(listas.tools).toEqual(expect.arrayContaining(["Write", "Edit"]));
    expect(listas.executor).toEqual(expect.arrayContaining(["Write", "Edit"]));
    expect(listas.allowedTools).not.toContain("Write");
    expect(listas.allowedTools).not.toContain("Edit");
    expect(listas.allowedTools).toEqual(expect.arrayContaining(REGRAS_DE_ARTEFATO));
    expect(listas.tools).toContain("Agent");
    expect(listas.executor).not.toContain("Agent");
    expect(valoresDe(argumentos, "--permission-mode")).toEqual(["dontAsk"]);
    expect(valoresDe(argumentos, "--disallowedTools")).toEqual(
      expect.arrayContaining(["PowerShell(git commit:*)", "Bash(git push:*)"]),
    );
  });

  it("na execução mantém as ferramentas do nível configurado", () => {
    expect(ferramentasDoTurno(pedido(true, "edicao_e_comandos", "execucao"))).toContain("PowerShell");
    expect(ferramentasDoTurno(pedido(true, "edicao_e_comandos", "planejamento"))).not.toContain("PowerShell");
  });
});

describe("linhaDeEntrada", () => {
  it("monta uma linha JSON com o texto e as imagens em base64", () => {
    const linha = linhaDeEntrada("o que tem aqui?", [{ tipoDeMidia: "image/png", base64: "AAAA" }]);

    expect(linha.endsWith("\n")).toBe(true);
    expect(JSON.parse(linha)).toEqual({
      type: "user",
      message: {
        role: "user",
        content: [
          { type: "text", text: "o que tem aqui?" },
          { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
        ],
      },
    });
  });

  it("sem imagens, leva só o texto", () => {
    expect(JSON.parse(linhaDeEntrada("oi", [])).message.content).toEqual([{ type: "text", text: "oi" }]);
  });
});

describe("definicaoDosAgentes", () => {
  it("define o executor com o modelo e as ferramentas do nível, sem poder lançar outros agentes", () => {
    const { executor } = definicaoDosAgentes(pedido(false, "edicao"));

    expect(executor?.model).toBe("haiku");
    expect(executor?.tools).toContain("Edit");
    expect(executor?.tools).not.toContain("Agent");
  });

  describe("subagentes prontos", () => {
    const revisor = { nome: "revisor", descricao: "Revisa código.", prompt: "Aponte bugs.", modelo: "herdar" as const };
    const comProntos = (
      base: PedidoDeTurno,
      subagentesProntos = [revisor, { ...revisor, nome: "testador", modelo: "opus" as const }],
    ) => ({
      ...base,
      subagentesProntos,
    });

    it("sem prontos, só o executor", () => {
      expect(Object.keys(definicaoDosAgentes(pedido(false, "edicao")))).toEqual(["executor"]);
    });

    it("cada pronto tem as ferramentas e o esforço do executor, sem poder lançar outros agentes", () => {
      const agentes = definicaoDosAgentes(
        comProntos(pedido(false, "edicao", "execucao", false, { esforcoDosSubagentes: "baixo" })),
      );

      expect(Object.keys(agentes).sort()).toEqual(["executor", "revisor", "testador"]);
      expect(agentes.revisor?.tools).toEqual(agentes.executor?.tools);
      expect(agentes.revisor?.tools).not.toContain("Agent");
      expect(agentes.revisor?.effort).toBe("low");
      expect(agentes.revisor?.description).toBe("Revisa código.");
      expect(agentes.revisor?.model).toBe("haiku");
      expect(agentes.testador?.model).toBe("opus");
      expect(agentes.revisor?.prompt).toContain("Aponte bugs.");
      expect(agentes.revisor?.prompt).toContain(PASTA_DE_ARTEFATOS);
    });

    it("no planejamento, os prontos têm as mesmas ferramentas do executor e não fazem commit", () => {
      const agentes = definicaoDosAgentes(comProntos(pedido(true, "edicao_e_comandos", "planejamento")));

      expect(agentes.revisor?.tools).toEqual(agentes.executor?.tools);
      expect(agentes.revisor?.tools).not.toContain("Bash");
      expect(agentes.revisor?.prompt).toContain("Nunca faça commit nem push.");
    });

    it("seguem a regra de commit e push do turno", () => {
      const agentes = definicaoDosAgentes(comProntos(pedido(true, "edicao_e_comandos", "execucao", true)));
      expect(agentes.revisor?.prompt).toContain(
        "Commit e push: só se a subtarefa recebida o designar como responsável pelos commits",
      );
      expect(agentes.revisor?.prompt).toContain("um commit por feature pronta");
      expect(agentes.revisor?.prompt).toContain("Abrir PR e mergear são proibidos");
    });

    it("no Windows, o executor e os prontos levam a regra dos servidores do Windows", () => {
      const agentes = definicaoDosAgentes(comProntos(pedido(false, "edicao_e_comandos")), "windows");

      for (const nome of ["executor", "revisor", "testador"]) {
        expect(agentes[nome]?.prompt).toContain(REGRA_DOS_SERVIDORES_WINDOWS);
        expect(agentes[nome]?.prompt).not.toContain(REGRA_DOS_SERVIDORES_UNIX);
      }
    });

    it("sem a plataforma, todos levam a regra do unix", () => {
      const agentes = definicaoDosAgentes(comProntos(pedido(false, "edicao_e_comandos")));

      for (const nome of ["executor", "revisor", "testador"]) {
        expect(agentes[nome]?.prompt).toContain(REGRA_DOS_SERVIDORES_UNIX);
      }
    });
  });
});

describe("montarAmbiente", () => {
  it("remove as variáveis da sessão pai e limita a concorrência ao teto configurado", () => {
    const ambiente = montarAmbiente(
      { PATH: "x", CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "pai", CLAUDE_CODE_USE_FOUNDRY: "1" },
      pedido(false),
    );

    expect(ambiente.CLAUDECODE).toBeUndefined();
    expect(ambiente.CLAUDE_CODE_SESSION_ID).toBeUndefined();
    expect(ambiente.PATH).toBe("x");
    expect(ambiente.CLAUDE_CODE_USE_FOUNDRY).toBe("1");
    expect(ambiente.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS).toBe("4");
  });

  it("com os dois esforços em padrão, mantém a variável de esforço herdada", () => {
    const ambiente = montarAmbiente({ PATH: "x", CLAUDE_CODE_EFFORT_LEVEL: "low" }, pedido(false));

    expect(ambiente.CLAUDE_CODE_EFFORT_LEVEL).toBe("low");
  });

  it.each<Esforcos>([{ esforcoDoOrquestrador: "alto" }, { esforcoDosSubagentes: "baixo" }])(
    "com esforço escolhido (%j), remove a variável de esforço herdada, que venceria a escolha",
    (esforcos) => {
      const ambiente = montarAmbiente(
        { PATH: "x", CLAUDE_CODE_EFFORT_LEVEL: "low" },
        pedido(false, "leitura", "execucao", false, esforcos),
      );

      expect(ambiente.CLAUDE_CODE_EFFORT_LEVEL).toBeUndefined();
      expect(ambiente.PATH).toBe("x");
    },
  );
});

describe("esforço de raciocínio", () => {
  const MAPEAMENTO: [EsforcoDeRaciocinio, NivelDeEsforcoDoClaudeCode][] = [
    ["baixo", "low"],
    ["medio", "medium"],
    ["alto", "high"],
    ["extra_alto", "xhigh"],
    ["maximo", "max"],
  ];

  it("no padrão não envia nada: nem --effort ao orquestrador, nem effort ao executor", () => {
    const padrao = pedido(false);
    const { executor } = definicaoDosAgentes(padrao);

    expect(nivelDeEsforcoDoClaudeCode("padrao")).toBeNull();
    expect(montarArgumentos(padrao, arquivos)).not.toContain("--effort");
    expect(executor).toBeDefined();
    expect(executor !== undefined && "effort" in executor).toBe(false);
    expect(JSON.stringify(definicaoDosAgentes(padrao))).not.toContain("effort");
  });

  it.each(MAPEAMENTO)("o esforço %s do orquestrador vira --effort %s", (esforco, nivel) => {
    const argumentos = montarArgumentos(pedido(false, "leitura", "execucao", false, { esforcoDoOrquestrador: esforco }), arquivos);

    expect(valoresDe(argumentos, "--effort")).toEqual([nivel]);
    expect(argumentos.indexOf("--effort")).toBe(argumentos.indexOf("--model") + 2);
  });

  it.each(MAPEAMENTO)("o esforço %s dos subagentes vira effort %s na definição do executor", (esforco, nivel) => {
    const definicao = definicaoDosAgentes(pedido(false, "leitura", "execucao", false, { esforcoDosSubagentes: esforco }));

    expect(definicao.executor?.effort).toBe(nivel);
    expect(JSON.parse(JSON.stringify(definicao)).executor.effort).toBe(nivel);
  });

  it("cada papel tem o seu esforço, independente do outro", () => {
    const soOrquestrador = pedido(false, "leitura", "execucao", false, { esforcoDoOrquestrador: "maximo" });
    const soSubagentes = pedido(false, "leitura", "execucao", false, { esforcoDosSubagentes: "baixo" });

    expect(valoresDe(montarArgumentos(soOrquestrador, arquivos), "--effort")).toEqual(["max"]);
    expect(definicaoDosAgentes(soOrquestrador).executor?.effort).toBeUndefined();
    expect(montarArgumentos(soSubagentes, arquivos)).not.toContain("--effort");
    expect(definicaoDosAgentes(soSubagentes).executor?.effort).toBe("low");
  });

  it("vale também no planejamento, sem mexer nas travas do modo", () => {
    const planejamento = pedido(true, "edicao_e_comandos", "planejamento", true, {
      esforcoDoOrquestrador: "alto",
      esforcoDosSubagentes: "medio",
    });
    const argumentos = montarArgumentos(planejamento, arquivos);

    expect(valoresDe(argumentos, "--effort")).toEqual(["high"]);
    expect(definicaoDosAgentes(planejamento).executor?.effort).toBe("medium");
    expect(valoresDe(argumentos, "--allowedTools")).not.toContain("Edit");
    expect(argumentos).not.toContain("--settings");
  });

  it("com commit e push liberados, o esforço vai na flag e as configurações da sessão seguem só com a atribuição", () => {
    const ligado = pedido(true, "edicao_e_comandos", "execucao", true, {
      esforcoDoOrquestrador: "extra_alto",
      esforcoDosSubagentes: "maximo",
    });
    const argumentos = montarArgumentos(ligado, arquivos);

    expect(valoresDe(argumentos, "--effort")).toEqual(["xhigh"]);
    expect(valoresDe(argumentos, "--settings")).toEqual(["configuracoes.json"]);
    expect(configuracoesDaSessao(ligado)).toEqual({ attribution: { commit: "", pr: "" } });
    expect(definicaoDosAgentes(ligado).executor?.effort).toBe("max");
  });

  it("com esforço escolhido e commit e push proibidos, não passa configurações da sessão", () => {
    const argumentos = montarArgumentos(
      pedido(true, "edicao_e_comandos", "execucao", false, { esforcoDoOrquestrador: "baixo" }),
      arquivos,
    );

    expect(valoresDe(argumentos, "--effort")).toEqual(["low"]);
    expect(argumentos).not.toContain("--settings");
  });
});

describe("esforço ultracode", () => {
  const REVISOR = { nome: "revisor", descricao: "Revisa.", prompt: "Revise.", modelo: "herdar" as const };
  const ultracode = (esforcoDosSubagentes: EsforcoDeRaciocinio = "padrao", nivel: NivelDePermissao = "edicao_e_comandos") =>
    pedido(false, nivel, "execucao", false, { esforcoDoOrquestrador: "ultracode", esforcoDosSubagentes });

  it("vira --effort ultracode, logo depois do --model", () => {
    const argumentos = montarArgumentos(ultracode(), arquivos);

    expect(valoresDe(argumentos, "--effort")).toEqual(["ultracode"]);
    expect(argumentos.indexOf("--effort")).toBe(argumentos.indexOf("--model") + 2);
  });

  it("acrescenta o Workflow em --tools e em --allowedTools, depois do Agent", () => {
    const argumentos = montarArgumentos(ultracode(), arquivos);

    expect(valoresDe(argumentos, "--tools")).toEqual([...FERRAMENTAS_POR_NIVEL.edicao_e_comandos, "Agent", "Workflow"]);
    expect(valoresDe(argumentos, "--allowedTools")).toEqual([
      ...FERRAMENTAS_POR_NIVEL.edicao_e_comandos,
      "Agent",
      "Workflow",
    ]);
  });

  it("no nível só de leitura, o Workflow entra antes das regras da pasta de artefatos", () => {
    const argumentos = montarArgumentos(ultracode("padrao", "leitura"), arquivos);

    expect(valoresDe(argumentos, "--allowedTools")).toEqual([
      ...FERRAMENTAS_POR_NIVEL.leitura,
      "Agent",
      "Workflow",
      ...REGRAS_DE_ARTEFATO,
    ]);
  });

  it.each<EsforcoDeRaciocinio>(["padrao", "baixo", "medio", "alto", "extra_alto", "maximo"])(
    "com o orquestrador em %s, o Workflow não aparece",
    (esforco) => {
      const argumentos = montarArgumentos(
        pedido(false, "edicao_e_comandos", "execucao", false, { esforcoDoOrquestrador: esforco }),
        arquivos,
      );

      expect(argumentos).not.toContain("Workflow");
    },
  );

  it("com os subagentes em padrão, o executor e os prontos recebem effort xhigh", () => {
    const definicao = definicaoDosAgentes({
      ...ultracode(),
      subagentesProntos: [REVISOR],
    });

    expect(definicao.executor?.effort).toBe("xhigh");
    expect(definicao.revisor?.effort).toBe("xhigh");
  });

  it("com esforço escolhido para os subagentes, vale o escolhido", () => {
    expect(definicaoDosAgentes(ultracode("baixo")).executor?.effort).toBe("low");
    expect(definicaoDosAgentes(ultracode("maximo")).executor?.effort).toBe("max");
  });

  it("o Workflow nunca entra nas ferramentas do executor nem dos prontos", () => {
    const definicao = definicaoDosAgentes({
      ...ultracode(),
      subagentesProntos: [REVISOR],
    });

    expect(definicao.executor?.tools).not.toContain("Workflow");
    expect(definicao.revisor?.tools).not.toContain("Workflow");
    expect(JSON.stringify(definicao)).not.toContain("ultracode");
  });

  it("o ultracode dos subagentes, se chegasse, viraria xhigh: o effort de agente não o aceita", () => {
    expect(nivelDeEsforcoDosSubagentes("ultracode", "padrao")).toBe("xhigh");
    expect(nivelDeEsforcoDosSubagentes("padrao", "maximo")).toBeNull();
    expect(nivelDeEsforcoDosSubagentes("padrao", "padrao")).toBeNull();
  });

  it("ferramentasDoEsforco só devolve o Workflow no ultracode", () => {
    expect(ferramentasDoEsforco("ultracode")).toEqual(["Workflow"]);
    expect(ferramentasDoEsforco("maximo")).toEqual([]);
  });

  it("remove a variável de esforço herdada e não vai para as configurações da sessão", () => {
    const comCommit = pedido(false, "edicao_e_comandos", "execucao", true, { esforcoDoOrquestrador: "ultracode" });
    const ambiente = montarAmbiente({ PATH: "x", CLAUDE_CODE_EFFORT_LEVEL: "low" }, comCommit);

    expect(ambiente.CLAUDE_CODE_EFFORT_LEVEL).toBeUndefined();
    expect(configuracoesDaSessao(comCommit)).toEqual({ attribution: { commit: "", pr: "" } });
  });
});
