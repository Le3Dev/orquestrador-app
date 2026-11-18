import { describe, expect, it } from "vitest";

import { criarComandoDoNavegador, normalizarEnderecoDoNavegador, normalizarNomeDeTecla } from "./ComandoDoNavegador";
import { ErroDoNavegador } from "./ErroDoNavegador";

function motivoDoErro(acao: () => unknown): string | undefined {
  try {
    acao();
  } catch (erro) {
    return erro instanceof ErroDoNavegador ? erro.motivo : "outro erro";
  }
  return undefined;
}

describe("normalizarEnderecoDoNavegador", () => {
  it("aceita http e https e normaliza", () => {
    expect(normalizarEnderecoDoNavegador("https://exemplo.com/a?b=1#c")).toBe("https://exemplo.com/a?b=1#c");
    expect(normalizarEnderecoDoNavegador("HTTP://EXEMPLO.com")).toBe("http://exemplo.com/");
    expect(normalizarEnderecoDoNavegador("  https://exemplo.com  ")).toBe("https://exemplo.com/");
  });

  it("sem esquema, assume https", () => {
    expect(normalizarEnderecoDoNavegador("exemplo.com/pagina")).toBe("https://exemplo.com/pagina");
    expect(normalizarEnderecoDoNavegador("localhost:3000")).toBe("https://localhost:3000/");
  });

  it("aceita endereços de máquinas locais (qualquer site http/https vale)", () => {
    expect(normalizarEnderecoDoNavegador("http://localhost:5173/app")).toBe("http://localhost:5173/app");
    expect(normalizarEnderecoDoNavegador("http://192.168.0.10")).toBe("http://192.168.0.10/");
  });

  it.each([
    "file:///etc/passwd",
    "FILE:///C:/Windows/win.ini",
    "chrome://settings",
    "chrome-extension://abc/pagina.html",
    "devtools://devtools/bundled/inspector.html",
    "javascript:alert(1)",
    "JavaScript:void(0)",
    "data:text/html,<b>oi</b>",
    "blob:https://exemplo.com/uuid",
    "about:blank",
    "view-source:https://exemplo.com",
    "ftp://exemplo.com/arquivo",
    "mailto:alguem@exemplo.com",
  ])("recusa %s", (endereco) => {
    expect(motivoDoErro(() => normalizarEnderecoDoNavegador(endereco))).toBe("recusado");
  });

  it("recusa endereço com usuário e senha", () => {
    expect(motivoDoErro(() => normalizarEnderecoDoNavegador("https://admin:senha@exemplo.com"))).toBe("recusado");
  });

  it("recusa vazio, inválido e grande demais", () => {
    expect(motivoDoErro(() => normalizarEnderecoDoNavegador("   "))).toBe("comando_invalido");
    expect(motivoDoErro(() => normalizarEnderecoDoNavegador("http://"))).toBe("comando_invalido");
    expect(motivoDoErro(() => normalizarEnderecoDoNavegador(`https://exemplo.com/${"a".repeat(3000)}`))).toBe("comando_invalido");
  });
});

describe("normalizarNomeDeTecla", () => {
  it("normaliza maiúsculas, apelidos e a ordem dos modificadores", () => {
    expect(normalizarNomeDeTecla("enter")).toBe("Enter");
    expect(normalizarNomeDeTecla("esc")).toBe("Escape");
    expect(normalizarNomeDeTecla("arrowdown")).toBe("ArrowDown");
    expect(normalizarNomeDeTecla("f5")).toBe("F5");
    expect(normalizarNomeDeTecla("a")).toBe("a");
    expect(normalizarNomeDeTecla("ctrl+a")).toBe("Ctrl+a");
    expect(normalizarNomeDeTecla("Shift+Control+Z")).toBe("Ctrl+Shift+Z");
    expect(normalizarNomeDeTecla("cmd+Enter")).toBe("Meta+Enter");
  });

  it("recusa teclas e modificadores desconhecidos", () => {
    expect(motivoDoErro(() => normalizarNomeDeTecla("Foo"))).toBe("comando_invalido");
    expect(motivoDoErro(() => normalizarNomeDeTecla("Hyper+A"))).toBe("comando_invalido");
    expect(motivoDoErro(() => normalizarNomeDeTecla("F13"))).toBe("comando_invalido");
    expect(motivoDoErro(() => normalizarNomeDeTecla("Ctrl+"))).toBe("comando_invalido");
  });
});

