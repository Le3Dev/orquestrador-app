import path from "node:path";

import {
  BYTES_PARA_DETECTAR_BINARIO,
  ConteudoDoArquivo,
  EntradaDaPasta,
  ErroDeArquivo,
  ItemDoDisco,
  ListagemDaPasta,
  MAXIMO_DE_ENTRADAS_DA_PASTA,
  SistemaDeArquivos,
  TAMANHO_MAXIMO_DO_ARQUIVO,
} from "./ArquivosDaPasta";
import { ErroDeOrquestracao } from "./ErroDeOrquestracao";
import { PastaDeTrabalho } from "./PastaDeTrabalho";
import { RepositorioDeOrquestradores } from "./RepositorioDeOrquestradores";

export interface DependenciasDoServicoDeArquivos {
  repositorio: Pick<RepositorioDeOrquestradores, "buscarPorId">;
  sistema: SistemaDeArquivos;
}

/** Pastas que somem da árvore e não abrem: o histórico do git e as dependências. */
const PASTAS_ESCONDIDAS = new Set([".git", "node_modules"]);

const MENSAGEM_DE_BLOQUEIO = ".git, node_modules e .env não abrem no visualizador";

/**
 * `.git`, `node_modules`, `.env` e `.env.*`. Sem diferenciar maiúsculas: no
 * Mac e no Windows `.GIT` é a mesma pasta que `.git`.
 */
function nomeBloqueado(nome: string): boolean {
  const minusculo = nome.toLowerCase();
  return PASTAS_ESCONDIDAS.has(minusculo) || minusculo === ".env" || minusculo.startsWith(".env.");
}

/**
 * Quebra o caminho pedido em partes, recusando o que não é um caminho
 * relativo limpo: absoluto (inclusive `C:\` e `\\servidor`), com `..` ou com
 * byte nulo. `.` e barras repetidas somem; `\` vale como `/`.
 */
function partesDoCaminho(caminho: string): string[] {
  if (caminho.includes("\0")) {
    throw new ErroDeArquivo("caminho_invalido", "Caminho inválido.");
  }
  if (path.posix.isAbsolute(caminho) || path.win32.isAbsolute(caminho) || /^[a-zA-Z]:/.test(caminho)) {
    throw new ErroDeArquivo("caminho_invalido", "Caminho inválido: use um caminho relativo à pasta do orquestrador.");
  }
  const partes = caminho.split(/[\\/]+/).filter((parte) => parte !== "" && parte !== ".");
  if (partes.includes("..")) {
    throw new ErroDeArquivo("caminho_invalido", 'Caminho inválido: ".." não é aceito.');
  }
  return partes;
}

/** O caminho fica dentro da raiz? A mesma conferência da pasta de trabalho (`PastaDeTrabalho.dentroDe`). */
function dentroDaRaiz(raiz: string, caminho: string): boolean {
  try {
    PastaDeTrabalho.dentroDe(raiz, caminho);
    return true;
  } catch (erro) {
    if (erro instanceof ErroDeOrquestracao) {
      return false;
    }
    throw erro;
  }
}

/** Alguma parte do caminho (relativo à raiz) é bloqueada? */
function temParteBloqueada(relativo: string): boolean {
  return relativo.split(/[\\/]+/).some(nomeBloqueado);
}

function contarLinhas(conteudo: string): number {
  if (conteudo === "") {
    return 0;
  }
  const quebras = conteudo.match(/\n/g)?.length ?? 0;
  return conteudo.endsWith("\n") ? quebras : quebras + 1;
}

function emKb(bytes: number): string {
  return `${Math.ceil(bytes / 1024).toLocaleString("pt-BR")} KB`;
}

/** Pastas antes de arquivos; dentro de cada grupo, em ordem alfabética (com números em ordem natural). */
function compararEntradas(a: EntradaDaPasta, b: EntradaDaPasta): number {
  if (a.tipo !== b.tipo) {
    return a.tipo === "pasta" ? -1 : 1;
  }
  return a.nome.localeCompare(b.nome, "pt-BR", { numeric: true, sensitivity: "base" });
}

/**
 * Casos de uso do visualizador de código: listar uma pasta (um nível) e ler um
 * arquivo da pasta de um Orquestrador. Só leitura. Stateless.
 *
 * Segurança: o caminho pedido é sempre relativo à raiz (o worktree atual, se
 * existir, senão a pasta de trabalho). Ele é resolvido no disco (symlinks
 * incluídos) e só vale se o caminho real continuar dentro da raiz real e fora
 * de `.git`, `node_modules` e `.env*`.
 */
export class ServicoDeArquivos {
  constructor(private readonly dependencias: DependenciasDoServicoDeArquivos) {}

  async listar(orquestradorId: string, caminho: string): Promise<ListagemDaPasta> {
    const partes = partesDoCaminho(caminho);
    const raiz = await this.raizReal(orquestradorId);
    const pasta = await this.resolver(raiz, partes);
    const { sistema } = this.dependencias;
    const informacoes = await sistema.informacoes(pasta);
    if (informacoes?.tipo !== "pasta") {
      throw new ErroDeArquivo("tipo_errado", `"${partes.join("/")}" não é uma pasta.`);
    }

    const itens = await sistema.listar(pasta);
    const visiveis = await Promise.all(itens.map((item) => this.entradaVisivel(raiz, pasta, item)));
    const entradas = visiveis.filter((entrada) => entrada !== null).sort(compararEntradas);
    return {
      caminho: partes.join("/"),
      entradas: entradas.slice(0, MAXIMO_DE_ENTRADAS_DA_PASTA),
      truncada: entradas.length > MAXIMO_DE_ENTRADAS_DA_PASTA,
    };
  }

