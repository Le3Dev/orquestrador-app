import { ErroDeOrquestracao } from "./ErroDeOrquestracao";
import { DadosDoUso, UsoDeTokens } from "./UsoDeTokens";

export interface DadosDoConsumoDoTurno {
  principal: DadosDoUso;
  subagentes: DadosDoUso;
  subagentesMedidos: number;
  parcial: boolean;
  indiceDeCusto: number;
  modeloDoPrincipal: string | null;
}

export interface NovoConsumoDoTurno {
  principal: UsoDeTokens;
  subagentes: UsoDeTokens;
  subagentesMedidos: number;
  parcial: boolean;
  modeloDoPrincipal: string | null;
}

/**
 * Quanto um Turno gastou, medido depois que ele termina: o agente principal
 * (o Orquestrador) e a soma dos Subagentes. É uma estimativa — vem das
 * transcrições do Claude Code — e fica `parcial` quando o turno não terminou
 * com sucesso ou quando parte do gasto não pôde ser lida. Objeto de valor.
 */
export class ConsumoDoTurno {
  private constructor(
    public readonly principal: UsoDeTokens,
    public readonly subagentes: UsoDeTokens,
    public readonly subagentesMedidos: number,
    public readonly parcial: boolean,
    /** ID do modelo que o agente principal de fato usou (ex.: `claude-opus-5-5`), se conhecido. */
    public readonly modeloDoPrincipal: string | null,
  ) {
    Object.freeze(this);
  }

  static criar(dados: NovoConsumoDoTurno): ConsumoDoTurno {
    if (!Number.isInteger(dados.subagentesMedidos) || dados.subagentesMedidos < 0) {
      throw new ErroDeOrquestracao(
        "dados_invalidos",
        "Consumo do turno inválido: a quantidade de subagentes medidos deve ser um inteiro maior ou igual a zero.",
      );
    }
    const modelo = dados.modeloDoPrincipal === null ? null : dados.modeloDoPrincipal.trim();
    return new ConsumoDoTurno(
      dados.principal,
      dados.subagentes,
      dados.subagentesMedidos,
      dados.parcial,
      modelo === null || modelo === "" ? null : modelo,
    );
  }

  total(): UsoDeTokens {
    return this.principal.somar(this.subagentes);
  }

  indiceDeCusto(): number {
    return this.total().indiceDeCusto();
  }

  /** O mesmo consumo, marcado como incompleto. */
  comoParcial(): ConsumoDoTurno {
    return this.parcial
      ? this
      : new ConsumoDoTurno(this.principal, this.subagentes, this.subagentesMedidos, true, this.modeloDoPrincipal);
  }

  paraDados(): DadosDoConsumoDoTurno {
    return {
      principal: this.principal.paraDados(),
      subagentes: this.subagentes.paraDados(),
      subagentesMedidos: this.subagentesMedidos,
      parcial: this.parcial,
      indiceDeCusto: this.indiceDeCusto(),
      modeloDoPrincipal: this.modeloDoPrincipal,
    };
  }
}
