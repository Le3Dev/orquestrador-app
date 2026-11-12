import { describe, expect, it } from "vitest";

import {
  ContextoDePermissoesDoCopilot,
  decidirPermissaoDoCopilot,
  ehArquivoDeAmbiente,
  ferramentasDoCopilotParaONivel,
  normalizarCaminhoDoCopilot,
  PedidoDePermissaoDoCopilot,
} from "./PoliticaDePermissoesDoCopilot";

const TRABALHO = "C:/Projetos/painel";
const ARTEFATOS = "C:/Dados/artefatos/entrada/orquestradores/o1";

function contexto(alteracoes: Partial<ContextoDePermissoesDoCopilot> = {}): ContextoDePermissoesDoCopilot {
  return {
    nivel: "edicao_e_comandos",
    modo: "execucao",
    pastaDeTrabalho: TRABALHO,
    pastaDeArtefatos: ARTEFATOS,
    permiteCommitEPush: false,
    distinguirCaixa: false,
    ...alteracoes,
  };
}

function comando(texto: string, extra: Partial<PedidoDePermissaoDoCopilot> = {}): PedidoDePermissaoDoCopilot {
  return { kind: "shell", fullCommandText: texto, possiblePaths: [], ...extra };
}

function aprovada(ctx: ContextoDePermissoesDoCopilot, pedido: PedidoDePermissaoDoCopilot): boolean {
  return decidirPermissaoDoCopilot(ctx, pedido).aprovada;
}

describe("ferramentasDoCopilotParaONivel", () => {
  it("só o nível edicao_e_comandos, fora do planejamento, recebe o terminal", () => {
    expect(ferramentasDoCopilotParaONivel("leitura", "execucao", "win32")).not.toContain("powershell");
    expect(ferramentasDoCopilotParaONivel("edicao", "execucao", "win32")).not.toContain("powershell");
    expect(ferramentasDoCopilotParaONivel("edicao_e_comandos", "planejamento", "win32")).not.toContain("powershell");
    expect(ferramentasDoCopilotParaONivel("edicao_e_comandos", "execucao", "win32")).toEqual(
      expect.arrayContaining(["powershell", "read_powershell", "stop_powershell", "list_powershell"]),
    );
  });

  it("usa a família bash fora do Windows", () => {
    const ferramentas = ferramentasDoCopilotParaONivel("edicao_e_comandos", "execucao", "darwin");
    expect(ferramentas).toEqual(expect.arrayContaining(["bash", "read_bash", "stop_bash", "list_bash"]));
    expect(ferramentas).not.toContain("powershell");
  });

  it("deixa os subagentes (task) para a Fase 2 e mantém leitura e gravação em todo nível", () => {
    for (const nivel of ["leitura", "edicao", "edicao_e_comandos"] as const) {
      const ferramentas = ferramentasDoCopilotParaONivel(nivel, "execucao", "win32");
      expect(ferramentas).not.toContain("task");
      expect(ferramentas).toEqual(expect.arrayContaining(["view", "grep", "glob", "web_fetch", "create", "edit"]));
    }
  });
});

describe("normalizarCaminhoDoCopilot", () => {
  it("unifica as barras, resolve .. e ignora a caixa fora do Linux", () => {
    expect(normalizarCaminhoDoCopilot("C:\\Projetos\\painel\\..\\painel\\src\\", TRABALHO, false)).toBe("c:/projetos/painel/src");
  });

  it("resolve um caminho relativo a partir da base e preserva a caixa no Linux", () => {
    expect(normalizarCaminhoDoCopilot("src/Index.ts", "/srv/App", true)).toBe("/srv/App/src/Index.ts");
  });
});

describe("ehArquivoDeAmbiente", () => {
  it.each([".env", ".env.local", "C:\\x\\.env.production", "/a/b/.ENV"])("%s é de ambiente", (caminho) => {
    expect(ehArquivoDeAmbiente(caminho)).toBe(true);
  });

  it.each(["ambiente.ts", "src/env.ts", "C:/x/dotenv/index.js"])("%s não é", (caminho) => {
    expect(ehArquivoDeAmbiente(caminho)).toBe(false);
  });
});

