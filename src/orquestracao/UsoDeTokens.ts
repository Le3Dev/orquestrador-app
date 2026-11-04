import { ErroDeOrquestracao } from "./ErroDeOrquestracao";

export interface DadosDoUso {
  entrada: number;
  criacaoDeCache: number;
  leituraDeCache: number;
  saida: number;
}

/** Pesos do índice de custo, relativos ao token de entrada sem cache (os mesmos do benchmark). */
const PESO_DA_CRIACAO_DE_CACHE = 1.25;
const PESO_DA_LEITURA_DE_CACHE = 0.1;
const PESO_DA_SAIDA = 5;

function validar(nome: string, valor: unknown): number {
  if (typeof valor !== "number" || !Number.isInteger(valor) || valor < 0) {
    throw new ErroDeOrquestracao(
      "dados_invalidos",
      `Uso de tokens inválido: "${nome}" deve ser um número inteiro maior ou igual a zero.`,
    );
  }
  return valor;
}

/**
 * Tokens gastos por um agente (ou pela soma de vários), separados como o
 * Claude cobra: entrada sem cache, escrita no cache, leitura do cache e
 * saída. Objeto de valor.
 */
export class UsoDeTokens {
  static readonly vazio: UsoDeTokens = new UsoDeTokens(0, 0, 0, 0);

  private constructor(
    public readonly entrada: number,
    public readonly criacaoDeCache: number,
    public readonly leituraDeCache: number,
    public readonly saida: number,
  ) {
    Object.freeze(this);
  }

  static criar(dados: DadosDoUso): UsoDeTokens {
    return new UsoDeTokens(
      validar("entrada", dados.entrada),
      validar("criacaoDeCache", dados.criacaoDeCache),
      validar("leituraDeCache", dados.leituraDeCache),
      validar("saida", dados.saida),
    );
  }

  somar(outro: UsoDeTokens): UsoDeTokens {
    return new UsoDeTokens(
      this.entrada + outro.entrada,
      this.criacaoDeCache + outro.criacaoDeCache,
      this.leituraDeCache + outro.leituraDeCache,
      this.saida + outro.saida,
    );
  }

  total(): number {
    return this.entrada + this.criacaoDeCache + this.leituraDeCache + this.saida;
  }

  /**
   * Custo relativo em "tokens de entrada equivalentes": escrever no cache
   * custa 1,25×, ler do cache 0,1× e gerar saída 5× um token de entrada. Não
   * é preço nem cota — serve para comparar turnos e configurações.
   */
  indiceDeCusto(): number {
    return Math.round(
      this.entrada +
        PESO_DA_CRIACAO_DE_CACHE * this.criacaoDeCache +
        PESO_DA_LEITURA_DE_CACHE * this.leituraDeCache +
        PESO_DA_SAIDA * this.saida,
    );
  }

  paraDados(): DadosDoUso {
    return {
      entrada: this.entrada,
      criacaoDeCache: this.criacaoDeCache,
      leituraDeCache: this.leituraDeCache,
      saida: this.saida,
    };
  }
}
