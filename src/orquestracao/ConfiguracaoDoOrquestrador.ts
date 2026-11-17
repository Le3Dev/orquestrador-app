import { ErroDeOrquestracao } from "./ErroDeOrquestracao";
import {
  ehEsforcoDeRaciocinio,
  ESFORCO_PADRAO,
  EsforcoDeRaciocinio,
  serveParaSubagentes,
  ULTRACODE_NOS_SUBAGENTES,
} from "./EsforcoDeRaciocinio";
import { instrucoesValidas } from "./InstrucoesPersonalizadas";
import { ModeloDoMotor, modeloDoMotorValido, modeloPadraoDoMotor } from "./ModeloDoMotor";
import { ModoDoTurno } from "./ModoDoTurno";
import { ehMotor, Motor, MOTOR_PADRAO, MOTORES } from "./Motor";
import { ehNivelDePermissao, NivelDePermissao } from "./NivelDePermissao";
import { DadosDaQuantidade, QuantidadeDeSubagentes } from "./QuantidadeDeSubagentes";
import { SelecaoDeSubagentesProntos, selecaoDeSubagentesProntosValida } from "./SubagentesProntos";

export interface DadosDaConfiguracao {
  /**
   * O motor de cada papel. Ausentes nas configurações gravadas antes de
   * existirem os outros motores: valem `claude-code`. `paraDados` sempre os
   * preenche.
   */
  motorDoOrquestrador?: Motor | undefined;
  motorDosSubagentes?: Motor | undefined;
  /** O modelo de cada papel, válido para o motor dele (`ModeloDoMotor`). */
  modeloDoOrquestrador: ModeloDoMotor;
  modeloDosSubagentes: ModeloDoMotor;
  /**
   * Os motores a que o app recorre, na ordem, quando o motor do Orquestrador
   * bate no limite de uso ou fica sobrecarregado no meio de um pedido. Sem
   * repetidos e sem o motor do Orquestrador. Ausente nas configurações
   * gravadas antes do campo: vale `[]` (nenhuma reserva). `paraDados` sempre a
   * preenche.
   */
  ordemDeReserva?: readonly Motor[] | undefined;
  /**
   * Se o Orquestrador tem um navegador próprio, que os agentes controlam e o
   * usuário vê no canvas. Ausente nas configurações gravadas antes de a opção
   * existir: vale `false`. `paraDados` sempre o preenche. Só liga as
   * ferramentas no nível "Editar e rodar comandos" e fora do planejamento
   * (`permiteNavegador`).
   */
  navegadorDoAgente?: boolean | undefined;
  quantidadeDeSubagentes: DadosDaQuantidade;
  nivelDePermissao: NivelDePermissao;
  /**
   * Se os agentes podem fazer commit e push quando o usuário pedir. Ausente
   * nas configurações gravadas antes de a opção existir: vale `false`.
   * `paraDados` sempre o preenche.
   */
  permitirCommitEPush?: boolean | undefined;
  /**
   * Se o Orquestrador (e os subagentes lançados por ele) podem publicar
   * artefatos online na conta do claude.ai (ferramenta `Artifact`). Ausente
   * nas configurações gravadas antes de a opção existir: vale `false`.
   * `paraDados` sempre o preenche.
   */
  permitirArtefatosOnline?: boolean | undefined;
  /**
   * Esforço de raciocínio de cada papel. Ausentes nas configurações gravadas
   * antes de a opção existir: vale `padrao`. `paraDados` sempre os preenche.
   * Só o Claude Code o aplica: o valor fica guardado, mas os outros motores
   * seguem o esforço do próprio CLI (`esforcoDoOrquestradorNo`).
   */
  esforcoDoOrquestrador?: EsforcoDeRaciocinio | undefined;
  esforcoDosSubagentes?: EsforcoDeRaciocinio | undefined;
  // "Fazer o trivial sozinho" e "Propor plano antes de mudanças grandes"
  // deixaram de ser opções (ADR-28): valem sempre. Configurações gravadas
  // quando ainda eram opções trazem os dois campos; `de` os ignora e
  // `paraDados` não os devolve, então somem ao salvar de novo.
  /**
   * Instruções personalizadas do usuário para este Orquestrador, acrescentadas
   * ao fim do bloco de cada pedido. Vazias, vale o padrão global (se houver).
   * Ausentes nas configurações gravadas antes de a opção existir: vale `""`.
   * `paraDados` sempre as preenche, já normalizadas.
   */
  instrucoesPersonalizadas?: string | undefined;
  /**
   * Quais subagentes prontos das preferências este Orquestrador recebe.
   * Ausente nas configurações gravadas antes de a opção existir: vale
   * `"todos"`. `paraDados` sempre a preenche.
   */
  subagentesProntos?: SelecaoDeSubagentesProntos | undefined;
}

