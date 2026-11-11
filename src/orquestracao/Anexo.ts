import { ErroDeOrquestracao } from "./ErroDeOrquestracao";

/** Formatos de imagem que o Claude lê. */
export const TIPOS_DE_IMAGEM = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export type TipoDeImagem = (typeof TIPOS_DE_IMAGEM)[number];

/** Limite do Claude por imagem. */
export const TAMANHO_MAXIMO_DA_IMAGEM = 5 * 1024 * 1024;
export const MAXIMO_DE_IMAGENS_POR_MENSAGEM = 5;
const TAMANHO_MAXIMO_DO_NOME = 200;

const EXTENSAO: Readonly<Record<TipoDeImagem, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

export function ehTipoDeImagem(valor: unknown): valor is TipoDeImagem {
  return typeof valor === "string" && (TIPOS_DE_IMAGEM as readonly string[]).includes(valor);
}

export interface DadosDoAnexo {
  id: string;
  nome: string;
  tipoDeMidia: TipoDeImagem;
  tamanhoEmBytes: number;
  /** Nome do arquivo guardado: o id e a extensão do formato. */
  arquivo: string;
}

/**
 * Imagem anexada a uma mensagem para o Orquestrador. Objeto de valor.
 *
 * O Orquestrador recebe a imagem junto com o texto; os Subagentes podem abri-la
 * pelo caminho em disco, que vai citado na mensagem.
 */
export class Anexo {
  private constructor(
    public readonly id: string,
    public readonly nome: string,
    public readonly tipoDeMidia: TipoDeImagem,
    public readonly tamanhoEmBytes: number,
  ) {}

  static de(dados: { id: string; nome: string; tipoDeMidia: string; tamanhoEmBytes: number }): Anexo {
    if (!ehTipoDeImagem(dados.tipoDeMidia)) {
      throw new ErroDeOrquestracao("dados_invalidos", "Só dá para anexar imagens PNG, JPEG, GIF ou WebP.");
    }
    const nome = dados.nome.trim().slice(0, TAMANHO_MAXIMO_DO_NOME) || "imagem";
    if (dados.tamanhoEmBytes <= 0) {
      throw new ErroDeOrquestracao("dados_invalidos", `A imagem "${nome}" está vazia.`);
    }
    if (dados.tamanhoEmBytes > TAMANHO_MAXIMO_DA_IMAGEM) {
      throw new ErroDeOrquestracao(
        "dados_invalidos",
        `A imagem "${nome}" passa de ${TAMANHO_MAXIMO_DA_IMAGEM / 1024 / 1024} MB, o limite do Claude por imagem.`,
      );
    }
    return new Anexo(dados.id, nome, dados.tipoDeMidia, dados.tamanhoEmBytes);
  }

  get arquivo(): string {
    return `${this.id}.${EXTENSAO[this.tipoDeMidia]}`;
  }

  paraDados(): DadosDoAnexo {
    return {
      id: this.id,
      nome: this.nome,
      tipoDeMidia: this.tipoDeMidia,
      tamanhoEmBytes: this.tamanhoEmBytes,
      arquivo: this.arquivo,
    };
  }
}
