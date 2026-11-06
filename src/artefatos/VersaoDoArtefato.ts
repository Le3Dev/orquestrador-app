import { ErroDeArtefato } from "./ErroDeArtefato";

/** sha256 em hexadecimal minúsculo. */
export const HASH_VALIDO = /^[0-9a-f]{64}$/;

export interface DadosDaVersao {
  numero: number;
  /** ISO 8601 */
  criadaEm: string;
  /** Em bytes. */
  tamanho: number;
  /** sha256 do conteúdo, em hexadecimal. */
  hash: string;
}

/**
 * Objeto de valor: uma versão do conteúdo de um Artefato. Imutável — uma
 * regravação do arquivo vira uma versão nova, nunca altera a anterior.
 */
export class VersaoDoArtefato {
  private constructor(
    public readonly numero: number,
    private readonly criadaEmMs: number,
    public readonly tamanho: number,
    public readonly hash: string,
  ) {
    Object.freeze(this);
  }

  static criar(numero: number, hash: string, tamanho: number, criadaEm: Date): VersaoDoArtefato {
    if (!Number.isInteger(numero) || numero < 1) {
      throw new ErroDeArtefato("dados_invalidos", `Número de versão inválido: ${numero}.`);
    }
    if (!HASH_VALIDO.test(hash)) {
      throw new ErroDeArtefato("dados_invalidos", "Hash de conteúdo inválido.");
    }
    if (!Number.isInteger(tamanho) || tamanho < 0) {
      throw new ErroDeArtefato("dados_invalidos", `Tamanho de conteúdo inválido: ${tamanho}.`);
    }
    if (Number.isNaN(criadaEm.getTime())) {
      throw new ErroDeArtefato("dados_invalidos", "Data da versão inválida.");
    }
    return new VersaoDoArtefato(numero, criadaEm.getTime(), tamanho, hash);
  }

  static reconstituir(dados: DadosDaVersao): VersaoDoArtefato {
    return VersaoDoArtefato.criar(dados.numero, dados.hash, dados.tamanho, new Date(dados.criadaEm));
  }

  get criadaEm(): Date {
    return new Date(this.criadaEmMs);
  }

  paraDados(): DadosDaVersao {
    return {
      numero: this.numero,
      criadaEm: new Date(this.criadaEmMs).toISOString(),
      tamanho: this.tamanho,
      hash: this.hash,
    };
  }
}
