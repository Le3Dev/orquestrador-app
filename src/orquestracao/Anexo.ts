import { ErroDeOrquestracao } from "./ErroDeOrquestracao";

/** Formatos de imagem que o Claude lê. */
export const TIPOS_DE_IMAGEM = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export type TipoDeImagem = (typeof TIPOS_DE_IMAGEM)[number];

/** Imagem vai inline para o Claude; documento é aberto por ele pelo caminho em disco. */
export const CATEGORIAS_DO_ANEXO = ["imagem", "documento"] as const;
export type CategoriaDoAnexo = (typeof CATEGORIAS_DO_ANEXO)[number];

/** Limite do Claude por imagem. */
export const TAMANHO_MAXIMO_DA_IMAGEM = 5 * 1024 * 1024;
export const TAMANHO_MAXIMO_DO_DOCUMENTO = 32 * 1024 * 1024;
export const MAXIMO_DE_IMAGENS_POR_MENSAGEM = 5;
export const MAXIMO_DE_ANEXOS_POR_MENSAGEM = 10;
export const TAMANHO_MAXIMO_DOS_ANEXOS_POR_MENSAGEM = 100 * 1024 * 1024;
const TAMANHO_MAXIMO_DO_NOME = 200;

const EXTENSAO_DA_IMAGEM: Readonly<Record<TipoDeImagem, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

/** Extensões de imagem que o nome do arquivo pode trazer (o navegador às vezes manda o tipo vazio). */
const TIPO_DA_IMAGEM_PELA_EXTENSAO: Readonly<Record<string, TipoDeImagem>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

/** Como um formato de documento é tratado: o tipo gravado, o nome para o usuário e se o servidor extrai o texto. */
export interface FormatoDeDocumento {
  tipoDeMidia: string;
  rotulo: string;
  /** Word, Excel e PowerPoint modernos (zip de XML): o servidor extrai o texto para um `.txt`. */
  textoExtraivel: boolean;
  /** Formato binário antigo (.doc, .xls): aceito, mas sem extração de texto. */
  legado: boolean;
}

const OFFICE = "application/vnd.openxmlformats-officedocument";

/** Documentos aceitos, pela extensão (minúscula): ela manda, pois o navegador erra o tipo de .md, .csv etc. */
export const FORMATOS_DE_DOCUMENTO: Readonly<Record<string, FormatoDeDocumento>> = {
  pdf: { tipoDeMidia: "application/pdf", rotulo: "PDF", textoExtraivel: false, legado: false },
  docx: {
    tipoDeMidia: `${OFFICE}.wordprocessingml.document`,
    rotulo: "Word",
    textoExtraivel: true,
    legado: false,
  },
  doc: { tipoDeMidia: "application/msword", rotulo: "Word (formato antigo)", textoExtraivel: false, legado: true },
  xlsx: { tipoDeMidia: `${OFFICE}.spreadsheetml.sheet`, rotulo: "Excel", textoExtraivel: true, legado: false },
  xls: {
    tipoDeMidia: "application/vnd.ms-excel",
    rotulo: "Excel (formato antigo)",
    textoExtraivel: false,
    legado: true,
  },
  csv: { tipoDeMidia: "text/csv", rotulo: "CSV", textoExtraivel: false, legado: false },
  pptx: {
    tipoDeMidia: `${OFFICE}.presentationml.presentation`,
    rotulo: "PowerPoint",
    textoExtraivel: true,
    legado: false,
  },
  html: { tipoDeMidia: "text/html", rotulo: "HTML", textoExtraivel: false, legado: false },
  htm: { tipoDeMidia: "text/html", rotulo: "HTML", textoExtraivel: false, legado: false },
  txt: { tipoDeMidia: "text/plain", rotulo: "Texto", textoExtraivel: false, legado: false },
  md: { tipoDeMidia: "text/markdown", rotulo: "Markdown", textoExtraivel: false, legado: false },
  json: { tipoDeMidia: "application/json", rotulo: "JSON", textoExtraivel: false, legado: false },
  xml: { tipoDeMidia: "application/xml", rotulo: "XML", textoExtraivel: false, legado: false },
  yaml: { tipoDeMidia: "application/yaml", rotulo: "YAML", textoExtraivel: false, legado: false },
  yml: { tipoDeMidia: "application/yaml", rotulo: "YAML", textoExtraivel: false, legado: false },
  log: { tipoDeMidia: "text/plain", rotulo: "Log", textoExtraivel: false, legado: false },
};

