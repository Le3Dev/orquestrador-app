import { ErroDeOrquestracao } from "./ErroDeOrquestracao";
import { ehModeloClaude, ModeloClaude } from "./ModeloClaude";
import { ehNivelDePermissao, NivelDePermissao } from "./NivelDePermissao";
import { DadosDaQuantidade, QuantidadeDeSubagentes } from "./QuantidadeDeSubagentes";

export interface DadosDaConfiguracao {
  modeloDoOrquestrador: ModeloClaude;
  modeloDosSubagentes: ModeloClaude;
  quantidadeDeSubagentes: DadosDaQuantidade;
  nivelDePermissao: NivelDePermissao;
}

/** Só os campos informados mudam; os ausentes mantêm o valor atual. */
export type AlteracoesDaConfiguracao = {
  [Campo in keyof DadosDaConfiguracao]?: DadosDaConfiguracao[Campo] | undefined;
};

/**
 * Como um Orquestrador trabalha: modelos, quantos Subagentes e o que eles
 * podem fazer. Objeto de valor — alterar a configuração produz outra.
 */
export class ConfiguracaoDoOrquestrador {
  private constructor(
    public readonly modeloDoOrquestrador: ModeloClaude,
    public readonly modeloDosSubagentes: ModeloClaude,
    public readonly quantidadeDeSubagentes: QuantidadeDeSubagentes,
    public readonly nivelDePermissao: NivelDePermissao,
  ) {}

  static de(dados: DadosDaConfiguracao): ConfiguracaoDoOrquestrador {
    if (!ehModeloClaude(dados.modeloDoOrquestrador) || !ehModeloClaude(dados.modeloDosSubagentes)) {
      throw new ErroDeOrquestracao("dados_invalidos", "Modelo inválido. Use opus, sonnet ou haiku.");
    }
    if (!ehNivelDePermissao(dados.nivelDePermissao)) {
      throw new ErroDeOrquestracao("dados_invalidos", "Nível de permissão inválido.");
    }
    return new ConfiguracaoDoOrquestrador(
      dados.modeloDoOrquestrador,
      dados.modeloDosSubagentes,
      QuantidadeDeSubagentes.de(dados.quantidadeDeSubagentes),
      dados.nivelDePermissao,
    );
  }

  com(alteracoes: AlteracoesDaConfiguracao): ConfiguracaoDoOrquestrador {
    const atual = this.paraDados();
    return ConfiguracaoDoOrquestrador.de({
      modeloDoOrquestrador: alteracoes.modeloDoOrquestrador ?? atual.modeloDoOrquestrador,
      modeloDosSubagentes: alteracoes.modeloDosSubagentes ?? atual.modeloDosSubagentes,
      quantidadeDeSubagentes: alteracoes.quantidadeDeSubagentes ?? atual.quantidadeDeSubagentes,
      nivelDePermissao: alteracoes.nivelDePermissao ?? atual.nivelDePermissao,
    });
  }

  paraDados(): DadosDaConfiguracao {
    return {
      modeloDoOrquestrador: this.modeloDoOrquestrador,
      modeloDosSubagentes: this.modeloDosSubagentes,
      quantidadeDeSubagentes: this.quantidadeDeSubagentes.paraDados(),
      nivelDePermissao: this.nivelDePermissao,
    };
  }
}
