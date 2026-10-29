import { SituacaoFinalDoSubagente } from "./EventoDeOrquestracao";

export type SituacaoDoSubagente = "executando" | SituacaoFinalDoSubagente;

export interface DadosDoSubagente {
  id: string;
  descricao: string;
  situacao: SituacaoDoSubagente;
  tokens: number;
  duracaoMs: number;
  resumo: string;
}

/**
 * Um Subagente lançado pelo Orquestrador durante um Turno. Objeto interno do
 * agregado `Orquestrador`: só é alterado através do Turno a que pertence.
 *
 * Guarda apenas o necessário para o histórico resumido; o passo a passo (textos,
 * ferramentas usadas) fica nos eventos, que a tela reproduz.
 */
export class Subagente {
  private constructor(
    public readonly id: string,
    public readonly descricao: string,
    private situacaoAtual: SituacaoDoSubagente,
    private tokensUsados: number,
    private duracao: number,
    private resumoFinal: string,
  ) {}

  static iniciar(id: string, descricao: string): Subagente {
    return new Subagente(id, descricao, "executando", 0, 0, "");
  }

  static reconstituir(dados: DadosDoSubagente): Subagente {
    return new Subagente(
      dados.id,
      dados.descricao,
      dados.situacao,
      dados.tokens,
      dados.duracaoMs,
      dados.resumo,
    );
  }

  get situacao(): SituacaoDoSubagente {
    return this.situacaoAtual;
  }

  get ativo(): boolean {
    return this.situacaoAtual === "executando";
  }

  registrarProgresso(tokens: number, duracaoMs: number): void {
    if (!this.ativo) {
      return;
    }
    this.tokensUsados = tokens;
    this.duracao = duracaoMs;
  }

  concluir(situacao: SituacaoFinalDoSubagente, resumo: string, tokens: number, duracaoMs: number): void {
    this.situacaoAtual = situacao;
    this.resumoFinal = resumo;
    this.tokensUsados = tokens;
    this.duracao = duracaoMs;
  }

  /** Encerra um Subagente que ainda rodava quando o Turno acabou de outro jeito. */
  interromper(): void {
    if (this.ativo) {
      this.situacaoAtual = "cancelado";
    }
  }

  paraDados(): DadosDoSubagente {
    return {
      id: this.id,
      descricao: this.descricao,
      situacao: this.situacaoAtual,
      tokens: this.tokensUsados,
      duracaoMs: this.duracao,
      resumo: this.resumoFinal,
    };
  }
}
