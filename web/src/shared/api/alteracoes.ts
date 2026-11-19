import { textosAtuais } from "../idioma/idioma";
import { textosDeApoioDosNos } from "../idioma/textos/nos";
import { ErroDaApi } from "./cliente";

const textos = () => textosAtuais(textosDeApoioDosNos).alteracoes;

/*
 * Painel de alterações do worktree (`/api/orquestradores/:id/alteracoes`):
 * o que o Orquestrador deixou por commitar no worktree dele e o diff de cada
 * arquivo. Só leitura. Mantenha em sincronia com
 * `src/orquestracao/AlteracoesDoWorktree.ts` e `src/controllers/alteracoesRoutes.ts`.
 */

/** Como um arquivo mudou em relação ao HEAD do worktree. */
export type SituacaoDoArquivo = "adicionado" | "modificado" | "removido" | "renomeado" | "nao_rastreado";

/**
 * - `sem_git`: a pasta não é repositório git com HEAD; os agentes alteram a pasta direto.
 * - `sem_worktree`: é repositório git, mas não há worktree agora (o último pedido não alterou nada).
 * - `com_worktree`: há worktree; a lista traz o que nele ainda não foi commitado.
 */
export type SituacaoDasAlteracoes = "sem_git" | "sem_worktree" | "com_worktree";

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

/** As alterações pendentes do worktree de um Orquestrador, num instante. */
export interface AlteracoesDoWorktree {
  readonly situacao: SituacaoDasAlteracoes;
  readonly branch: string | null;
  /** Caminho do worktree no disco; `null` sem worktree. */
  readonly caminho: string | null;
  /** Um pedido está rodando dentro do worktree agora: a lista pode mudar. */
  readonly emUso: boolean;
  /** Commits da branch do worktree que ainda não estão no HEAD da pasta original. */
  readonly commitsNaBranch: number;
  readonly arquivos: readonly ArquivoAlterado[];
}

/** O diff de um arquivo da lista. */
export interface DiffDoArquivo {
  readonly caminho: string;
  /** Diff unificado; vazio quando o arquivo é binário. */
  readonly diff: string;
  /** O diff passou do limite e foi cortado no fim de uma linha. */
  readonly truncado: boolean;
  readonly binario: boolean;
}

function extrairMensagem(corpo: unknown): string | null {
  if (typeof corpo === "object" && corpo !== null && "erro" in corpo && typeof corpo.erro === "string") {
    return corpo.erro;
  }
  return null;
}

/**
 * GET na API com o mesmo tratamento de erro do `cliente.ts`: falha de rede vira
 * uma mensagem pronta; resposta de erro vira `ErroDaApi` com o `{ erro }` do servidor.
 */
async function ler<Resposta>(caminho: string): Promise<Resposta> {
  let resposta: Response;
  try {
    resposta = await fetch(`/api${caminho}`, { headers: { "Content-Type": "application/json" } });
  } catch {
    throw new Error(textos().semConexao);
  }

  const corpo: unknown = await resposta.json().catch(() => null);
  if (!resposta.ok) {
    throw new ErroDaApi(extrairMensagem(corpo) ?? textos().erroDoServidor(resposta.status), resposta.status);
  }
  return corpo as Resposta;
}

function caminhoDasAlteracoes(orquestradorId: string): string {
  return `/orquestradores/${encodeURIComponent(orquestradorId)}/alteracoes`;
}

export const apiDeAlteracoes = {
  /** O que o Orquestrador deixou por commitar no worktree dele. */
  consultar: (orquestradorId: string) => ler<AlteracoesDoWorktree>(caminhoDasAlteracoes(orquestradorId)),

  /** O diff de um arquivo que está na lista de `consultar` (outro caminho é recusado com 404). */
  lerDiff: (orquestradorId: string, arquivo: string) =>
    ler<DiffDoArquivo>(
      `${caminhoDasAlteracoes(orquestradorId)}/diff?${new URLSearchParams({ arquivo }).toString()}`,
    ),
};

/* --------------------------------------------------------------------------
   Leitura para a tela: o estado da consulta, os textos e as linhas do diff.
   -------------------------------------------------------------------------- */

/** A consulta das alterações como o botão e o painel a mostram. */
export interface ConsultaDasAlteracoes {
  /** A última leitura que deu certo; `null` antes da primeira e depois de uma falha. */
  readonly alteracoes: AlteracoesDoWorktree | null;
  readonly carregando: boolean;
  /** Mensagem da última falha; `null` quando a última leitura deu certo. */
  readonly erro: string | null;
}

/** Os textos fixos do painel, no idioma atual (lidos a cada chamada). */
export const textoSemGit = (): string => textos().semGit;
export const textoSemAlteracoes = (): string => textos().semAlteracoes;
export const textoEmUso = (): string => textos().emUso;
export const textoDiffTruncado = (): string => textos().diffTruncado;
export const textoArquivoBinario = (): string => textos().arquivoBinario;
export const textoDiffVazio = (): string => textos().diffVazio;

/** Aviso dos commits da branch, que o painel não lista; `null` quando não há. */
export function textoDosCommitsNaBranch(alteracoes: AlteracoesDoWorktree): string | null {
  const { commitsNaBranch: quantidade, branch } = alteracoes;
  if (quantidade <= 0 || branch === null) {
    return null;
  }
  return textos().commitsNaBranch(quantidade, branch);
}

/** Como uma linha do diff unificado é pintada. */
export type TipoDaLinhaDoDiff = "cabecalho" | "trecho" | "adicao" | "remocao" | "contexto" | "observacao";

export interface LinhaDoDiff {
  readonly texto: string;
  readonly tipo: TipoDaLinhaDoDiff;
}

/**
 * Separa o diff unificado em linhas tipadas. Antes do primeiro `@@` tudo é
 * cabeçalho (`diff --git`, `index`, `---`, `+++`): assim uma linha removida
 * que começa com `--` (comentário SQL, por exemplo) não vira cabeçalho.
 */
export function classificarLinhasDoDiff(diff: string): LinhaDoDiff[] {
  if (diff === "") {
    return [];
  }
  const linhas = diff.split("\n");
  if (linhas.at(-1) === "") {
    linhas.pop();
  }
  let dentroDeUmTrecho = false;
  return linhas.map((linha): LinhaDoDiff => {
    const texto = linha.endsWith("\r") ? linha.slice(0, -1) : linha;
    if (texto.startsWith("diff --git ")) {
      dentroDeUmTrecho = false;
      return { texto, tipo: "cabecalho" };
    }
    if (texto.startsWith("@@")) {
      dentroDeUmTrecho = true;
      return { texto, tipo: "trecho" };
    }
    if (!dentroDeUmTrecho) {
      return { texto, tipo: "cabecalho" };
    }
    if (texto.startsWith("+")) {
      return { texto, tipo: "adicao" };
    }
    if (texto.startsWith("-")) {
      return { texto, tipo: "remocao" };
    }
    // "\ No newline at end of file"
    if (texto.startsWith("\\")) {
      return { texto, tipo: "observacao" };
    }
    return { texto, tipo: "contexto" };
  });
}
