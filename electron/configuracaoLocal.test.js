"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
// O vitest não pode ser carregado por require(); o resto do arquivo segue em CommonJS.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const {
  caminhoDaConfiguracao,
  copiarDaPastaAntiga,
  detectarClaudeCode,
  escolherPortaDaInstalacao,
  gravarConfiguracaoLocal,
  lerConfiguracaoLocal,
  sugerirPastaDosProjetos,
  validarConfiguracao,
} = require("./configuracaoLocal");

const APPDATA = path.join("C:", "Users", "ana", "AppData", "Roaming");
const LOCALAPPDATA = path.join("C:", "Users", "ana", "AppData", "Local");
const USERPROFILE = path.join("C:", "Users", "ana");
const NO_NPM = path.join(APPDATA, "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
const NO_LOCAL_BIN = path.join(USERPROFILE, ".local", "bin", "claude.exe");
const NO_PROGRAMS = path.join(LOCALAPPDATA, "Programs", "claude", "claude.exe");

const existeSo = (...caminhos) => (caminho) => caminhos.includes(caminho);

describe("detectarClaudeCode", () => {
  const ambiente = { APPDATA, LOCALAPPDATA, USERPROFILE };

  it("prefere o CLAUDE_CODE_BIN quando ele existe", () => {
    const proprio = path.join("D:", "ferramentas", "claude.exe");
    const resultado = detectarClaudeCode({ ...ambiente, CLAUDE_CODE_BIN: proprio }, existeSo(proprio, NO_NPM));
    expect(resultado).toBe(proprio);
  });

  it("segue a ordem: npm, .local\\bin, Programs", () => {
    expect(detectarClaudeCode(ambiente, existeSo(NO_NPM, NO_LOCAL_BIN, NO_PROGRAMS))).toBe(NO_NPM);
    expect(detectarClaudeCode(ambiente, existeSo(NO_LOCAL_BIN, NO_PROGRAMS))).toBe(NO_LOCAL_BIN);
    expect(detectarClaudeCode(ambiente, existeSo(NO_PROGRAMS))).toBe(NO_PROGRAMS);
  });

  it("ignora um CLAUDE_CODE_BIN que não existe", () => {
    const resultado = detectarClaudeCode({ ...ambiente, CLAUDE_CODE_BIN: "X:\\nao\\tem.exe" }, existeSo(NO_PROGRAMS));
    expect(resultado).toBe(NO_PROGRAMS);
  });

  it("devolve null quando nada existe", () => {
    expect(detectarClaudeCode(ambiente, () => false)).toBeNull();
    expect(detectarClaudeCode({}, () => true)).toBeNull();
  });
});

describe("sugerirPastaDosProjetos", () => {
  it("usa %USERPROFILE%\\projetos quando existe", () => {
    const projetos = path.join(USERPROFILE, "projetos");
    expect(sugerirPastaDosProjetos({ USERPROFILE }, existeSo(projetos))).toBe(projetos);
  });

  it("cai na própria pasta do usuário quando não há projetos", () => {
    expect(sugerirPastaDosProjetos({ USERPROFILE }, () => false)).toBe(USERPROFILE);
  });

  it("devolve null sem pasta do usuário", () => {
    expect(sugerirPastaDosProjetos({}, () => true)).toBeNull();
  });
});

describe("validarConfiguracao", () => {
  const pasta = path.resolve(os.tmpdir(), "projetos-validos");
  const claude = path.resolve(os.tmpdir(), "claude.exe");
  const verificadores = { ehPasta: existeSo(pasta), ehArquivo: existeSo(claude) };

  it("aceita pasta e arquivo existentes", () => {
    expect(validarConfiguracao({ pastaRaizDosProjetos: pasta, caminhoDoClaudeCode: claude }, verificadores)).toEqual([]);
  });

  it("recusa campos vazios, caminhos relativos e inexistentes", () => {
    expect(validarConfiguracao({}, verificadores)).toHaveLength(2);
    expect(
      validarConfiguracao({ pastaRaizDosProjetos: "projetos", caminhoDoClaudeCode: "claude.exe" }, verificadores),
    ).toHaveLength(2);
    const erros = validarConfiguracao(
      { pastaRaizDosProjetos: pasta + "-x", caminhoDoClaudeCode: claude },
      verificadores,
    );
    expect(erros).toEqual([`A pasta dos projetos não existe: ${pasta}-x`]);
  });
});

describe("lerConfiguracaoLocal / gravarConfiguracaoLocal", () => {
  let pastaDoUsuario;

  beforeEach(() => {
    pastaDoUsuario = fs.mkdtempSync(path.join(os.tmpdir(), "orq-config-"));
  });

  afterEach(() => {
    fs.rmSync(pastaDoUsuario, { recursive: true, force: true });
  });

  it("devolve null quando ainda não há config.json", () => {
    expect(lerConfiguracaoLocal(pastaDoUsuario)).toBeNull();
  });

  it("grava e lê de volta, sem deixar o temporário", () => {
    const dados = {
      pastaRaizDosProjetos: "C:\\p",
      caminhoDoClaudeCode: "C:\\c.exe",
      historicoImportadoDe: null,
      porta: 51_234,
    };
    gravarConfiguracaoLocal(pastaDoUsuario, dados);
    expect(lerConfiguracaoLocal(pastaDoUsuario)).toEqual(dados);
    expect(fs.readdirSync(pastaDoUsuario)).toEqual(["config.json"]);
  });

  it("cria a pasta do usuário se faltar", () => {
    const dentro = path.join(pastaDoUsuario, "a", "b");
    gravarConfiguracaoLocal(dentro, { pastaRaizDosProjetos: "x", caminhoDoClaudeCode: "y" });
    expect(lerConfiguracaoLocal(dentro)).toEqual({
      pastaRaizDosProjetos: "x",
      caminhoDoClaudeCode: "y",
      historicoImportadoDe: null,
      porta: null,
    });
  });

  it("normaliza um arquivo editado à mão", () => {
    fs.writeFileSync(
      caminhoDaConfiguracao(pastaDoUsuario),
      JSON.stringify({ pastaRaizDosProjetos: "  C:\\p  ", caminhoDoClaudeCode: 3, historicoImportadoDe: "", porta: 70_000 }),
    );
    expect(lerConfiguracaoLocal(pastaDoUsuario)).toEqual({
      pastaRaizDosProjetos: "C:\\p",
      caminhoDoClaudeCode: "",
      historicoImportadoDe: null,
      porta: null,
    });
  });

  it("explica quando o arquivo está corrompido", () => {
    fs.writeFileSync(caminhoDaConfiguracao(pastaDoUsuario), "{ quebrado");
    expect(() => lerConfiguracaoLocal(pastaDoUsuario)).toThrow(/corrompida/);
  });
});

describe("escolherPortaDaInstalacao", () => {
  const sortear = (porta) => async () => porta;
  const livre = (...portas) => async (porta) => portas.includes(porta);

  it("PORTA do ambiente vale por cima da gravada, sem testar se está livre", async () => {
    const resultado = await escolherPortaDaInstalacao({
      portaDoAmbiente: "4000",
      portaGravada: 51_000,
      estaLivre: async () => false,
      sortearPortaLivre: sortear(9),
    });
    expect(resultado).toEqual({ porta: 4000, origem: "ambiente" });
  });

  it("recusa uma PORTA inválida no ambiente", async () => {
    await expect(
      escolherPortaDaInstalacao({ portaDoAmbiente: "abc", portaGravada: null, estaLivre: livre(), sortearPortaLivre: sortear(9) }),
    ).rejects.toThrow(/PORTA inválida/);
  });

  it("reaproveita a porta gravada quando ela está livre", async () => {
    const resultado = await escolherPortaDaInstalacao({
      portaGravada: 51_000,
      estaLivre: livre(51_000),
      sortearPortaLivre: sortear(9),
    });
    expect(resultado).toEqual({ porta: 51_000, origem: "gravada" });
  });

  it("troca a porta gravada quando ela está ocupada", async () => {
    const resultado = await escolherPortaDaInstalacao({
      portaGravada: 51_000,
      estaLivre: livre(),
      sortearPortaLivre: sortear(52_000),
    });
    expect(resultado).toEqual({ porta: 52_000, origem: "trocada", anterior: 51_000 });
  });

  it("sorteia uma porta nova na primeira vez", async () => {
    const resultado = await escolherPortaDaInstalacao({
      portaGravada: null,
      estaLivre: livre(),
      sortearPortaLivre: sortear(53_000),
    });
    expect(resultado).toEqual({ porta: 53_000, origem: "nova" });
  });
});

describe("copiarDaPastaAntiga", () => {
  let raiz;
  let antiga;
  let nova;

  const escrever = (arquivo, conteudo) => {
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    fs.writeFileSync(arquivo, conteudo);
  };

  beforeEach(() => {
    raiz = fs.mkdtempSync(path.join(os.tmpdir(), "orq-migracao-"));
    antiga = path.join(raiz, "orquestrador-agentes-app");
    nova = path.join(raiz, "Orquestrador de Agentes");
  });

  afterEach(() => {
    fs.rmSync(raiz, { recursive: true, force: true });
  });

  it("copia config.json e dados/, sem caches, e mantém a pasta antiga intacta", () => {
    escrever(path.join(antiga, "config.json"), '{"pastaRaizDosProjetos":"C:\\p"}');
    escrever(path.join(antiga, "dados", "orquestradores", "a.json"), "{}");
    escrever(path.join(antiga, "Cache", "f_000001"), "cache");
    escrever(path.join(antiga, "Local Storage", "leveldb", "x.log"), "ls");

    const resumo = copiarDaPastaAntiga({ pastaNova: nova, pastaAntiga: antiga });

    expect(resumo).toEqual({ de: antiga, para: nova, copiouDados: true });
    expect(fs.readFileSync(path.join(nova, "config.json"), "utf8")).toContain("pastaRaizDosProjetos");
    expect(fs.existsSync(path.join(nova, "dados", "orquestradores", "a.json"))).toBe(true);
    expect(fs.readdirSync(nova).sort()).toEqual(["config.json", "dados"]);
    expect(fs.readdirSync(antiga).sort()).toEqual(["Cache", "Local Storage", "config.json", "dados"]);
    expect(fs.existsSync(path.join(antiga, "dados", "orquestradores", "a.json"))).toBe(true);
  });

  it("não faz nada quando a pasta nova já tem config.json", () => {
    escrever(path.join(antiga, "config.json"), "{}");
    escrever(path.join(antiga, "dados", "a.json"), "{}");
    escrever(path.join(nova, "config.json"), '{"porta":5}');

    expect(copiarDaPastaAntiga({ pastaNova: nova, pastaAntiga: antiga })).toBeNull();
    expect(fs.existsSync(path.join(nova, "dados"))).toBe(false);
    expect(fs.readFileSync(path.join(nova, "config.json"), "utf8")).toBe('{"porta":5}');
  });

  it("não faz nada quando a pasta antiga não tem config.json (ou é a mesma)", () => {
    escrever(path.join(antiga, "dados", "a.json"), "{}");
    expect(copiarDaPastaAntiga({ pastaNova: nova, pastaAntiga: antiga })).toBeNull();
    expect(fs.existsSync(nova)).toBe(false);
    escrever(path.join(antiga, "config.json"), "{}");
    expect(copiarDaPastaAntiga({ pastaNova: antiga, pastaAntiga: antiga })).toBeNull();
  });

  it("sem dados/ na antiga, copia só o config.json; não sobrescreve dados já na nova", () => {
    escrever(path.join(antiga, "config.json"), "{}");
    expect(copiarDaPastaAntiga({ pastaNova: nova, pastaAntiga: antiga })).toEqual({
      de: antiga,
      para: nova,
      copiouDados: false,
    });

    const outraNova = path.join(raiz, "outra");
    escrever(path.join(antiga, "dados", "a.json"), "antigo");
    escrever(path.join(outraNova, "dados", "a.json"), "novo");
    copiarDaPastaAntiga({ pastaNova: outraNova, pastaAntiga: antiga });
    expect(fs.readFileSync(path.join(outraNova, "dados", "a.json"), "utf8")).toBe("novo");
  });
});
