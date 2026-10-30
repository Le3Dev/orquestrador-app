import { existsSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";

import { GerenciadorDeWorktrees, PreparoDeWorktree } from "../../orquestracao/PreparoDeWorktree";
import { Worktrees } from "./Worktrees";

/** Prefixo da branch dedicada a cada Orquestrador. */
const PREFIXO_DA_BRANCH = "orquestrador/";

/**
 * Implementa o ciclo de vida do worktree sobre `Worktrees` (git) + um layout
 * de pastas curto e determinístico.
 *
 * Layout: `<pastaDeDados>/worktrees/<idCurto>`, com `idCurto` = os 8 primeiros
 * caracteres do id. Caminho curto de propósito: o worktree vira a raiz onde os
 * agentes criam `node_modules` e afins, e no Windows um caminho base longo
 * estouraria o MAX_PATH lá dentro. Branch: `orquestrador/<id>`.
 */
export class GerenciadorDeWorktreesGit implements GerenciadorDeWorktrees {
  private readonly pastaBase: string;

  constructor(
    pastaDeDados: string,
    private readonly worktrees: Worktrees = new Worktrees(),
  ) {
    this.pastaBase = path.join(pastaDeDados, "worktrees");
  }

  async preparar(orquestradorId: string, pastaDeTrabalho: string): Promise<PreparoDeWorktree> {
    try {
      if (!(await this.worktrees.ehRepoGit(pastaDeTrabalho)) || !(await this.worktrees.temHead(pastaDeTrabalho))) {
        return { cwd: pastaDeTrabalho, worktree: null };
      }
      const caminho = this.caminhoDoWorktree(orquestradorId);
      const branch = this.branchDe(orquestradorId);
      await this.worktrees.prune(pastaDeTrabalho);
      await this.worktrees.criar(pastaDeTrabalho, caminho, branch);
      return { cwd: caminho, worktree: { branch, caminho } };
    } catch (erro) {
      // Degradação graciosa: nunca quebrar o turno por causa do git.
      console.warn(`[worktrees] Não foi possível preparar o worktree de ${orquestradorId}; usando a pasta normal.`, erro);
      return { cwd: pastaDeTrabalho, worktree: null };
    }
  }

  async concluir(orquestradorId: string, pastaDeTrabalho: string): Promise<boolean> {
    const caminho = this.caminhoDoWorktree(orquestradorId);
    const branch = this.branchDe(orquestradorId);
    try {
      if (!(await this.worktrees.ehRepoGit(pastaDeTrabalho))) {
        return false;
      }
      if (!(await this.worktrees.semAlteracoes(caminho))) {
        // Há trabalho não descartado: espelha o auto-cleanup do CLI, que só
        // remove worktrees intocados. Mantém para o usuário aproveitar.
        return false;
      }
      await this.worktrees.remover(pastaDeTrabalho, caminho);
      await this.worktrees.prune(pastaDeTrabalho);
      // Com commit liberado, um commit feito direto nesta branch deixa o
      // worktree "limpo": apagar a branch o perderia.
      if (await this.worktrees.temCommitsSoDela(pastaDeTrabalho, branch)) {
        console.warn(
          `[worktrees] A branch "${branch}" tem commits que não estão em nenhuma outra branch; ` +
            "mantida para não perder trabalho. Mescle ou apague-a à mão quando não precisar mais.",
        );
      } else {
        await this.worktrees.apagarBranch(pastaDeTrabalho, branch);
      }
      return true;
    } catch (erro) {
      console.warn(`[worktrees] Falha ao limpar o worktree de ${orquestradorId}.`, erro);
      return false;
    }
  }

  /**
   * Remove worktrees deixados para trás pela queda do servidor. Chamado no
   * arranque, análogo ao `encerrarAgentesOrfaos`. Só mexe nas árvores
   * registradas que estiverem vazias (sem alterações); as com trabalho ficam.
   * Também apaga pastas em `worktrees/` sem `.git` (não são worktree). Devolve
   * quantos worktrees foram removidos pelo git.
   */
  async limparOrfaos(pastasDeTrabalho: Iterable<string>): Promise<number> {
    let removidos = 0;
    const reposVistos = new Set<string>();
    for (const pasta of pastasDeTrabalho) {
      if (reposVistos.has(pasta)) {
        continue;
      }
      reposVistos.add(pasta);
      try {
        if (!(await this.worktrees.ehRepoGit(pasta))) {
          continue;
        }
        await this.worktrees.prune(pasta);
        for (const caminho of await this.worktrees.listar(pasta)) {
          if (!this.ehNossoWorktree(caminho)) {
            continue;
          }
          if (await this.worktrees.semAlteracoes(caminho)) {
            await this.worktrees.remover(pasta, caminho);
            removidos += 1;
          }
        }
      } catch (erro) {
        console.warn(`[worktrees] Falha ao limpar worktrees órfãos em "${pasta}".`, erro);
      }
    }
    // Pastas nossas que não são worktree (sem `.git`): apaga. As com `.git` ficam.
    await this.removerPastasOrfas().catch(() => undefined);
    return removidos;
  }

  private ehNossoWorktree(caminho: string): boolean {
    const base = path.resolve(this.pastaBase).replace(/\\/g, "/").toLowerCase();
    return path.resolve(caminho).replace(/\\/g, "/").toLowerCase().startsWith(`${base}/`);
  }

  /**
   * Apaga só o que não é worktree: pasta sem `.git` (ex.: `worktree add` pela
   * metade). Pasta com `.git` pode guardar trabalho não commitado e nunca é
   * apagada aqui — quem decide é a limpeza pelo git em `limparOrfaos`, que só
   * tira as limpas. Se o repositório de origem sumiu ou foi movido, o git não
   * consegue dizer se há alterações: a pasta fica e o caso vai para o log.
   */
  private async removerPastasOrfas(): Promise<void> {
    const entradas = await readdir(this.pastaBase, { withFileTypes: true }).catch(() => []);
    for (const entrada of entradas) {
      if (!entrada.isDirectory()) {
        continue;
      }
      const caminho = path.join(this.pastaBase, entrada.name);
      if (existsSync(path.join(caminho, ".git"))) {
        if (!(await this.worktrees.ehRepoGit(caminho))) {
          console.warn(
            `[worktrees] "${caminho}" perdeu o vínculo com o repositório de origem (movido ou apagado?). ` +
              `Mantido para não perder trabalho: rode "git worktree repair" no repositório ou apague a pasta à mão.`,
          );
        }
        continue;
      }
      await rm(caminho, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private caminhoDoWorktree(orquestradorId: string): string {
    return path.join(this.pastaBase, orquestradorId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "wt");
  }

  private branchDe(orquestradorId: string): string {
    return `${PREFIXO_DA_BRANCH}${orquestradorId}`;
  }
}
