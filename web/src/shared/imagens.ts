import type { TipoDeImagem } from "./api/tipos";

/** Mesmos limites do servidor (e do Claude): formatos, 5 MB por imagem, 5 por mensagem. */
export const TIPOS_DE_IMAGEM: readonly TipoDeImagem[] = ["image/png", "image/jpeg", "image/gif", "image/webp"];
export const TAMANHO_MAXIMO_DA_IMAGEM = 5 * 1024 * 1024;
export const MAXIMO_DE_IMAGENS = 5;

export interface ImagemAnexada {
  id: string;
  nome: string;
  tipoDeMidia: TipoDeImagem;
  tamanhoEmBytes: number;
  base64: string;
  /** `data:` URL para a miniatura antes do envio. */
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
  return new Promise((resolver, rejeitar) => {
    const leitor = new FileReader();
    leitor.onerror = () => rejeitar(new Error(`Não foi possível ler "${arquivo.name}".`));
    leitor.onload = () => {
      const previa = String(leitor.result);
      const tipoDeMidia = arquivo.type;
      if (!ehTipoDeImagem(tipoDeMidia)) {
        rejeitar(new Error(`"${arquivo.name}" não é uma imagem aceita.`));
        return;
      }
      resolver({
        id: crypto.randomUUID(),
        // Imagens coladas chegam como "image.png"; o nome serve só de rótulo.
        nome: arquivo.name || "imagem colada",
        tipoDeMidia,
        tamanhoEmBytes: arquivo.size,
        base64: previa.slice(previa.indexOf(",") + 1),
        previa,
      });
    };
    leitor.readAsDataURL(arquivo);
  });
}
