import { ErroDeOrquestracao } from "./ErroDeOrquestracao";
import { ehEsforcoDeRaciocinio, ESFORCO_PADRAO, EsforcoDeRaciocinio } from "./EsforcoDeRaciocinio";
import { ehModeloClaude, ModeloClaude } from "./ModeloClaude";
import { ModoDoTurno } from "./ModoDoTurno";
import { ehNivelDePermissao, NivelDePermissao } from "./NivelDePermissao";
import { DadosDaQuantidade, QuantidadeDeSubagentes } from "./QuantidadeDeSubagentes";

export interface DadosDaConfiguracao {
  modeloDoOrquestrador: ModeloClaude;
  modeloDosSubagentes: ModeloClaude;
  quantidadeDeSubagentes: DadosDaQuantidade;
  nivelDePermissao: NivelDePermissao;
  /**
   * Se os agentes podem fazer commit e push quando o usuário pedir. Ausente
   * nas configurações gravadas antes de a opção existir: vale `false`.
   * `paraDados` sempre o preenche.
   */
  permitirCommitEPush?: boolean | undefined;
  /**
   * Esforço de raciocínio de cada papel. Ausentes nas configurações gravadas
   * antes de a opção existir: vale `padrao`. `paraDados` sempre os preenche.
   */
  esforcoDoOrquestrador?: EsforcoDeRaciocinio | undefined;
  esforcoDosSubagentes?: EsforcoDeRaciocinio | undefined;
  /**
   * "Deixar o orquestrador fazer o trivial sozinho": se o Orquestrador pode
   * ler, buscar e rodar comandos curtos ele mesmo, em vez de delegar tudo.
   * Ausente nas configurações gravadas antes de a opção existir: vale `true`.
   * `paraDados` sempre o preenche.
   */
  permitirTrabalhoDireto?: boolean | undefined;
  /**
   * "Propor plano antes de mudanças grandes": se, num turno de execução, o
   * Orquestrador para e propõe um Plano quando o pedido é grande. Ausente nas
   * configurações gravadas antes de a opção existir: vale `true`. `paraDados`
   * sempre o preenche.
   */
  proporPlanoEmPedidosGrandes?: boolean | undefined;
}

/** Só os campos informados mudam; os ausentes mantêm o valor atual. */
export type AlteracoesDaConfiguracao = {
  [Campo in keyof DadosDaConfiguracao]?: DadosDaConfiguracao[Campo] | undefined;
};

/**
 * Como um Orquestrador trabalha: modelos, esforço de raciocínio, quantos
 * Subagentes, o que eles podem fazer, se o Orquestrador faz o trivial ele
 * mesmo e se propõe um Plano antes de mudanças grandes. Objeto de valor —
 * alterar a configuração produz outra.
 */
export class ConfiguracaoDoOrquestrador {
  private constructor(
    public readonly modeloDoOrquestrador: ModeloClaude,
    public readonly modeloDosSubagentes: ModeloClaude,
    public readonly quantidadeDeSubagentes: QuantidadeDeSubagentes,
    public readonly nivelDePermissao: NivelDePermissao,
    public readonly permitirCommitEPush: boolean,
    public readonly esforcoDoOrquestrador: EsforcoDeRaciocinio,
    public readonly esforcoDosSubagentes: EsforcoDeRaciocinio,
    public readonly permitirTrabalhoDireto: boolean,
    public readonly proporPlanoEmPedidosGrandes: boolean,
  ) {}

