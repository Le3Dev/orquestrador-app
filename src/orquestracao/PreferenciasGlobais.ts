import { instrucoesValidas } from "./InstrucoesPersonalizadas";

export interface DadosDasPreferencias {
  /**
   * Instruções que valem para todo Orquestrador sem instruções próprias.
   * Ausentes num arquivo gravado antes de existirem: vale `""`.
   */
  instrucoesPadrao?: string | undefined;
}

/** Só os campos informados mudam; os ausentes mantêm o valor atual. */
export type AlteracoesDasPreferencias = {
  [Campo in keyof DadosDasPreferencias]?: DadosDasPreferencias[Campo] | undefined;
};

/**
 * Preferências que valem para todos os Orquestradores, e não para um só.
 * Objeto de valor: alterar produz outro.
 */
export class PreferenciasGlobais {
  private constructor(public readonly instrucoesPadrao: string) {}

  static vazias(): PreferenciasGlobais {
    return new PreferenciasGlobais("");
  }

  static de(dados: DadosDasPreferencias): PreferenciasGlobais {
    return new PreferenciasGlobais(instrucoesValidas(dados.instrucoesPadrao, "As instruções padrão"));
  }

  com(alteracoes: AlteracoesDasPreferencias): PreferenciasGlobais {
    return PreferenciasGlobais.de({
      instrucoesPadrao: alteracoes.instrucoesPadrao ?? this.instrucoesPadrao,
    });
  }

  paraDados(): Required<DadosDasPreferencias> {
    return { instrucoesPadrao: this.instrucoesPadrao };
  }
}