/** Só os campos informados mudam; os ausentes mantêm o valor atual. */
export type AlteracoesDaConfiguracao = {
  [Campo in keyof DadosDaConfiguracao]?: DadosDaConfiguracao[Campo] | undefined;
};

/** O motor de um papel: o padrão (`claude-code`) na ausência, `dados_invalidos` se não existir. */
function motorValido(valor: unknown, papel: string): Motor {
  const motor = valor ?? MOTOR_PADRAO;
  if (!ehMotor(motor)) {
    throw new ErroDeOrquestracao("dados_invalidos", `Motor ${papel} inválido. Use ${MOTORES.join(", ")}.`);
  }
  return motor;
}

/** A ordem de reserva sem repetidos e sem o motor do Orquestrador, congelada. */
function ordemDeReservaValida(valor: unknown, motorDoOrquestrador: Motor): readonly Motor[] {
  const itens: unknown = valor ?? [];
  if (!Array.isArray(itens)) {
    throw new ErroDeOrquestracao("dados_invalidos", "A ordem de reserva deve ser uma lista de motores.");
  }
  const motores: Motor[] = [];
  for (const item of itens as readonly unknown[]) {
    if (!ehMotor(item)) {
      throw new ErroDeOrquestracao("dados_invalidos", `Motor de reserva inválido. Use ${MOTORES.join(", ")}.`);
    }
    if (item === motorDoOrquestrador) {
      throw new ErroDeOrquestracao(
        "dados_invalidos",
        "O motor do orquestrador não pode estar na ordem de reserva.",
      );
    }
    if (motores.includes(item)) {
      throw new ErroDeOrquestracao("dados_invalidos", "A ordem de reserva não pode repetir motores.");
    }
    motores.push(item);
  }
  return Object.freeze(motores);
}

/**
 * Como um Orquestrador trabalha: o motor e o modelo de cada papel, os motores
 * de reserva, esforço de raciocínio, quantos Subagentes, o que eles podem
 * fazer e as instruções personalizadas do usuário. Fazer o trivial ele mesmo e
 * propor um Plano antes de mudanças grandes não são opções: valem sempre
 * (ADR-28). Objeto de valor — alterar a configuração produz outra.
 *
 * Padrão: tudo no Claude Code e sem reserva, como era antes de existirem os
 * outros motores.
 */
export class ConfiguracaoDoOrquestrador {
  private constructor(
    public readonly modeloDoOrquestrador: ModeloDoMotor,
    public readonly modeloDosSubagentes: ModeloDoMotor,
    public readonly quantidadeDeSubagentes: QuantidadeDeSubagentes,
    public readonly nivelDePermissao: NivelDePermissao,
    public readonly permitirCommitEPush: boolean,
    public readonly permitirArtefatosOnline: boolean,
    public readonly esforcoDoOrquestrador: EsforcoDeRaciocinio,
    public readonly esforcoDosSubagentes: EsforcoDeRaciocinio,
    public readonly instrucoesPersonalizadas: string,
    public readonly subagentesProntos: SelecaoDeSubagentesProntos,
    public readonly motorDoOrquestrador: Motor,
    public readonly motorDosSubagentes: Motor,
    public readonly ordemDeReserva: readonly Motor[],
    public readonly navegadorDoAgente: boolean,
  ) {}