describe("decidirPermissaoDoCopilot — leitura de arquivos e web", () => {
  it("libera ler dentro da pasta de trabalho, da de artefatos e das dos anexos", () => {
    const ctx = contexto({ pastasSoDeLeitura: ["C:/Dados/anexos/o1"] });
    expect(aprovada(ctx, { kind: "read", path: `${TRABALHO}/src/index.ts` })).toBe(true);
    expect(aprovada(ctx, { kind: "read", path: `${ARTEFATOS}/relatorio.md` })).toBe(true);
    expect(aprovada(ctx, { kind: "read", path: "C:/Dados/anexos/o1/foto.png" })).toBe(true);
    expect(aprovada(ctx, { kind: "read", path: "src/index.ts" })).toBe(true);
  });

  it("recusa ler fora das pastas liberadas, inclusive por .. e por link simbólico", () => {
    const ctx = contexto();
    expect(aprovada(ctx, { kind: "read", path: "C:/Windows/System32/drivers/etc/hosts" })).toBe(false);
    expect(aprovada(ctx, { kind: "read", path: `${TRABALHO}/../outro/segredo.txt` })).toBe(false);
    expect(aprovada(ctx, { kind: "read", path: `${TRABALHO}/link`, resolvedPath: "C:/Users/x/segredo.txt" })).toBe(false);
  });

  it("não confunde uma pasta irmã de nome parecido com a pasta liberada", () => {
    expect(aprovada(contexto(), { kind: "read", path: "C:/Projetos/painel-antigo/a.ts" })).toBe(false);
  });

  it("recusa arquivos .env em qualquer nível, mesmo dentro da pasta de trabalho", () => {
    for (const nivel of ["leitura", "edicao", "edicao_e_comandos"] as const) {
      const decisao = decidirPermissaoDoCopilot(contexto({ nivel }), { kind: "read", path: `${TRABALHO}/.env.local` });
      expect(decisao).toMatchObject({ aprovada: false, ferramenta: "read" });
      expect(decisao.aprovada === false && decisao.motivo).toContain(".env");
    }
  });

  it("recusa o pedido de leitura sem caminho", () => {
    expect(aprovada(contexto(), { kind: "read" })).toBe(false);
  });

  it("libera buscar na web em qualquer nível e no planejamento", () => {
    expect(aprovada(contexto({ nivel: "leitura" }), { kind: "url", url: "https://exemplo.com" })).toBe(true);
    expect(aprovada(contexto({ modo: "planejamento" }), { kind: "url", url: "https://exemplo.com" })).toBe(true);
  });
});

describe("decidirPermissaoDoCopilot — gravação", () => {
  it("no nível leitura só grava na pasta de artefatos", () => {
    const ctx = contexto({ nivel: "leitura" });
    expect(aprovada(ctx, { kind: "write", fileName: `${ARTEFATOS}/pagina.html` })).toBe(true);
    const negada = decidirPermissaoDoCopilot(ctx, { kind: "write", fileName: `${TRABALHO}/novo.txt` });
    expect(negada).toMatchObject({ aprovada: false, ferramenta: "write" });
    expect(negada.aprovada === false && negada.motivo).toContain("pasta de artefatos");
  });

  it("no planejamento só grava na pasta de artefatos, seja qual for o nível", () => {
    const ctx = contexto({ nivel: "edicao_e_comandos", modo: "planejamento" });
    expect(aprovada(ctx, { kind: "write", fileName: `${ARTEFATOS}/plano.md` })).toBe(true);
    const negada = decidirPermissaoDoCopilot(ctx, { kind: "write", fileName: `${TRABALHO}/src/a.ts` });
    expect(negada.aprovada === false && negada.motivo).toContain("planejamento");
  });

  it.each(["edicao", "edicao_e_comandos"] as const)("no nível %s grava na pasta de trabalho e na de artefatos", (nivel) => {
    const ctx = contexto({ nivel });
    expect(aprovada(ctx, { kind: "write", fileName: `${TRABALHO}/src/a.ts` })).toBe(true);
    expect(aprovada(ctx, { kind: "write", fileName: `${ARTEFATOS}/a.md` })).toBe(true);
    expect(aprovada(ctx, { kind: "write", fileName: "C:/Users/x/Desktop/a.txt" })).toBe(false);
    expect(aprovada(ctx, { kind: "write", fileName: `${TRABALHO}/../fora.txt` })).toBe(false);
  });

  it("recusa gravar quando o caminho canônico escapa das pastas", () => {
    const ctx = contexto({ nivel: "edicao" });
    expect(aprovada(ctx, { kind: "write", fileName: `${TRABALHO}/atalho.txt`, resolvedPath: "C:/Windows/atalho.txt" })).toBe(false);
  });

  it("recusa gravar sem caminho", () => {
    expect(aprovada(contexto(), { kind: "write" })).toBe(false);
  });
});

