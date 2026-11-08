import { describe, expect, it } from "vitest";

import type { PerguntaAoMotorDeChat } from "../../chat/MotorDeChat";
import {
  caminhoParaRegraDePermissao,
  configuracoesDaSessaoDoChat,
  FERRAMENTAS_DO_CHAT,
  montarAmbienteDoChat,
  montarArgumentosDoChat,
  regrasDeNegacaoDoChat,
} from "./ArgumentosDoChat";
import { COMANDOS_DE_PUSH_FORCADO } from "./ArgumentosDoClaudeCode";

const arquivos = { instrucoes: "instrucoes.txt", configuracoes: "configuracoes.json" };

/** Pasta de artefatos do chat, com espaço no caminho como a pasta de dados real. */
const PASTA_DE_ARTEFATOS = "C:\\Users\\ana\\Orquestrador de Agentes\\dados\\artefatos\\entrada\\chat";
const REGRAS_DE_ARTEFATO = [
  "Write(//c/Users/ana/Orquestrador de Agentes/dados/artefatos/entrada/chat/**)",
  "Edit(//c/Users/ana/Orquestrador de Agentes/dados/artefatos/entrada/chat/**)",
];

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
    pastaDeArtefatos: PASTA_DE_ARTEFATOS,
    modelo: "haiku",
    esforco: "padrao",
    alteracoesAutorizadas: false,
    ...alteracoes,
  };
}

