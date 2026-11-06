/**
 * O que um Orquestrador deixou por commitar no worktree dele: o painel de
 * alterações da tela lê isto para o usuário revisar o trabalho dos agentes
 * antes de levá-lo para o projeto. Só leitura — nada aqui altera o worktree.
 */

/** Como um arquivo mudou em relação ao HEAD do worktree. */
export type SituacaoDoArquivo = "adicionado" | "modificado" | "removido" | "renomeado" | "nao_rastreado";

/**
 * - `sem_git`: a pasta não é repositório git com HEAD; os agentes alteram a pasta direto.
 * - `sem_worktree`: é repositório git, mas não há worktree agora (o último pedido não alterou nada).
 * - `com_worktree`: há worktree; a lista traz o que nele ainda não foi commitado.
 */
export type SituacaoDasAlteracoes = "sem_git" | "sem_worktree" | "com_worktree";

/** Um arquivo alterado no worktree. Objeto de valor: crie com `arquivoAlterado`, que o congela. */
export interface ArquivoAlterado {
  /** Caminho relativo à raiz do worktree, com `/`. */
  readonly caminho: string;
  /** Caminho antes da renomeação; `null` nas demais situações. */
  readonly caminhoAnterior: string | null;
  readonly situacao: SituacaoDoArquivo;
  /** Linhas adicionadas; `null` quando não se sabe (binário, arquivo grande ou ilegível). */
  readonly adicoes: number | null;
  /** Linhas removidas; `null` quando não se sabe. */
  readonly remocoes: number | null;
  readonly binario: boolean;
}

export function arquivoAlterado(dados: ArquivoAlterado): ArquivoAlterado {
  return Object.freeze({
    caminho: dados.caminho,
    caminhoAnterior: dados.caminhoAnterior,
    situacao: dados.situacao,
    adicoes: dados.adicoes,
    remocoes: dados.remocoes,
    binario: dados.binario,
  });
}

/** O diff de um arquivo da lista. Objeto de valor: crie com `diffDoArquivo`, que o congela. */
export interface DiffDoArquivo {
  readonly caminho: string;
  /** Diff unificado; vazio quando o arquivo é binário. */
  readonly diff: string;
  /** O diff passou do limite e foi cortado no fim de uma linha. */
  readonly truncado: boolean;
  readonly binario: boolean;
}

export function diffDoArquivo(dados: DiffDoArquivo): DiffDoArquivo {
  return Object.freeze({
    caminho: dados.caminho,
    diff: dados.diff,
    truncado: dados.truncado,
    binario: dados.binario,
  });
}

/** O formato que sai para a tela (JSON). */
export interface DadosDasAlteracoes {
  situacao: SituacaoDasAlteracoes;
  branch: string | null;
  caminho: string | null;
  emUso: boolean;
  commitsNaBranch: number;
  arquivos: ArquivoAlterado[];
}

const NENHUM_ARQUIVO: readonly ArquivoAlterado[] = Object.freeze([]);

/**
 * As alterações pendentes do worktree de um Orquestrador, num instante.
 * Objeto de valor imutável: uma nova leitura produz outro.
 */
export class AlteracoesDoWorktree {
  private constructor(
    public readonly situacao: SituacaoDasAlteracoes,
    public readonly branch: string | null,
    public readonly caminho: string | null,
    /** Um pedido está rodando dentro do worktree agora: a lista pode mudar. */
    public readonly emUso: boolean,
    /** Commits da branch do worktree que ainda não estão no HEAD da pasta original. */
    public readonly commitsNaBranch: number,
    public readonly arquivos: readonly ArquivoAlterado[],
  ) {
    Object.freeze(this);
  }

  static semGit(): AlteracoesDoWorktree {
    return new AlteracoesDoWorktree("sem_git", null, null, false, 0, NENHUM_ARQUIVO);
  }

  static semWorktree(): AlteracoesDoWorktree {
    return new AlteracoesDoWorktree("sem_worktree", null, null, false, 0, NENHUM_ARQUIVO);
  }

  static comWorktree(dados: {
    branch: string;
    caminho: string;
    emUso: boolean;
    commitsNaBranch: number;
    arquivos: readonly ArquivoAlterado[];
  }): AlteracoesDoWorktree {
    const commits = Number.isFinite(dados.commitsNaBranch) ? Math.max(0, Math.trunc(dados.commitsNaBranch)) : 0;
    return new AlteracoesDoWorktree(
      "com_worktree",
      dados.branch,
      dados.caminho,
      dados.emUso,
      commits,
      Object.freeze(dados.arquivos.map(arquivoAlterado)),
    );
  }

  /** O arquivo da lista com exatamente este caminho, ou `null` se ele não está entre as alterações. */
  arquivo(caminho: string): ArquivoAlterado | null {
    return this.arquivos.find((arquivo) => arquivo.caminho === caminho) ?? null;
  }

  paraDados(): DadosDasAlteracoes {
    return {
      situacao: this.situacao,
      branch: this.branch,
      caminho: this.caminho,
      emUso: this.emUso,
      commitsNaBranch: this.commitsNaBranch,
      arquivos: this.arquivos.map((arquivo) => ({ ...arquivo })),
    };
  }
}

/** A leitura das alterações falhou (git ausente, travado, worktree sumido...). O motivo vai em `cause`. */
export class ErroDeLeituraDasAlteracoes extends Error {
  constructor(motivo: unknown) {
    super("Não foi possível ler as alterações do worktree.", { cause: motivo });
    this.name = "ErroDeLeituraDasAlteracoes";
  }
}

/**
 * Porta para ler, sem alterar nada, o estado git de um worktree. A
 * implementação decide limites (quantidade de arquivos, tamanho do diff) e
 * lança quando o git falha; quem chama traduz para o usuário.
 */
export interface LeitorDeAlteracoes {
  /** Se a pasta está num repositório git que já tem HEAD (onde um worktree poderia existir). Nunca lança. */
  ehRepositorioComHead(pasta: string): Promise<boolean>;

  /** O que não foi commitado no worktree: alterações em relação ao HEAD dele mais os arquivos não rastreados. */
  listarArquivos(caminhoDoWorktree: string): Promise<readonly ArquivoAlterado[]>;

  /** Commits do HEAD do worktree que não estão no HEAD atual da pasta original; 0 se não der para calcular. */
  contarCommitsNaBranch(caminhoDoWorktree: string, pastaOriginal: string): Promise<number>;

  /** O diff de um arquivo que veio de `listarArquivos`. */
  lerDiff(caminhoDoWorktree: string, arquivo: ArquivoAlterado): Promise<DiffDoArquivo>;
}
