import path from "node:path";

import { describe, expect, it } from "vitest";

import { ConfiguracaoDoOrquestrador } from "../../orquestracao/ConfiguracaoDoOrquestrador";
import { EsforcoDeRaciocinio } from "../../orquestracao/EsforcoDeRaciocinio";
import { ModoDoTurno } from "../../orquestracao/ModoDoTurno";
import { PedidoDeTurno } from "../../orquestracao/MotorDeAgentes";
import { NivelDePermissao } from "../../orquestracao/NivelDePermissao";
import { PastaDeTrabalho } from "../../orquestracao/PastaDeTrabalho";
import {
  configuracoesDaSessao,
  definicaoDosAgentes,
  ferramentasDoTurno,
  linhaDeEntrada,
  montarAmbiente,
  montarArgumentos,
  NivelDeEsforcoDoClaudeCode,
  nivelDeEsforcoDoClaudeCode,
} from "./ArgumentosDoClaudeCode";

const arquivos = { agentes: "agentes.json", instrucoes: "instrucoes.txt", configuracoes: "configuracoes.json" };

const COMMIT_E_PUSH = ["PowerShell(git commit:*)", "PowerShell(git push:*)", "Bash(git commit:*)", "Bash(git push:*)"];

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
    const argumentos = montarArgumentos(pedido(false), arquivos);

    expect(valoresDe(argumentos, "--permission-mode")).toEqual(["dontAsk"]);
    expect(valoresDe(argumentos, "--allowedTools")).toEqual(valoresDe(argumentos, "--tools"));
  });

  it.each<[NivelDePermissao, string[], string[]]>([
    ["leitura", ["Read", "Grep", "Agent"], ["Edit", "Write", "PowerShell", "Bash"]],
    ["edicao", ["Read", "Edit", "Write", "Agent"], ["PowerShell", "Bash"]],
    ["edicao_e_comandos", ["Edit", "PowerShell", "Bash", "Agent"], []],
  ])("no nível %s libera só as ferramentas certas", (nivel, liberadas, ausentes) => {
    const ferramentas = valoresDe(montarArgumentos(pedido(false, nivel), arquivos), "--tools");

    expect(ferramentas).toEqual(expect.arrayContaining(liberadas));
    for (const ferramenta of ausentes) {
      expect(ferramentas).not.toContain(ferramenta);
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

    it("o executor só commita quando a subtarefa pedir, fora da main e sem Co-authored-by", () => {
      const prompt = definicaoDosAgentes(pedido(true, "edicao_e_comandos", "execucao", true)).executor?.prompt ?? "";

      expect(prompt).not.toContain("Nunca faça commit nem push.");
      expect(prompt).toContain("somente se a subtarefa recebida pedir explicitamente");
      expect(prompt).toContain("Nunca na main");
      expect(prompt).toContain("Nunca adicione a linha Co-authored-by");
    });
  });

  it("não leva o texto do usuário na linha de comando", () => {
    expect(montarArgumentos(pedido(false), arquivos)).not.toContain("analise");
  });

  it("recebe a mensagem em stream-json, que é o formato que aceita imagens", () => {
    const argumentos = montarArgumentos(pedido(false), arquivos);

    expect(valoresDe(argumentos, "--input-format")).toEqual(["stream-json"]);
    expect(argumentos).not.toContain("--add-dir");
  });

  it("libera a pasta das imagens para os subagentes quando há anexos", () => {
    const comImagens: PedidoDeTurno = {
      ...pedido(false),
      imagens: [{ caminho: "C:/dados/anexos/o1/a.png", tipoDeMidia: "image/png" }],
      pastaDasImagens: "C:/dados/anexos/o1",
    };

    expect(valoresDe(montarArgumentos(comImagens, arquivos), "--add-dir")).toEqual(["C:/dados/anexos/o1"]);
  });

  it("no planejamento só libera leitura, mesmo no nível mais permissivo", () => {
    const planejamento = pedido(true, "edicao_e_comandos", "planejamento");
    const argumentos = montarArgumentos(planejamento, arquivos);
    const listas = {
      tools: valoresDe(argumentos, "--tools"),
      allowedTools: valoresDe(argumentos, "--allowedTools"),
      executor: definicaoDosAgentes(planejamento).executor?.tools ?? [],
    };

    for (const ferramentas of Object.values(listas)) {
      expect(ferramentas).toEqual(expect.arrayContaining(["Read", "Grep", "WebSearch"]));
      for (const ferramenta of ["Edit", "Write", "NotebookEdit", "Bash", "PowerShell"]) {
        expect(ferramentas).not.toContain(ferramenta);
      }
    }
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
    expect(valoresDe(argumentos, "--tools")).not.toContain("Edit");
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