const LEITURA = ["WebSearch", "WebFetch", "Read", "Glob", "Grep"];
const TODAS = [...LEITURA, "Edit", "Write", "NotebookEdit", "PowerShell", "Bash"];

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

  it("--tools traz sempre as dez ferramentas, sem Subagentes", () => {
    for (const alteracoesAutorizadas of [false, true]) {
      const argumentos = montarArgumentosDoChat(pergunta({ alteracoesAutorizadas }), arquivos);

      expect(valoresDe(argumentos, "--tools")).toEqual(TODAS);
      expect(argumentos).not.toContain("Agent");
      expect(argumentos).not.toContain("--agents");
    }
    expect([...FERRAMENTAS_DO_CHAT]).toEqual(TODAS);
  });

  it("sem autorização, --allowedTools libera só pesquisa, leitura e a gravação na pasta de artefatos", () => {
    const argumentos = montarArgumentosDoChat(pergunta({ alteracoesAutorizadas: false }), arquivos);
    const liberadas = valoresDe(argumentos, "--allowedTools");

    expect(liberadas).toEqual([...LEITURA, ...REGRAS_DE_ARTEFATO]);
    // Editar projetos e rodar comandos continuam negados (e pedem autorização).
    for (const ferramenta of ["Edit", "Write", "NotebookEdit", "PowerShell", "Bash"]) {
      expect(liberadas).not.toContain(ferramenta);
    }
  });

  it("libera a pasta de artefatos em --add-dir, com ou sem autorização", () => {
    for (const alteracoesAutorizadas of [false, true]) {
      const argumentos = montarArgumentosDoChat(pergunta({ alteracoesAutorizadas }), arquivos);

      expect(pastasLiberadas(argumentos)).toEqual(["C:\\Users\\ana\\projetos", PASTA_DE_ARTEFATOS]);
      expect(valoresDe(argumentos, "--tools")).toEqual(expect.arrayContaining(["Write", "Edit"]));
    }
  });

  it("com autorização, --allowedTools libera as dez ferramentas", () => {
    const argumentos = montarArgumentosDoChat(pergunta({ alteracoesAutorizadas: true }), arquivos);

    expect(valoresDe(argumentos, "--allowedTools")).toEqual(TODAS);
  });

  it("nega sempre .env* e o push forçado, com --disallowedTools por último", () => {
    for (const alteracoesAutorizadas of [false, true]) {
      const argumentos = montarArgumentosDoChat(pergunta({ alteracoesAutorizadas }), arquivos);
      const negados = valoresDe(argumentos, "--disallowedTools");

      expect(negados).toEqual(["Read(//c/Users/ana/projetos/**/.env*)", "Read(.env*)", ...COMANDOS_DE_PUSH_FORCADO]);
      expect(negados).toContain("PowerShell(git push *--force*)");
      expect(negados).toContain("Bash(git push * +*)");
      expect(argumentos.lastIndexOf("--disallowedTools")).toBe(argumentos.length - negados.length - 1);
      expect(argumentos.at(-1)).toBe(COMANDOS_DE_PUSH_FORCADO.at(-1));
      // Commit e push comuns não são bloqueados: dependem do pedido explícito do usuário.
      expect(negados).not.toContain("PowerShell(git commit:*)");
    }
  });

  it("passa --settings sempre, com o arquivo da configuração da sessão", () => {
    for (const alteracoesAutorizadas of [false, true]) {
      const argumentos = montarArgumentosDoChat(pergunta({ alteracoesAutorizadas }), arquivos);

      expect(valoresDe(argumentos, "--settings")).toEqual(["configuracoes.json"]);
    }
  });

  it("continua com --permission-mode dontAsk e a raiz dos projetos em --add-dir, com ou sem autorização", () => {
    const argumentos = montarArgumentosDoChat(pergunta({ alteracoesAutorizadas: true }), arquivos);

    expect(valoresDe(argumentos, "--permission-mode")).toEqual(["dontAsk"]);
    expect(valoresDe(argumentos, "--add-dir")).toEqual(["C:\\Users\\ana\\projetos"]);
  });

  it("adiciona a raiz dos projetos e, só com imagens, a pasta das imagens", () => {
    const semImagens = montarArgumentosDoChat(pergunta({ pastaDasImagens: "C:\\anexos" }), arquivos);
    expect(valoresDe(semImagens, "--add-dir")).toEqual(["C:\\Users\\ana\\projetos"]);
    expect(semImagens).not.toContain("C:\\anexos");

    const comImagens = montarArgumentosDoChat(
      pergunta({ pastaDasImagens: "C:\\anexos", imagens: [{ caminho: "C:\\anexos\\a.png", tipoDeMidia: "image/png" }] }),
      arquivos,
    );
    expect(pastasLiberadas(comImagens)).toEqual(["C:\\Users\\ana\\projetos", PASTA_DE_ARTEFATOS, "C:\\anexos"]);
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

  describe("com esforço ultracode", () => {
    it("manda --effort ultracode e acrescenta o Workflow às ferramentas da sessão", () => {
      const argumentos = montarArgumentosDoChat(pergunta({ esforco: "ultracode" }), arquivos);

      expect(valoresDe(argumentos, "--effort")).toEqual(["ultracode"]);
      expect(valoresDe(argumentos, "--tools")).toEqual([...TODAS, "Workflow"]);
    });

    it("libera o Workflow sem autorização, junto da leitura e da pasta de artefatos", () => {
      const argumentos = montarArgumentosDoChat(pergunta({ esforco: "ultracode" }), arquivos);

      expect(valoresDe(argumentos, "--allowedTools")).toEqual([...LEITURA, ...REGRAS_DE_ARTEFATO, "Workflow"]);
    });

    it("com alterações autorizadas, libera tudo mais o Workflow", () => {
      const argumentos = montarArgumentosDoChat(
        pergunta({ esforco: "ultracode", alteracoesAutorizadas: true }),
        arquivos,
      );

      expect(valoresDe(argumentos, "--allowedTools")).toEqual([...TODAS, "Workflow"]);
    });

    it("nos outros esforços, o Workflow não aparece", () => {
      for (const esforco of ["padrao", "extra_alto", "maximo"] as const) {
        expect(montarArgumentosDoChat(pergunta({ esforco }), arquivos)).not.toContain("Workflow");
      }
    });

    it("tira CLAUDE_CODE_EFFORT_LEVEL do ambiente", () => {
      expect(montarAmbienteDoChat({ CLAUDE_CODE_EFFORT_LEVEL: "high" }, "ultracode").CLAUDE_CODE_EFFORT_LEVEL).toBeUndefined();
    });
  });
});

describe("configuracoesDaSessaoDoChat", () => {
  it("desliga a atribuição Co-authored-by com textos vazios", () => {
    expect(configuracoesDaSessaoDoChat()).toEqual({ attribution: { commit: "", pr: "" } });
    expect(JSON.stringify(configuracoesDaSessaoDoChat())).toBe('{"attribution":{"commit":"","pr":""}}');
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