export const EXTENSOES_DE_DOCUMENTO: readonly string[] = Object.keys(FORMATOS_DE_DOCUMENTO);

/** Todas as extensões que um anexo guardado pode ter (as de imagem como são gravadas: `jpg`, não `jpeg`). */
export const EXTENSOES_DE_ANEXO: readonly string[] = [
  ...Object.values(EXTENSAO_DA_IMAGEM),
  ...EXTENSOES_DE_DOCUMENTO,
];

const MENSAGEM_DE_FORMATOS_ACEITOS =
  "Dá para anexar imagens (PNG, JPEG, GIF ou WebP) e documentos (PDF, Word, Excel, CSV, PowerPoint, HTML, TXT, MD, JSON, XML, YAML ou LOG).";

export function ehTipoDeImagem(valor: unknown): valor is TipoDeImagem {
  return typeof valor === "string" && (TIPOS_DE_IMAGEM as readonly string[]).includes(valor);
}

/** Categoria deduzida só pelo tipo gravado: serve para anexos guardados antes de existir `categoria`. */
export function categoriaPeloTipoDeMidia(tipoDeMidia: string): CategoriaDoAnexo {
  return tipoDeMidia.startsWith("image/") ? "imagem" : "documento";
}

export interface DadosDoAnexo {
  id: string;
  nome: string;
  tipoDeMidia: string;
  tamanhoEmBytes: number;
  /** Nome do arquivo guardado: o id e a extensão do formato. */
  arquivo: string;
  categoria: CategoriaDoAnexo;
}

function extensaoDoNome(nome: string): string {
  const achado = /\.([A-Za-z0-9]{1,10})$/.exec(nome);
  return achado === null ? "" : (achado[1] ?? "").toLowerCase();
}

/** Tipo de imagem aceito, ou, com o tipo ausente/genérico, o deduzido pela extensão do nome. */
function tipoDeImagemDe(tipoInformado: string, extensao: string): TipoDeImagem | undefined {
  if (ehTipoDeImagem(tipoInformado)) {
    return tipoInformado;
  }
  const generico = tipoInformado === "" || tipoInformado === "application/octet-stream";
  return generico && Object.hasOwn(TIPO_DA_IMAGEM_PELA_EXTENSAO, extensao)
    ? TIPO_DA_IMAGEM_PELA_EXTENSAO[extensao]
    : undefined;
}

function megabytes(bytes: number): string {
  return `${Math.round((bytes / 1024 / 1024) * 10) / 10}`.replace(".", ",");
}

/**
 * Arquivo anexado a uma mensagem. Objeto de valor.
 *
 * Imagem (PNG, JPEG, GIF ou WebP) segue inline, junto com o texto. Documento
 * (PDF, Word, Excel, PowerPoint, HTML, texto...) é guardado em disco e o agente o
 * abre pelo caminho, que vai citado na mensagem; os Subagentes fazem o mesmo.
 */
export class Anexo {
  private constructor(
    public readonly id: string,
    public readonly nome: string,
    public readonly tipoDeMidia: string,
    public readonly tamanhoEmBytes: number,
    public readonly categoria: CategoriaDoAnexo,
    public readonly extensao: string,
    private readonly formato: FormatoDeDocumento | null,
  ) {}

