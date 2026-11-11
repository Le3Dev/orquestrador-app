import type { AnexoParaEnvio } from "./api/cliente";
import type { CategoriaDoAnexo, TipoDeImagem } from "./api/tipos";

/**
 * Mesmos limites do servidor: imagem até 5 MB (limite do Claude) e no máximo 5 por mensagem,
 * documento até 32 MB, 10 anexos e 100 MB no total por mensagem.
 */
export const TIPOS_DE_IMAGEM: readonly TipoDeImagem[] = ["image/png", "image/jpeg", "image/gif", "image/webp"];
export const TAMANHO_MAXIMO_DA_IMAGEM = 5 * 1024 * 1024;
export const TAMANHO_MAXIMO_DO_DOCUMENTO = 32 * 1024 * 1024;
export const MAXIMO_DE_IMAGENS = 5;
export const MAXIMO_DE_ANEXOS = 10;
export const TAMANHO_MAXIMO_DOS_ANEXOS = 100 * 1024 * 1024;

/** Texto enviado quando o usuário anexa arquivos mas não escreve nada. */
export const TEXTO_PADRAO_DOS_ANEXOS = "Analise os anexos.";

/** Como a tela chama um formato de documento; `legado` é o formato binário antigo, que o Claude não lê direto. */
export interface FormatoDeDocumento {
  rotulo: string;
  legado: boolean;
}

/** Documentos aceitos, pela extensão (minúscula): é ela que manda, pois o navegador erra o tipo de .md, .csv etc. */
export const FORMATOS_DE_DOCUMENTO: Readonly<Record<string, FormatoDeDocumento>> = {
  pdf: { rotulo: "PDF", legado: false },
  docx: { rotulo: "Word", legado: false },
  doc: { rotulo: "Word (formato antigo)", legado: true },
  xlsx: { rotulo: "Excel", legado: false },
  xls: { rotulo: "Excel (formato antigo)", legado: true },
  csv: { rotulo: "CSV", legado: false },
  pptx: { rotulo: "PowerPoint", legado: false },
  html: { rotulo: "HTML", legado: false },
  htm: { rotulo: "HTML", legado: false },
  txt: { rotulo: "Texto", legado: false },
  md: { rotulo: "Markdown", legado: false },
  json: { rotulo: "JSON", legado: false },
  xml: { rotulo: "XML", legado: false },
  yaml: { rotulo: "YAML", legado: false },
  yml: { rotulo: "YAML", legado: false },
  log: { rotulo: "Log", legado: false },
};

/** O valor do atributo `accept` do seletor de arquivos: os tipos de imagem e as extensões dos documentos. */
export const TIPOS_ACEITOS_NO_SELETOR: string = [
  ...TIPOS_DE_IMAGEM,
  ...Object.keys(FORMATOS_DE_DOCUMENTO).map((extensao) => `.${extensao}`),
].join(",");

/** Por que um .doc/.xls é aceito mas pouco útil: aparece no selo "formato antigo" do anexo. */
export const AVISO_DO_FORMATO_ANTIGO =
  "Formato antigo: o Claude não lê .doc e .xls direto. Salve como .docx ou .xlsx e anexe de novo para ele ler o conteúdo.";

const FORMATOS_ACEITOS =
  "Dá para anexar imagens (PNG, JPEG, GIF ou WebP) e documentos (PDF, Word, Excel, CSV, PowerPoint, HTML, TXT, MD, JSON, XML, YAML ou LOG).";

/** Extensões de imagem que o nome pode trazer quando o navegador manda o tipo vazio (o servidor faz o mesmo). */
const IMAGEM_PELA_EXTENSAO: ReadonlySet<string> = new Set(["png", "jpg", "jpeg", "gif", "webp"]);

/** Captura de tela do modo invisível: o Electron nomeia como `tela-<ISO>.jpg`. */
export function ehCapturaDeTela(nome: string): boolean {
  return /^tela-.+\.jpg$/i.test(nome);
}

function extensaoDoNome(nome: string): string {
  const achado = /\.([A-Za-z0-9]{1,10})$/.exec(nome.trim());
  return achado === null ? "" : (achado[1] ?? "").toLowerCase();
}

/** O formato de documento aceito pela extensão do nome, ou nulo. */
export function formatoDoDocumento(nome: string): FormatoDeDocumento | null {
  const extensao = extensaoDoNome(nome);
  return Object.hasOwn(FORMATOS_DE_DOCUMENTO, extensao) ? (FORMATOS_DE_DOCUMENTO[extensao] ?? null) : null;
}

