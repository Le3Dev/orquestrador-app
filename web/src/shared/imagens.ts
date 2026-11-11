import type { TipoDeImagem } from "./api/tipos";

/** Mesmos limites do servidor (e do Claude): formatos, 5 MB por imagem, 5 por mensagem. */
export const TIPOS_DE_IMAGEM: readonly TipoDeImagem[] = ["image/png", "image/jpeg", "image/gif", "image/webp"];
export const TAMANHO_MAXIMO_DA_IMAGEM = 5 * 1024 * 1024;
export const MAXIMO_DE_IMAGENS = 5;

/** Captura de tela do modo invisível: o Electron nomeia como `tela-<ISO>.jpg`. */
export function ehCapturaDeTela(nome: string): boolean {
  return /^tela-.+\.jpg$/i.test(nome);
}

/**
 * Imagem anexada ao prompt e ainda não enviada. Guarda só o arquivo (`Blob`):
 * o base64 é gerado no envio (`imagensParaEnvio`). A `previa` é uma URL
 * `blob:` e precisa ser liberada com `liberarImagens` ao sair de uso.
 */
export interface ImagemAnexada {
  id: string;
  nome: string;
  tipoDeMidia: TipoDeImagem;
  tamanhoEmBytes: number;
  arquivo: Blob;
  /** URL `blob:` para a miniatura antes do envio. */
  previa: string;
}

function ehTipoDeImagem(tipo: string): tipo is TipoDeImagem {
  return (TIPOS_DE_IMAGEM as readonly string[]).includes(tipo);
}

/** Por que a imagem não pode ser anexada, ou nulo se pode. */
export function problemaDaImagem(
  arquivo: { name: string; type: string; size: number },
  jaAnexadas: number,
): string | null {
  if (!ehTipoDeImagem(arquivo.type)) {
    return `"${arquivo.name}" não é PNG, JPEG, GIF nem WebP.`;
  }
  if (arquivo.size > TAMANHO_MAXIMO_DA_IMAGEM) {
    return `"${arquivo.name}" passa de 5 MB, o limite do Claude por imagem.`;
  }
  if (jaAnexadas >= MAXIMO_DE_IMAGENS) {
    return `Dá para anexar até ${MAXIMO_DE_IMAGENS} imagens por mensagem.`;
  }
  return null;
}

export function lerImagem(arquivo: File): Promise<ImagemAnexada> {
  const tipoDeMidia = arquivo.type;
  if (!ehTipoDeImagem(tipoDeMidia)) {
    return Promise.reject(new Error(`"${arquivo.name}" não é uma imagem aceita.`));
  }
  try {
    return Promise.resolve({
      id: crypto.randomUUID(),
      // Imagens coladas chegam como "image.png"; o nome serve só de rótulo.
      nome: arquivo.name || "imagem colada",
      tipoDeMidia,
      tamanhoEmBytes: arquivo.size,
      arquivo,
      previa: URL.createObjectURL(arquivo),
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
): Promise<{ nome: string; tipoDeMidia: TipoDeImagem; base64: string }[]> {
  return Promise.all(
    imagens.map(async (imagem) => ({
      nome: imagem.nome,
      tipoDeMidia: imagem.tipoDeMidia,
      base64: await base64DoArquivo(imagem.arquivo, imagem.nome),
    })),
  );
}

/** Libera as miniaturas (URLs `blob:`) das imagens que saíram de uso. */
export function liberarImagens(imagens: readonly ImagemAnexada[]): void {
  for (const imagem of imagens) URL.revokeObjectURL(imagem.previa);
}
