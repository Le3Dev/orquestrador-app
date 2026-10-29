import { ErroDeOrquestracao } from "./ErroDeOrquestracao";

export const LIMITE_DE_SUBAGENTES = 10;

export type ModoDaQuantidade = "fixa" | "automatica";

export interface DadosDaQuantidade {
  modo: ModoDaQuantidade;
  limite: number;
}

/**
 * Quantos Subagentes o Orquestrador lança por pedido. Objeto de valor.
 *
 * No modo `fixa`, `limite` é o número exato; no `automatica`, é o máximo, e o
 * próprio Orquestrador decide quantos usar conforme o tamanho do pedido.
 *
 * O teto existe porque todos os Subagentes rodam ao mesmo tempo e cada um
 * consome a cota da assinatura do Claude.
 */
export class QuantidadeDeSubagentes {
  private constructor(
    public readonly modo: ModoDaQuantidade,
    public readonly limite: number,
  ) {}

  static fixa(valor: number): QuantidadeDeSubagentes {
    return QuantidadeDeSubagentes.de({ modo: "fixa", limite: valor });
  }

  static automatica(maximo: number): QuantidadeDeSubagentes {
    return QuantidadeDeSubagentes.de({ modo: "automatica", limite: maximo });
  }

  static de(dados: DadosDaQuantidade): QuantidadeDeSubagentes {
    if (dados.modo !== "fixa" && dados.modo !== "automatica") {
      throw new ErroDeOrquestracao(
        "dados_invalidos",
        "A quantidade de subagentes deve ser fixa ou automática.",
      );
    }
    if (!Number.isInteger(dados.limite) || dados.limite < 1 || dados.limite > LIMITE_DE_SUBAGENTES) {
      throw new ErroDeOrquestracao(
        "dados_invalidos",
        `A quantidade de subagentes deve ser um número inteiro entre 1 e ${LIMITE_DE_SUBAGENTES}.`,
      );
    }
    return new QuantidadeDeSubagentes(dados.modo, dados.limite);
  }

  paraDados(): DadosDaQuantidade {
    return { modo: this.modo, limite: this.limite };
  }
}
