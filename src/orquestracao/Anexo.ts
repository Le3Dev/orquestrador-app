import { ErroDeOrquestracao } from "./ErroDeOrquestracao";

/** Formatos de imagem que o Claude lê. */
export const TIPOS_DE_IMAGEM = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export type TipoDeImagem = (typeof TIPOS_DE_IMAGEM)[number];

/** Documentos aceitos: o servidor extrai o texto deles para o Claude ler. */
export const TIPOS_DE_DOCUMENTO = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "text/plain",
  "text/markdown",
] as const;
export type TipoDeDocumento = (typeof TIPOS_DE_DOCUMENTO)[number];

export const TIPOS_DE_MIDIA = [...TIPOS_DE_IMAGEM, ...TIPOS_DE_DOCUMENTO] as const;
export type TipoDeMidia = (typeof TIPOS_DE_MIDIA)[number];

export type CategoriaDoAnexo = "imagem" | "documento";

/** Limite do Claude por imagem. */
export const TAMANHO_MAXIMO_DA_IMAGEM = 5 * 1024 * 1024;
export const TAMANHO_MAXIMO_DO_DOCUMENTO = 30 * 1024 * 1024;
export const MAXIMO_DE_IMAGENS_POR_MENSAGEM = 5;
export const MAXIMO_DE_DOCUMENTOS_POR_MENSAGEM = 5;
export const MAXIMO_DE_ANEXOS_POR_MENSAGEM = MAXIMO_DE_IMAGENS_POR_MENSAGEM + MAXIMO_DE_DOCUMENTOS_POR_MENSAGEM;
const TAMANHO_MAXIMO_DO_NOME = 200;

const EXTENSAO: Readonly<Record<TipoDeMidia, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xls",
  "text/csv": "csv",
  "text/plain": "txt",
  "text/markdown": "md",
};

/** Extensões do nome do arquivo que levam a cada tipo (jpeg e jpg são o mesmo). */
const TIPO_POR_EXTENSAO: Readonly<Record<string, TipoDeMidia>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  csv: "text/csv",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
};

/** Tipos que os navegadores mandam para vários formatos de texto: a extensão do nome decide. */
const TIPOS_GENERICOS = new Set<string>(["", "application/octet-stream", "text/plain", "application/vnd.ms-excel"]);

export const MENSAGEM_DE_TIPO_NAO_ACEITO =
  "Tipo de arquivo não aceito. Anexe imagens (PNG, JPEG, GIF, WebP) ou documentos (PDF, DOCX, XLSX, XLS, CSV, TXT, MD).";

export function ehTipoDeImagem(valor: unknown): valor is TipoDeImagem {
  return typeof valor === "string" && (TIPOS_DE_IMAGEM as readonly string[]).includes(valor);
}

export function ehTipoDeMidia(valor: unknown): valor is TipoDeMidia {
  return typeof valor === "string" && (TIPOS_DE_MIDIA as readonly string[]).includes(valor);
}

export function categoriaDoTipo(tipo: TipoDeMidia): CategoriaDoAnexo {
  return ehTipoDeImagem(tipo) ? "imagem" : "documento";
}

export function extensaoDoTipo(tipo: TipoDeMidia): string {
  return EXTENSAO[tipo];
}

/** O tipo pela extensão do arquivo guardado (`<id>.pdf`); nulo se for desconhecida. */
export function tipoPelaExtensao(nomeDeArquivo: string): TipoDeMidia | null {
  const ponto = nomeDeArquivo.lastIndexOf(".");
  if (ponto < 0) {
    return null;
  }
  return TIPO_POR_EXTENSAO[nomeDeArquivo.slice(ponto + 1).toLowerCase()] ?? null;
}

/**
 * Decide o tipo de um anexo pelo tipo informado pelo navegador E pela extensão
 * do nome. O tipo informado vale quando é aceito e não contradiz a extensão;
 * tipo vazio ou genérico (alguns navegadores mandam vazio no .md e .csv, ou
 * `application/vnd.ms-excel` no .csv) cede à extensão. Nulo: não aceito.
 */
export function identificarTipoDeMidia(nome: string, tipoInformado: string): TipoDeMidia | null {
  const informado = tipoInformado.split(";")[0]?.trim().toLowerCase() ?? "";
  const pelaExtensao = tipoPelaExtensao(nome.trim());
  if (!ehTipoDeMidia(informado)) {
    // Sem tipo útil: só a extensão, e só para documentos (imagem sem tipo não dá para confiar).
    if (TIPOS_GENERICOS.has(informado) && pelaExtensao !== null && categoriaDoTipo(pelaExtensao) === "documento") {
      return pelaExtensao;
    }
    return null;
  }
  if (pelaExtensao === informado) {
    return informado;
  }
  if (pelaExtensao === null) {
    // Imagem colada pode vir com qualquer nome; documento com extensão estranha (setup.exe) não passa.
    const temExtensao = /\.[0-9a-z]{1,8}$/i.test(nome.trim());
    return ehTipoDeImagem(informado) || !temExtensao ? informado : null;
  }
  const ambosImagem = ehTipoDeImagem(informado) && ehTipoDeImagem(pelaExtensao);
  if (ambosImagem) {
    // A foto renomeada: o tipo informado é o que o navegador leu do arquivo.
    return informado;
  }
  if (TIPOS_GENERICOS.has(informado) && categoriaDoTipo(pelaExtensao) === "documento") {
    return pelaExtensao;
  }
  return null;
}

