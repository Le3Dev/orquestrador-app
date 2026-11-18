import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ArgumentoInseguroError,
  citarParaCmd,
  comandoParaProcesso,
  ehScriptDoWindows,
  procurarExecutavel,
} from "./ExecutavelDoCli";

describe("procurarExecutavel", () => {
  const existentes = (...caminhos: string[]) => (caminho: string) => caminhos.includes(caminho);

  it("no Windows acha o .cmd do npm pelo nome, preferindo o .exe quando há os dois", () => {
    const pasta = "C:\\Users\\x\\AppData\\Roaming\\npm";
    const ambiente = { PATH: `C:\\Windows;${pasta}` };

    expect(
      procurarExecutavel("copilot", { ambiente, plataforma: "win32", ehArquivo: existentes(path.join(pasta, "copilot.cmd")) }),
    ).toBe(path.join(pasta, "copilot.cmd"));
    expect(
      procurarExecutavel("copilot", {
        ambiente,
        plataforma: "win32",
        ehArquivo: existentes(path.join(pasta, "copilot.cmd"), path.join(pasta, "copilot.exe")),
      }),
    ).toBe(path.join(pasta, "copilot.exe"));
  });

  it("no Mac/Linux procura o nome exato nas pastas do PATH", () => {
    expect(procurarExecutavel("codex", { ambiente: { PATH: "/usr/bin:/opt/bin" }, plataforma: "linux", ehArquivo: existentes(path.join("/opt/bin", "codex")) })).toBe(
      path.join("/opt/bin", "codex"),
    );
  });

  it("confere um caminho informado em vez de procurá-lo no PATH", () => {
    const caminho = path.join(path.sep, "ferramentas", "codex");

    expect(procurarExecutavel(caminho, { plataforma: "linux", ehArquivo: existentes(caminho) })).toBe(caminho);
    expect(procurarExecutavel(caminho, { plataforma: "linux", ehArquivo: () => false })).toBeNull();
  });

  it("devolve nulo quando o CLI não existe ou o nome vem vazio", () => {
    expect(procurarExecutavel("codex", { ambiente: { PATH: "/usr/bin" }, plataforma: "linux", ehArquivo: () => false })).toBeNull();
    expect(procurarExecutavel("  ")).toBeNull();
  });
});

describe("comandoParaProcesso", () => {
  it("inicia um .exe (ou qualquer binário do Mac/Linux) direto, sem shell", () => {
    expect(comandoParaProcesso("C:\\x\\codex.exe", ["app-server"], "win32")).toEqual({
      comando: "C:\\x\\codex.exe",
      argumentos: ["app-server"],
      verbatim: false,
    });
    expect(comandoParaProcesso("/usr/bin/copilot", ["--acp"], "linux").verbatim).toBe(false);
  });

  it("roda um .cmd do Windows pelo cmd.exe, com cada argumento citado", () => {
    const comando = comandoParaProcesso(
      "C:\\Users\\Fulano de Tal\\npm\\copilot.cmd",
      ["--acp", "--add-dir", "C:\\Meus Artefatos", "--deny-tool=shell(git commit)"],
      "win32",
      "cmd.exe",
    );

    expect(comando.comando).toBe("cmd.exe");
    expect(comando.verbatim).toBe(true);
    expect(comando.argumentos).toEqual([
      "/d",
      "/s",
      "/c",
      '""C:\\Users\\Fulano de Tal\\npm\\copilot.cmd" --acp --add-dir "C:\\Meus Artefatos" "--deny-tool=shell(git commit)""',
    ]);
  });

  it("reconhece os scripts do Windows só no Windows", () => {
    expect(ehScriptDoWindows("a.cmd", "win32")).toBe(true);
    expect(ehScriptDoWindows("A.BAT", "win32")).toBe(true);
    expect(ehScriptDoWindows("a.exe", "win32")).toBe(false);
    expect(ehScriptDoWindows("a.cmd", "linux")).toBe(false);
  });
});

describe("citarParaCmd", () => {
  it("deixa como está o que não precisa de aspas e cita o que tem espaço ou parênteses", () => {
    expect(citarParaCmd("--model")).toBe("--model");
    expect(citarParaCmd("C:\\Pasta com espaço")).toBe('"C:\\Pasta com espaço"');
    expect(citarParaCmd("shell(git push)")).toBe('"shell(git push)"');
    expect(citarParaCmd("")).toBe('""');
  });

  it("dobra a barra invertida do fim, que escaparia a aspa de fechamento", () => {
    expect(citarParaCmd("C:\\Minha pasta\\")).toBe('"C:\\Minha pasta\\\\"');
  });

  it("recusa o que o cmd.exe interpretaria: aspas, porcentagem e quebra de linha", () => {
    expect(() => citarParaCmd('a"b')).toThrow(ArgumentoInseguroError);
    expect(() => citarParaCmd("%PATH%")).toThrow(ArgumentoInseguroError);
    expect(() => citarParaCmd("a\nb")).toThrow(ArgumentoInseguroError);
  });
});
