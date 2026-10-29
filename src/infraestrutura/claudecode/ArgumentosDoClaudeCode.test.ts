import path from "node:path";

import { describe, expect, it } from "vitest";

import { ConfiguracaoDoOrquestrador } from "../../orquestracao/ConfiguracaoDoOrquestrador";
import { PedidoDeTurno } from "../../orquestracao/MotorDeAgentes";
import { NivelDePermissao } from "../../orquestracao/NivelDePermissao";
import { PastaDeTrabalho } from "../../orquestracao/PastaDeTrabalho";
import { definicaoDosAgentes, linhaDeEntrada, montarAmbiente, montarArgumentos } from "./ArgumentosDoClaudeCode";

const arquivos = { agentes: "agentes.json", instrucoes: "instrucoes.txt" };

function pedido(sessaoIniciada: boolean, nivelDePermissao: NivelDePermissao = "leitura"): PedidoDeTurno {
  return {
    orquestradorId: "o1",
    imagens: [],
    pastaDasImagens: null,
    sessaoId: "sessao-1",
    sessaoIniciada,
    texto: "analise",
    pastaDeTrabalho: PastaDeTrabalho.dentroDe(path.resolve("/projetos"), "painel"),
    configuracao: ConfiguracaoDoOrquestrador.de({
      modeloDoOrquestrador: "opus",
      modeloDosSubagentes: "haiku",
      quantidadeDeSubagentes: { modo: "automatica", limite: 4 },
      nivelDePermissao,
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
      const proibidos = valoresDe(montarArgumentos(pedido(false, nivel), arquivos), "--disallowedTools");

      expect(proibidos).toEqual(
        expect.arrayContaining(["PowerShell(git commit:*)", "PowerShell(git push:*)", "Bash(git commit:*)", "Bash(git push:*)"]),
      );
    },
  );

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
});