describe("decidirPermissaoDoCopilot — comandos", () => {
  it("só o nível edicao_e_comandos tem terminal", () => {
    expect(aprovada(contexto({ nivel: "edicao_e_comandos" }), comando("npm test"))).toBe(true);
    for (const nivel of ["leitura", "edicao"] as const) {
      const decisao = decidirPermissaoDoCopilot(contexto({ nivel }), comando("npm test"));
      expect(decisao).toMatchObject({ aprovada: false, ferramenta: "shell", detalhe: "npm test" });
    }
  });

  it("no planejamento não há terminal, nem no nível edicao_e_comandos", () => {
    const decisao = decidirPermissaoDoCopilot(contexto({ modo: "planejamento" }), comando("git status"));
    expect(decisao.aprovada === false && decisao.motivo).toContain("planejamento");
  });

  it("recusa git commit e git push com a opção desligada, em qualquer forma de escrever", () => {
    const ctx = contexto({ permiteCommitEPush: false });
    for (const texto of [
      'git commit -m "x"',
      "git push",
      "git push origin main",
      "git status; git push",
      "git add . && git commit -m x && git push",
      "git -C ../outro push",
      'git -c user.name=x commit -m "y"',
      "git.exe push origin main",
      'pwsh -c "git push"',
      "(git push)",
    ]) {
      expect(aprovada(ctx, comando(texto)), texto).toBe(false);
    }
  });

  it("não confunde outros subcomandos do git com commit e push", () => {
    const ctx = contexto({ permiteCommitEPush: false });
    for (const texto of [
      "git status",
      "git log --oneline -5",
      "git commit-tree HEAD^{tree}",
      "git diff HEAD~1",
      "git checkout -b fix/x",
      "echo gitpush",
      "legit push",
    ]) {
      expect(aprovada(ctx, comando(texto)), texto).toBe(true);
    }
  });

  it("com a opção ligada libera commit e push comuns", () => {
    const ctx = contexto({ permiteCommitEPush: true });
    expect(aprovada(ctx, comando('git commit -m "ajuste"'))).toBe(true);
    expect(aprovada(ctx, comando("git push origin feature/x"))).toBe(true);
    expect(aprovada(ctx, comando("git push -u origin feature/x"))).toBe(true);
    expect(aprovada(ctx, comando("git push --set-upstream origin feature/x"))).toBe(true);
  });

  it("recusa push forçado mesmo com a opção ligada", () => {
    const ctx = contexto({ permiteCommitEPush: true });
    for (const texto of [
      "git push --force",
      "git push origin main --force",
      "git push --force-with-lease origin main",
      "git push --force-if-includes",
      "git push -f",
      "git push origin main -f",
      "git push -fu origin main",
      "git push -uf origin main",
      "git push origin +main",
      "git push origin +HEAD:main",
      "git -C ../x push --force",
      "git status && git push -f",
    ]) {
      const decisao = decidirPermissaoDoCopilot(ctx, comando(texto));
      expect(decisao.aprovada, texto).toBe(false);
      expect(decisao.aprovada === false && decisao.motivo, texto).toContain("forçado");
    }
  });

  it("recusa comandos que citam arquivos .env", () => {
    const ctx = contexto();
    for (const texto of ["cat .env", "Get-Content .\\.env.local", "type C:\\Projetos\\painel\\.env", 'echo x > ".env"']) {
      expect(aprovada(ctx, comando(texto)), texto).toBe(false);
    }
    expect(aprovada(ctx, comando("cat ambiente.md", { possiblePaths: [`${TRABALHO}/.env`] }))).toBe(false);
    expect(aprovada(ctx, comando("npm run env:check"))).toBe(true);
  });
});

describe("decidirPermissaoDoCopilot — o que o app não registra", () => {
  it.each(["mcp", "memory", "hook", "custom-tool"])("recusa pedidos do tipo %s", (kind) => {
    const decisao = decidirPermissaoDoCopilot(contexto(), { kind, toolName: "qualquer" });
    expect(decisao).toMatchObject({ aprovada: false, ferramenta: kind, detalhe: "qualquer" });
    expect(decisao.aprovada === false && decisao.motivo).toContain(kind);
  });

  it("recusa tipos novos que o app ainda não conhece", () => {
    const decisao = decidirPermissaoDoCopilot(contexto(), { kind: "extension-management" });
    expect(decisao).toMatchObject({ aprovada: false, ferramenta: "extension-management" });
    expect(decisao.aprovada === false && decisao.motivo).toContain("não são reconhecidos");
  });
});
