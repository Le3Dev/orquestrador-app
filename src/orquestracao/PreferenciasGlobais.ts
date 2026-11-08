import { instrucoesValidas } from "./InstrucoesPersonalizadas";
import { DadosDoSubagentePronto, subagentesProntosValidos } from "./SubagentesProntos";

export interface DadosDasPreferencias {
  /**
   * Instruções que valem para todo Orquestrador sem instruções próprias.
   * Ausentes num arquivo gravado antes de existirem: vale `""`.
   */
  instrucoesPadrao?: string | undefined;
  /**
   * Biblioteca de subagentes prontos, disponível a todos os Orquestradores.
   * Ausente num arquivo gravado antes de existir: vale lista vazia.
   */
  subagentesProntos?: DadosDoSubagentePronto[] | undefined;
  /**
   * O app encerra o turno parado e o retoma sozinho, e retoma os que caíram
   * por limite de uso, sobrecarga ou rede (ver ADR-36). Ausente num arquivo
   * gravado antes de existir: vale `true`.
   */
  autorrecuperacao?: boolean | undefined;
}

/**
 * Só os campos informados mudam; os ausentes mantêm o valor atual. A lista de
 * subagentes prontos troca inteira e é validada aqui (`subagentesProntosValidos`).
 */
export interface AlteracoesDasPreferencias {
  instrucoesPadrao?: string | undefined;
  subagentesProntos?: readonly unknown[] | undefined;
  autorrecuperacao?: boolean | undefined;
}

/**
 * Preferências que valem para todos os Orquestradores, e não para um só.
 * Objeto de valor: alterar produz outro.
 */
export class PreferenciasGlobais {
  private constructor(
    public readonly instrucoesPadrao: string,
    public readonly subagentesProntos: readonly DadosDoSubagentePronto[],
    public readonly autorrecuperacao: boolean,
  ) {}

  static vazias(): PreferenciasGlobais {
    return new PreferenciasGlobais("", [], true);
  }

  static de(dados: DadosDasPreferencias | AlteracoesDasPreferencias): PreferenciasGlobais {
    return new PreferenciasGlobais(
      instrucoesValidas(dados.instrucoesPadrao, "As instruções gerais"),
      subagentesProntosValidos(dados.subagentesProntos),
      // Só `false` desliga: ausente (arquivo antigo) ou qualquer outra coisa liga.
      dados.autorrecuperacao !== false,
    );
  }

  com(alteracoes: AlteracoesDasPreferencias): PreferenciasGlobais {
    return PreferenciasGlobais.de({
      instrucoesPadrao: alteracoes.instrucoesPadrao ?? this.instrucoesPadrao,
      subagentesProntos: alteracoes.subagentesProntos ?? this.subagentesProntos.map((subagente) => ({ ...subagente })),
      autorrecuperacao: alteracoes.autorrecuperacao ?? this.autorrecuperacao,
    });
  }

  paraDados(): Required<DadosDasPreferencias> {
    return {
      instrucoesPadrao: this.instrucoesPadrao,
      subagentesProntos: this.subagentesProntos.map((subagente) => ({ ...subagente })),
      autorrecuperacao: this.autorrecuperacao,
    };
  }
}