  static de(dados: DadosDaConfiguracao): ConfiguracaoDoOrquestrador {
    const motorDoOrquestrador = motorValido(dados.motorDoOrquestrador, "do orquestrador");
    const motorDosSubagentes = motorValido(dados.motorDosSubagentes, "dos subagentes");
    const modeloDoOrquestrador = modeloDoMotorValido(motorDoOrquestrador, dados.modeloDoOrquestrador);
    const modeloDosSubagentes = modeloDoMotorValido(motorDosSubagentes, dados.modeloDosSubagentes);
    const ordemDeReserva = ordemDeReservaValida(dados.ordemDeReserva, motorDoOrquestrador);
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
    const permitirArtefatosOnline: unknown = dados.permitirArtefatosOnline ?? false;
    if (typeof permitirArtefatosOnline !== "boolean") {
      throw new ErroDeOrquestracao(
        "dados_invalidos",
        'A opção "Publicar artefatos no claude.ai" deve ser verdadeira ou falsa.',
      );
    }
    const navegadorDoAgente: unknown = dados.navegadorDoAgente ?? false;
    if (typeof navegadorDoAgente !== "boolean") {
      throw new ErroDeOrquestracao(
        "dados_invalidos",
        'A opção "Navegador do agente" deve ser verdadeira ou falsa.',
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
    if (!serveParaSubagentes(esforcoDosSubagentes)) {
      throw new ErroDeOrquestracao("dados_invalidos", ULTRACODE_NOS_SUBAGENTES);
    }
    const instrucoesPersonalizadas = instrucoesValidas(
      dados.instrucoesPersonalizadas,
      "As instruções personalizadas",
    );
    return new ConfiguracaoDoOrquestrador(
      modeloDoOrquestrador,
      modeloDosSubagentes,
      QuantidadeDeSubagentes.de(dados.quantidadeDeSubagentes),
      dados.nivelDePermissao,
      permitirCommitEPush,
      permitirArtefatosOnline,
      esforcoDoOrquestrador,
      esforcoDosSubagentes,
      instrucoesPersonalizadas,
      selecaoDeSubagentesProntosValida(dados.subagentesProntos),
      motorDoOrquestrador,
      motorDosSubagentes,
      ordemDeReserva,
      navegadorDoAgente,
    );
  }

  /**
   * Os motores por onde um pedido passa, na ordem: o do Orquestrador e, depois,
   * os de reserva. O primeiro é o que ele tenta primeiro.
   */
  get motoresEmOrdem(): readonly Motor[] {
    return [this.motorDoOrquestrador, ...this.ordemDeReserva];
  }

  /** O primeiro motor de reserva que ainda não foi tentado (`tentados`), ou `null` se a reserva esgotou. */
  proximoMotorDeReserva(tentados: readonly Motor[]): Motor | null {
    return this.ordemDeReserva.find((motor) => !tentados.includes(motor)) ?? null;
  }

  /**
   * A configuração com que um turno roda quando o motor em uso não é o do
   * Orquestrador (um motor de reserva): os dois papéis passam para esse motor,
   * cada um com o modelo padrão dele, e o resto (permissões, esforço guardado,
   * quantidade de Subagentes...) fica igual. No motor do Orquestrador, é a
   * própria configuração.
   */
  paraMotor(motor: Motor): ConfiguracaoDoOrquestrador {
    if (motor === this.motorDoOrquestrador) {
      return this;
    }
    return new ConfiguracaoDoOrquestrador(
      modeloPadraoDoMotor(motor, "orquestrador"),
      modeloPadraoDoMotor(motor, "subagentes"),
      this.quantidadeDeSubagentes,
      this.nivelDePermissao,
      this.permitirCommitEPush,
      this.permitirArtefatosOnline,
      this.esforcoDoOrquestrador,
      this.esforcoDosSubagentes,
      this.instrucoesPersonalizadas,
      this.subagentesProntos,
      motor,
      motor,
      [],
      this.navegadorDoAgente,
    );
  }

  /** O esforço do Orquestrador que vale neste motor: só o Claude Code o aplica; os outros seguem o do próprio CLI. */
  esforcoDoOrquestradorNo(motor: Motor): EsforcoDeRaciocinio {
    return motor === "claude-code" ? this.esforcoDoOrquestrador : ESFORCO_PADRAO;
  }

  /** O esforço dos Subagentes que vale neste motor (ver `esforcoDoOrquestradorNo`). */
  esforcoDosSubagentesNo(motor: Motor): EsforcoDeRaciocinio {
    return motor === "claude-code" ? this.esforcoDosSubagentes : ESFORCO_PADRAO;
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
   * Se as ferramentas do navegador do agente vão ao turno: com a opção ligada,
   * no nível "Editar e rodar comandos" (um site pode levar a qualquer ação, e
   * esse é o nível em que o usuário já aceitou que o agente aja sozinho) e num
   * turno de execução — no planejamento nada é alterado nem aberto.
   */
  permiteNavegador(modo: ModoDoTurno): boolean {
    return this.navegadorDoAgente && this.nivelDePermissao === "edicao_e_comandos" && modo === "execucao";
  }

  /**
   * Se, num turno deste modo, o Orquestrador deve avaliar o tamanho do pedido
   * e, se for grande, propor um Plano em vez de executar: sempre num turno de
   * execução (ADR-28) — o planejamento já termina em Plano.
   */
  propoePlanoEmPedidosGrandes(modo: ModoDoTurno): boolean {
    return modo === "execucao";
  }

  com(alteracoes: AlteracoesDaConfiguracao): ConfiguracaoDoOrquestrador {
    const atual = this.paraDados();
    const motorDoOrquestrador = alteracoes.motorDoOrquestrador ?? this.motorDoOrquestrador;
    const motorDosSubagentes = alteracoes.motorDosSubagentes ?? this.motorDosSubagentes;
    return ConfiguracaoDoOrquestrador.de({
      motorDoOrquestrador,
      motorDosSubagentes,
      // Trocar o motor de um papel sem escolher o modelo volta ao modelo padrão do motor novo:
      // o modelo do motor anterior não serve a ele.
      modeloDoOrquestrador:
        alteracoes.modeloDoOrquestrador ??
        (motorDoOrquestrador === this.motorDoOrquestrador
          ? atual.modeloDoOrquestrador
          : modeloPadraoDoMotor(motorDoOrquestrador, "orquestrador")),
      modeloDosSubagentes:
        alteracoes.modeloDosSubagentes ??
        (motorDosSubagentes === this.motorDosSubagentes
          ? atual.modeloDosSubagentes
          : modeloPadraoDoMotor(motorDosSubagentes, "subagentes")),
      // O motor que passa a ser o do Orquestrador sai da reserva; só a ausência mantém a ordem atual.
      ordemDeReserva:
        alteracoes.ordemDeReserva ?? this.ordemDeReserva.filter((motor) => motor !== motorDoOrquestrador),
      quantidadeDeSubagentes: alteracoes.quantidadeDeSubagentes ?? atual.quantidadeDeSubagentes,
      nivelDePermissao: alteracoes.nivelDePermissao ?? atual.nivelDePermissao,
      permitirCommitEPush: alteracoes.permitirCommitEPush ?? atual.permitirCommitEPush,
      permitirArtefatosOnline: alteracoes.permitirArtefatosOnline ?? atual.permitirArtefatosOnline,
      navegadorDoAgente: alteracoes.navegadorDoAgente ?? atual.navegadorDoAgente,
      esforcoDoOrquestrador: alteracoes.esforcoDoOrquestrador ?? atual.esforcoDoOrquestrador,
      esforcoDosSubagentes: alteracoes.esforcoDosSubagentes ?? atual.esforcoDosSubagentes,
      // `""` limpa as instruções: só a ausência mantém as atuais.
      instrucoesPersonalizadas: alteracoes.instrucoesPersonalizadas ?? atual.instrucoesPersonalizadas,
      subagentesProntos: alteracoes.subagentesProntos ?? atual.subagentesProntos,
    });
  }

  paraDados(): DadosDaConfiguracao {
    return {
      motorDoOrquestrador: this.motorDoOrquestrador,
      motorDosSubagentes: this.motorDosSubagentes,
      modeloDoOrquestrador: this.modeloDoOrquestrador,
      modeloDosSubagentes: this.modeloDosSubagentes,
      ordemDeReserva: [...this.ordemDeReserva],
      quantidadeDeSubagentes: this.quantidadeDeSubagentes.paraDados(),
      nivelDePermissao: this.nivelDePermissao,
      permitirCommitEPush: this.permitirCommitEPush,
      permitirArtefatosOnline: this.permitirArtefatosOnline,
      navegadorDoAgente: this.navegadorDoAgente,
      esforcoDoOrquestrador: this.esforcoDoOrquestrador,
      esforcoDosSubagentes: this.esforcoDosSubagentes,
      instrucoesPersonalizadas: this.instrucoesPersonalizadas,
      subagentesProntos: Array.isArray(this.subagentesProntos) ? [...this.subagentesProntos] : this.subagentesProntos,
    };
  }
}
