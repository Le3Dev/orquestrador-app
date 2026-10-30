import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GerenciadorDeWorktreesGit } from "./GerenciadorDeWorktreesGit";
import { ExecutorDeGit, Worktrees } from "./Worktrees";

const REPO = path.join(tmpdir(), "repo-que-nao-existe-no-disco");

/** Cria `<pastaDeDados>/worktrees/<nome>`, com ou sem o arquivo `.git` de um worktree. */
async function criarPasta(pastaDeDados: string, nome: string, comGit: boolean): Promise<string> {
  const caminho = path.join(pastaDeDados, "worktrees", nome);
  await mkdir(caminho, { recursive: true });
  await writeFile(path.join(caminho, "arquivo.ts"), "trabalho do agente");
  if (comGit) {
    await writeFile(path.join(caminho, ".git"), `gitdir: ${REPO}/.git/worktrees/${nome}`);
  }
  return caminho;
}

/**
 * Executor de git falso: `REPO` é um repositório com os worktrees `registrados`;
 * `sujos` têm alterações no `git status`; `semRepo` não respondem ao git
 * (repositório de origem sumiu). O `worktree remove` apaga a pasta, como o git.
 */
function executorFalso(opcoes: { registrados: string[]; sujos: string[]; semRepo: string[] }): {
  executar: ExecutorDeGit;
  chamadas: { argumentos: string[]; cwd: string | undefined }[];
} {
  const chamadas: { argumentos: string[]; cwd: string | undefined }[] = [];
  const executar: ExecutorDeGit = async (argumentos, cwd) => {
    chamadas.push({ argumentos: [...argumentos], cwd });
    if (argumentos.includes("--is-inside-work-tree")) {
      return cwd !== undefined && opcoes.semRepo.includes(cwd)
        ? { codigo: 128, saida: "", erro: "fatal: not a git repository" }
        : { codigo: 0, saida: "true\n", erro: "" };
    }
    if (argumentos.includes("list")) {
      const saida = [REPO, ...opcoes.registrados].map((caminho) => `worktree ${caminho}\nHEAD abc\n`).join("\n");
      return { codigo: 0, saida, erro: "" };
    }
    if (argumentos.includes("status")) {
      const sujo = cwd !== undefined && opcoes.sujos.includes(cwd);
      return { codigo: 0, saida: sujo ? " M arquivo.ts\n" : "", erro: "" };
    }
    if (argumentos.includes("remove")) {
      const alvo = argumentos[argumentos.length - 1];
      if (alvo !== undefined) {
        await rm(alvo, { recursive: true, force: true });
      }
    }
    return { codigo: 0, saida: "", erro: "" };
  };
  return { executar, chamadas };
}

