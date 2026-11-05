import { describe, expect, it } from "vitest";

import type { PerguntaAoMotorDeChat } from "../../chat/MotorDeChat";
import {
  caminhoParaRegraDePermissao,
  FERRAMENTAS_DO_CHAT,
  montarAmbienteDoChat,
  montarArgumentosDoChat,
  regrasDeNegacaoDoChat,
} from "./ArgumentosDoChat";

const arquivos = { instrucoes: "instrucoes.txt" };

function pergunta(alteracoes: Partial<PerguntaAoMotorDeChat> = {}): PerguntaAoMotorDeChat {
  return {
    sessaoId: "sessao-1",
    sessaoIniciada: false,
    mensagem: "oi",
    instrucoes: "seja breve",
    imagens: [],
    pastaDasImagens: null,
    pastaDaSessao: "C:\\dados\\chat\\sessao-1",
    pastaDosProjetos: "C:\\Users\\ana\\projetos",
    modelo: "haiku",
    esforco: "padrao",
    ...alteracoes,
  };
}

/** Valores de uma opção variádica: tudo entre ela e a próxima opção. */
function valoresDe(argumentos: string[], opcao: string): string[] {
  const inicio = argumentos.indexOf(opcao) + 1;
  const fim = argumentos.findIndex((argumento, indice) => indice >= inicio && argumento.startsWith("--"));
  return argumentos.slice(inicio, fim === -1 ? undefined : fim);
}

describe("montarArgumentosDoChat", () => {
  it("pede saída em stream-json com mensagens parciais", () => {
    const argumentos = montarArgumentosDoChat(pergunta(), arquivos);

    expect(argumentos.slice(0, 7)).toEqual([
      "-p",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
    ]);
    expect(argumentos).toContain("--strict-mcp-config");
    expect(valoresDe(argumentos, "--permission-mode")).toEqual(["dontAsk"]);
    expect(valoresDe(argumentos, "--append-system-prompt-file")).toEqual(["instrucoes.txt"]);
    expect(valoresDe(argumentos, "--model")).toEqual(["haiku"]);
  });

  it("libera só pesquisa e leitura, sem Subagentes", () => {
    const argumentos = montarArgumentosDoChat(pergunta(), arquivos);

    expect(valoresDe(argumentos, "--tools")).toEqual(["WebSearch", "WebFetch", "Read", "Glob", "Grep"]);
    expect(valoresDe(argumentos, "--allowedTools")).toEqual([...FERRAMENTAS_DO_CHAT]);
    expect(argumentos).not.toContain("Agent");
    expect(argumentos).not.toContain("--agents");
  });

  it("nega a leitura de .env* na raiz dos projetos e na pasta da sessão, por último", () => {
    const argumentos = montarArgumentosDoChat(pergunta(), arquivos);

    expect(valoresDe(argumentos, "--disallowedTools")).toEqual([
      "Read(//c/Users/ana/projetos/**/.env*)",
      "Read(.env*)",
    ]);
    expect(argumentos.at(-1)).toBe("Read(.env*)");
  });

  it("adiciona a raiz dos projetos e, só com imagens, a pasta das imagens", () => {
    const semImagens = montarArgumentosDoChat(pergunta({ pastaDasImagens: "C:\\anexos" }), arquivos);
    expect(valoresDe(semImagens, "--add-dir")).toEqual(["C:\\Users\\ana\\projetos"]);
    expect(semImagens).not.toContain("C:\\anexos");

    const comImagens = montarArgumentosDoChat(
      pergunta({ pastaDasImagens: "C:\\anexos", imagens: [{ caminho: "C:\\anexos\\a.png", tipoDeMidia: "image/png" }] }),
      arquivos,
    );
    const pastas = comImagens.flatMap((argumento, indice) => (argumento === "--add-dir" ? [comImagens[indice + 1]] : []));
    expect(pastas).toEqual(["C:\\Users\\ana\\projetos", "C:\\anexos"]);
  });

  it("cria a sessão na primeira pergunta e retoma nas seguintes", () => {
    const primeira = montarArgumentosDoChat(pergunta(), arquivos);
    expect(valoresDe(primeira, "--session-id")).toEqual(["sessao-1"]);
    expect(primeira).not.toContain("--resume");

    const seguinte = montarArgumentosDoChat(pergunta({ sessaoIniciada: true }), arquivos);
    expect(valoresDe(seguinte, "--resume")).toEqual(["sessao-1"]);
    expect(seguinte).not.toContain("--session-id");
  });

  it("manda --effort só com esforço escolhido", () => {
    expect(montarArgumentosDoChat(pergunta(), arquivos)).not.toContain("--effort");
    expect(valoresDe(montarArgumentosDoChat(pergunta({ esforco: "baixo" }), arquivos), "--effort")).toEqual(["low"]);
    expect(valoresDe(montarArgumentosDoChat(pergunta({ esforco: "maximo" }), arquivos), "--effort")).toEqual(["max"]);
  });
});

describe("caminhoParaRegraDePermissao", () => {
  it("converte caminho do Windows para o formato POSIX absoluto das regras", () => {
    expect(caminhoParaRegraDePermissao("C:\\Users\\ana\\projetos\\")).toBe("//c/Users/ana/projetos");
    expect(caminhoParaRegraDePermissao("D:/trabalho")).toBe("//d/trabalho");
  });

  it("mantém caminho POSIX e escapa caracteres de padrão do gitignore", () => {
    expect(caminhoParaRegraDePermissao("/home/ana/projetos")).toBe("//home/ana/projetos");
    expect(caminhoParaRegraDePermissao("C:\\x\\[novo]")).toBe("//c/x/\\[novo\\]");
  });

  it("a regra cobre .env, .env.local e .env.production em qualquer subpasta", () => {
    expect(regrasDeNegacaoDoChat("C:\\p")[0]).toBe("Read(//c/p/**/.env*)");
  });
});

describe("montarAmbienteDoChat", () => {
  const base = {
    PATH: "x",
    CLAUDECODE: "1",
    CLAUDE_CODE_ENTRYPOINT: "cli",
    CLAUDE_CODE_SESSION_ID: "pai",
    CLAUDE_CODE_EFFORT_LEVEL: "high",
  };

  it("remove as variáveis da sessão pai", () => {
    const ambiente = montarAmbienteDoChat(base, "padrao");

    expect(ambiente.CLAUDECODE).toBeUndefined();
    expect(ambiente.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
    expect(ambiente.CLAUDE_CODE_SESSION_ID).toBeUndefined();
    expect(ambiente.PATH).toBe("x");
  });

  it("tira CLAUDE_CODE_EFFORT_LEVEL só com esforço escolhido", () => {
    expect(montarAmbienteDoChat(base, "padrao").CLAUDE_CODE_EFFORT_LEVEL).toBe("high");
    expect(montarAmbienteDoChat(base, "baixo").CLAUDE_CODE_EFFORT_LEVEL).toBeUndefined();
  });

  it("não altera o ambiente recebido", () => {
    montarAmbienteDoChat(base, "baixo");
    expect(base.CLAUDECODE).toBe("1");
  });
});