describe("criarComandoDoNavegador", () => {
  it("abrir: valida e normaliza a URL", () => {
    expect(criarComandoDoNavegador({ tipo: "abrir", url: "exemplo.com" })).toEqual({
      tipo: "abrir",
      url: "https://exemplo.com/",
    });
    expect(motivoDoErro(() => criarComandoDoNavegador({ tipo: "abrir", url: "file:///etc/passwd" }))).toBe("recusado");
    expect(motivoDoErro(() => criarComandoDoNavegador({ tipo: "abrir" }))).toBe("comando_invalido");
    expect(motivoDoErro(() => criarComandoDoNavegador({ tipo: "abrir", url: 42 }))).toBe("comando_invalido");
  });

  it.each(["ler_pagina", "capturar_tela", "voltar", "avancar", "recarregar"] as const)("%s não tem campos", (tipo) => {
    expect(criarComandoDoNavegador({ tipo, extra: "ignorado" })).toEqual({ tipo });
  });

  it("clicar: exatamente um entre ref e texto", () => {
    expect(criarComandoDoNavegador({ tipo: "clicar", ref: 3 })).toEqual({ tipo: "clicar", ref: 3 });
    expect(criarComandoDoNavegador({ tipo: "clicar", texto: "Entrar" })).toEqual({ tipo: "clicar", texto: "Entrar" });
    expect(motivoDoErro(() => criarComandoDoNavegador({ tipo: "clicar" }))).toBe("comando_invalido");
    expect(motivoDoErro(() => criarComandoDoNavegador({ tipo: "clicar", ref: 1, texto: "x" }))).toBe("comando_invalido");
    expect(motivoDoErro(() => criarComandoDoNavegador({ tipo: "clicar", ref: 0 }))).toBe("comando_invalido");
    expect(motivoDoErro(() => criarComandoDoNavegador({ tipo: "clicar", ref: 1.5 }))).toBe("comando_invalido");
    expect(motivoDoErro(() => criarComandoDoNavegador({ tipo: "clicar", ref: "3" }))).toBe("comando_invalido");
    expect(motivoDoErro(() => criarComandoDoNavegador({ tipo: "clicar", texto: "  " }))).toBe("comando_invalido");
  });

  it("clicar: null e undefined contam como ausentes (clientes mandam campos vazios)", () => {
    expect(criarComandoDoNavegador({ tipo: "clicar", ref: 2, texto: undefined })).toEqual({ tipo: "clicar", ref: 2 });
    expect(criarComandoDoNavegador({ tipo: "clicar", ref: null, texto: "ok" })).toEqual({ tipo: "clicar", texto: "ok" });
  });

  it("digitar: texto obrigatório; ref e enviar opcionais", () => {
    expect(criarComandoDoNavegador({ tipo: "digitar", texto: "olá" })).toEqual({ tipo: "digitar", texto: "olá", enviar: false });
    expect(criarComandoDoNavegador({ tipo: "digitar", texto: "olá", ref: 4, enviar: true })).toEqual({
      tipo: "digitar",
      texto: "olá",
      enviar: true,
      ref: 4,
    });
    // Texto vazio vale: limpa o campo quando há `ref`.
    expect(criarComandoDoNavegador({ tipo: "digitar", texto: "", ref: 4 })).toEqual({ tipo: "digitar", texto: "", enviar: false, ref: 4 });
    expect(motivoDoErro(() => criarComandoDoNavegador({ tipo: "digitar" }))).toBe("comando_invalido");
    expect(motivoDoErro(() => criarComandoDoNavegador({ tipo: "digitar", texto: "x".repeat(10_001) }))).toBe("comando_invalido");
    expect(motivoDoErro(() => criarComandoDoNavegador({ tipo: "digitar", texto: "x", enviar: "sim" }))).toBe("comando_invalido");
    expect(motivoDoErro(() => criarComandoDoNavegador({ tipo: "digitar", texto: "x", ref: -1 }))).toBe("comando_invalido");
  });

  it("tecla: normaliza o nome", () => {
    expect(criarComandoDoNavegador({ tipo: "tecla", nome: "ctrl+a" })).toEqual({ tipo: "tecla", nome: "Ctrl+a" });
    expect(motivoDoErro(() => criarComandoDoNavegador({ tipo: "tecla", nome: "Nada" }))).toBe("comando_invalido");
    expect(motivoDoErro(() => criarComandoDoNavegador({ tipo: "tecla" }))).toBe("comando_invalido");
  });

  it("rolar: direção obrigatória; quantidade vale 1 por padrão e vai de 0 a 20", () => {
    expect(criarComandoDoNavegador({ tipo: "rolar", direcao: "baixo" })).toEqual({ tipo: "rolar", direcao: "baixo", quantidade: 1 });
    expect(criarComandoDoNavegador({ tipo: "rolar", direcao: "cima", quantidade: 2.5 })).toEqual({
      tipo: "rolar",
      direcao: "cima",
      quantidade: 2.5,
    });
    expect(motivoDoErro(() => criarComandoDoNavegador({ tipo: "rolar", direcao: "diagonal" }))).toBe("comando_invalido");
    expect(motivoDoErro(() => criarComandoDoNavegador({ tipo: "rolar" }))).toBe("comando_invalido");
    for (const quantidade of [0, -1, 21, Number.NaN, Infinity, "2"]) {
      expect(motivoDoErro(() => criarComandoDoNavegador({ tipo: "rolar", direcao: "baixo", quantidade }))).toBe("comando_invalido");
    }
  });

  it("esperar: exatamente um entre ms e texto", () => {
    expect(criarComandoDoNavegador({ tipo: "esperar", ms: 500 })).toEqual({ tipo: "esperar", ms: 500 });
    expect(criarComandoDoNavegador({ tipo: "esperar", texto: "Pronto" })).toEqual({ tipo: "esperar", texto: "Pronto" });
    expect(motivoDoErro(() => criarComandoDoNavegador({ tipo: "esperar" }))).toBe("comando_invalido");
    expect(motivoDoErro(() => criarComandoDoNavegador({ tipo: "esperar", ms: 1, texto: "x" }))).toBe("comando_invalido");
    for (const ms of [0, -5, 30_001, 1.5, "10"]) {
      expect(motivoDoErro(() => criarComandoDoNavegador({ tipo: "esperar", ms }))).toBe("comando_invalido");
    }
  });

  it("recusa o que não é um comando", () => {
    expect(motivoDoErro(() => criarComandoDoNavegador(null))).toBe("comando_invalido");
    expect(motivoDoErro(() => criarComandoDoNavegador("abrir"))).toBe("comando_invalido");
    expect(motivoDoErro(() => criarComandoDoNavegador([]))).toBe("comando_invalido");
    expect(motivoDoErro(() => criarComandoDoNavegador({}))).toBe("comando_invalido");
    expect(motivoDoErro(() => criarComandoDoNavegador({ tipo: "formatar_disco" }))).toBe("comando_invalido");
  });

  it("devolve um objeto imutável", () => {
    const comando = criarComandoDoNavegador({ tipo: "abrir", url: "https://exemplo.com" });
    expect(Object.isFrozen(comando)).toBe(true);
    expect(() => {
      (comando as { url: string }).url = "https://outro.com";
    }).toThrow(TypeError);
  });
});