  static de(dados: { id: string; nome: string; tipoDeMidia: string; tamanhoEmBytes: number }): Anexo {
    const tipoInformado = dados.tipoDeMidia.trim().toLowerCase();
    const nomeLimpo = dados.nome.trim().slice(0, TAMANHO_MAXIMO_DO_NOME);
    const extensaoDoArquivo = extensaoDoNome(nomeLimpo);

    const tipoDeImagem = tipoDeImagemDe(tipoInformado, extensaoDoArquivo);
    if (tipoDeImagem !== undefined) {
      const nome = nomeLimpo || "imagem";
      if (dados.tamanhoEmBytes <= 0) {
        throw new ErroDeOrquestracao("dados_invalidos", `A imagem "${nome}" está vazia.`);
      }
      if (dados.tamanhoEmBytes > TAMANHO_MAXIMO_DA_IMAGEM) {
        throw new ErroDeOrquestracao(
          "dados_invalidos",
          `A imagem "${nome}" passa de ${megabytes(TAMANHO_MAXIMO_DA_IMAGEM)} MB, o limite do Claude por imagem.`,
        );
      }
      return new Anexo(dados.id, nome, tipoDeImagem, dados.tamanhoEmBytes, "imagem", EXTENSAO_DA_IMAGEM[tipoDeImagem], null);
    }

    // 3. Documento: a extensão manda (o tipo do navegador não é confiável para .md, .csv...).
    const formato = Object.hasOwn(FORMATOS_DE_DOCUMENTO, extensaoDoArquivo)
      ? FORMATOS_DE_DOCUMENTO[extensaoDoArquivo]
      : undefined;
    if (formato === undefined) {
      if (tipoInformado.startsWith("image/")) {
        throw new ErroDeOrquestracao("dados_invalidos", `Só dá para anexar imagens PNG, JPEG, GIF ou WebP. ${MENSAGEM_DE_FORMATOS_ACEITOS}`);
      }
      const referencia = nomeLimpo === "" ? "O arquivo" : `O arquivo "${nomeLimpo}"`;
      throw new ErroDeOrquestracao("dados_invalidos", `${referencia} tem um formato que não dá para anexar. ${MENSAGEM_DE_FORMATOS_ACEITOS}`);
    }
    const nome = nomeLimpo;
    if (dados.tamanhoEmBytes <= 0) {
      throw new ErroDeOrquestracao("dados_invalidos", `O documento "${nome}" está vazio.`);
    }
    if (dados.tamanhoEmBytes > TAMANHO_MAXIMO_DO_DOCUMENTO) {
      throw new ErroDeOrquestracao(
        "dados_invalidos",
        `O documento "${nome}" passa de ${megabytes(TAMANHO_MAXIMO_DO_DOCUMENTO)} MB, o limite por documento.`,
      );
    }
    return new Anexo(dados.id, nome, formato.tipoDeMidia, dados.tamanhoEmBytes, "documento", extensaoDoArquivo, formato);
  }

  /** Reabre um anexo já aceito, a partir dos dados gravados no turno. */
  static reconstituir(dados: DadosDoAnexo): Anexo {
    const extensao = dados.arquivo.slice(dados.arquivo.lastIndexOf(".") + 1).toLowerCase();
    const formato =
      dados.categoria === "documento" && Object.hasOwn(FORMATOS_DE_DOCUMENTO, extensao)
        ? (FORMATOS_DE_DOCUMENTO[extensao] ?? null)
        : null;
    return new Anexo(dados.id, dados.nome, dados.tipoDeMidia, dados.tamanhoEmBytes, dados.categoria, extensao, formato);
  }

  get arquivo(): string {
    return `${this.id}.${this.extensao}`;
  }

  /** Nome do formato para o usuário: "Imagem", "PDF", "Excel"... */
  get rotulo(): string {
    return this.formato?.rotulo ?? "Imagem";
  }

  /** Formato binário antigo (.doc, .xls): sem extração de texto. */
  get legado(): boolean {
    return this.formato?.legado ?? false;
  }

  /** Word, Excel ou PowerPoint modernos: o servidor extrai o texto para um `.txt` ao lado. */
  get textoExtraivel(): boolean {
    return this.formato?.textoExtraivel ?? false;
  }

  paraDados(): DadosDoAnexo {
    return {
      id: this.id,
      nome: this.nome,
      tipoDeMidia: this.tipoDeMidia,
      tamanhoEmBytes: this.tamanhoEmBytes,
      arquivo: this.arquivo,
      categoria: this.categoria,
    };
  }
}

/**
 * Confere os limites de uma mensagem inteira: quantidade de anexos, de imagens e
 * o tamanho somado. Devolve a mensagem para o usuário, ou nulo se está tudo certo.
 */
export function problemaDosAnexosDaMensagem(
  anexos: readonly { categoria: CategoriaDoAnexo; tamanhoEmBytes: number }[],
): string | null {
  if (anexos.length > MAXIMO_DE_ANEXOS_POR_MENSAGEM) {
    return `Anexe até ${MAXIMO_DE_ANEXOS_POR_MENSAGEM} arquivos por mensagem.`;
  }
  if (anexos.filter((anexo) => anexo.categoria === "imagem").length > MAXIMO_DE_IMAGENS_POR_MENSAGEM) {
    return `Anexe até ${MAXIMO_DE_IMAGENS_POR_MENSAGEM} imagens por mensagem.`;
  }
  const total = anexos.reduce((soma, anexo) => soma + anexo.tamanhoEmBytes, 0);
  if (total > TAMANHO_MAXIMO_DOS_ANEXOS_POR_MENSAGEM) {
    return `Os anexos de uma mensagem somam no máximo ${megabytes(TAMANHO_MAXIMO_DOS_ANEXOS_POR_MENSAGEM)} MB.`;
  }
  return null;
}
