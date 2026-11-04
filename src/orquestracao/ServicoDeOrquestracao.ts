import { Anexo } from "./Anexo";
import { ArmazemDeAnexos } from "./ArmazemDeAnexos";
import {
  AlteracoesDaConfiguracao,
  ConfiguracaoDoOrquestrador,
  DadosDaConfiguracao,
} from "./ConfiguracaoDoOrquestrador";
import { ControleDeExecucoes, PublicadorDeEventos } from "./ControleDeExecucoes";
import { ErroDeOrquestracao } from "./ErroDeOrquestracao";
import { EsforcoDaMaquina } from "./EsforcoDaMaquina";
import { EsforcoHerdado } from "./EsforcoHerdado";
import { EventoDeOrquestracao, EventoDoMotor } from "./EventoDeOrquestracao";
import { mensagemDeAprovacaoDoPlano, separarPropostaDePlano } from "./InstrucoesDoOrquestrador";
import { MedidorDeConsumo, PeriodoDoTurno } from "./MedidorDeConsumo";
import { ModeloClaude } from "./ModeloClaude";
import { ModoDoTurno } from "./ModoDoTurno";
import { MotorDeAgentes, ResultadoDoTurno } from "./MotorDeAgentes";
import { Orquestrador, TAMANHO_MAXIMO_DA_MENSAGEM } from "./Orquestrador";
import { PastaDeTrabalho } from "./PastaDeTrabalho";
import { predefinicaoPorNome } from "./PredefinicaoDeConfiguracao";
import { GerenciadorDeWorktrees } from "./PreparoDeWorktree";
import { RepositorioDeOrquestradores } from "./RepositorioDeOrquestradores";

export interface DependenciasDoServico {
  repositorio: RepositorioDeOrquestradores;
  motor: MotorDeAgentes;
  execucoes: ControleDeExecucoes;
  publicador: PublicadorDeEventos;
  anexos: ArmazemDeAnexos;
  worktrees: GerenciadorDeWorktrees;
  gerarId: () => string;
  agora: () => Date;
  /** Mede o gasto de cada turno ao fim dele. Sem medidor, nenhum consumo é registrado. */
  medidor?: MedidorDeConsumo | undefined;
  /** Lê o esforço que o Claude Code da máquina usa no "Padrão". Sem ele, nada é herdado. */
  esforcoDaMaquina?: EsforcoDaMaquina | undefined;
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

/** O que a medição precisa saber do turno que acabou de terminar. */
interface TurnoEncerrado {
  turnoId: string;
  periodo: PeriodoDoTurno;
}

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
}

function descreverErro(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

/**
 * Casos de uso da orquestração: criar Orquestradores, conversar com eles,
 * decidir os Planos que entregarem, limpar a conversa e cancelar o que
 * estiverem fazendo.
 *
 * Não guarda estado: os Orquestradores vêm do repositório, e os turnos em
 * execução ficam no `ControleDeExecucoes`.
 */
export class ServicoDeOrquestracao {
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

  async alterarConfiguracao(id: string, alteracoes: AlteracoesDaConfiguracao): Promise<Orquestrador> {
    const orquestrador = this.buscar(id);
    this.publicar(orquestrador, orquestrador.alterarConfiguracao(alteracoes));
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
    const { repositorio, execucoes, anexos, gerarId, agora } = this.dependencias;
    const orquestrador = this.buscar(id);
    const turnoId = gerarId();

    const anexosDoTurno = imagens.map((imagem) =>
      Anexo.de({
        id: gerarId(),
        nome: imagem.nome,
        tipoDeMidia: imagem.tipoDeMidia,
        tamanhoEmBytes: imagem.conteudo.byteLength,
      }),
    );
    const inicio = orquestrador.iniciarTurno(turnoId, texto, agora(), anexosDoTurno, modo);
    // A mesma do evento `turno_iniciado`: o turno segue com ela até o fim,
    // mesmo que o usuário altere a configuração enquanto ele roda.
    const configuracaoDoTurno = orquestrador.configuracao;
    // O sinal nasce antes de qualquer espera: um cancelamento que chegue
    // enquanto o turno é gravado já encontra a execução registrada.
    const sinal = execucoes.iniciar(orquestrador.id);
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

    const execucao = this.executar(orquestrador, turnoId, sinal, configuracaoDoTurno).finally(() =>
      execucoes.encerrar(orquestrador.id),
    );
    const conclusao = execucao.then(() => undefined);
    // Em segundo plano, depois do fim do turno: não segura a resposta nem o
    // próximo pedido, e o evento do consumo sempre vem depois do de fim.
    const medicao = execucao
      .then((encerrado) => (encerrado === null ? undefined : this.medirConsumo(orquestrador, encerrado)))
      .catch((falha: unknown) =>
        console.warn(`[orquestracao] Não foi possível medir o consumo do turno ${turnoId}:`, descreverErro(falha)),
      );
    return { turnoId, conclusao, medicao };
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
   */
  async aprovarPlano(id: string, observacoes = ""): Promise<MensagemEnviada> {
    const orquestrador = this.buscar(id);
    const texto = mensagemDeAprovacaoDoPlano(observacoes);
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

  async cancelar(id: string): Promise<void> {
    const { repositorio, execucoes, agora } = this.dependencias;
    const orquestrador = this.buscar(id);
    const turno = orquestrador.turnoEmAndamento;

    if (turno === null) {
      throw new ErroDeOrquestracao(
        "sem_turno_em_andamento",
        `"${orquestrador.nome}" não está trabalhando em nenhum pedido.`,
      );
    }

    if (execucoes.cancelar(id)) {
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
    await this.dependencias.repositorio.remover(id);
    await this.dependencias.anexos.removerTodos(id);
  }

  /**
   * Ao subir o servidor, nenhum turno pode estar de fato rodando: os
   * processos morreram junto com o servidor anterior. Devolve quantos foram
   * marcados como interrompidos.
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

  private async executar(
    orquestrador: Orquestrador,
    turnoId: string,
    sinal: AbortSignal,
    configuracaoDoTurno: ConfiguracaoDoOrquestrador,
  ): Promise<TurnoEncerrado | null> {
    const { motor, repositorio, anexos, worktrees, agora } = this.dependencias;
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
        },
        (evento) => this.registrarDoMotor(orquestrador, turnoId, evento),
        sinal,
      );
    } catch (falha) {
      erro = falha;
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
    };

    try {
      if (sinal.aborted) {
        this.publicar(orquestrador, orquestrador.cancelarTurno(turnoId, agora()));
      } else if (resultado !== null && resultado.sucesso) {
        // O marcador sai sempre da resposta; só vira Plano pendente se a
        // opção estava ligada quando o turno começou e o turno é de execução.
        const { resposta, planoProposto } = separarPropostaDePlano(resultado.resposta);
        const planoPendente = planoProposto && configuracaoDoTurno.propoePlanoEmPedidosGrandes(modo);
        this.publicar(
          orquestrador,
          orquestrador.concluirTurno(turnoId, resposta, resultado.uso, agora(), planoPendente),
        );
      } else {
        const motivo = resultado !== null && !resultado.sucesso ? resultado.motivo : descreverErro(erro);
        this.publicar(orquestrador, orquestrador.falharTurno(turnoId, motivo, agora()));
      }
      await repositorio.salvar(orquestrador);
    } catch (falha) {
      console.error(`[orquestracao] Não foi possível encerrar o turno ${turnoId}:`, falha);
      return null;
    }
    return encerrado;
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
