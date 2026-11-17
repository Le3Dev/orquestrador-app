import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ContextoDePermissao,
  contemCommitOuPush,
  decidirPermissao,
  estaDentroDe,
  padroesDeNegacaoDeComandos,
} from "./PoliticaDePermissao";

describe("PoliticaDePermissao", () => {
  let raiz: string;
  let contexto: ContextoDePermissao;

  beforeEach(() => {
    raiz = mkdtempSync(path.join(tmpdir(), "orq-politica-"));
    mkdirSync(path.join(raiz, "projeto"));
    mkdirSync(path.join(raiz, "artefatos"));
    contexto = {
      nivel: "edicao_e_comandos",
      modo: "execucao",
      pastaDeTrabalho: path.join(raiz, "projeto"),
      pastaDeArtefatos: path.join(raiz, "artefatos"),
      pastaDosAnexos: null,
      permiteCommitEPush: false,
    };
  });

  afterEach(() => rmSync(raiz, { recursive: true, force: true }));

  const permitido = (acao: Parameters<typeof decidirPermissao>[0], parcial: Partial<ContextoDePermissao> = {}): boolean =>
    decidirPermissao(acao, { ...contexto, ...parcial }).permitido;

  const projeto = (...partes: string[]): string => path.join(raiz, "projeto", ...partes);
  const artefatos = (...partes: string[]): string => path.join(raiz, "artefatos", ...partes);
  /** Uma pasta fora do projeto, dos artefatos e da temporária do sistema (onde os testes criam as pastas). */
  const foraDeTudo = (...partes: string[]): string => path.join(path.parse(raiz).root, "OutraPasta", ...partes);

  describe("leitura, web e ferramentas do app", () => {
    it("sempre permite, em qualquer nível e no planejamento", () => {
      for (const parcial of [{ nivel: "leitura" as const }, { modo: "planejamento" as const }]) {
        expect(permitido({ tipo: "leitura" }, parcial)).toBe(true);
        expect(permitido({ tipo: "web" }, parcial)).toBe(true);
        expect(permitido({ tipo: "ferramenta_do_app" }, parcial)).toBe(true);
      }
    });

    it("nunca deixa o agente mudar o próprio modo (plano, piloto automático)", () => {
      expect(permitido({ tipo: "mudar_de_modo" })).toBe(false);
    });
  });

  describe("escrita", () => {
    it("na pasta de artefatos vale em qualquer nível e no planejamento", () => {
      expect(permitido({ tipo: "escrita", caminhos: [artefatos("r.html")] }, { nivel: "leitura" })).toBe(true);
      expect(permitido({ tipo: "escrita", caminhos: [artefatos("sub", "r.md")] }, { modo: "planejamento" })).toBe(true);
    });

    it("no projeto só do nível edicao em diante e fora do planejamento", () => {
      expect(permitido({ tipo: "escrita", caminhos: [projeto("a.ts")] }, { nivel: "leitura" })).toBe(false);
      expect(permitido({ tipo: "escrita", caminhos: [projeto("a.ts")] }, { nivel: "edicao" })).toBe(true);
      expect(permitido({ tipo: "escrita", caminhos: [projeto("a.ts")] }, { nivel: "edicao_e_comandos" })).toBe(true);
      expect(permitido({ tipo: "escrita", caminhos: [projeto("a.ts")] }, { modo: "planejamento" })).toBe(false);
    });

    it("recusa gravar fora da pasta de trabalho, dos artefatos e da temporária, e resolve o .. antes de comparar", () => {
      expect(permitido({ tipo: "escrita", caminhos: [foraDeTudo("a.ts")] })).toBe(false);
      // O ".." é resolvido antes de comparar: continua dentro do projeto.
      expect(permitido({ tipo: "escrita", caminhos: [projeto("a", "..", "b.ts")] })).toBe(true);
    });

    it("recusa quando uma das alterações sai da área liberada e quando o CLI não diz os caminhos", () => {
      expect(permitido({ tipo: "escrita", caminhos: [projeto("a.ts"), foraDeTudo("b.ts")] })).toBe(false);
      expect(permitido({ tipo: "escrita", caminhos: [] })).toBe(false);
    });

    it("com nível leitura, uma alteração que mistura projeto e artefatos é recusada", () => {
      expect(permitido({ tipo: "escrita", caminhos: [artefatos("a.html"), projeto("a.ts")] }, { nivel: "leitura" })).toBe(false);
    });
  });

  describe("comandos", () => {
    it("só no nível edicao_e_comandos e fora do planejamento", () => {
      expect(permitido({ tipo: "comando", comando: "npm test" })).toBe(true);
      expect(permitido({ tipo: "comando", comando: "npm test" }, { nivel: "edicao" })).toBe(false);
      expect(permitido({ tipo: "comando", comando: "npm test" }, { nivel: "leitura" })).toBe(false);
      expect(permitido({ tipo: "comando", comando: "ls" }, { modo: "planejamento" })).toBe(false);
    });

    it("recusa commit e push sem a opção ligada, em qualquer posição do comando", () => {
      for (const comando of [
        "git commit -m x",
        "git add . && git commit -m x",
        "git push origin main",
        "git -C ../outro push",
        "git -c user.name=x commit -m y",
        'pwsh -Command "git commit -am x"',
        "GIT COMMIT -m x",
        "git.exe push",
      ]) {
        expect(permitido({ tipo: "comando", comando }), comando).toBe(false);
      }
    });

    it("libera commit e push com a opção ligada, mas nunca push forçado", () => {
      const liberado = { permiteCommitEPush: true };

      expect(permitido({ tipo: "comando", comando: "git commit -m x" }, liberado)).toBe(true);
      expect(permitido({ tipo: "comando", comando: "git push -u origin feature/x" }, liberado)).toBe(true);
      for (const comando of [
        "git push --force origin main",
        "git push --force-with-lease",
        "git push -f origin main",
        "git push -fu origin main",
        "git push -uf origin main",
        "git push origin +main",
        "git add . ; git push --force",
      ]) {
        expect(permitido({ tipo: "comando", comando }, liberado), comando).toBe(false);
      }
    });

    it("recusa o commit que traz a linha Co-authored-by (o Copilot a acrescenta por padrão), mas não outros comandos que a citam", () => {
      const liberado = { permiteCommitEPush: true };

      expect(permitido({ tipo: "comando", comando: 'git commit -m "feat: x" -m "Co-authored-by: Copilot <c@x.com>"' }, liberado)).toBe(false);
      expect(permitido({ tipo: "comando", comando: 'git commit -m "feat: x\n\nco-authored-by: alguém"' }, liberado)).toBe(false);
      expect(permitido({ tipo: "comando", comando: 'git commit -m "feat: x"' }, liberado)).toBe(true);
      expect(permitido({ tipo: "comando", comando: 'grep -r "Co-authored-by" .' }, liberado)).toBe(true);
    });

    it("não confunde outros comandos com commit e push", () => {
      expect(contemCommitOuPush("git status")).toBe(false);
      expect(contemCommitOuPush("git log --oneline")).toBe(false);
      expect(contemCommitOuPush("gitea commit")).toBe(false);
      expect(contemCommitOuPush("npm run commit-lint")).toBe(false);
      expect(permitido({ tipo: "comando", comando: "git diff HEAD~1" })).toBe(true);
    });
  });

  describe("outras ferramentas", () => {
    it("só onde há edição e comandos", () => {
      expect(permitido({ tipo: "outra", descricao: "mcp x" })).toBe(true);
      expect(permitido({ tipo: "outra", descricao: "mcp x" }, { nivel: "edicao" })).toBe(false);
      expect(permitido({ tipo: "outra", descricao: "mcp x" }, { modo: "planejamento" })).toBe(false);
    });
  });

  describe("estaDentroDe", () => {
    it("aceita a própria pasta e o que está dentro, e recusa irmãs e o que escapa por ..", () => {
      expect(estaDentroDe(projeto(), projeto())).toBe(true);
      expect(estaDentroDe(projeto("a", "b.ts"), projeto())).toBe(true);
      expect(estaDentroDe(path.join(raiz, "projeto-irmao", "a.ts"), projeto())).toBe(false);
      expect(estaDentroDe(projeto("..", "artefatos", "a.html"), projeto())).toBe(false);
    });
  });

  describe("padroesDeNegacaoDeComandos", () => {
    it("nega commit e push no CLI quando não estão liberados e nada quando estão", () => {
      expect(padroesDeNegacaoDeComandos({ permiteCommitEPush: false })).toEqual(["shell(git commit)", "shell(git push)"]);
      expect(padroesDeNegacaoDeComandos({ permiteCommitEPush: true })).toEqual([]);
    });
  });
});
