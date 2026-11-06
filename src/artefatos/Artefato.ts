import { ErroDeArtefato, MENSAGEM_DE_TITULO_INVALIDO } from "./ErroDeArtefato";
import { DadosDaOrigem, OrigemDoArtefato } from "./OrigemDoArtefato";
import { DadosDaVersao, VersaoDoArtefato } from "./VersaoDoArtefato";

export const FORMATOS_DE_ARTEFATO = ["html", "markdown"] as const;
export type FormatoDoArtefato = (typeof FORMATOS_DE_ARTEFATO)[number];

export const TAMANHO_MAXIMO_DO_TITULO = 120;
export const TAMANHO_MAXIMO_DO_NOME_DO_ARQUIVO = 255;
/** Título de um arquivo cujo nome, sem a extensão, não tem letra nenhuma (ex.: "---.html"). */
export const TITULO_SEM_NOME = "Artefato";

/** Extensões aceitas na pasta de entrada (sem diferenciar maiúsculas). As outras são ignoradas. */
const FORMATO_POR_EXTENSAO: ReadonlyMap<string, FormatoDoArtefato> = new Map([
  ["html", "html"],
  ["htm", "html"],
  ["md", "markdown"],
  ["markdown", "markdown"],
]);

/** Extensão com que cada versão é guardada: `v<N>.html` ou `v<N>.md`. */
export const EXTENSAO_DO_FORMATO: Readonly<Record<FormatoDoArtefato, string>> = {
  html: "html",
  markdown: "md",
};

function separarExtensao(arquivo: string): { nome: string; extensao: string } | null {
  const ponto = arquivo.lastIndexOf(".");
  // ".md" sozinho não tem nome; "relatorio." não tem extensão.
  if (ponto <= 0 || ponto === arquivo.length - 1) {
    return null;
  }
  return { nome: arquivo.slice(0, ponto), extensao: arquivo.slice(ponto + 1).toLowerCase() };
}

/** `html` para .html/.htm, `markdown` para .md/.markdown; `null` para o resto. */
export function formatoDoArquivo(arquivo: string): FormatoDoArtefato | null {
  const partes = separarExtensao(arquivo);
  return partes === null ? null : (FORMATO_POR_EXTENSAO.get(partes.extensao) ?? null);
}

/** Só um nome de arquivo, sem pasta: ele é usado para achar (e apagar) o arquivo na entrada. */
export function ehNomeDeArquivoValido(arquivo: string): boolean {
  return (
    arquivo.length > 0 &&
    arquivo.length <= TAMANHO_MAXIMO_DO_NOME_DO_ARQUIVO &&
    arquivo !== "." &&
    arquivo !== ".." &&
    !/[\\/\0]/.test(arquivo)
  );
}

/** "relatorio-de_vendas.html" -> "relatorio de vendas". */
export function tituloInicial(arquivo: string): string {
  const nome = separarExtensao(arquivo)?.nome ?? arquivo;
  const titulo = nome.replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();
  if (titulo === "") {
    return TITULO_SEM_NOME;
  }
  return titulo.length > TAMANHO_MAXIMO_DO_TITULO ? titulo.slice(0, TAMANHO_MAXIMO_DO_TITULO).trimEnd() : titulo;
}

function tituloValido(titulo: string): string {
  const aparado = titulo.trim();
  if (aparado === "" || aparado.length > TAMANHO_MAXIMO_DO_TITULO) {
    throw new ErroDeArtefato("dados_invalidos", MENSAGEM_DE_TITULO_INVALIDO);
  }
  return aparado;
}

export interface DadosDoArtefato {
  id: string;
  titulo: string;
  formato: FormatoDoArtefato;
  origem: DadosDaOrigem;
  /** Nome do arquivo na pasta de entrada (ex.: "relatorio.html"). */
  arquivo: string;
  /** ISO 8601 */
  criadoEm: string;
  /** ISO 8601 */
  atualizadoEm: string;
  /** Da primeira (1) para a mais recente. */
  versoes: DadosDaVersao[];
}

export interface NovoArtefato {
  id: string;
  origem: OrigemDoArtefato;
  arquivo: string;
  /** sha256 do conteúdo da primeira versão. */
  hash: string;
  /** Em bytes. */
  tamanho: number;
  agora: Date;
}

/**
 * Raiz do agregado: uma página HTML ou um documento Markdown entregue por um
 * agente (Orquestrador ou chat rápido), com todas as suas versões.
 *
 * A identidade de negócio, para a coleta, é a origem + o nome do arquivo:
 * regravar o mesmo arquivo na entrada é uma versão nova do mesmo Artefato.
 * O conteúdo de cada versão não fica no agregado (só tamanho e hash): ele
 * é guardado e lido pelo repositório.
 */