  static de(dados: DadosDaConfiguracao): ConfiguracaoDoOrquestrador {
    if (!ehModeloClaude(dados.modeloDoOrquestrador) || !ehModeloClaude(dados.modeloDosSubagentes)) {
      throw new ErroDeOrquestracao("dados_invalidos", "Modelo inválido. Use opus, sonnet ou haiku.");
    }
    if (!ehNivelDePermissao(dados.nivelDePermissao)) {
      throw new ErroDeOrquestracao("dados_invalidos", "Nível de permissão inválido.");
    }
    const permitirCommitEPush: unknown = dados.permitirCommitEPush ?? false;
    if (typeof permitirCommitEPush !== "boolean") {
      throw new ErroDeOrquestracao(
        "dados_invalidos",
        'A opção "Permitir commit e push" deve ser verdadeira ou falsa.',
      );
    }
    const esforcoDoOrquestrador: unknown = dados.esforcoDoOrquestrador ?? ESFORCO_PADRAO;
    if (!ehEsforcoDeRaciocinio(esforcoDoOrquestrador)) {
      throw new ErroDeOrquestracao("dados_invalidos", "Esforço do orquestrador inválido.");
    }
    const esforcoDosSubagentes: unknown = dados.esforcoDosSubagentes ?? ESFORCO_PADRAO;
    if (!ehEsforcoDeRaciocinio(esforcoDosSubagentes)) {
      throw new ErroDeOrquestracao("dados_invalidos", "Esforço dos subagentes inválido.");
    }
    const permitirTrabalhoDireto: unknown = dados.permitirTrabalhoDireto ?? true;
    if (typeof permitirTrabalhoDireto !== "boolean") {
      throw new ErroDeOrquestracao(
        "dados_invalidos",
        'A opção "Deixar o orquestrador fazer o trivial sozinho" deve ser verdadeira ou falsa.',
      );
    }
    const proporPlanoEmPedidosGrandes: unknown = dados.proporPlanoEmPedidosGrandes ?? true;
    if (typeof proporPlanoEmPedidosGrandes !== "boolean") {
      throw new ErroDeOrquestracao(
        "dados_invalidos",
        'A opção "Propor plano antes de mudanças grandes" deve ser verdadeira ou falsa.',
      );
    }
    return new ConfiguracaoDoOrquestrador(
      dados.modeloDoOrquestrador,
      dados.modeloDosSubagentes,
      QuantidadeDeSubagentes.de(dados.quantidadeDeSubagentes),
      dados.nivelDePermissao,
      permitirCommitEPush,
      esforcoDoOrquestrador,
      esforcoDosSubagentes,
      permitirTrabalhoDireto,
      proporPlanoEmPedidosGrandes,
    );
  }

  /**
   * Se commit e push ficam liberados num turno deste modo: só com a opção
   * ligada e num turno de execução — no planejamento nada pode ser alterado.
   * Mesmo liberados, só acontecem quando o usuário pede, e só com o nível
   * `edicao_e_comandos`, o único com ferramenta de terminal.
   */
  permiteCommitEPush(modo: ModoDoTurno): boolean {
    return this.permitirCommitEPush && modo === "execucao";
  }

  /**
   * Se, num turno deste modo, o Orquestrador deve avaliar o tamanho do pedido
   * e, se for grande, propor um Plano em vez de executar: só com a opção
   * ligada e num turno de execução — o planejamento já termina em Plano.
   */
  propoePlanoEmPedidosGrandes(modo: ModoDoTurno): boolean {
    return this.proporPlanoEmPedidosGrandes && modo === "execucao";
  }

  com(alteracoes: AlteracoesDaConfiguracao): ConfiguracaoDoOrquestrador {
    const atual = this.paraDados();
    return ConfiguracaoDoOrquestrador.de({
      modeloDoOrquestrador: alteracoes.modeloDoOrquestrador ?? atual.modeloDoOrquestrador,
      modeloDosSubagentes: alteracoes.modeloDosSubagentes ?? atual.modeloDosSubagentes,
      quantidadeDeSubagentes: alteracoes.quantidadeDeSubagentes ?? atual.quantidadeDeSubagentes,
      nivelDePermissao: alteracoes.nivelDePermissao ?? atual.nivelDePermissao,
      permitirCommitEPush: alteracoes.permitirCommitEPush ?? atual.permitirCommitEPush,
      esforcoDoOrquestrador: alteracoes.esforcoDoOrquestrador ?? atual.esforcoDoOrquestrador,
      esforcoDosSubagentes: alteracoes.esforcoDosSubagentes ?? atual.esforcoDosSubagentes,
      permitirTrabalhoDireto: alteracoes.permitirTrabalhoDireto ?? atual.permitirTrabalhoDireto,
      proporPlanoEmPedidosGrandes: alteracoes.proporPlanoEmPedidosGrandes ?? atual.proporPlanoEmPedidosGrandes,
    });
  }

  paraDados(): DadosDaConfiguracao {
    return {
      modeloDoOrquestrador: this.modeloDoOrquestrador,
      modeloDosSubagentes: this.modeloDosSubagentes,
      quantidadeDeSubagentes: this.quantidadeDeSubagentes.paraDados(),
      nivelDePermissao: this.nivelDePermissao,
      permitirCommitEPush: this.permitirCommitEPush,
      esforcoDoOrquestrador: this.esforcoDoOrquestrador,
      esforcoDosSubagentes: this.esforcoDosSubagentes,
      permitirTrabalhoDireto: this.permitirTrabalhoDireto,
      proporPlanoEmPedidosGrandes: this.proporPlanoEmPedidosGrandes,
    };
  }
}
