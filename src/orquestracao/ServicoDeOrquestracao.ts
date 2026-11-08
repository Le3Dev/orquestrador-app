import { separarPerguntasDoApp } from "../perguntas/PerguntaDoApp";
import { Anexo } from "./Anexo";
import { ArmazemDeAnexos } from "./ArmazemDeAnexos";
import {
  AlteracoesDaConfiguracao,
  ConfiguracaoDoOrquestrador,
  DadosDaConfiguracao,
} from "./ConfiguracaoDoOrquestrador";
import { ControleDeExecucoes, PublicadorDeEventos } from "./ControleDeExecucoes";
import { DiagnosticadorDoClaude } from "./DiagnosticoDoClaude";
import { ErroDeOrquestracao } from "./ErroDeOrquestracao";
import { EsforcoDaMaquina } from "./EsforcoDaMaquina";
import { EsforcoHerdado } from "./EsforcoHerdado";
import {
  CausaDaRecuperacao,
  EtapaDaRecuperacao,
  EventoDeOrquestracao,
  EventoDoMotor,
} from "./EventoDeOrquestracao";
import { mensagemDeAprovacaoDoPlano, separarPropostaDePlano } from "./InstrucoesDoOrquestrador";
import { aplicarVariaveis, InstrucoesAplicadas, resolverInstrucoes } from "./InstrucoesPersonalizadas";
import { MedidorDeConsumo, PeriodoDoTurno } from "./MedidorDeConsumo";
import { ModeloClaude } from "./ModeloClaude";
import { ModoDoTurno } from "./ModoDoTurno";
import { ABORTO_POR_SILENCIO, CausaDaFalha, MotorDeAgentes, PedidoDeTurno, ResultadoDoTurno } from "./MotorDeAgentes";
import { DadosDaRetomadaPendente, Orquestrador, TAMANHO_MAXIMO_DA_MENSAGEM } from "./Orquestrador";
import { PastaDeTrabalho } from "./PastaDeTrabalho";
import { PedidoNaFila } from "./PedidoNaFila";
import { predefinicaoPorNome } from "./PredefinicaoDeConfiguracao";
import { GerenciadorDeWorktrees } from "./PreparoDeWorktree";
import {
  descreverCausa,
  descreverEsperas,
  ehRecuperavel,
  esperaAntesDaTentativa,
  formatarHora,
  maximoDeTentativas,
  mensagemDeRetomada,
  resumoDaEspera,
} from "./RecuperacaoDoTurno";
import { RepositorioDeOrquestradores } from "./RepositorioDeOrquestradores";
import { RepositorioDePreferencias } from "./RepositorioDePreferencias";
import { DadosDoSubagentePronto } from "./SubagentesProntos";
import { AgendadorDeTarefas, agendadorDoRelogio, VigiaDoTurno } from "./VigiaDoTurno";

export interface DependenciasDoServico {
  repositorio: RepositorioDeOrquestradores;
  motor: MotorDeAgentes;
  execucoes: ControleDeExecucoes;
  publicador: PublicadorDeEventos;
  anexos: ArmazemDeAnexos;
  worktrees: GerenciadorDeWorktrees;
  /**
   * Pasta de entrada dos artefatos de cada Orquestrador, absoluta
   * (`<PASTA_DADOS>/artefatos/entrada/orquestradores/<id>`): vai em cada
   * pedido ao motor.
   */
  pastaDeArtefatos: (orquestradorId: string) => string;
  /** De onde vêm as instruções padrão, para Orquestradores sem instruções próprias. */
  preferencias: RepositorioDePreferencias;
  gerarId: () => string;
  agora: () => Date;
  /** Mede o gasto de cada turno ao fim dele. Sem medidor, nenhum consumo é registrado. */
  medidor?: MedidorDeConsumo | undefined;
  /** Lê o esforço que o Claude Code da máquina usa no "Padrão". Sem ele, nada é herdado. */
  esforcoDaMaquina?: EsforcoDaMaquina | undefined;
  /**
   * Examina o Claude de um turno que ficou em silêncio (ver ADR-36). Sem ele,
   * não há vigia: o turno espera o quanto for. As falhas por limite de uso,
   * sobrecarga e rede são retomadas do mesmo jeito.
   */
  diagnosticador?: DiagnosticadorDoClaude | undefined;
  /** Marca as esperas da vigia e da retomada. Sem ele, `setTimeout`. */
  agendador?: AgendadorDeTarefas | undefined;
}

/** O esforço que cada papel herda da máquina quando a configuração está em "Padrão". */
export interface EsforcoHerdadoDosPapeis {
  orquestrador: EsforcoHerdado | null;
  subagentes: EsforcoHerdado | null;
}

/** Os modelos e a pasta de um Orquestrador ainda não criado (formulário de criação). */
export interface ConsultaDeEsforcoDosPapeis {
  modeloDoOrquestrador: ModeloClaude;
  modeloDosSubagentes: ModeloClaude;
  pastaDoProjeto: string;
}

/** Por que um turno falhou, para decidir se ele é retomado (ver ADR-36). */
interface FalhaDoTurno {
  causa: CausaDaFalha;
  liberaEm: string | null;
  /** O motivo gravado no `turno_falhou`. */
  motivo: string;
}

/** O que a medição e a autorrecuperação precisam saber do turno que acabou de terminar. */
interface TurnoEncerrado {
  turnoId: string;
  periodo: PeriodoDoTurno;
  modo: ModoDoTurno;
  /** Nula quando o turno foi concluído ou cancelado. */
  falha: FalhaDoTurno | null;
}

/** Uma retomada marcada para daqui a pouco, que o usuário ainda pode cancelar. */
interface RetomadaAgendada {
  /** O turno que travou ou falhou. */
  turnoId: string;
  causa: CausaDaRecuperacao;
  tentativa: number;
  de: number;
  modo: ModoDoTurno;
  desmarcar: () => void;
}

/**
 * Retomada vencida durante o reinício: espera ao menos isto, multiplicado
 * pela ordem dela, para várias não abrirem o Claude ao mesmo tempo.
 */
export const ATRASO_DA_RETOMADA_APOS_REINICIO_MS = 10_000;

/** Imagem como chega do usuário, antes de virar Anexo. */
export interface ImagemRecebida {
  nome: string;
  tipoDeMidia: string;
  conteudo: Uint8Array;
}

