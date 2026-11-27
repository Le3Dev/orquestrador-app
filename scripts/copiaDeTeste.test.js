"use strict";

// O vitest não pode ser carregado por require(); o resto segue em CommonJS.
import { describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  ambienteDaCopia,
  argumentosDoElectron,
  arquivoDeLogDaCopia,
  camposSegurosDoConfig,
  comandoEhDoElectron,
  copiaEstaAberta,
  ehDoAppInstalado,
  garantirPastaForaDoAppInstalado,
  lerArgumentos,
  lerEstado,
  pastaDoAppInstalado,
  pastaIsoladaDaCopia,
  pidVivo,
  slugDaBranch,
  NOME_DO_ARQUIVO_DE_ESTADO,
} = require("./copiaDeTeste.cjs");

describe("slugDaBranch", () => {
  it("troca barras e símbolos por hífen", () => {
    expect(slugDaBranch("feature/atualizar-pelo-botao-no-mac")).toBe("feature-atualizar-pelo-botao-no-mac");
  });

  it("tira acentos e maiúsculas", () => {
    expect(slugDaBranch("Fix/Correção Ágil")).toBe("fix-correcao-agil");
  });

  it("commit curto passa como está", () => {
    expect(slugDaBranch("84d5bce")).toBe("84d5bce");
  });

  it("limita o tamanho sem terminar em hífen", () => {
    const slug = slugDaBranch(`feature/${"a".repeat(51)}-bbbb`);
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("vazio vira sem-nome", () => {
    expect(slugDaBranch("///")).toBe("sem-nome");
    expect(slugDaBranch(undefined)).toBe("sem-nome");
  });
});

describe("pasta isolada e log", () => {
  it("fica no tmp com o prefixo e o slug", () => {
    expect(pastaIsoladaDaCopia("feature-x", "/tmp/base")).toBe(path.join("/tmp/base", "orquestrador-copia-de-teste-feature-x"));
  });

  it("log em /tmp no Mac e no tmp do sistema no Windows", () => {
    expect(arquivoDeLogDaCopia("feature-x", "darwin")).toBe(path.join("/tmp", "copia-de-teste-feature-x.log"));
    expect(arquivoDeLogDaCopia("feature-x", "win32", "/temp")).toBe(path.join("/temp", "copia-de-teste-feature-x.log"));
  });

  it("a pasta isolada nunca é a do app instalado", () => {
    const instalado = pastaDoAppInstalado({ plataforma: "darwin", pastaPessoal: "/Users/alguem" });
    expect(ehDoAppInstalado(pastaIsoladaDaCopia("main", "/tmp"), instalado, "darwin")).toBe(false);
  });
});

describe("pastaDoAppInstalado", () => {
  it("Mac: Application Support", () => {
    expect(pastaDoAppInstalado({ plataforma: "darwin", pastaPessoal: "/Users/alguem" })).toBe(
      path.join("/Users/alguem", "Library", "Application Support", "Orquestrador de Agentes"),
    );
  });

  it("Windows: APPDATA", () => {
    expect(pastaDoAppInstalado({ plataforma: "win32", ambiente: { APPDATA: "/c/Roaming" }, pastaPessoal: "/c" })).toBe(
      path.join("/c/Roaming", "Orquestrador de Agentes"),
    );
  });
});

describe("recusa da pasta do app instalado", () => {
  const instalado = "/Users/alguem/Library/Application Support/Orquestrador de Agentes";

  it("a própria pasta, com barra no fim ou outra caixa (Mac)", () => {
    expect(ehDoAppInstalado(instalado, instalado, "darwin")).toBe(true);
    expect(ehDoAppInstalado(`${instalado}/`, instalado, "darwin")).toBe(true);
    expect(ehDoAppInstalado(instalado.toUpperCase(), instalado, "darwin")).toBe(true);
  });

  it("uma subpasta dela também", () => {
    expect(ehDoAppInstalado(`${instalado}/dados`, instalado, "darwin")).toBe(true);
  });

  it("caminho relativo que resolve para ela", () => {
    expect(ehDoAppInstalado(`${instalado}/dados/..`, instalado, "darwin")).toBe(true);
  });

  it("pasta vizinha com nome parecido passa", () => {
    expect(ehDoAppInstalado(`${instalado} 2`, instalado, "darwin")).toBe(false);
    expect(ehDoAppInstalado("", instalado, "darwin")).toBe(false);
  });

  it("garantirPastaForaDoAppInstalado lança só para a do instalado", () => {
    expect(() => garantirPastaForaDoAppInstalado(instalado, instalado, "darwin")).toThrow(/Recusado/);
    expect(() => garantirPastaForaDoAppInstalado("/tmp/orquestrador-copia-de-teste-x", instalado, "darwin")).not.toThrow();
  });
});

describe("camposSegurosDoConfig", () => {
  it("leva só a raiz dos projetos e o Claude Code", () => {
    const config = {
      pastaRaizDosProjetos: " /Users/alguem/Projetos ",
      caminhoDoClaudeCode: "/opt/homebrew/bin/claude",
      historicoImportadoDe: "/algum/lugar",
      porta: 3299,
      chave: "segredo",
      licenca: { token: "x" },
    };
    expect(camposSegurosDoConfig(config)).toEqual({
      pastaRaizDosProjetos: "/Users/alguem/Projetos",
      caminhoDoClaudeCode: "/opt/homebrew/bin/claude",
    });
  });

  it("ignora vazios e tipos errados", () => {
    expect(camposSegurosDoConfig({ pastaRaizDosProjetos: "", caminhoDoClaudeCode: 42 })).toEqual({});
    expect(camposSegurosDoConfig(null)).toEqual({});
  });
});

describe("ambienteDaCopia", () => {
  it("tira porta, pastas, chave e sessão do Claude Code; põe a pasta isolada e o nome", () => {
    const ambiente = ambienteDaCopia(
      {
        PATH: "/usr/bin",
        HOME: "/Users/alguem",
        PORTA: "3299",
        PASTA_DADOS: "/x",
        PASTA_DA_TELA: "/y",
        PASTA_RAIZ_PROJETOS: "/z",
        ELECTRON_RUN_AS_NODE: "1",
        ORQUESTRADOR_URL_DA_TELA: "http://vite",
        ORQUESTRADOR_PASTA_DO_USUARIO: "/instalado",
        ORQUESTRADOR_CHAVE_DE_ACESSO: "segredo",
        CLAUDECODE: "1",
        CLAUDE_CODE_BIN: "/claude",
        CLAUDE_CODE_SESSION_ID: "abc",
      },
      { pastaDoUsuario: "/tmp/orquestrador-copia-de-teste-x", nome: "feature/x" },
    );
    expect(ambiente).toEqual({
      PATH: "/usr/bin",
      HOME: "/Users/alguem",
      ORQUESTRADOR_PASTA_DO_USUARIO: "/tmp/orquestrador-copia-de-teste-x",
      ORQUESTRADOR_COPIA_DE_TESTE: "feature/x",
    });
  });
});

describe("argumentosDoElectron", () => {
  it("no Mac troca o Chaveiro por um falso; fora dele só a pasta", () => {
    expect(argumentosDoElectron("darwin")).toEqual([".", "--use-mock-keychain"]);
    expect(argumentosDoElectron("win32")).toEqual(["."]);
  });
});

describe("estado da cópia", () => {
  const criarPasta = () => fs.mkdtempSync(path.join(os.tmpdir(), "copia-de-teste-unit-"));

  it("lê o estado gravado", () => {
    const pasta = criarPasta();
    fs.writeFileSync(path.join(pasta, NOME_DO_ARQUIVO_DE_ESTADO), JSON.stringify({ pid: 123, nome: "x", porta: 4000 }));
    expect(lerEstado(pasta)).toMatchObject({ pid: 123, porta: 4000 });
    fs.rmSync(pasta, { recursive: true, force: true });
  });

  it("sem arquivo, corrompido ou sem pid: null", () => {
    const pasta = criarPasta();
    expect(lerEstado(pasta)).toBeNull();
    fs.writeFileSync(path.join(pasta, NOME_DO_ARQUIVO_DE_ESTADO), "{ quebrado");
    expect(lerEstado(pasta)).toBeNull();
    fs.writeFileSync(path.join(pasta, NOME_DO_ARQUIVO_DE_ESTADO), JSON.stringify({ nome: "x" }));
    expect(lerEstado(pasta)).toBeNull();
    fs.rmSync(pasta, { recursive: true, force: true });
  });

  it("pidVivo: ESRCH é morto, EPERM é vivo, pid inválido é morto", () => {
    const falha = (code) => () => {
      throw Object.assign(new Error(code), { code });
    };
    expect(pidVivo(10, falha("ESRCH"))).toBe(false);
    expect(pidVivo(10, falha("EPERM"))).toBe(true);
    expect(pidVivo(10, () => true)).toBe(true);
    expect(pidVivo(0, () => true)).toBe(false);
    expect(pidVivo(undefined, () => true)).toBe(false);
    expect(pidVivo(process.pid)).toBe(true);
  });

  it("copiaEstaAberta: pid morto, pid reaproveitado e Electron vivo", () => {
    const estado = { pid: 77, nome: "x" };
    expect(copiaEstaAberta(null)).toBe(false);
    expect(copiaEstaAberta(estado, { vivo: () => false, comandoDoPid: () => "Electron ." })).toBe(false);
    expect(copiaEstaAberta(estado, { vivo: () => true, comandoDoPid: () => "/usr/bin/vim" })).toBe(false);
    expect(
      copiaEstaAberta(estado, { vivo: () => true, comandoDoPid: () => "/x/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron ." }),
    ).toBe(true);
    expect(copiaEstaAberta(estado, { vivo: () => true, comandoDoPid: () => null })).toBe(true);
  });

  it("comandoEhDoElectron", () => {
    expect(comandoEhDoElectron("C:\\app\\node_modules\\electron\\dist\\electron.exe .")).toBe(true);
    expect(comandoEhDoElectron("node server.js")).toBe(false);
  });
});

describe("lerArgumentos", () => {
  it("subcomando e opções", () => {
    expect(lerArgumentos(["abrir", "--pasta", "/x", "--sem-build"])).toEqual({
      comando: "abrir",
      pasta: "/x",
      todas: false,
      semBuild: true,
    });
    expect(lerArgumentos(["fechar", "--todas"])).toMatchObject({ comando: "fechar", todas: true });
  });

  it("recusa opção desconhecida e --pasta sem caminho", () => {
    expect(() => lerArgumentos(["abrir", "--xyz"])).toThrow(/desconhecido/);
    expect(() => lerArgumentos(["abrir", "--pasta"])).toThrow(/caminho/);
  });
});