function ehTipoDeImagem(tipo: string): tipo is TipoDeImagem {
  return (TIPOS_DE_IMAGEM as readonly string[]).includes(tipo);
}

/**
 * Imagem, documento, ou nulo se o formato não é aceito. Imagem é pelo tipo (ou pela extensão quando o
 * tipo vem vazio); documento é sempre pela extensão do nome.
 */
export function categoriaDoArquivo(arquivo: { name: string; type: string }): CategoriaDoAnexo | null {
  const tipo = arquivo.type.trim().toLowerCase();
  if (ehTipoDeImagem(tipo)) {
    return "imagem";
  }
  const extensao = extensaoDoNome(arquivo.name);
  if (formatoDoDocumento(arquivo.name) !== null) {
    return "documento";
  }
  const generico = tipo === "" || tipo === "application/octet-stream";
  return generico && IMAGEM_PELA_EXTENSAO.has(extensao) ? "imagem" : null;
}

/**
 * Os arquivos de uma colagem (Ctrl+V): só os de formato aceito. Colou arquivos que nenhum é aceito e sem
 * texto junto (ex.: um .zip copiado no Explorer)? Devolve todos, para o usuário ler por que foram recusados.
 */
export function arquivosColados(dados: Pick<DataTransfer, "files" | "getData">): File[] {
  const arquivos = [...dados.files];
  const aceitos = arquivos.filter((arquivo) => categoriaDoArquivo(arquivo) !== null);
  if (aceitos.length > 0 || arquivos.length === 0) {
    return aceitos;
  }
  return dados.getData("text/plain") === "" ? arquivos : [];
}

/**
 * Anexo vindo do servidor (turno ou mensagem do chat): imagem pela `categoria` e, nos gravados antes dela,
 * pelo `tipoDeMidia` "image/*".
 */
export function ehAnexoDeImagem(anexo: { categoria?: CategoriaDoAnexo | undefined; tipoDeMidia: string }): boolean {
  return anexo.categoria === undefined ? anexo.tipoDeMidia.startsWith("image/") : anexo.categoria === "imagem";
}

/**
 * Arquivo anexado ao prompt e ainda não enviado. Guarda só o arquivo (`Blob`): o base64 é gerado
 * no envio (`anexosParaEnvio`). A `previa` (só das imagens) é uma URL `blob:` e precisa ser
 * liberada com `liberarAnexos` ao sair de uso.
 */
export interface AnexoPendente {
  id: string;
  nome: string;
  categoria: CategoriaDoAnexo;
  /** O `File.type` do arquivo: pode ser vazio nos documentos (o servidor decide pela extensão). */
  tipoDeMidia: string;
  tamanhoEmBytes: number;
  arquivo: Blob;
  /** URL `blob:` para a miniatura antes do envio; nulo nos documentos. */
  previa: string | null;
  /** "Imagem", "PDF", "Word (formato antigo)"... */
  rotulo: string;
  /** Formato antigo (.doc, .xls): aceito, mas o Claude não o lê direto. */
  legado: boolean;
}

type ResumoDoAnexo = Pick<AnexoPendente, "categoria" | "tamanhoEmBytes">;

function megabytes(bytes: number): string {
  return String(Math.round(bytes / 1024 / 1024));
}

/** Por que o arquivo não pode ser anexado (somando-se aos `jaAnexados`), ou nulo se pode. */
export function problemaDoAnexo(
  arquivo: { name: string; type: string; size: number },
  jaAnexados: readonly ResumoDoAnexo[],
): string | null {
  const categoria = categoriaDoArquivo(arquivo);
  if (categoria === null) {
    return `"${arquivo.name || "O arquivo"}" tem um formato que não dá para anexar. ${FORMATOS_ACEITOS}`;
  }
  if (arquivo.size <= 0) {
    return `"${arquivo.name}" está vazio.`;
  }
  if (categoria === "imagem" && arquivo.size > TAMANHO_MAXIMO_DA_IMAGEM) {
    return `"${arquivo.name}" passa de ${megabytes(TAMANHO_MAXIMO_DA_IMAGEM)} MB, o limite do Claude por imagem.`;
  }
  if (categoria === "documento" && arquivo.size > TAMANHO_MAXIMO_DO_DOCUMENTO) {
    return `"${arquivo.name}" passa de ${megabytes(TAMANHO_MAXIMO_DO_DOCUMENTO)} MB, o limite por documento.`;
  }
  if (jaAnexados.length >= MAXIMO_DE_ANEXOS) {
    return `Dá para anexar até ${MAXIMO_DE_ANEXOS} arquivos por mensagem.`;
  }
  if (categoria === "imagem" && jaAnexados.filter((anexo) => anexo.categoria === "imagem").length >= MAXIMO_DE_IMAGENS) {
    return `Dá para anexar até ${MAXIMO_DE_IMAGENS} imagens por mensagem.`;
  }
  const somaDosAnexados = jaAnexados.reduce((soma, anexo) => soma + anexo.tamanhoEmBytes, 0);
  if (somaDosAnexados + arquivo.size > TAMANHO_MAXIMO_DOS_ANEXOS) {
    return `Os anexos de uma mensagem somam no máximo ${megabytes(TAMANHO_MAXIMO_DOS_ANEXOS)} MB.`;
  }
  return null;
}

