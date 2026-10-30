import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";

/**
 * Resultado cru de um comando git: o código de saída e as saídas, sem lançar.
 * Diferente do `executar` de `Processos.ts`, aqui o código de saída importa —
 * um `git rev-parse` com saída diferente de zero é a resposta "não é repo",
 * não um erro a propagar.
 */
interface SaidaDoGit {
  codigo: number;
  saida: string;
  erro: string;
}

export type ExecutorDeGit = (argumentos: readonly string[], cwd?: string) => Promise<SaidaDoGit>;

/**
 * Executor padrão: chama `git` direto pelo execFile, sem shell, no mesmo
 * espírito de `Processos.ts`. Nunca rejeita por código de saída — devolve o
 * código para quem chamou decidir o que fazer.
 */
export const executarGit: ExecutorDeGit = (argumentos, cwd) =>
  new Promise((resolver) => {
    execFile(
      "git",
      [...argumentos],
      { cwd, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (erro, saida, erroPadrao) => {
        const codigo =
          erro === null ? 0 : typeof erro.code === "number" ? erro.code : erro.code === undefined ? 1 : 1;
        resolver({ codigo, saida: saida.toString(), erro: erroPadrao.toString() });
      },
    );
  });

/**
 * `git -c core.longpaths=true` nas operações que criam/apagam arquivos:
 * worktrees têm caminhos longos e, sem isso, o Windows estoura o MAX_PATH ao
 * materializar a árvore.
 */
const LONGPATHS: readonly string[] = ["-c", "core.longpaths=true"];

/** Espera entre tentativas de remoção quando o Windows ainda segura um lock. */
const ESPERA_RETRY_MS = 300;
const TENTATIVAS_DE_REMOCAO = 3;

function esperar(ms: number): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

/**
 * Encapsula o `git worktree` para dar a cada Orquestrador uma árvore isolada,
 * no espírito do recurso de worktree do CLI do Claude Code. Sem shell, sem
 * dependências externas — só o `git` do usuário.
 */
export class Worktrees {
  constructor(private readonly executar: ExecutorDeGit = executarGit) {}

  /** Se a pasta está dentro de uma árvore de trabalho git. */
  async ehRepoGit(pasta: string): Promise<boolean> {
    const { codigo, saida } = await this.executar(["rev-parse", "--is-inside-work-tree"], pasta);
    return codigo === 0 && saida.trim() === "true";
  }

  /**
   * Se o repositório já tem um HEAD com commit. Sem commit, `git worktree add`
   * falha — repositório recém-criado por `git init` ainda não serve.
   */
  async temHead(pasta: string): Promise<boolean> {
    const { codigo } = await this.executar(["rev-parse", "--verify", "HEAD"], pasta);
    return codigo === 0;
  }

  /**
   * Cria um worktree em `caminhoWorktree` ligado a `branch` (criada do HEAD
   * atual). Se o worktree já existe no caminho pedido, não refaz nada.
   */
  async criar(pastaRepo: string, caminhoWorktree: string, branch: string): Promise<void> {
    if (await this.existeNoCaminho(pastaRepo, caminhoWorktree)) {
      return;
    }
    const branchExiste = await this.branchExiste(pastaRepo, branch);
    const argumentos = branchExiste
      ? ["worktree", "add", caminhoWorktree, branch]
      : ["worktree", "add", "-b", branch, caminhoWorktree, "HEAD"];
    const { codigo, erro } = await this.executar([...LONGPATHS, ...argumentos], pastaRepo);
    if (codigo !== 0) {
      throw new Error(`git worktree add falhou (código ${codigo}): ${erro.trim()}`);
    }
  }

  /** Sem alterações pendentes: `git status --porcelain` vazio. */
  async semAlteracoes(caminhoWorktree: string): Promise<boolean> {
    const { codigo, saida } = await this.executar(["status", "--porcelain"], caminhoWorktree);
    return codigo === 0 && saida.trim() === "";
  }

  /**
   * Remove o worktree. Com retry: no Windows um antivírus ou um processo que
   * acabou de sair ainda pode segurar um lock por alguns instantes. Em último
   * caso, apaga a pasta e deixa o `prune` limpar o registro.
   */
  async remover(pastaRepo: string, caminhoWorktree: string): Promise<void> {
    for (let tentativa = 1; tentativa <= TENTATIVAS_DE_REMOCAO; tentativa++) {
      const { codigo, erro } = await this.executar(
        [...LONGPATHS, "worktree", "remove", "--force", caminhoWorktree],
        pastaRepo,
      );
      if (codigo === 0) {
        return;
      }
      if (tentativa === TENTATIVAS_DE_REMOCAO) {
        console.warn(`[worktrees] git worktree remove falhou após ${tentativa} tentativas: ${erro.trim()}`);
        // Fallback: apaga a pasta na marra; o prune em seguida limpa o registro.
        await rm(caminhoWorktree, { recursive: true, force: true }).catch(() => undefined);
        return;
      }
      await esperar(ESPERA_RETRY_MS);
    }
  }

  /** Limpa do registro worktrees cujas pastas já não existem. */
  async prune(pastaRepo: string): Promise<void> {
    await this.executar(["worktree", "prune"], pastaRepo);
  }

  /** Caminhos de todos os worktrees do repositório. */
  async listar(pastaRepo: string): Promise<string[]> {
    const { codigo, saida } = await this.executar(["worktree", "list", "--porcelain"], pastaRepo);
    if (codigo !== 0) {
      return [];
    }
    const caminhos: string[] = [];
    for (const linha of saida.split(/\r?\n/)) {
      if (linha.startsWith("worktree ")) {
        caminhos.push(linha.slice("worktree ".length).trim());
      }
    }
    return caminhos;
  }

  /**
   * Se a branch tem commits que nenhuma outra referência alcança (outras
   * branches, tags, remotas, stash e os HEADs): apagá-la os perderia. Chame
   * depois de remover o worktree e rodar o `prune` — o HEAD de um worktree
   * ainda registrado na própria branch esconderia os commits dela.
   *
   * Na dúvida (o git falhou ou respondeu algo inesperado), diz que sim:
   * manter uma branch sobrando é melhor que perder trabalho.
   */
  async temCommitsSoDela(pastaRepo: string, branch: string): Promise<boolean> {
    const referencia = `refs/heads/${branch}`;
    const { codigo, saida } = await this.executar(
      ["rev-list", "--count", referencia, "--not", `--exclude=${referencia}`, "--all"],
      pastaRepo,
    );
    return codigo !== 0 || saida.trim() !== "0";
  }

  /** Apaga a branch local; `-D` porque ela pode não estar mesclada. */
  async apagarBranch(pastaRepo: string, branch: string): Promise<void> {
    const { codigo, erro } = await this.executar(["branch", "-D", branch], pastaRepo);
    if (codigo !== 0 && !erro.includes("not found")) {
      console.warn(`[worktrees] não foi possível apagar a branch "${branch}": ${erro.trim()}`);
    }
  }

  private async branchExiste(pastaRepo: string, branch: string): Promise<boolean> {
    const { codigo } = await this.executar(["rev-parse", "--verify", `refs/heads/${branch}`], pastaRepo);
    return codigo === 0;
  }

  private async existeNoCaminho(pastaRepo: string, caminhoWorktree: string): Promise<boolean> {
    const alvo = normalizar(caminhoWorktree);
    const caminhos = await this.listar(pastaRepo);
    return caminhos.some((caminho) => normalizar(caminho) === alvo);
  }
}

/** No Windows os caminhos do git vêm com barra normal; comparação à prova de separador e caixa. */
function normalizar(caminho: string): string {
  return caminho.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}
