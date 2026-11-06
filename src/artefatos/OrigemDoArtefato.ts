import { ErroDeArtefato } from "./ErroDeArtefato";

export const TIPOS_DE_ORIGEM = ["orquestrador", "chat"] as const;
export type TipoDaOrigem = (typeof TIPOS_DE_ORIGEM)[number];

export interface DadosDaOrigem {
  tipo: TipoDaOrigem;
  /** Id do Orquestrador; `null` quando veio do chat rápido. */
  id: string | null;
}

/**
 * Identidade de Orquestrador aceita como origem: só letras, números, `-` e
 * `_`. Ela vira nome de pasta na entrada, então nada de "..\" escapando.
 */
export const IDENTIDADE_DE_ORQUESTRADOR_VALIDA = /^[A-Za-z0-9_-]{1,100}$/;

/**
 * Objeto de valor: quem entregou o artefato — um Orquestrador (com o id dele)
 * ou o chat rápido. Imutável; duas origens com o mesmo tipo e id são iguais.
 */
export class OrigemDoArtefato {
  private constructor(
    public readonly tipo: TipoDaOrigem,
    public readonly id: string | null,
  ) {
    Object.freeze(this);
  }

  static doOrquestrador(id: string): OrigemDoArtefato {
    if (!IDENTIDADE_DE_ORQUESTRADOR_VALIDA.test(id)) {
      throw new ErroDeArtefato("dados_invalidos", `Identidade de orquestrador inválida: "${id}".`);
    }
    return new OrigemDoArtefato("orquestrador", id);
  }

  static doChat(): OrigemDoArtefato {
    return new OrigemDoArtefato("chat", null);
  }

  static reconstituir(dados: DadosDaOrigem): OrigemDoArtefato {
    if (dados.tipo === "chat") {
      return OrigemDoArtefato.doChat();
    }
    return OrigemDoArtefato.doOrquestrador(dados.id ?? "");
  }

  igualA(outra: OrigemDoArtefato): boolean {
    return this.tipo === outra.tipo && this.id === outra.id;
  }

  paraDados(): DadosDaOrigem {
    return { tipo: this.tipo, id: this.id };
  }
}