export function lerAnexo(arquivo: File): Promise<AnexoPendente> {
  const categoria = categoriaDoArquivo(arquivo);
  if (categoria === null) {
    return Promise.reject(new Error(`"${arquivo.name}" não é um formato aceito.`));
  }
  try {
    if (categoria === "imagem") {
      return Promise.resolve({
        id: crypto.randomUUID(),
        // Imagens coladas chegam como "image.png"; o nome serve só de rótulo.
        nome: arquivo.name || "imagem colada",
        categoria,
        tipoDeMidia: arquivo.type,
        tamanhoEmBytes: arquivo.size,
        arquivo,
        previa: URL.createObjectURL(arquivo),
        rotulo: "Imagem",
        legado: false,
      });
    }
    const formato = formatoDoDocumento(arquivo.name);
    return Promise.resolve({
      id: crypto.randomUUID(),
      nome: arquivo.name,
      categoria,
      tipoDeMidia: arquivo.type,
      tamanhoEmBytes: arquivo.size,
      arquivo,
      previa: null,
      rotulo: formato?.rotulo ?? "Documento",
      legado: formato?.legado ?? false,
    });
  } catch {
    return Promise.reject(new Error(`Não foi possível ler "${arquivo.name}".`));
  }
}

/**
 * Quadro da captura de tela (chega em base64 pelo IPC do Electron): vira
 * `Blob` uma vez e a string não fica guardada. No envio, o base64 é refeito
 * a partir dos mesmos bytes, idêntico ao recebido.
 */
export function imagemDaCaptura(captura: { nome: string; tipoDeMidia: TipoDeImagem; base64: string }): AnexoPendente {
  const binario = atob(captura.base64);
  const bytes = new Uint8Array(binario.length);
  for (let indice = 0; indice < binario.length; indice += 1) {
    bytes[indice] = binario.charCodeAt(indice);
  }
  const arquivo = new Blob([bytes], { type: captura.tipoDeMidia });
  return {
    id: crypto.randomUUID(),
    nome: captura.nome,
    categoria: "imagem",
    tipoDeMidia: captura.tipoDeMidia,
    tamanhoEmBytes: arquivo.size,
    arquivo,
    previa: URL.createObjectURL(arquivo),
    rotulo: "Imagem",
    legado: false,
  };
}

/** O conteúdo do arquivo em base64 (sem o prefixo `data:`), como o servidor espera. */
export function base64DoArquivo(arquivo: Blob, nome: string): Promise<string> {
  return new Promise((resolver, rejeitar) => {
    const leitor = new FileReader();
    leitor.onerror = () => rejeitar(new Error(`Não foi possível ler "${nome}".`));
    leitor.onload = () => {
      const endereco = String(leitor.result);
      resolver(endereco.slice(endereco.indexOf(",") + 1));
    };
    leitor.readAsDataURL(arquivo);
  });
}

/** Monta o que vai ao servidor: o base64 só existe a partir daqui, no envio. */
export function anexosParaEnvio(anexos: readonly AnexoPendente[]): Promise<AnexoParaEnvio[]> {
  return Promise.all(
    anexos.map(async (anexo) => ({
      nome: anexo.nome,
      tipoDeMidia: anexo.tipoDeMidia,
      base64: await base64DoArquivo(anexo.arquivo, anexo.nome),
    })),
  );
}

/** Libera as miniaturas (URLs `blob:`) dos anexos que saíram de uso. */
export function liberarAnexos(anexos: readonly AnexoPendente[]): void {
  for (const anexo of anexos) {
    if (anexo.previa !== null) URL.revokeObjectURL(anexo.previa);
  }
}
