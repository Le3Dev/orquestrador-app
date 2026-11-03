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
}

/**
 * Só os campos informados mudam; os ausentes mantêm o valor atual. A lista de
 * subagentes prontos troca inteira e é validada aqui (`subagentesProntosValidos`).
 */
export interface AlteracoesDasPreferencias {
  instrucoesPadrao?: string | undefined;
  subagentesProntos?: readonly unknown[] | undefined;
}

/**
 * Preferências que valem para todos os Orquestradores, e não para um só.
 * Objeto de valor: alterar produz outro.
 */
export class PreferenciasGlobais {
  private constructor(
    public readonly instrucoesPadrao: string,
    public readonly subagentesProntos: readonly DadosDoSubagentePronto[],
  ) {}

  static vazias(): PreferenciasGlobais {
    return new PreferenciasGlobais("", []);
  }

  static de(dados: DadosDasPreferencias | AlteracoesDasPreferencias): PreferenciasGlobais {
    return new PreferenciasGlobais(
      instrucoesValidas(dados.instrucoesPadrao, "As instruções padrão"),
      subagentesProntosValidos(dados.subagentesProntos),
    );
  }

  com(alteracoes: AlteracoesDasPreferencias): PreferenciasGlobais {
    return PreferenciasGlobais.de({
      instrucoesPadrao: alteracoes.instrucoesPadrao ?? this.instrucoesPadrao,
      subagentesProntos: alteracoes.subagentesProntos ?? this.subagentesProntos.map((subagente) => ({ ...subagente })),
    });
  }

  paraDados(): Required<DadosDasPreferencias> {
    return {
      instrucoesPadrao: this.instrucoesPadrao,
      subagentesProntos: this.subagentesProntos.map((subagente) => ({ ...subagente })),
    };
  }
}
