import { describe, expect, it } from "vitest";

import { ambienteDoTerminal, comandoDoShell } from "./PtyDoSistema";

describe("ambienteDoTerminal", () => {
  const base: NodeJS.ProcessEnv = {
    PATH: "/usr/bin",
    HOME: "/Users/ana",
    LANG: "pt_BR.UTF-8",
    PORTA: "3200",
    PASTA_DADOS: "/dados/reais",
    PASTA_DA_TELA: "/app/web/dist",
    PASTA_RAIZ_PROJETOS: "/projetos",
    ORQUESTRADOR_CHAVE_DE_ACESSO: "a".repeat(64),
    ORQUESTRADOR_PERMITIR_NAVEGADOR: "1",
    ORQUESTRADOR_URL_DA_TELA: "http://localhost:5173",
    CLAUDECODE: "1",
    CLAUDE_CODE_SESSION_ID: "sessao",
    AI_AGENT: "claude",
    ELECTRON_RUN_AS_NODE: "1",
    TERM: "dumb",
  };

  it("tira as variáveis do app e da sessão do Claude Code e põe TERM=xterm-256color", () => {
    const ambiente = ambienteDoTerminal(base, "darwin");

    expect(ambiente).toEqual({
      PATH: "/usr/bin",
      HOME: "/Users/ana",
      LANG: "pt_BR.UTF-8",
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
    });
  });

  it("não altera o ambiente recebido", () => {
    ambienteDoTerminal(base, "darwin");
    expect(base.PORTA).toBe("3200");
    expect(base.TERM).toBe("dumb");
  });

  it("sem LANG (app aberto pelo Finder), usa UTF-8; no Windows não mexe", () => {
    expect(ambienteDoTerminal({ PATH: "/bin" }, "darwin").LANG).toBe("en_US.UTF-8");
    expect(ambienteDoTerminal({ PATH: "C:\\" }, "win32").LANG).toBeUndefined();
  });
});

describe("comandoDoShell", () => {
  it("usa o SHELL do usuário como login shell", () => {
    expect(comandoDoShell({ SHELL: "/opt/homebrew/bin/fish" }, "darwin")).toEqual({
      arquivo: "/opt/homebrew/bin/fish",
      argumentos: ["-l"],
    });
  });

  it("sem SHELL, zsh no macOS e bash no Linux", () => {
    expect(comandoDoShell({}, "darwin")).toEqual({ arquivo: "/bin/zsh", argumentos: ["-l"] });
    expect(comandoDoShell({ SHELL: "" }, "linux")).toEqual({ arquivo: "/bin/bash", argumentos: ["-l"] });
  });

  it("no Windows, powershell.exe", () => {
    expect(comandoDoShell({ SHELL: "/bin/zsh" }, "win32")).toEqual({ arquivo: "powershell.exe", argumentos: [] });
  });
});
