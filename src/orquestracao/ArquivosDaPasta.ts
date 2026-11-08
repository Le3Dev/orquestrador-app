/**
 * Visualizador de código: a tela navega pela pasta de um Orquestrador (o
 * worktree, se houver) e lê os arquivos dela. Só leitura, nada aqui grava.
 */

/** Maior arquivo que o visualizador abre. */
export const TAMANHO_MAXIMO_DO_ARQUIVO = 500 * 1024;

/** Quantos bytes do começo do arquivo são olhados atrás de um byte nulo (sinal de binário). */
export const BYTES_PARA_DETECTAR_BINARIO = 8 * 1024;

/** Mais que isto numa pasta só, a lista é cortada (e avisa). */
export const MAXIMO_DE_ENTRADAS_DA_PASTA = 2_000;

/** Um item de uma pasta, num nível só: as subpastas são listadas quando a tela as abre. */
export interface EntradaDaPasta {
  readonly nome: string;
  readonly tipo: "pasta" | "arquivo";
  /** Bytes; só nos arquivos. */
  readonly tamanho?: number;
}

export interface ListagemDaPasta {
  /** Caminho relativo à raiz, com `/`; vazio na raiz. */
  readonly caminho: string;
  readonly entradas: readonly EntradaDaPasta[];
  /** A pasta tinha mais que `MAXIMO_DE_ENTRADAS_DA_PASTA` itens e a lista foi cortada. */
  readonly truncada: boolean;
}

export interface ConteudoDoArquivo {
  /** Caminho relativo à raiz, com `/`. */
  readonly caminho: string;
  /** O texto em UTF-8. */
  readonly conteudo: string;
  /** Bytes. */
  readonly tamanho: number;
  readonly linhas: number;
}

/**
 * - `caminho_invalido`: absoluto, com `..` ou vazio onde se pede um arquivo.
 * - `bloqueado`: `.git`, `node_modules`, `.env*` ou algo que sai da pasta (symlink).
 * - `nao_encontrado`: Orquestrador, pasta ou arquivo que não existe.
 * - `tipo_errado`: pediu-se uma pasta e é arquivo, ou o contrário.
 * - `grande_demais`: arquivo acima de `TAMANHO_MAXIMO_DO_ARQUIVO`.
 * - `binario`: arquivo com byte nulo no começo.
 */
export type MotivoDoErroDeArquivo =
  | "caminho_invalido"
  | "bloqueado"
  | "nao_encontrado"
  | "tipo_errado"
  | "grande_demais"
  | "binario";

/** Recusa do visualizador. A mensagem já vem pronta para o usuário; o `motivo` escolhe o status HTTP. */
export class ErroDeArquivo extends Error {
  constructor(
    public readonly motivo: MotivoDoErroDeArquivo,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ErroDeArquivo";
  }
}

/** O que o disco diz de um caminho, seguindo symlinks. */
export interface InformacoesDoCaminho {
  readonly tipo: "pasta" | "arquivo" | "outro";
  readonly tamanho: number;
}

/** Um item lido do disco, antes dos filtros do visualizador. */
export interface ItemDoDisco {
  readonly nome: string;
  /** O tipo do alvo, já seguindo o symlink; `outro` para socket, fifo ou link quebrado. */
  readonly tipo: "pasta" | "arquivo" | "outro";
  readonly tamanho: number;
  /** É um symlink: o serviço confere para onde ele aponta. */
  readonly link: boolean;
}

/**
 * Porta para o disco, só leitura. Quem implementa não decide o que pode ser
 * lido: as regras de segurança ficam no serviço.
 */
export interface SistemaDeArquivos {
  /** O caminho real (symlinks resolvidos); `null` se não existe. */
  caminhoReal(caminho: string): Promise<string | null>;

  /** Tipo e tamanho; `null` se não existe. */
  informacoes(caminho: string): Promise<InformacoesDoCaminho | null>;

  /** Os itens de uma pasta (um nível). */
  listar(pasta: string): Promise<readonly ItemDoDisco[]>;

  /** O conteúdo inteiro de um arquivo. */
  ler(arquivo: string): Promise<Buffer>;
}
