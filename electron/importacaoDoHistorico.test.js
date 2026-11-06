"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
// O vitest não pode ser carregado por require(); o resto do arquivo segue em CommonJS.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { importarHistorico, localizarHistoricoAntigo } = require("./importacaoDoHistorico");

function escrever(arquivo, conteudo) {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, conteudo);
}

describe("importacaoDoHistorico", () => {
  let raiz;

  beforeEach(() => {
    raiz = fs.mkdtempSync(path.join(os.tmpdir(), "orq-historico-"));
  });

  afterEach(() => {
    fs.rmSync(raiz, { recursive: true, force: true });
  });

  describe("localizarHistoricoAntigo", () => {
    it("acha <pasta do app>/dados fora do app empacotado", () => {
      const pastaDoApp = path.join(raiz, "app");
      fs.mkdirSync(path.join(pastaDoApp, "dados", "orquestradores"), { recursive: true });
      const achado = localizarHistoricoAntigo({ empacotado: false, pastaDoApp, ambiente: {}, destinoDados: null });
      expect(achado).toBe(path.join(pastaDoApp, "dados"));
    });

    it("no app empacotado ignora a pasta do app e usa %USERPROFILE%\\projetos\\orquestrador-app\\dados", () => {
      const pastaDoApp = path.join(raiz, "app");
      fs.mkdirSync(path.join(pastaDoApp, "dados", "orquestradores"), { recursive: true });
      const antigo = path.join(raiz, "usuario", "projetos", "orquestrador-app", "dados");
      fs.mkdirSync(path.join(antigo, "notas"), { recursive: true });
      const achado = localizarHistoricoAntigo({
        empacotado: true,
        pastaDoApp,
        ambiente: { USERPROFILE: path.join(raiz, "usuario") },
        destinoDados: path.join(raiz, "userData", "dados"),
      });
      expect(achado).toBe(antigo);
    });

    it("só conta pastas com orquestradores/ ou notas/", () => {
      const pastaDoApp = path.join(raiz, "app");
      fs.mkdirSync(path.join(pastaDoApp, "dados", "worktrees"), { recursive: true });
      fs.mkdirSync(path.join(pastaDoApp, "dados", "chat"), { recursive: true });
      expect(localizarHistoricoAntigo({ empacotado: false, pastaDoApp, ambiente: {}, destinoDados: null })).toBeNull();
    });

    it("ignora o próprio destino", () => {
      const pastaDoApp = path.join(raiz, "app");
      const dados = path.join(pastaDoApp, "dados");
      fs.mkdirSync(path.join(dados, "orquestradores"), { recursive: true });
      expect(localizarHistoricoAntigo({ empacotado: false, pastaDoApp, ambiente: {}, destinoDados: dados })).toBeNull();
    });
  });

  describe("importarHistorico", () => {
    let origem;
    let destino;

    beforeEach(() => {
      origem = path.join(raiz, "antigo", "dados");
      destino = path.join(raiz, "userData", "dados");
      escrever(path.join(origem, "orquestradores", "o1", "orquestrador.json"), "o1");
      escrever(path.join(origem, "orquestradores", "o1", "eventos.jsonl"), "e1");
      escrever(path.join(origem, "notas", "n1.json"), "n1");
      escrever(path.join(origem, "chat", "conversa.json"), "c-antigo");
      escrever(path.join(origem, "chat", "sessao", "rascunho.txt"), "sessao-antiga");
      escrever(path.join(origem, "anexos", "o1", "img.png"), "png");
      escrever(path.join(origem, "worktrees", "abcd1234", "arquivo.txt"), "wt");
      escrever(path.join(origem, "processos-em-execucao.json"), "[]");
    });

    it("copia orquestradores, notas, chat (arquivado) e anexos, e nunca worktrees nem o registro de processos", () => {
      const resumo = importarHistorico(origem, destino);
      expect(resumo.pastas).toEqual(["orquestradores", "notas", "chat", "anexos"]);
      expect(resumo.arquivosCopiados).toBe(5);
      expect(fs.readFileSync(path.join(destino, "orquestradores", "o1", "orquestrador.json"), "utf8")).toBe("o1");
      expect(fs.readFileSync(path.join(destino, "anexos", "o1", "img.png"), "utf8")).toBe("png");
      expect(fs.existsSync(path.join(destino, "worktrees"))).toBe(false);
      expect(fs.existsSync(path.join(destino, "processos-em-execucao.json"))).toBe(false);
    });

    it("o chat antigo vai só para consulta em chat/historico/conversa-importada, sem a pasta sessao", () => {
      importarHistorico(origem, destino);
      const importada = path.join(destino, "chat", "historico", "conversa-importada");
      expect(fs.readFileSync(path.join(importada, "conversa.json"), "utf8")).toBe("c-antigo");
      // Não vira a conversa atual: a sessão do Claude Code não pode ser retomada na pasta nova.
      expect(fs.existsSync(path.join(destino, "chat", "conversa.json"))).toBe(false);
      expect(fs.existsSync(path.join(importada, "sessao"))).toBe(false);
      expect(fs.existsSync(path.join(destino, "chat", "sessao"))).toBe(false);
    });

    it("não sobrescreve o que já existe no destino", () => {
      escrever(path.join(destino, "orquestradores", "o1", "orquestrador.json"), "o1-novo");
      const resumo = importarHistorico(origem, destino);
      expect(fs.readFileSync(path.join(destino, "orquestradores", "o1", "orquestrador.json"), "utf8")).toBe("o1-novo");
      expect(resumo.ignorados).toEqual([path.join(origem, "orquestradores", "o1", "orquestrador.json")]);
      expect(resumo.arquivosCopiados).toBe(4);
    });

    it("nunca apaga nem altera a origem", () => {
      importarHistorico(origem, destino);
      importarHistorico(origem, destino);
      expect(fs.readFileSync(path.join(origem, "chat", "conversa.json"), "utf8")).toBe("c-antigo");
      expect(fs.existsSync(path.join(origem, "worktrees", "abcd1234", "arquivo.txt"))).toBe(true);
      expect(fs.existsSync(path.join(origem, "processos-em-execucao.json"))).toBe(true);
    });

    it("pula as pastas que não existem na origem", () => {
      fs.rmSync(path.join(origem, "chat"), { recursive: true });
      expect(importarHistorico(origem, destino).pastas).toEqual(["orquestradores", "notas", "anexos"]);
    });

    it("recusa origem inexistente ou igual ao destino", () => {
      expect(() => importarHistorico(path.join(raiz, "nada"), destino)).toThrow(/não existe/);
      expect(() => importarHistorico(origem, origem)).toThrow(/mesma pasta/);
    });
  });
});
