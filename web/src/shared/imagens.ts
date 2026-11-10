import type { CategoriaDoAnexo, TipoDeImagem } from "./api/tipos";

/** Mesmos limites do servidor (e do Claude): formatos, 5 MB por imagem, 5 por mensagem. */
export const TIPOS_DE_IMAGEM: readonly TipoDeImagem[] = ["image/png", "image/jpeg", "image/gif", "image/webp"];
export const TAMANHO_MAXIMO_DA_IMAGEM = 5 * 1024 * 1024;
export const MAXIMO_DE_IMAGENS = 5;

/** Documentos: PDF, Word, Excel, CSV, TXT e MD; 30 MB cada, 5 por mensagem. */
export const TAMANHO_MAXIMO_DO_DOCUMENTO = 30 * 1024 * 1024;
export const MAXIMO_DE_DOCUMENTOS = 5;

const DOCUMENTOS_POR_EXTENSAO: Readonly<Record<string, string>> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  txt: "text/plain",
  md: "text/markdown",
};

export const EXTENSOES_DE_DOCUMENTO: readonly string[] = Object.keys(DOCUMENTOS_POR_EXTENSAO).map((e) => `.${e}`);

/** Valor do atributo `accept` dos seletores de arquivo: imagens e documentos. */
export const ACEITE_DE_ANEXOS = [...TIPOS_DE_IMAGEM, ...EXTENSOES_DE_DOCUMENTO].join(",");

function extensaoDe(nome: string): string {
  const ponto = nome.lastIndexOf(".");
  return ponto < 0 ? "" : nome.slice(ponto + 1).toLowerCase();
}

/** Captura de tela do modo invisível: o Electron nomeia como `tela-<ISO>.jpg`. */
export function ehCapturaDeTela(nome: string): boolean {
  return /^tela-.+\.jpg$/i.test(nome);
}

/**
 * Anexo (imagem ou documento) no prompt e ainda não enviado. Guarda só o
 * arquivo (`Blob`): o base64 é gerado no envio (`imagensParaEnvio`). Em
 * imagens, a `previa` é uma URL `blob:` que precisa ser liberada com
 * `liberarImagens`; documentos não têm prévia (vazia).
 */
export interface ImagemAnexada {
  id: string;
  nome: string;
  categoria: CategoriaDoAnexo;
  tipoDeMidia: string;
  tamanhoEmBytes: number;
  arquivo: Blob;
  /** URL `blob:` para a miniatura antes do envio; vazia em documentos. */
  previa: string;
}

function ehTipoDeImagem(tipo: string): tipo is TipoDeImagem {
  return (TIPOS_DE_IMAGEM as readonly string[]).includes(tipo);
}

/** O tipo de mídia do documento (pela extensão, que vale quando o mime vem vazio), ou nulo se não é aceito. */
export function tipoDoDocumento(arquivo: { name: string; type: string }): string | null {
  const porExtensao = DOCUMENTOS_POR_EXTENSAO[extensaoDe(arquivo.name)];
  return porExtensao === undefined ? null : porExtensao;
}

/** Categoria do arquivo, ou nulo se o tipo não é aceito. */
export function categoriaDoArquivo(arquivo: { name: string; type: string }): CategoriaDoAnexo | null {
  if (ehTipoDeImagem(arquivo.type)) return "imagem";
  return tipoDoDocumento(arquivo) === null ? null : "documento";
}

export function ehImagem(anexo: { categoria?: CategoriaDoAnexo }): boolean {
  return anexo.categoria === undefined || anexo.categoria === "imagem";
}

/** "1,2 MB", "340 KB": tamanho legível para os chips de documento. */
export function tamanhoLegivel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** Por que o arquivo não pode ser anexado, ou nulo se pode. `jaAnexados` são os pendentes. */
export function problemaDoAnexo(
  arquivo: { name: string; type: string; size: number },
  jaAnexados: readonly { categoria: CategoriaDoAnexo }[],
): string | null {
  const categoria = categoriaDoArquivo(arquivo);
  if (categoria === null) {
    return `"${arquivo.name}" não é um tipo aceito: use imagem (PNG, JPEG, GIF, WebP) ou documento (PDF, Word, Excel, CSV, TXT, MD).`;
  }
  const quantidade = jaAnexados.filter((anexo) => anexo.categoria === categoria).length;
  if (categoria === "imagem") {
    if (arquivo.size > TAMANHO_MAXIMO_DA_IMAGEM) {
      return `"${arquivo.name}" passa de 5 MB, o limite do Claude por imagem.`;
    }
    if (quantidade >= MAXIMO_DE_IMAGENS) {
      return `Dá para anexar até ${MAXIMO_DE_IMAGENS} imagens por mensagem.`;
    }
    return null;
  }
  if (arquivo.size > TAMANHO_MAXIMO_DO_DOCUMENTO) {
    return `"${arquivo.name}" passa de 30 MB, o limite por documento.`;
  }
  if (quantidade >= MAXIMO_DE_DOCUMENTOS) {
    return `Dá para anexar até ${MAXIMO_DE_DOCUMENTOS} documentos por mensagem.`;
  }
  return null;
}

/** Compatibilidade: valida contando só as imagens já anexadas (número). */
export function problemaDaImagem(
  arquivo: { name: string; type: string; size: number },
  jaAnexadas: number,
): string | null {
  return problemaDoAnexo(
    arquivo,
    Array.from({ length: jaAnexadas }, () => ({ categoria: "imagem" as const })),
  );
}

export function lerImagem(arquivo: File): Promise<ImagemAnexada> {
  const categoria = categoriaDoArquivo(arquivo);
  if (categoria === null) {
    return Promise.reject(new Error(`"${arquivo.name}" não é um tipo de arquivo aceito.`));
  }
  try {
    return Promise.resolve({
      id: crypto.randomUUID(),
      // Imagens coladas chegam como "image.png"; o nome serve só de rótulo.
      nome: arquivo.name || "imagem colada",
      categoria,
      tipoDeMidia: categoria === "imagem" ? arquivo.type : (tipoDoDocumento(arquivo) ?? arquivo.type),
      tamanhoEmBytes: arquivo.size,
      arquivo,
      previa: categoria === "imagem" ? URL.createObjectURL(arquivo) : "",
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
export function imagemDaCaptura(captura: { nome: string; tipoDeMidia: TipoDeImagem; base64: string }): ImagemAnexada {
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
export function imagensParaEnvio(
  imagens: readonly ImagemAnexada[],
): Promise<{ nome: string; tipoDeMidia: string; categoria: CategoriaDoAnexo; base64: string }[]> {
  return Promise.all(
    imagens.map(async (imagem) => ({
      nome: imagem.nome,
      tipoDeMidia: imagem.tipoDeMidia,
      categoria: imagem.categoria,
      base64: await base64DoArquivo(imagem.arquivo, imagem.nome),
    })),
  );
}

/** Libera as miniaturas (URLs `blob:`) dos anexos que saíram de uso. */
export function liberarImagens(imagens: readonly ImagemAnexada[]): void {
  for (const imagem of imagens) {
    if (imagem.previa !== "") URL.revokeObjectURL(imagem.previa);
  }
}