export class Artefato {
  private constructor(
    public readonly id: string,
    private tituloAtual: string,
    public readonly formato: FormatoDoArtefato,
    public readonly origem: OrigemDoArtefato,
    public readonly arquivo: string,
    private readonly criadoEmMs: number,
    private atualizadoEmMs: number,
    private readonly versoesGravadas: VersaoDoArtefato[],
  ) {}

  static criar({ id, origem, arquivo, hash, tamanho, agora }: NovoArtefato): Artefato {
    if (!ehNomeDeArquivoValido(arquivo)) {
      throw new ErroDeArtefato("dados_invalidos", `Nome de arquivo inválido: "${arquivo}".`);
    }
    const formato = formatoDoArquivo(arquivo);
    if (formato === null) {
      throw new ErroDeArtefato("dados_invalidos", `O arquivo "${arquivo}" não é HTML nem Markdown.`);
    }
    const primeira = VersaoDoArtefato.criar(1, hash, tamanho, agora);
    return new Artefato(
      id,
      tituloInicial(arquivo),
      formato,
      origem,
      arquivo,
      agora.getTime(),
      agora.getTime(),
      [primeira],
    );
  }

  static reconstituir(dados: DadosDoArtefato): Artefato {
    if (!ehNomeDeArquivoValido(dados.arquivo)) {
      throw new ErroDeArtefato("dados_invalidos", `Nome de arquivo inválido: "${dados.arquivo}".`);
    }
    const versoes = dados.versoes.map((versao) => VersaoDoArtefato.reconstituir(versao));
    if (versoes.length === 0 || versoes.some((versao, indice) => versao.numero !== indice + 1)) {
      throw new ErroDeArtefato("dados_invalidos", "As versões do artefato devem ser numeradas de 1 em diante, sem falhas.");
    }
    return new Artefato(
      dados.id,
      tituloValido(dados.titulo),
      dados.formato,
      OrigemDoArtefato.reconstituir(dados.origem),
      dados.arquivo,
      Date.parse(dados.criadoEm),
      Date.parse(dados.atualizadoEm),
      versoes,
    );
  }

  get titulo(): string {
    return this.tituloAtual;
  }

  get criadoEm(): Date {
    return new Date(this.criadoEmMs);
  }

  get atualizadoEm(): Date {
    return new Date(this.atualizadoEmMs);
  }

  get versoes(): readonly VersaoDoArtefato[] {
    return [...this.versoesGravadas];
  }

  /** A mais recente: é a que a tela mostra por padrão. */
  get versaoAtual(): VersaoDoArtefato {
    const ultima = this.versoesGravadas[this.versoesGravadas.length - 1];
    if (ultima === undefined) {
      throw new Error(`Artefato "${this.id}" sem versões.`);
    }
    return ultima;
  }

  versao(numero: number): VersaoDoArtefato | null {
    return this.versoesGravadas.find((versao) => versao.numero === numero) ?? null;
  }

  /** Mesma origem e mesmo nome de arquivo na entrada. */
  vemDe(origem: OrigemDoArtefato, arquivo: string): boolean {
    return this.origem.igualA(origem) && this.arquivo === arquivo;
  }

  /**
   * O arquivo de entrada foi regravado. Se o conteúdo é o mesmo da última
   * versão (mesmo hash), nada muda e devolve `null`: eventos repetidos do
   * sistema de arquivos não duplicam versão. Voltar a um conteúdo antigo
   * (A → B → A) é, sim, uma versão nova.
   */
  adicionarVersao(hash: string, tamanho: number, agora: Date): VersaoDoArtefato | null {
    if (hash === this.versaoAtual.hash) {
      return null;
    }
    const nova = VersaoDoArtefato.criar(this.versaoAtual.numero + 1, hash, tamanho, agora);
    this.versoesGravadas.push(nova);
    this.atualizadoEmMs = agora.getTime();
    return nova;
  }

  /**
   * Título de 1 a 120 caracteres, contado depois de aparar. Devolve se mudou:
   * trocar pelo mesmo título não conta como alteração.
   */
  renomear(titulo: string, agora: Date): boolean {
    const novo = tituloValido(titulo);
    if (novo === this.tituloAtual) {
      return false;
    }
    this.tituloAtual = novo;
    this.atualizadoEmMs = agora.getTime();
    return true;
  }

  paraDados(): DadosDoArtefato {
    return {
      id: this.id,
      titulo: this.tituloAtual,
      formato: this.formato,
      origem: this.origem.paraDados(),
      arquivo: this.arquivo,
      criadoEm: new Date(this.criadoEmMs).toISOString(),
      atualizadoEm: new Date(this.atualizadoEmMs).toISOString(),
      versoes: this.versoesGravadas.map((versao) => versao.paraDados()),
    };
  }
}