export interface NovoPedidoDeOrquestrador {
  nome: string;
  pastaDeTrabalho: PastaDeTrabalho;
  configuracao: DadosDaConfiguracao;
}

export interface MensagemEnviada {
  turnoId: string;
  /** Resolve quando o turno termina (concluído, cancelado ou com falha). Nunca rejeita. */
  conclusao: Promise<void>;
  /**
   * Resolve depois da `conclusao`, quando a medição do consumo do turno
   * termina (com ou sem evento). Nunca rejeita. Ninguém precisa esperá-la.
   */
  medicao: Promise<void>;
  /**
   * Resolve depois da `conclusao`, quando o envio automático do próximo
   * pedido da fila foi decidido — e, se ele saiu, quando o turno dele já
   * começou. Nunca rejeita. Ninguém precisa esperá-la.
   */
  envioDaFila: Promise<void>;
  /**
   * Resolve depois da `conclusao`, quando a autorrecuperação decidiu o que
   * fazer com o turno (nada, agendar a retomada ou desistir; ver ADR-36). Não
   * espera a retomada em si. Nunca rejeita. Ninguém precisa esperá-la.
   */
  recuperacao: Promise<void>;
}

export interface PedidoEnfileirado {
  pedidoId: string;
}

function descreverErro(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

/**
 * Casos de uso da orquestração: criar Orquestradores, conversar com eles,
 * enfileirar pedidos, decidir os Planos que entregarem, limpar a conversa e
 * cancelar o que estiverem fazendo.
 *
 * Os Orquestradores vêm do repositório, e os turnos em execução ficam no
 * `ControleDeExecucoes`. O único estado daqui é o da autorrecuperação (ver
 * ADR-36): o relógio de cada retomada agendada e a contagem de tentativas. A
 * retomada em si (turno, causa, tentativa e horário) fica no agregado e vai
 * para o disco; ao subir, `reagendarRetomadasPendentes` volta a marcá-las.
 */
export class ServicoDeOrquestracao {
  /** Tentativas de retomada já feitas, por Orquestrador e por causa. Zeram quando um turno conclui. */
  private readonly tentativas = new Map<string, Map<CausaDaRecuperacao, number>>();
  /** No máximo uma por Orquestrador. */
  private readonly retomadas = new Map<string, RetomadaAgendada>();

  constructor(private readonly dependencias: DependenciasDoServico) {}

  async criarOrquestrador(pedido: NovoPedidoDeOrquestrador): Promise<Orquestrador> {
    const { repositorio, gerarId, agora } = this.dependencias;

    const orquestrador = Orquestrador.criar({
      id: gerarId(),
      nome: pedido.nome,
      pastaDeTrabalho: pedido.pastaDeTrabalho,
      sessaoId: gerarId(),
      configuracao: ConfiguracaoDoOrquestrador.de(pedido.configuracao),
      agora: agora(),
    });
    await repositorio.salvar(orquestrador);
    return orquestrador;
  }

  /**
   * As instruções personalizadas que um pedido com esta configuração
   * receberia agora: as próprias, se houver; senão o padrão global. Ainda com
   * `{{pasta}}` e `{{nome}}`: são trocadas no turno (`executar`), quando a
   * pasta do turno já é conhecida.
   */
  instrucoesPara(configuracao: ConfiguracaoDoOrquestrador): InstrucoesAplicadas | null {
    return resolverInstrucoes(
      configuracao.instrucoesPersonalizadas,
      this.dependencias.preferencias.atuais().instrucoesPadrao,
    );
  }

  /** A biblioteca de subagentes prontos que um pedido receberia agora. */
  subagentesProntos(): readonly DadosDoSubagentePronto[] {
    return this.dependencias.preferencias.atuais().subagentesProntos;
  }

  async alterarConfiguracao(id: string, alteracoes: AlteracoesDaConfiguracao): Promise<Orquestrador> {
    const orquestrador = this.buscar(id);
    this.publicar(orquestrador, orquestrador.alterarConfiguracao(alteracoes));
    await this.dependencias.repositorio.salvar(orquestrador);
    return orquestrador;
  }

  /**
   * Troca o nome do Orquestrador; vale também durante um turno. Trocar pelo
   * mesmo nome não grava nem avisa as telas.
   */
  async renomear(id: string, nome: string): Promise<Orquestrador> {
    const orquestrador = this.buscar(id);
    const evento = orquestrador.renomear(nome);
    if (evento === null) {
      return orquestrador;
    }
    this.publicar(orquestrador, evento);
    await this.dependencias.repositorio.salvar(orquestrador);
    return orquestrador;
  }

  /**
   * Aplica uma predefinição de configuração (ex.: "economico"). Como uma
   * alteração de configuração: vale a partir do próximo turno e continua
   * editável campo a campo depois.
   */
  async aplicarPredefinicao(id: string, nome: string): Promise<Orquestrador> {
    const predefinicao = predefinicaoPorNome(nome);
    if (predefinicao === null) {
      throw new ErroDeOrquestracao("dados_invalidos", "Predefinição desconhecida.");
    }
    const orquestrador = this.buscar(id);
    this.publicar(orquestrador, orquestrador.aplicarPredefinicao(predefinicao));
    await this.dependencias.repositorio.salvar(orquestrador);
    return orquestrador;
  }

  /**
   * O esforço que cada papel herda da máquina quando está em "Padrão", com
   * os modelos da configuração atual. O modelo real do Orquestrador é o do
   * último consumo medido na conversa, se houver.
   */
  async esforcoHerdadoDe(id: string): Promise<EsforcoHerdadoDosPapeis> {
    const orquestrador = this.buscar(id);
    const configuracao = orquestrador.configuracao;
    const pastaDoProjeto = orquestrador.pastaDeTrabalho.caminho;
    const [doOrquestrador, dosSubagentes] = await Promise.all([
      this.esforcoHerdado({
        modelo: configuracao.modeloDoOrquestrador,
        pastaDoProjeto,
        modeloReal: this.ultimoModeloMedido(orquestrador.id),
      }),
      this.esforcoHerdado({ modelo: configuracao.modeloDosSubagentes, pastaDoProjeto, modeloReal: null }),
    ]);
    return { orquestrador: doOrquestrador, subagentes: dosSubagentes };
  }

  /** O mesmo, para um Orquestrador ainda no formulário de criação. */
  async esforcoHerdadoPara(consulta: ConsultaDeEsforcoDosPapeis): Promise<EsforcoHerdadoDosPapeis> {
    const [doOrquestrador, dosSubagentes] = await Promise.all([
      this.esforcoHerdado({
        modelo: consulta.modeloDoOrquestrador,
        pastaDoProjeto: consulta.pastaDoProjeto,
        modeloReal: null,
      }),
      this.esforcoHerdado({
        modelo: consulta.modeloDosSubagentes,
        pastaDoProjeto: consulta.pastaDoProjeto,
        modeloReal: null,
      }),
    ]);
    return { orquestrador: doOrquestrador, subagentes: dosSubagentes };
  }

  /**
   * Inicia um turno e devolve assim que ele começa; o trabalho segue em
   * segundo plano e é acompanhado pelos eventos.
   *
   * No modo `planejamento` o turno só investiga e responde com um Plano, que
   * fica pendente até `aprovarPlano` ou `descartarPlano`. Na `execucao`, com
   * a opção de propor plano em pedidos grandes ligada, o Orquestrador pode
   * responder com um Plano em vez de executar — ele fica pendente do mesmo jeito.
   */
  async enviarMensagem(
    id: string,
    texto: string,
    imagens: readonly ImagemRecebida[] = [],
    modo: ModoDoTurno = "execucao",
  ): Promise<MensagemEnviada> {
    return this.iniciarTurno(this.buscar(id), texto, imagens, modo, null);
  }

  /**
   * Guarda um pedido na fila do Orquestrador, com ou sem turno em andamento.
   * Ele sai sozinho quando um turno terminar bem, ou com `enviarDaFila`.
   */
  async enfileirarPedido(id: string, texto: string, modo: ModoDoTurno = "execucao"): Promise<PedidoEnfileirado> {
    const { repositorio, gerarId, agora } = this.dependencias;
    const orquestrador = this.buscar(id);
    const pedido = PedidoNaFila.criar({ id: gerarId(), texto, modo, enfileiradoEm: agora() });
    this.publicar(orquestrador, orquestrador.enfileirarPedido(pedido));
    await repositorio.salvar(orquestrador);
    return { pedidoId: pedido.id };
  }

  async removerDaFila(id: string, pedidoId: string): Promise<void> {
    const orquestrador = this.buscar(id);
    this.publicar(orquestrador, orquestrador.retirarDaFila(pedidoId, "removido"));
    await this.dependencias.repositorio.salvar(orquestrador);
  }

  /**
   * Envia agora um pedido da fila, com o texto e o modo dele, como se fosse
   * uma mensagem. Com um turno em andamento, é recusado como uma mensagem
   * seria — e o pedido continua na fila.
   */
  async enviarDaFila(id: string, pedidoId: string): Promise<MensagemEnviada> {
    const orquestrador = this.buscar(id);
    const pedido = orquestrador.pedidoDaFila(pedidoId);
    return this.iniciarTurno(orquestrador, pedido.texto, [], pedido.modo, pedido);
  }

  /**
   * Inicia um turno, vindo de uma mensagem ou de um pedido da fila
   * (`pedidoDaFila`).
   *
   * O pedido só sai da fila depois que o agregado aceitou o turno, e sem
   * espera entre uma coisa e outra: se o turno for recusado (ex.: outro em
   * andamento), o pedido continua na fila; uma vez aceito, nada se intercala.
   * Se depois disso a gravação falhar, o turno fica registrado como falho
   * com o texto do pedido — que não se perde, fica no histórico da conversa.
   *
   * `retomada`: o turno é o app retomando sozinho um que travou ou falhou
   * (ver ADR-36). Qualquer outro turno que começa cancela a retomada que
   * estivesse agendada: o usuário assumiu.
   */
  private async iniciarTurno(
    orquestrador: Orquestrador,
    texto: string,
    imagens: readonly ImagemRecebida[],
    modo: ModoDoTurno,
    pedidoDaFila: PedidoNaFila | null,
    retomada: { deTurnoId: string; tentativa: number } | null = null,
  ): Promise<MensagemEnviada> {
    const { repositorio, execucoes, anexos, gerarId, agora } = this.dependencias;
    const turnoId = gerarId();

    const anexosDoTurno = imagens.map((imagem) =>
      Anexo.de({
        id: gerarId(),
        nome: imagem.nome,
        tipoDeMidia: imagem.tipoDeMidia,
        tamanhoEmBytes: imagem.conteudo.byteLength,
      }),
    );
    const aceito = orquestrador.iniciarTurno(turnoId, texto, agora(), anexosDoTurno, modo);
    const inicio: EventoDeOrquestracao =
      retomada !== null && aceito.tipo === "turno_iniciado" ? { ...aceito, retomada } : aceito;
    if (retomada === null) {
      // Só depois de o agregado aceitar: um pedido recusado não cancela nada.
      this.cancelarRetomada(orquestrador, "um novo pedido começou");
    }
    const retirada = pedidoDaFila === null ? null : orquestrador.retirarDaFila(pedidoDaFila.id, "enviado");
    // A mesma do evento `turno_iniciado`: o turno segue com ela até o fim,
    // mesmo que o usuário altere a configuração enquanto ele roda.
    const configuracaoDoTurno = orquestrador.configuracao;
    // Resolvidas agora, junto com a configuração: mudar o padrão global com o
    // turno rodando também só vale a partir do próximo.
    const instrucoesDoTurno = this.instrucoesPara(configuracaoDoTurno);
    const { revogarAnteriores } = orquestrador.registrarInstrucoesDoPedido(instrucoesDoTurno !== null);
    // O sinal nasce antes de qualquer espera: um cancelamento que chegue
    // enquanto o turno é gravado já encontra a execução registrada.
    const sinal = execucoes.iniciar(orquestrador.id);
    // A tela vê o pedido sair da fila antes de o turno dele aparecer.
    if (retirada !== null) {
      this.publicar(orquestrador, retirada);
    }
    this.publicar(orquestrador, inicio);

    try {
      for (const [indice, anexo] of anexosDoTurno.entries()) {
        await anexos.guardar(orquestrador.id, anexo, imagens[indice]?.conteudo ?? new Uint8Array());
      }
      await repositorio.salvar(orquestrador);
    } catch (erro) {
      execucoes.encerrar(orquestrador.id);
      this.publicar(orquestrador, orquestrador.falharTurno(turnoId, descreverErro(erro), agora()));
      throw erro;
    }

    const execucao = this.executar(orquestrador, turnoId, sinal, configuracaoDoTurno, {
      instrucoes: instrucoesDoTurno,
      revogarInstrucoesAnteriores: revogarAnteriores,
      subagentesProntos: this.subagentesProntos(),
    }).finally(() => execucoes.encerrar(orquestrador.id));
    const conclusao = execucao.then(() => undefined);
    // Em segundo plano, depois do fim do turno: não segura a resposta nem o
    // próximo pedido, e o evento do consumo sempre vem depois do de fim.
    const medicao = execucao
      .then((encerrado) => (encerrado === null ? undefined : this.medirConsumo(orquestrador, encerrado)))
      .catch((falha: unknown) =>
        console.warn(`[orquestracao] Não foi possível medir o consumo do turno ${turnoId}:`, descreverErro(falha)),
      );
    // Depois do `encerrar`: o turno que sair da fila registra a própria
    // execução sem que o fim deste a apague. Turno que nem conseguiu ser
    // gravado como encerrado (`null`) pausa a fila.
    const envioDaFila = execucao.then(
      (encerrado) => (encerrado === null ? undefined : this.enviarProximoDaFila(orquestrador.id, turnoId)),
      // A execução falhou por fora do turno (a medição já avisa no log): a fila pausa.
      () => undefined,
    );
    // Também depois do `encerrar`: a retomada abre outro turno, que registra a
    // própria execução. Turno que nem foi gravado como encerrado não é retomado.
    const recuperacao = execucao.then(
      (encerrado) => (encerrado === null ? undefined : this.decidirRecuperacao(orquestrador.id, encerrado)),
      () => undefined,
    );
    return { turnoId, conclusao, medicao, envioDaFila, recuperacao };
  }

  /**
   * Começa uma conversa nova no mesmo Orquestrador ("/clear"): arquiva o
   * histórico atual, descarta um Plano pendente e faz o próximo turno abrir
   * outra sessão do Claude Code. Sem conversa para limpar, não faz nada.
   */
  async limparConversa(id: string): Promise<Orquestrador> {
    const { repositorio, publicador, gerarId } = this.dependencias;
    const orquestrador = this.buscar(id);
    if (orquestrador.totalDeTurnos === 0 && !orquestrador.sessaoIniciada) {
      return orquestrador;
    }

    // Recusado antes, com turno em andamento (e aí não há retomada agendada).
    if (orquestrador.turnoEmAndamento === null) {
      // Vai para o histórico que será arquivado, junto do turno que falhou.
      this.cancelarRetomada(orquestrador, "a conversa foi limpa");
    }
    // Sem espera entre limpar e arquivar: nenhum evento pode cair no meio.
    const evento = orquestrador.limparConversa(gerarId());
    const { registrado, gravacao } = repositorio.arquivarConversa(orquestrador, evento);
    publicador.publicar(orquestrador.id, registrado);
    await gravacao;
    return orquestrador;
  }

  /**
   * Aprova o Plano pendente e já abre o turno que o executa, na mesma sessão
   * do Claude Code — é ela que guarda o Plano da resposta anterior.
   *
   * `commitarAoFinal` põe na mensagem o pedido de commit local ao final, só
   * se a configuração libera commit e o nível tem terminal
   * (`edicao_e_comandos`); senão é ignorado.
   */
  async aprovarPlano(id: string, observacoes = "", commitarAoFinal = false): Promise<MensagemEnviada> {
    const orquestrador = this.buscar(id);
    const { configuracao } = orquestrador;
    const commitLiberado =
      configuracao.permiteCommitEPush("execucao") && configuracao.nivelDePermissao === "edicao_e_comandos";
    const texto = mensagemDeAprovacaoDoPlano(observacoes, commitarAoFinal && commitLiberado);
    // Conferido antes de aprovar: se o pedido de execução fosse recusado
    // depois, o Plano ficaria aprovado sem nada rodando.
    if (texto.length > TAMANHO_MAXIMO_DA_MENSAGEM) {
      throw new ErroDeOrquestracao(
        "dados_invalidos",
        `As observações ficaram longas demais: a mensagem de aprovação deve ter até ${TAMANHO_MAXIMO_DA_MENSAGEM} caracteres.`,
      );
    }

    this.publicar(orquestrador, orquestrador.aprovarPlano());
    // `enviarMensagem` grava o Orquestrador, já com a decisão registrada.
    return this.enviarMensagem(id, texto, [], "execucao");
  }

  async descartarPlano(id: string): Promise<void> {
    const orquestrador = this.buscar(id);
    this.publicar(orquestrador, orquestrador.descartarPlano());
    await this.dependencias.repositorio.salvar(orquestrador);
  }

  /**
   * Cancela o turno em andamento ou, sem turno, a retomada automática que
   * estiver agendada (ver ADR-36). Sem nenhum dos dois, `sem_turno_em_andamento`.
   */
  async cancelar(id: string): Promise<void> {
    const { repositorio, execucoes, agora } = this.dependencias;
    const orquestrador = this.buscar(id);
    const turno = orquestrador.turnoEmAndamento;

    if (turno === null) {
      if (this.cancelarRetomada(orquestrador, "o usuário cancelou")) {
        await repositorio.salvar(orquestrador);
        return;
      }
      throw new ErroDeOrquestracao(
        "sem_turno_em_andamento",
        `"${orquestrador.nome}" não está trabalhando em nenhum pedido.`,
      );
    }

    if (execucoes.cancelar(id, "usuario")) {
      // O turno é encerrado por `executar`, quando o motor terminar de parar.
      return;
    }

    // Turno marcado como em andamento sem processo por trás: só falta registrar.
    this.publicar(orquestrador, orquestrador.cancelarTurno(turno.id, agora()));
    await repositorio.salvar(orquestrador);
  }

  async remover(id: string): Promise<void> {
    const orquestrador = this.buscar(id);
    if (orquestrador.turnoEmAndamento !== null) {
      throw new ErroDeOrquestracao(
        "turno_em_andamento",
        `Cancele o pedido em andamento de "${orquestrador.nome}" antes de excluí-lo.`,
      );
    }
    // Sem evento: o histórico vai embora junto.
    this.retomadas.get(id)?.desmarcar();
    this.retomadas.delete(id);
    this.tentativas.delete(id);
    await this.dependencias.repositorio.remover(id);
    await this.dependencias.anexos.removerTodos(id);
  }

  /**
   * Ao subir o servidor, nenhum turno pode estar de fato rodando: os
   * processos morreram junto com o servidor anterior. Devolve quantos foram
   * marcados como interrompidos.
   *
   * A fila não anda aqui: um turno interrompido pausa a fila, e os pedidos
   * esperam o usuário mandar enviar.
   */
  async interromperTurnosPendentes(): Promise<number> {
    const { repositorio, agora } = this.dependencias;
    let interrompidos = 0;

    for (const orquestrador of repositorio.listar()) {
      const evento = orquestrador.interromperTurnoEmAndamento(agora());
      if (evento !== null) {
        this.publicar(orquestrador, evento);
        await repositorio.salvar(orquestrador);
        interrompidos += 1;
      }
    }
    return interrompidos;
  }

  /**
   * Ao subir o servidor, depois de `interromperTurnosPendentes`: volta a
   * marcar as retomadas automáticas gravadas antes do reinício (ver ADR-36),
   * com a tentativa e a causa de antes, e registra no log do turno. A que já
   * venceu retoma logo, uma a cada `ATRASO_DA_RETOMADA_APOS_REINICIO_MS`.
   * Com a autorrecuperação desligada, a retomada só sai, com o registro.
   * Devolve quantas foram reagendadas.
   */
  async reagendarRetomadasPendentes(): Promise<number> {
    const { repositorio, preferencias, agora } = this.dependencias;
    let reagendadas = 0;

    for (const orquestrador of repositorio.listar()) {
      const pendente = orquestrador.retomadaPendente;
      if (pendente === null) {
        continue;
      }
      try {
        const { causa, tentativa } = pendente;
        const de = maximoDeTentativas(causa);
        const turno = orquestrador.ultimoTurno;
        if (turno === null || turno.id !== pendente.deTurnoId || turno.emAndamento) {
          // Gravada para um turno que já não é o último: não há o que retomar.
          orquestrador.limparRetomada();
        } else if (!preferencias.atuais().autorrecuperacao) {
          orquestrador.limparRetomada();
          this.publicarRecuperacao(orquestrador, turno.id, "cancelada", {
            causa,
            tentativa,
            de,
            resumo: "retomada cancelada: a autorrecuperação está desligada (o app foi reiniciado durante a espera)",
            retomaEm: null,
          });
        } else {
          const restante = Date.parse(pendente.retomarEm) - agora().getTime();
          const espera = Math.max(restante, ATRASO_DA_RETOMADA_APOS_REINICIO_MS * (reagendadas + 1));
          const retomaEm = new Date(agora().getTime() + espera);
          const retomada: DadosDaRetomadaPendente = { ...pendente, retomarEm: retomaEm.toISOString() };
          orquestrador.agendarRetomada(retomada);
          this.tentativas.set(orquestrador.id, new Map([[causa, tentativa]]));
          this.publicarRecuperacao(orquestrador, turno.id, "aguardando", {
            causa,
            tentativa,
            de,
            resumo: `retomada reagendada após o reinício do app; retoma às ${formatarHora(retomaEm)}`,
            retomaEm: retomada.retomarEm,
          });
          this.marcarRetomada(orquestrador.id, retomada, turno.modo, espera);
          reagendadas += 1;
        }
        await repositorio.salvar(orquestrador);
      } catch (falha) {
        console.warn(
          `[orquestracao] Não foi possível reagendar a retomada do orquestrador ${orquestrador.id}:`,
          descreverErro(falha),
        );
      }
    }
    return reagendadas;
  }

  private async executar(
    orquestrador: Orquestrador,
    turnoId: string,
    sinal: AbortSignal,
    configuracaoDoTurno: ConfiguracaoDoOrquestrador,
    instrucoesDoTurno: Pick<PedidoDeTurno, "instrucoes" | "revogarInstrucoesAnteriores" | "subagentesProntos">,
  ): Promise<TurnoEncerrado | null> {
    const { motor, repositorio, anexos, worktrees, pastaDeArtefatos, agora } = this.dependencias;
    const turno = orquestrador.turnoEmAndamento;
    const anexosDoTurno = turno?.anexos ?? [];
    const modo = turno?.modo ?? "execucao";
    // Capturados no início: a conversa pode ser limpa (outra sessão) antes de a medição rodar.
    const sessaoDoTurno = orquestrador.sessaoId;
    const inicioDoTurno = turno?.iniciadoEm ?? agora();

    // Worktree isolado por turno: se a pasta for repo git com HEAD, o turno
    // roda numa árvore própria; senão, na própria pasta (degradação graciosa).
    const preparo = await worktrees.preparar(orquestrador.id, orquestrador.pastaDeTrabalho.caminho);
    const pastaDoTurno =
      preparo.worktree === null
        ? orquestrador.pastaDeTrabalho
        : PastaDeTrabalho.reconstituir(preparo.cwd);
    if (preparo.worktree !== null) {
      orquestrador.usarWorktree(preparo.worktree.branch, preparo.worktree.caminho);
    } else {
      orquestrador.limparWorktree();
    }
    await repositorio.salvar(orquestrador).catch((falha: unknown) =>
      console.error("[orquestracao] Falha ao gravar o worktree:", falha),
    );

    let resultado: ResultadoDoTurno | null = null;
    let erro: unknown = null;
    // O resumo do diagnóstico, se a vigia encerrou o turno por silêncio.
    const travamento: { resumo: string | null } = { resumo: null };
    const vigia = this.vigiarTurno(orquestrador, turnoId, sessaoDoTurno, pastaDoTurno.caminho, (resumo) => {
      travamento.resumo = resumo;
    });
    vigia?.ligar();

    try {
      resultado = await motor.executarTurno(
        {
          orquestradorId: orquestrador.id,
          sessaoId: orquestrador.sessaoId,
          sessaoIniciada: orquestrador.sessaoIniciada,
          texto: turno?.texto ?? "",
          configuracao: configuracaoDoTurno,
          modo,
          pastaDeTrabalho: pastaDoTurno,
          imagens: anexosDoTurno.map((anexo) => ({
            caminho: anexos.caminhoDe(orquestrador.id, anexo.arquivo),
            tipoDeMidia: anexo.tipoDeMidia,
          })),
          pastaDasImagens: anexosDoTurno.length > 0 ? anexos.pastaDe(orquestrador.id) : null,
          // Do Orquestrador, e não do worktree: os artefatos sobrevivem ao turno.
          pastaDeArtefatos: pastaDeArtefatos(orquestrador.id),
          ...instrucoesDoTurno,
          // Só agora, com o worktree preparado: `{{pasta}}` é a mesma pasta que vai ao motor.
          instrucoes: aplicarVariaveis(instrucoesDoTurno.instrucoes, {
            pasta: pastaDoTurno.caminho,
            nome: orquestrador.nome,
          }),
        },
        (evento) => {
          vigia?.registrarLinha();
          this.registrarDoMotor(orquestrador, turnoId, evento);
        },
        sinal,
        () => vigia?.registrarLinha(),
      );
    } catch (falha) {
      erro = falha;
    } finally {
      vigia?.desligar();
      this.dependencias.diagnosticador?.esquecer(orquestrador.id);
    }

    // Auto-cleanup no espírito do CLI: worktree sem alterações é removido;
    // com trabalho, fica e deixa de estar "ativo" até o próximo turno.
    if (preparo.worktree !== null) {
      const removido = await worktrees.concluir(orquestrador.id, orquestrador.pastaDeTrabalho.caminho);
      if (removido) {
        orquestrador.limparWorktree();
      } else {
        orquestrador.liberarWorktree();
      }
    }

    const fimDoTurno = agora();
    const encerrado: TurnoEncerrado = {
      turnoId,
      periodo: {
        sessaoId: sessaoDoTurno,
        // Onde o processo do Claude Code rodou: é por ela que ele organiza as transcrições.
        pastaDeTrabalho: pastaDoTurno.caminho,
        inicio: inicioDoTurno,
        fim: fimDoTurno,
      },
      modo,
      falha: null,
    };
    // Abortado pela vigia (ADR-36) é falha, não cancelamento: o turno pode ser retomado.
    const encerradoPorSilencio = sinal.aborted && sinal.reason === ABORTO_POR_SILENCIO;

    try {
      if (sinal.aborted && !encerradoPorSilencio) {
        this.publicar(orquestrador, orquestrador.cancelarTurno(turnoId, agora()));
      } else if (encerradoPorSilencio) {
        const diagnostico = travamento.resumo ?? "sem saída";
        encerrado.falha = {
          causa: "silencio",
          liberaEm: null,
          motivo: `O app encerrou o turno porque o Claude ficou sem dar notícias (${diagnostico}).`,
        };
        this.publicar(orquestrador, orquestrador.falharTurno(turnoId, encerrado.falha.motivo, agora()));
      } else if (resultado !== null && resultado.sucesso) {
        // Só a resposta final do Orquestrador: o texto dos Subagentes nunca
        // chega aqui. Os blocos de pergunta saem do texto e viram perguntas;
        // os inválidos só são descartados (o turno não tem avisos).
        const semPerguntas = separarPerguntasDoApp(resultado.resposta);
        for (const aviso of semPerguntas.avisos) {
          console.warn(`[orquestracao] Turno ${turnoId}: ${aviso}`);
        }
        // O marcador sai sempre da resposta; só vira Plano pendente num turno
        // de execução (no planejamento, o turno já termina em Plano).
        const { resposta, planoProposto } = separarPropostaDePlano(semPerguntas.texto);
        const planoPendente = planoProposto && configuracaoDoTurno.propoePlanoEmPedidosGrandes(modo);
        this.publicar(
          orquestrador,
          orquestrador.concluirTurno(turnoId, resposta, resultado.uso, agora(), planoPendente, semPerguntas.perguntas),
        );
      } else {
        encerrado.falha =
          resultado !== null && !resultado.sucesso
            ? { causa: resultado.causa ?? "outro", liberaEm: resultado.liberaEm ?? null, motivo: resultado.motivo }
            : { causa: "outro", liberaEm: null, motivo: descreverErro(erro) };
        this.publicar(orquestrador, orquestrador.falharTurno(turnoId, encerrado.falha.motivo, agora()));
      }
      await repositorio.salvar(orquestrador);
    } catch (falha) {
      console.error(`[orquestracao] Não foi possível encerrar o turno ${turnoId}:`, falha);
      return null;
    }
    return encerrado;
  }

  /**
   * A vigia do turno (ver ADR-36), ou `null` sem diagnosticador. Durante o
   * silêncio publica o diagnóstico como sinal de vida; se o turno travar e a
   * autorrecuperação estiver ligada, publica a etapa "encerrado" e aborta a
   * execução com o motivo "silencio".
   */
  private vigiarTurno(
    orquestrador: Orquestrador,
    turnoId: string,
    sessaoId: string,
    pastaDoTurno: string,
    aoTravar: (resumo: string) => void,
  ): VigiaDoTurno | null {
    const { diagnosticador, agendador, preferencias, publicador, execucoes, agora } = this.dependencias;
    if (diagnosticador === undefined) {
      return null;
    }
    return new VigiaDoTurno({
      alvo: { orquestradorId: orquestrador.id, sessaoId, pastaDoTurno },
      diagnosticador,
      agendador: agendador ?? agendadorDoRelogio,
      agora,
      podeAgir: () => preferencias.atuais().autorrecuperacao,
      aoDiagnosticar: (diagnostico) =>
        publicador.sinalizar(orquestrador.id, {
          turnoId,
          em: agora().toISOString(),
          tokensPensando: 0,
          diagnostico,
        }),
      aoTravar: (resumo) => {
        aoTravar(resumo);
        const de = maximoDeTentativas("silencio");
        this.publicarRecuperacao(orquestrador, turnoId, "encerrado", {
          causa: "silencio",
          // A tentativa que vem a seguir; se já se esgotaram, a desistência vem depois do fim do turno.
          tentativa: Math.min(this.tentativasFeitas(orquestrador.id, "silencio") + 1, de),
          de,
          resumo,
          retomaEm: null,
        });
        execucoes.cancelar(orquestrador.id, ABORTO_POR_SILENCIO);
      },
    });
  }

  private tentativasFeitas(orquestradorId: string, causa: CausaDaRecuperacao): number {
    return this.tentativas.get(orquestradorId)?.get(causa) ?? 0;
  }

  /**
   * Terminado o turno (e já fora do `ControleDeExecucoes`), decide a
   * autorrecuperação: um turno concluído zera as tentativas; um que falhou
   * por silêncio, limite de uso, sobrecarga ou rede, com a preferência
   * ligada, ganha uma retomada agendada, ou a desistência se as tentativas
   * da causa se esgotaram. Nunca lança.
   */
  private decidirRecuperacao(orquestradorId: string, encerrado: TurnoEncerrado): void {
    const { repositorio, preferencias, agora } = this.dependencias;
    try {
      const { falha } = encerrado;
      if (falha === null) {
        this.tentativas.delete(orquestradorId);
        return;
      }
      if (!ehRecuperavel(falha.causa) || !preferencias.atuais().autorrecuperacao) {
        return;
      }
      const orquestrador = repositorio.buscarPorId(orquestradorId);
      // Excluído, ou o usuário já abriu outro turno: não há o que retomar.
      if (orquestrador === null || orquestrador.ultimoTurno?.id !== encerrado.turnoId) {
        return;
      }

      const causa = falha.causa;
      const de = maximoDeTentativas(causa);
      const tentativa = this.tentativasFeitas(orquestradorId, causa) + 1;
      if (tentativa > de) {
        this.tentativas.delete(orquestradorId);
        this.publicarRecuperacao(orquestrador, encerrado.turnoId, "desistiu", {
          causa,
          tentativa: de,
          de,
          resumo:
            `O app desistiu de retomar sozinho: ${descreverCausa(causa)}. ` +
            `Retomou a mesma sessão ${de} ${de === 1 ? "vez" : "vezes"}, ${descreverEsperas(causa)}, ` +
            `e o turno falhou de novo. Última falha: ${falha.motivo}`,
          retomaEm: null,
        });
        return;
      }

      const contagem = this.tentativas.get(orquestradorId) ?? new Map<CausaDaRecuperacao, number>();
      contagem.set(causa, tentativa);
      this.tentativas.set(orquestradorId, contagem);

      const espera = esperaAntesDaTentativa(causa, tentativa, falha.liberaEm, agora());
      const retomaEm = new Date(agora().getTime() + espera);
      this.publicarRecuperacao(orquestrador, encerrado.turnoId, "aguardando", {
        causa,
        tentativa,
        de,
        resumo: resumoDaEspera(causa, falha.liberaEm, retomaEm),
        retomaEm: retomaEm.toISOString(),
      });
      const retomada: DadosDaRetomadaPendente = {
        deTurnoId: encerrado.turnoId,
        causa,
        tentativa,
        retomarEm: retomaEm.toISOString(),
      };
      // Gravada para sobreviver a um reinício durante a espera.
      orquestrador.agendarRetomada(retomada);
      repositorio
        .salvar(orquestrador)
        .catch((erro: unknown) => console.error("[orquestracao] Falha ao gravar a retomada agendada:", erro));
      this.marcarRetomada(orquestradorId, retomada, encerrado.modo, espera);
    } catch (falha) {
      console.warn(
        `[orquestracao] Não foi possível decidir a autorrecuperação do turno ${encerrado.turnoId}:`,
        descreverErro(falha),
      );
    }
  }

  /**
   * Chegou a hora: publica "retomando" no turno que falhou e abre outro na
   * mesma sessão, pedindo ao Claude para continuar de onde parou. Nada na
   * pasta de trabalho é tocado. Nunca rejeita.
   */
  private async retomar(orquestradorId: string): Promise<void> {
    const agendada = this.retomadas.get(orquestradorId);
    if (agendada === undefined) {
      return;
    }
    this.retomadas.delete(orquestradorId);
    const { repositorio } = this.dependencias;
    const orquestrador = repositorio.buscarPorId(orquestradorId);
    if (orquestrador === null) {
      return;
    }
    // O turno que abre também a limparia; fica limpa mesmo se ele for recusado.
    orquestrador.limparRetomada();
    const { turnoId, causa, tentativa, de, modo } = agendada;
    try {
      this.publicarRecuperacao(orquestrador, turnoId, "retomando", {
        causa,
        tentativa,
        de,
        resumo: `retomando a mesma sessão (tentativa ${tentativa} de ${de})`,
        retomaEm: null,
      });
      await this.iniciarTurno(
        orquestrador,
        mensagemDeRetomada(causa, orquestrador.worktree !== null),
        [],
        modo,
        null,
        { deTurnoId: turnoId, tentativa },
      );
    } catch (falha) {
      console.warn(
        `[orquestracao] Não foi possível retomar o turno ${turnoId} do orquestrador ${orquestradorId}:`,
        descreverErro(falha),
      );
      this.tentativas.delete(orquestradorId);
      repositorio
        .salvar(orquestrador)
        .catch((erro: unknown) => console.error("[orquestracao] Falha ao gravar a retomada desfeita:", erro));
      try {
        this.publicarRecuperacao(orquestrador, turnoId, "desistiu", {
          causa,
          tentativa,
          de,
          resumo: `O app não conseguiu retomar o turno (${descreverCausa(causa)}): ${descreverErro(falha)}`,
          retomaEm: null,
        });
      } catch {
        // Sem histórico onde registrar: o aviso acima basta.
      }
    }
  }

  /** Marca no relógio a retomada já registrada no agregado. */
  private marcarRetomada(
    orquestradorId: string,
    retomada: DadosDaRetomadaPendente,
    modo: ModoDoTurno,
    espera: number,
  ): void {
    const desmarcar = (this.dependencias.agendador ?? agendadorDoRelogio).agendar(espera, () => {
      void this.retomar(orquestradorId);
    });
    this.retomadas.set(orquestradorId, {
      turnoId: retomada.deTurnoId,
      causa: retomada.causa,
      tentativa: retomada.tentativa,
      de: maximoDeTentativas(retomada.causa),
      modo,
      desmarcar,
    });
  }

  /**
   * Cancela a retomada agendada do Orquestrador, se houver, e publica
   * "cancelada" com o porquê. As tentativas zeram: o usuário assumiu. Tira a
   * retomada do agregado; gravar fica com quem chama.
   */
  private cancelarRetomada(orquestrador: Orquestrador, porque: string): boolean {
    const agendada = this.retomadas.get(orquestrador.id);
    if (agendada === undefined) {
      return false;
    }
    agendada.desmarcar();
    this.retomadas.delete(orquestrador.id);
    this.tentativas.delete(orquestrador.id);
    orquestrador.limparRetomada();
    this.publicarRecuperacao(orquestrador, agendada.turnoId, "cancelada", {
      causa: agendada.causa,
      tentativa: agendada.tentativa,
      de: agendada.de,
      resumo: `retomada cancelada: ${porque}`,
      retomaEm: null,
    });
    return true;
  }

  private publicarRecuperacao(
    orquestrador: Orquestrador,
    turnoId: string,
    etapa: EtapaDaRecuperacao,
    dados: { causa: CausaDaRecuperacao; tentativa: number; de: number; resumo: string; retomaEm: string | null },
  ): void {
    this.publicar(orquestrador, { tipo: "recuperacao_do_turno", turnoId, etapa, ...dados });
  }

  /**
   * A fila anda sozinha: terminado o turno `turnoId`, envia o primeiro pedido
   * dela se o agregado deixar (ver `proximoDaFilaApos`). Se o usuário já
   * iniciou outro turno, nada sai — e o pedido segue na fila. Nunca rejeita:
   * um erro aqui só vira aviso no log, sem afetar o turno que terminou.
   */
  private async enviarProximoDaFila(orquestradorId: string, turnoId: string): Promise<void> {
    try {
      // Excluído enquanto o turno terminava: nada a enviar.
      const orquestrador = this.dependencias.repositorio.buscarPorId(orquestradorId);
      const proximo = orquestrador?.proximoDaFilaApos(turnoId) ?? null;
      if (proximo === null) {
        return;
      }
      await this.enviarDaFila(orquestradorId, proximo.id);
    } catch (falha) {
      console.warn(
        `[orquestracao] Não foi possível enviar sozinho o próximo pedido da fila do orquestrador ${orquestradorId}:`,
        descreverErro(falha),
      );
    }
  }

  /**
   * Lê quanto o turno gastou e registra o consumo. Nunca afeta o turno: sem
   * medidor, sem transcrição ou com erro na leitura, não há evento.
   */
  private async medirConsumo(orquestrador: Orquestrador, encerrado: TurnoEncerrado): Promise<void> {
    const { medidor, repositorio } = this.dependencias;
    if (medidor === undefined) {
      return;
    }
    try {
      const consumo = await medidor.medirTurno(encerrado.periodo);
      // Excluído enquanto a medição rodava: nada a registrar.
      if (consumo === null || repositorio.buscarPorId(orquestrador.id) === null) {
        return;
      }
      // Falha se a conversa foi limpa no meio (o turno já não é desta conversa).
      this.publicar(orquestrador, orquestrador.registrarConsumoDoTurno(encerrado.turnoId, consumo));
    } catch (falha) {
      console.warn(
        `[orquestracao] Não foi possível medir o consumo do turno ${encerrado.turnoId}:`,
        descreverErro(falha),
      );
    }
  }

  private async esforcoHerdado(consulta: {
    modelo: ModeloClaude;
    pastaDoProjeto: string;
    modeloReal: string | null;
  }): Promise<EsforcoHerdado | null> {
    const { esforcoDaMaquina } = this.dependencias;
    if (esforcoDaMaquina === undefined) {
      return null;
    }
    try {
      return await esforcoDaMaquina.herdadoPara(consulta);
    } catch (falha) {
      // Só um aviso na tela depende disso: melhor não avisar do que quebrar.
      console.warn(
        `[orquestracao] Não foi possível ler o esforço herdado do Claude Code para "${consulta.modelo}":`,
        descreverErro(falha),
      );
      return null;
    }
  }

  /** O modelo que o Orquestrador usou de fato no último turno medido desta conversa. */
  private ultimoModeloMedido(orquestradorId: string): string | null {
    const eventos = this.dependencias.repositorio.lerEventos(orquestradorId, 0);
    for (let indice = eventos.length - 1; indice >= 0; indice -= 1) {
      const evento = eventos[indice];
      if (evento?.tipo === "consumo_do_turno_medido") {
        return evento.consumo.modeloDoPrincipal;
      }
    }
    return null;
  }

  private registrarDoMotor(orquestrador: Orquestrador, turnoId: string, evento: EventoDoMotor): void {
    if (evento.tipo === "sinal_de_vida") {
      // Não muda o turno nem vai para o histórico: só avisa a tela que o
      // Claude segue raciocinando.
      this.dependencias.publicador.sinalizar(orquestrador.id, {
        turnoId,
        em: this.dependencias.agora().toISOString(),
        tokensPensando: evento.tokensPensando,
      });
      return;
    }

    try {
      this.publicar(orquestrador, orquestrador.registrarDoMotor(turnoId, evento));
    } catch (erro) {
      // Só acontece com eventos que chegam depois de o turno ter sido encerrado.
      console.warn(`[orquestracao] Evento "${evento.tipo}" ignorado:`, descreverErro(erro));
      return;
    }

    if (evento.tipo === "sessao_iniciada") {
      // Gravado já, e não só no fim do turno: se o servidor cair no meio, o
      // próximo turno precisa saber que deve retomar a sessão, não criar outra.
      this.dependencias.repositorio
        .salvar(orquestrador)
        .catch((erro: unknown) => console.error("[orquestracao] Falha ao gravar a sessão:", erro));
    }
  }

  private publicar(orquestrador: Orquestrador, evento: EventoDeOrquestracao): void {
    const registrado = this.dependencias.repositorio.anexarEvento(orquestrador.id, evento);
    this.dependencias.publicador.publicar(orquestrador.id, registrado);
  }

  private buscar(id: string): Orquestrador {
    const orquestrador = this.dependencias.repositorio.buscarPorId(id);
    if (orquestrador === null) {
      throw new ErroDeOrquestracao("nao_encontrado", "Orquestrador não encontrado.");
    }
    return orquestrador;
  }
}