export function tamanhoMaximoDaCategoria(categoria: CategoriaDoAnexo): number {
  return categoria === "imagem" ? TAMANHO_MAXIMO_DA_IMAGEM : TAMANHO_MAXIMO_DO_DOCUMENTO;
}

export interface DadosDoAnexo {
  id: string;
  nome: string;
  tipoDeMidia: TipoDeMidia;
  /** Ausente nos anexos gravados antes dos documentos: vale "imagem". */
  categoria: CategoriaDoAnexo;
  tamanhoEmBytes: number;
  /** Nome do arquivo guardado: o id e a extensão do formato. */
  arquivo: string;
}

/** O id do anexo a partir do nome do arquivo guardado (`<id>.<extensão>`). */
export function idDoArquivo(arquivo: string): string {
  const ponto = arquivo.indexOf(".");
  return ponto < 0 ? arquivo : arquivo.slice(0, ponto);
}

/** O arquivo com o texto extraído de um documento, guardado ao lado do original. */
export function arquivoDeTextoDe(id: string): string {
  return `${id}.texto.txt`;
}

/**
 * Imagem ou documento anexado a uma mensagem para o Orquestrador. Objeto de valor.
 *
 * O Orquestrador recebe as imagens junto com o texto; os Subagentes (e o
 * Orquestrador, nos documentos) as abrem pelo caminho em disco, que vai citado
 * na mensagem.
 */
export class Anexo {
  private constructor(
    public readonly id: string,
    public readonly nome: string,
    public readonly tipoDeMidia: TipoDeMidia,
    public readonly tamanhoEmBytes: number,
  ) {}

  /** `tipoDeMidia` é o informado pelo navegador (pode vir vazio); o tipo final sai dele e da extensão do nome. */
  static de(dados: { id: string; nome: string; tipoDeMidia: string; tamanhoEmBytes: number }): Anexo {
    const nomeInformado = dados.nome.trim().slice(0, TAMANHO_MAXIMO_DO_NOME);
    const tipo = identificarTipoDeMidia(nomeInformado, dados.tipoDeMidia);
    if (tipo === null) {
      throw new ErroDeOrquestracao("dados_invalidos", MENSAGEM_DE_TIPO_NAO_ACEITO);
    }
    const categoria = categoriaDoTipo(tipo);
    const nome = nomeInformado || (categoria === "imagem" ? "imagem" : "documento");
    if (dados.tamanhoEmBytes <= 0) {
      throw new ErroDeOrquestracao(
        "dados_invalidos",
        categoria === "imagem" ? `A imagem "${nome}" está vazia.` : `O documento "${nome}" está vazio.`,
      );
    }
    const limite = tamanhoMaximoDaCategoria(categoria);
    if (dados.tamanhoEmBytes > limite) {
      throw new ErroDeOrquestracao(
        "dados_invalidos",
        categoria === "imagem"
          ? `A imagem "${nome}" passa de ${limite / 1024 / 1024} MB, o limite do Claude por imagem.`
          : `O documento "${nome}" passa de ${limite / 1024 / 1024} MB, o limite por documento.`,
      );
    }
    return new Anexo(dados.id, nome, tipo, dados.tamanhoEmBytes);
  }

  get categoria(): CategoriaDoAnexo {
    return categoriaDoTipo(this.tipoDeMidia);
  }

  get arquivo(): string {
    return `${this.id}.${EXTENSAO[this.tipoDeMidia]}`;
  }

  paraDados(): DadosDoAnexo {
    return {
      id: this.id,
      nome: this.nome,
      tipoDeMidia: this.tipoDeMidia,
      categoria: this.categoria,
      tamanhoEmBytes: this.tamanhoEmBytes,
      arquivo: this.arquivo,
    };
  }
}

/** Confere a quantidade por categoria; devolve a mensagem de erro, ou nulo se está dentro do limite. */
export function erroDaQuantidadeDeAnexos(anexos: readonly { categoria: CategoriaDoAnexo }[]): string | null {
  const imagens = anexos.filter((anexo) => anexo.categoria === "imagem").length;
  if (imagens > MAXIMO_DE_IMAGENS_POR_MENSAGEM) {
    return `Anexe até ${MAXIMO_DE_IMAGENS_POR_MENSAGEM} imagens por mensagem.`;
  }
  if (anexos.length - imagens > MAXIMO_DE_DOCUMENTOS_POR_MENSAGEM) {
    return `Anexe até ${MAXIMO_DE_DOCUMENTOS_POR_MENSAGEM} documentos por mensagem.`;
  }
  return null;
}