  async ler(orquestradorId: string, caminho: string): Promise<ConteudoDoArquivo> {
    const partes = partesDoCaminho(caminho);
    if (partes.length === 0) {
      throw new ErroDeArquivo("caminho_invalido", "Informe o arquivo.");
    }
    const relativo = partes.join("/");
    const raiz = await this.raizReal(orquestradorId);
    const arquivo = await this.resolver(raiz, partes);
    const { sistema } = this.dependencias;
    const informacoes = await sistema.informacoes(arquivo);
    if (informacoes?.tipo !== "arquivo") {
      throw new ErroDeArquivo("tipo_errado", `"${relativo}" não é um arquivo.`);
    }
    if (informacoes.tamanho > TAMANHO_MAXIMO_DO_ARQUIVO) {
      throw grandeDemais(relativo, informacoes.tamanho);
    }

    const bytes = await sistema.ler(arquivo);
    // O arquivo pode ter crescido entre a consulta do tamanho e a leitura.
    if (bytes.length > TAMANHO_MAXIMO_DO_ARQUIVO) {
      throw grandeDemais(relativo, bytes.length);
    }
    if (bytes.subarray(0, BYTES_PARA_DETECTAR_BINARIO).includes(0)) {
      throw new ErroDeArquivo("binario", `"${relativo}" é um arquivo binário e não dá para mostrar como texto.`);
    }
    const conteudo = bytes.toString("utf8").replace(/^\uFEFF/, "");
    return { caminho: relativo, conteudo, tamanho: bytes.length, linhas: contarLinhas(conteudo) };
  }

  /** A raiz real (symlinks resolvidos): o worktree atual, se a pasta dele existir, senão a pasta de trabalho. */
  private async raizReal(orquestradorId: string): Promise<string> {
    const orquestrador = this.dependencias.repositorio.buscarPorId(orquestradorId);
    if (orquestrador === null) {
      throw new ErroDeArquivo("nao_encontrado", "Orquestrador não encontrado.");
    }
    const { sistema } = this.dependencias;
    const worktree = orquestrador.worktree;
    const raiz =
      worktree !== null && (await sistema.informacoes(worktree.caminho))?.tipo === "pasta"
        ? worktree.caminho
        : orquestrador.pastaDeTrabalho.caminho;
    const real = await sistema.caminhoReal(raiz);
    if (real === null) {
      throw new ErroDeArquivo("nao_encontrado", `A pasta do orquestrador não existe mais: ${raiz}`);
    }
    return real;
  }

  /**
   * O caminho real de `partes` sob a raiz. Barra os nomes bloqueados antes de
   * tocar no disco e de novo depois de resolver os symlinks (um link para
   * `.git/config` ou para fora da raiz é recusado).
   */
  private async resolver(raiz: string, partes: readonly string[]): Promise<string> {
    if (partes.length === 0) {
      return raiz;
    }
    const relativo = partes.join("/");
    if (partes.some(nomeBloqueado)) {
      throw new ErroDeArquivo("bloqueado", `"${relativo}" está bloqueado (${MENSAGEM_DE_BLOQUEIO}).`);
    }
    const pedido = PastaDeTrabalho.dentroDe(raiz, partes.join(path.sep)).caminho;
    const real = await this.dependencias.sistema.caminhoReal(pedido);
    if (real === null) {
      throw new ErroDeArquivo("nao_encontrado", `"${relativo}" não existe.`);
    }
    if (!dentroDaRaiz(raiz, real)) {
      throw new ErroDeArquivo("bloqueado", `"${relativo}" aponta para fora da pasta do orquestrador.`);
    }
    if (temParteBloqueada(path.relative(raiz, real))) {
      throw new ErroDeArquivo("bloqueado", `"${relativo}" aponta para algo bloqueado (${MENSAGEM_DE_BLOQUEIO}).`);
    }
    return real;
  }

  /** O item como entra na lista; `null` se ele some dela (bloqueado, especial, link quebrado ou para fora). */
  private async entradaVisivel(raiz: string, pasta: string, item: ItemDoDisco): Promise<EntradaDaPasta | null> {
    if (nomeBloqueado(item.nome) || item.tipo === "outro") {
      return null;
    }
    if (item.link) {
      const real = await this.dependencias.sistema.caminhoReal(path.join(pasta, item.nome));
      if (real === null || !dentroDaRaiz(raiz, real) || temParteBloqueada(path.relative(raiz, real))) {
        return null;
      }
    }
    return item.tipo === "pasta"
      ? { nome: item.nome, tipo: "pasta" }
      : { nome: item.nome, tipo: "arquivo", tamanho: item.tamanho };
  }
}

function grandeDemais(relativo: string, tamanho: number): ErroDeArquivo {
  return new ErroDeArquivo(
    "grande_demais",
    `"${relativo}" tem ${emKb(tamanho)}; o visualizador abre arquivos de até ${emKb(TAMANHO_MAXIMO_DO_ARQUIVO)}.`,
  );
}