describe("GerenciadorDeWorktreesGit.limparOrfaos", () => {
  let pastaDeDados: string;

  beforeEach(async () => {
    pastaDeDados = await mkdtemp(path.join(tmpdir(), "worktrees-teste-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(pastaDeDados, { recursive: true, force: true });
  });

  it("preserva o worktree com alterações e remove pelo git só o limpo", async () => {
    const sujo = await criarPasta(pastaDeDados, "sujo0001", true);
    const limpo = await criarPasta(pastaDeDados, "limpo001", true);
    const { executar, chamadas } = executorFalso({ registrados: [sujo, limpo], sujos: [sujo], semRepo: [] });

    const removidos = await new GerenciadorDeWorktreesGit(pastaDeDados, new Worktrees(executar)).limparOrfaos([REPO]);

    expect(removidos).toBe(1);
    expect(existsSync(path.join(sujo, "arquivo.ts"))).toBe(true);
    expect(existsSync(limpo)).toBe(false);
    const remocoes = chamadas.filter((chamada) => chamada.argumentos.includes("remove"));
    expect(remocoes.map((chamada) => chamada.argumentos.at(-1))).toEqual([limpo]);
  });

  it("apaga a pasta sem .git, que não é worktree", async () => {
    const semGit = await criarPasta(pastaDeDados, "metade01", false);
    const { executar } = executorFalso({ registrados: [], sujos: [], semRepo: [] });

    await new GerenciadorDeWorktreesGit(pastaDeDados, new Worktrees(executar)).limparOrfaos([REPO]);

    expect(existsSync(semGit)).toBe(false);
  });

  it("mantém, com aviso, a pasta com .git cujo repositório de origem sumiu", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const orfa = await criarPasta(pastaDeDados, "orfa0001", true);
    const { executar } = executorFalso({ registrados: [], sujos: [], semRepo: [orfa] });

    await new GerenciadorDeWorktreesGit(pastaDeDados, new Worktrees(executar)).limparOrfaos([]);

    expect(existsSync(path.join(orfa, "arquivo.ts"))).toBe(true);
    expect(aviso).toHaveBeenCalledWith(expect.stringContaining("perdeu o vínculo"));
  });

  it("não apaga worktree com .git de Orquestrador que não está na lista", async () => {
    const naoListado = await criarPasta(pastaDeDados, "outro001", true);
    const { executar, chamadas } = executorFalso({ registrados: [], sujos: [], semRepo: [] });

    await new GerenciadorDeWorktreesGit(pastaDeDados, new Worktrees(executar)).limparOrfaos([]);

    expect(existsSync(path.join(naoListado, "arquivo.ts"))).toBe(true);
    expect(chamadas.some((chamada) => chamada.argumentos.includes("remove"))).toBe(false);
  });
});

describe("GerenciadorDeWorktreesGit.concluir", () => {
  // Nada é criado no disco: o executor falso só responde e anota as chamadas.
  const pastaDeDados = path.join(tmpdir(), "dados-de-teste-que-nao-existem");

  /**
   * Repositório com worktree limpo (`git status` vazio); `commitsSoDaBranch` é
   * a resposta do `git rev-list --count` — ou `null` para o git falhar.
   */
  function executorDoConcluir(commitsSoDaBranch: string | null): {
    executar: ExecutorDeGit;
    chamadas: string[][];
  } {
    const chamadas: string[][] = [];
    const executar: ExecutorDeGit = async (argumentos) => {
      chamadas.push([...argumentos]);
      if (argumentos.includes("--is-inside-work-tree")) {
        return { codigo: 0, saida: "true\n", erro: "" };
      }
      if (argumentos.includes("rev-list")) {
        return commitsSoDaBranch === null
          ? { codigo: 128, saida: "", erro: "fatal: bad revision" }
          : { codigo: 0, saida: `${commitsSoDaBranch}\n`, erro: "" };
      }
      return { codigo: 0, saida: "", erro: "" };
    };
    return { executar, chamadas };
  }

  function apagouBranch(chamadas: string[][]): boolean {
    return chamadas.some((argumentos) => argumentos[0] === "branch" && argumentos.includes("-D"));
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("mantém a branch com commits próprios (ex.: commit direto nela) e registra em log", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { executar, chamadas } = executorDoConcluir("2");

    const removido = await new GerenciadorDeWorktreesGit(pastaDeDados, new Worktrees(executar)).concluir("o1", REPO);

    expect(removido).toBe(true);
    expect(apagouBranch(chamadas)).toBe(false);
    expect(aviso).toHaveBeenCalledWith(expect.stringContaining('"orquestrador/o1" tem commits'));
    // A conferência vem depois de remover o worktree e do prune: o HEAD do
    // worktree ainda registrado esconderia os commits da branch.
    const posicao = (subcomando: string): number => chamadas.findIndex((argumentos) => argumentos.includes(subcomando));
    expect(posicao("remove")).toBeLessThan(posicao("prune"));
    expect(posicao("prune")).toBeLessThan(posicao("rev-list"));
    expect(chamadas.find((argumentos) => argumentos.includes("rev-list"))).toEqual([
      "rev-list",
      "--count",
      "refs/heads/orquestrador/o1",
      "--not",
      "--exclude=refs/heads/orquestrador/o1",
      "--all",
    ]);
  });

  it("apaga a branch sem commits próprios", async () => {
    const { executar, chamadas } = executorDoConcluir("0");

    await new GerenciadorDeWorktreesGit(pastaDeDados, new Worktrees(executar)).concluir("o1", REPO);

    expect(chamadas).toContainEqual(["branch", "-D", "orquestrador/o1"]);
  });

  it("na dúvida (git falhou), mantém a branch", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { executar, chamadas } = executorDoConcluir(null);

    await new GerenciadorDeWorktreesGit(pastaDeDados, new Worktrees(executar)).concluir("o1", REPO);

    expect(apagouBranch(chamadas)).toBe(false);
  });
});
