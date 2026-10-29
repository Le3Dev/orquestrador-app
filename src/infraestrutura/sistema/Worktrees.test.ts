import { describe, expect, it } from "vitest";

import { ExecutorDeGit, Worktrees } from "./Worktrees";

/** Executor de git falso: responde por padrão de argumentos, guardando o que foi chamado. */
function executorFalso(
  respostas: (argumentos: readonly string[]) => { codigo?: number; saida?: string; erro?: string },
): { executar: ExecutorDeGit; chamadas: string[][] } {
  const chamadas: string[][] = [];
  const executar: ExecutorDeGit = async (argumentos) => {
    chamadas.push([...argumentos]);
    const resposta = respostas(argumentos);
    return { codigo: resposta.codigo ?? 0, saida: resposta.saida ?? "", erro: resposta.erro ?? "" };
  };
  return { executar, chamadas };
}

describe("Worktrees", () => {
  it("ehRepoGit só é verdadeiro quando git confirma a árvore de trabalho", async () => {
    const dentro = new Worktrees(executorFalso(() => ({ saida: "true\n" })).executar);
    const fora = new Worktrees(executorFalso(() => ({ codigo: 128, erro: "not a git repository" })).executar);

    expect(await dentro.ehRepoGit("/x")).toBe(true);
    expect(await fora.ehRepoGit("/x")).toBe(false);
  });

  it("temHead é falso num repo recém-criado sem commit", async () => {
    const semCommit = new Worktrees(executorFalso(() => ({ codigo: 128 })).executar);
    const comCommit = new Worktrees(executorFalso(() => ({ codigo: 0 })).executar);

    expect(await semCommit.temHead("/x")).toBe(false);
    expect(await comCommit.temHead("/x")).toBe(true);
  });

  it("criar usa -b e longpaths quando a branch ainda não existe", async () => {
    const { executar, chamadas } = executorFalso((args) => {
      if (args.includes("list")) {
        return { saida: "" }; // nenhum worktree ainda
      }
      if (args.includes("--verify")) {
        return { codigo: 128 }; // branch não existe
      }
      return { codigo: 0 };
    });

    await new Worktrees(executar).criar("/repo", "/repo/../wt/abc", "orquestrador/id1");

    const add = chamadas.find((c) => c.includes("add"));
    expect(add).toContain("-c");
    expect(add).toContain("core.longpaths=true");
    expect(add).toContain("-b");
    expect(add).toContain("orquestrador/id1");
  });

  it("criar reaproveita a branch existente sem -b", async () => {
    const { executar, chamadas } = executorFalso((args) => {
      if (args.includes("list")) {
        return { saida: "" };
      }
      if (args.includes("--verify")) {
        return { codigo: 0 }; // branch existe
      }
      return { codigo: 0 };
    });

    await new Worktrees(executar).criar("/repo", "/wt/abc", "orquestrador/id1");

    const add = chamadas.find((c) => c.includes("add"));
    expect(add).not.toContain("-b");
  });

  it("criar não refaz nada quando o worktree já existe no caminho pedido", async () => {
    const { executar, chamadas } = executorFalso((args) => {
      if (args.includes("list")) {
        return { saida: "worktree /wt/abc\nHEAD deadbeef\nbranch refs/heads/orquestrador/id1\n" };
      }
      return { codigo: 0 };
    });

    await new Worktrees(executar).criar("/repo", "/wt/abc", "orquestrador/id1");

    expect(chamadas.some((c) => c.includes("add"))).toBe(false);
  });

  it("criar lança quando git worktree add falha", async () => {
    const { executar } = executorFalso((args) => {
      if (args.includes("list")) {
        return { saida: "" };
      }
      if (args.includes("--verify")) {
        return { codigo: 128 };
      }
      if (args.includes("add")) {
        return { codigo: 1, erro: "fatal: already exists" };
      }
      return { codigo: 0 };
    });

    await expect(new Worktrees(executar).criar("/repo", "/wt/abc", "b")).rejects.toThrow(/worktree add falhou/);
  });

  it("semAlteracoes reflete o git status --porcelain", async () => {
    const limpo = new Worktrees(executorFalso(() => ({ saida: "" })).executar);
    const sujo = new Worktrees(executorFalso(() => ({ saida: " M arquivo.ts\n" })).executar);

    expect(await limpo.semAlteracoes("/wt")).toBe(true);
    expect(await sujo.semAlteracoes("/wt")).toBe(false);
  });

  it("listar extrai os caminhos do porcelain", async () => {
    const saida = "worktree /repo\nHEAD a\nbranch refs/heads/main\n\nworktree /wt/abc\nHEAD b\n";
    const worktrees = new Worktrees(executorFalso(() => ({ saida })).executar);

    expect(await worktrees.listar("/repo")).toEqual(["/repo", "/wt/abc"]);
  });

  it("remover tenta de novo e só desiste depois das tentativas", async () => {
    let tentativas = 0;
    const { executar } = executorFalso((args) => {
      if (args.includes("remove")) {
        tentativas += 1;
        return { codigo: 1, erro: "locked" };
      }
      return { codigo: 0 };
    });

    await new Worktrees(executar).remover("/repo", "/wt/abc");

    expect(tentativas).toBe(3);
  });
});
