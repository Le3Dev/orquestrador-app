import { ErroDeOrquestracao } from "../orquestracao/ErroDeOrquestracao";
import { EventoRegistrado } from "../orquestracao/EventoDeOrquestracao";
import { ErroDeFilaCheia } from "../orquestracao/Orquestrador";
import { RepositorioDeOrquestradores } from "../orquestracao/RepositorioDeOrquestradores";
import { ServicoDeOrquestracao } from "../orquestracao/ServicoDeOrquestracao";
import { ExecutorDePedidos, PedidoDaRotina, ResultadoDoPedidoDaRotina } from "../rotinas/ExecutorDePedidos";
import { TEMPORIZADOR_DO_SISTEMA, Temporizador } from "../rotinas/Temporizador";
import { CanalDeEventos } from "./sse/CanalDeEventos";

/** O quanto a resposta de uma etapa guarda do que o Orquestrador respondeu (o resto fica na conversa dele). */
export const TAMANHO_MAXIMO_DA_RESPOSTA_DA_ETAPA = 4_000;

/**
 * Quanto esperar, depois de algo que pode mudar o rumo do pedido, antes de
 * concluir que não vem mais nada: depois de um turno falhar, por um sinal de
 * que o app continua o pedido sozinho (a reserva de motor, a retomada
 * automática); depois de um turno parar a fila, ou de o pedido entrar nela,
 * por ela andar. A decisão do app sai logo depois do fim do turno.
 */
export const ESPERA_DA_DECISAO_DO_APP_EM_MS = 2_000;

const MOTIVO_DO_CANCELAMENTO = "A rotina foi cancelada.";

const ORQUESTRADOR_INEXISTENTE: ResultadoDoPedidoDaRotina = {
  situacao: "falhou",
  motivo: "O orquestrador escolhido não existe mais.",
};

type Servico = Pick<
  ServicoDeOrquestracao,
  "enviarMensagem" | "enfileirarPedido" | "enviarDaFila" | "removerDaFila" | "aprovarPlano" | "descartarPlano" | "cancelar"
>;

export interface DependenciasDoExecutorDePedidos {
  servico: Servico;
  repositorio: Pick<RepositorioDeOrquestradores, "buscarPorId">;
  /** Os eventos de cada Orquestrador: é por onde se sabe que o turno de um pedido terminou. */
  canal: Pick<CanalDeEventos, "assinar">;
  /** Padrão: `setTimeout` de verdade. */
  temporizador?: Temporizador | undefined;
  /** Padrão: `ESPERA_DA_DECISAO_DO_APP_EM_MS`. */
  esperaDaDecisaoDoAppEmMs?: number | undefined;
}

/** Onde o pedido está depois de enviado: num turno que começou na hora, ou na fila de um Orquestrador ocupado. */
type Inicio = { tipo: "turno"; turnoId: string } | { tipo: "fila"; pedidoId: string };

/** Resumo da resposta para a etapa: o histórico completo continua na conversa do Orquestrador. */
function resumirResposta(resposta: string): string {
  const texto = resposta.trim();
  return texto.length <= TAMANHO_MAXIMO_DA_RESPOSTA_DA_ETAPA
    ? texto
    : `${texto.slice(0, TAMANHO_MAXIMO_DA_RESPOSTA_DA_ETAPA).trimEnd()}\n… (resposta cortada; o texto inteiro está na conversa do orquestrador)`;
}

function descreverErro(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

/**
 * O fim de um turno que, para a fila do Orquestrador, a faz parar: o pedido
 * seguinte só sai quando o usuário manda (ver `proximoDaFilaApos`).
 */
function pausaAFila(evento: EventoRegistrado): boolean {
  switch (evento.tipo) {
    case "turno_cancelado":
    case "turno_falhou":
    case "turno_interrompido":
      return true;
    case "turno_concluido":
      return evento.planoPendente;
    case "recuperacao_do_turno":
      return evento.etapa === "cancelada" || evento.etapa === "desistiu";
    default:
      return false;
  }
}

/**
 * Acompanha UM pedido de uma Rotina num Orquestrador, do envio ao fim do
 * turno, pelos eventos do Orquestrador. Segue o pedido mesmo quando o app o
 * continua em outro turno: a reserva de motor (`motor_trocado`) e a retomada
 * automática (`recuperacao_do_turno`). Resolve uma vez, com o resultado.
 */
class AcompanhamentoDoPedido {
  readonly resultado: Promise<ResultadoDoPedidoDaRotina>;
  private resolver: (resultado: ResultadoDoPedidoDaRotina) => void = () => undefined;
  private encerrado = false;
  private readonly cancelarAssinatura: () => void;

  /** Os fins de turno vistos, por turno: o evento pode chegar antes de se saber qual é o turno do pedido. */
  private readonly fins = new Map<string, EventoRegistrado>();
  private turnoAtual: string | null = null;

  private pedidoNaFila: string | null = null;
  private saiuDaFila = false;
  /** Um turno de outro pedido terminou de um jeito que para a fila. */
  private filaParouPorFalha = false;
  /** O próprio executor está tirando o pedido da fila: o evento disso não é o usuário cancelando. */
  private retirandoSozinho = false;

  /** O turno que falhou e o app talvez continue (reserva ou retomada); `continuacao` diz o que já se viu. */
  private emAnalise: {
    turnoId: string;
    motivo: string;
    continuacao: "nada" | "troca" | "retomada" | "espera";
  } | null = null;
  private cancelarEspera: () => void = () => undefined;

  constructor(
    orquestradorId: string,
    canal: Pick<CanalDeEventos, "assinar">,
    private readonly temporizador: Temporizador,
    private readonly esperaEmMs: number,
    /** Decide o que fazer com um pedido que parece preso na fila; `null`: nada a fazer (ainda). */
    private readonly aoConferirAFila: (viuAFilaParar: boolean) => Promise<ResultadoDoPedidoDaRotina | null>,
  ) {
    this.resultado = new Promise((resolver) => {
      this.resolver = resolver;
    });
    this.cancelarAssinatura = canal.assinar(orquestradorId, {
      aoEvento: (evento) => this.registrar(evento),
      aoSinal: () => undefined,
    });
  }

  /** O pedido ainda espera na fila (ainda não virou turno), com o id dele. */
  get aindaNaFila(): string | null {
    return this.pedidoNaFila !== null && !this.saiuDaFila ? this.pedidoNaFila : null;
  }

  /** O turno em que o pedido está agora, se já se sabe. */
  get turnoEmCurso(): string | null {
    return this.turnoAtual;
  }

  /** O turno do pedido começou na hora: acompanha-o. */
  seguirTurno(turnoId: string): void {
    this.turnoAtual = turnoId;
    this.reavaliar();
  }

  /** O pedido ficou na fila: espera ele sair e o turno dele terminar. */
  seguirPedidoDaFila(pedidoId: string): void {
    this.pedidoNaFila = pedidoId;
    // Se o turno que o segurava já acabou, nada vai tirá-lo da fila: confere daqui a pouco.
    this.conferirAFilaDepoisDeUmaEspera();
  }

  /** Tira o pedido da fila por conta do executor, sem o evento disso encerrar a etapa como "cancelada pelo usuário". */
  async retirarDaFila(retirar: () => Promise<void>): Promise<void> {
    this.retirandoSozinho = true;
    try {
      await retirar();
    } finally {
      this.retirandoSozinho = false;
    }
  }

  finalizar(resultado: ResultadoDoPedidoDaRotina): void {
    if (this.encerrado) {
      return;
    }
    this.encerrado = true;
    this.cancelarEspera();
    this.cancelarAssinatura();
    this.resolver(resultado);
  }

  private conferirAFilaDepoisDeUmaEspera(): void {
    if (this.aindaNaFila === null) {
      return;
    }
    this.cancelarEspera();
    this.cancelarEspera = this.temporizador.agendar(() => {
      void this.conferirAFila();
    }, this.esperaEmMs);
  }

  private async conferirAFila(): Promise<void> {
    if (this.encerrado || this.aindaNaFila === null) {
      return;
    }
    const resultado = await this.aoConferirAFila(this.filaParouPorFalha);
    if (resultado !== null) {
      this.finalizar(resultado);
    }
  }

  private registrar(evento: EventoRegistrado): void {
    if (this.encerrado) {
      return;
    }
    switch (evento.tipo) {
      case "pedido_retirado_da_fila":
        if (evento.pedidoId === this.pedidoNaFila) {
          if (evento.motivo === "removido") {
            if (this.retirandoSozinho) {
              return;
            }
            this.finalizar({ situacao: "cancelado", motivo: "O pedido foi tirado da fila do orquestrador antes de rodar." });
          } else {
            this.saiuDaFila = true;
          }
        }
        return;
      case "turno_iniciado":
        this.aoIniciarTurno(evento.turnoId, evento.retomada?.deTurnoId ?? null);
        return;
      case "motor_trocado":
        if (this.emAnalise?.turnoId === evento.turnoId) {
          this.emAnalise.continuacao = "troca";
          this.cancelarEspera();
        }
        return;
      case "recuperacao_do_turno":
        this.aoRecuperarTurno(evento);
        return;
      case "turno_concluido":
      case "turno_cancelado":
      case "turno_falhou":
      case "turno_interrompido":
        this.fins.set(evento.turnoId, evento);
        if (evento.turnoId === this.turnoAtual) {
          this.reavaliar();
        } else {
          this.aoTerminarOutroTurno(evento);
        }
        return;
      default:
        return;
    }
  }

  private aoIniciarTurno(turnoId: string, retomadaDe: string | null): void {
    if (this.pedidoNaFila !== null && this.saiuDaFila && this.turnoAtual === null) {
      // O pedido saiu da fila: o turno que começa logo depois é o dele.
      this.turnoAtual = turnoId;
      this.reavaliar();
      return;
    }
    const analise = this.emAnalise;
    if (analise !== null && (analise.continuacao === "troca" || retomadaDe === analise.turnoId)) {
      // O app continuou o pedido: outro motor, ou a retomada da mesma sessão.
      this.emAnalise = null;
      this.cancelarEspera();
      this.turnoAtual = turnoId;
      this.reavaliar();
    }
  }

  private aoRecuperarTurno(evento: Extract<EventoRegistrado, { tipo: "recuperacao_do_turno" }>): void {
    const analise = this.emAnalise;
    if (analise === null || analise.turnoId !== evento.turnoId) {
      this.aoTerminarOutroTurno(evento);
      return;
    }
    switch (evento.etapa) {
      case "aguardando":
        // O app marcou a retomada: o pedido continua quando ela vier.
        analise.continuacao = "espera";
        this.cancelarEspera();
        return;
      case "retomando":
        analise.continuacao = "retomada";
        return;
      case "cancelada":
      case "desistiu":
        this.finalizar({ situacao: "falhou", motivo: evento.etapa === "desistiu" ? evento.resumo : analise.motivo });
        return;
      default:
        return;
    }
  }

  /** Um turno que não é do pedido terminou: se parou a fila com o pedido nela, confere se ele ficou preso. */
  private aoTerminarOutroTurno(evento: EventoRegistrado): void {
    if (this.aindaNaFila === null || !pausaAFila(evento)) {
      return;
    }
    this.filaParouPorFalha = true;
    this.conferirAFilaDepoisDeUmaEspera();
  }

  /** Olha o fim do turno do pedido, se já houve. */
  private reavaliar(): void {
    if (this.encerrado || this.turnoAtual === null) {
      return;
    }
    const fim = this.fins.get(this.turnoAtual);
    if (fim === undefined) {
      return;
    }
    switch (fim.tipo) {
      case "turno_concluido":
        this.finalizar(
          fim.planoPendente
            ? { situacao: "plano_para_aprovacao", plano: resumirResposta(fim.resposta) }
            : { situacao: "concluido", resposta: resumirResposta(fim.resposta) },
        );
        return;
      case "turno_cancelado":
        this.finalizar({ situacao: "cancelado", motivo: "O pedido foi cancelado no orquestrador." });
        return;
      case "turno_interrompido":
        this.finalizar({ situacao: "falhou", motivo: "O servidor reiniciou durante o pedido." });
        return;
      case "turno_falhou":
        this.analisarFalha(fim.turnoId, fim.motivo);
        return;
      default:
        return;
    }
  }

  /**
   * O turno falhou. O app pode continuar o pedido (outro motor, retomada): a
   * decisão sai logo depois do fim do turno e chega como evento. Sem sinal
   * nenhum a tempo, a etapa falhou.
   */
  private analisarFalha(turnoId: string, motivo: string): void {
    this.emAnalise = { turnoId, motivo, continuacao: "nada" };
    this.cancelarEspera();
    this.cancelarEspera = this.temporizador.agendar(() => {
      const analise = this.emAnalise;
      if (!this.encerrado && analise !== null && analise.turnoId === turnoId && analise.continuacao === "nada") {
        this.finalizar({ situacao: "falhou", motivo });
      }
    }, this.esperaEmMs);
  }
}

/**
 * Implementa a porta `ExecutorDePedidos` das Rotinas sobre o
 * `ServicoDeOrquestracao`: é a única ligação das Rotinas com a orquestração,
 * e fica na camada de composição para nenhum dos dois contextos conhecer o outro.
 *
 * - Orquestrador livre: o pedido vira um turno na hora (`enviarMensagem`).
 * - Orquestrador ocupado: o pedido entra na fila dele (até 10; cheia, a etapa
 *   falha com a mensagem da fila) e a etapa espera ele sair e terminar. Se a
 *   fila parar (o turno anterior falhou, foi cancelado ou deixou um plano para
 *   aprovar), o pedido sai da fila e a etapa falha: mandá-lo assim mesmo
 *   passaria por cima de uma decisão do usuário.
 * - O fim é lido dos eventos do Orquestrador (`turno_concluido`, `turno_falhou`
 *   etc.), seguindo o pedido pela reserva de motor e pela retomada automática.
 *   Um turno que termina com plano pendente vira `plano_para_aprovacao`.
 * - O `sinal` aborta a espera: o pedido na fila sai dela e o turno em andamento
 *   é cancelado.
 */
export class ExecutorDePedidosDaOrquestracao implements ExecutorDePedidos {
  private readonly temporizador: Temporizador;
  private readonly esperaEmMs: number;

  constructor(private readonly dependencias: DependenciasDoExecutorDePedidos) {
    this.temporizador = dependencias.temporizador ?? TEMPORIZADOR_DO_SISTEMA;
    this.esperaEmMs = dependencias.esperaDaDecisaoDoAppEmMs ?? ESPERA_DA_DECISAO_DO_APP_EM_MS;
  }

  async orquestradorExiste(orquestradorId: string): Promise<boolean> {
    return this.dependencias.repositorio.buscarPorId(orquestradorId) !== null;
  }

  async executar(pedido: PedidoDaRotina, sinal: AbortSignal): Promise<ResultadoDoPedidoDaRotina> {
    const { orquestradorId } = pedido;
    const { servico, repositorio } = this.dependencias;
    return this.acompanhar(orquestradorId, sinal, async () => {
      const orquestrador = repositorio.buscarPorId(orquestradorId);
      if (orquestrador === null) {
        return ORQUESTRADOR_INEXISTENTE;
      }
      if (orquestrador.turnoEmAndamento === null) {
        try {
          const enviada = await servico.enviarMensagem(orquestradorId, pedido.texto, [], pedido.modo);
          return { tipo: "turno" as const, turnoId: enviada.turnoId };
        } catch (erro) {
          // Outro pedido começou entre a conferência e o envio: vai para a fila, como se já estivesse ocupado.
          if (!(erro instanceof ErroDeOrquestracao && erro.motivo === "turno_em_andamento")) {
            throw erro;
          }
        }
      }
      const enfileirado = await servico.enfileirarPedido(orquestradorId, pedido.texto, pedido.modo);
      return { tipo: "fila" as const, pedidoId: enfileirado.pedidoId };
    });
  }

  async aprovarPlano(orquestradorId: string, sinal: AbortSignal): Promise<ResultadoDoPedidoDaRotina> {
    const { servico, repositorio } = this.dependencias;
    return this.acompanhar(orquestradorId, sinal, async () => {
      const orquestrador = repositorio.buscarPorId(orquestradorId);
      if (orquestrador === null) {
        return ORQUESTRADOR_INEXISTENTE;
      }
      // Conferido antes: aprovar com o Orquestrador ocupado deixaria o plano aprovado sem nada rodando.
      if (orquestrador.turnoEmAndamento !== null) {
        return {
          situacao: "falhou" as const,
          motivo: `"${orquestrador.nome}" está ocupado com outro pedido. Aprove o plano pelo cartão do orquestrador quando ele terminar.`,
        };
      }
      if (orquestrador.turnoComPlanoPendente === null) {
        return {
          situacao: "falhou" as const,
          motivo: `Não há mais um plano esperando aprovação em "${orquestrador.nome}" (ele já foi aprovado, descartado ou substituído por outro pedido).`,
        };
      }
      const enviada = await servico.aprovarPlano(orquestradorId);
      return { tipo: "turno" as const, turnoId: enviada.turnoId };
    });
  }

  /** Um plano já decidido, ou um Orquestrador que não existe mais, não é erro: só não há o que descartar. */
  async descartarPlano(orquestradorId: string): Promise<void> {
    try {
      await this.dependencias.servico.descartarPlano(orquestradorId);
    } catch (erro) {
      if (erro instanceof ErroDeOrquestracao && (erro.motivo === "sem_plano_pendente" || erro.motivo === "nao_encontrado")) {
        return;
      }
      throw erro;
    }
  }

  /**
   * Assina os eventos ANTES de enviar (o turno publica o começo antes de o
   * envio voltar), envia e espera o fim. Erros do domínio viram `falhou`, com
   * a mensagem que já vem pronta para o usuário; o resto sobe.
   */
  private async acompanhar(
    orquestradorId: string,
    sinal: AbortSignal,
    enviar: () => Promise<Inicio | ResultadoDoPedidoDaRotina>,
  ): Promise<ResultadoDoPedidoDaRotina> {
    if (sinal.aborted) {
      return { situacao: "cancelado", motivo: MOTIVO_DO_CANCELAMENTO };
    }
    const acompanhamento: AcompanhamentoDoPedido = new AcompanhamentoDoPedido(
      orquestradorId,
      this.dependencias.canal,
      this.temporizador,
      this.esperaEmMs,
      (viuAFilaParar) => this.conferirAFila(orquestradorId, acompanhamento, viuAFilaParar),
    );
    const aoAbortar = (): void => {
      void this.desistir(orquestradorId, acompanhamento);
    };
    sinal.addEventListener("abort", aoAbortar, { once: true });
    try {
      let inicio: Inicio | ResultadoDoPedidoDaRotina;
      try {
        inicio = await enviar();
      } catch (erro) {
        if (erro instanceof ErroDeOrquestracao || erro instanceof ErroDeFilaCheia) {
          return { situacao: "falhou", motivo: erro.message };
        }
        throw erro;
      }
      if ("situacao" in inicio) {
        return inicio;
      }
      if (inicio.tipo === "turno") {
        acompanhamento.seguirTurno(inicio.turnoId);
      } else {
        acompanhamento.seguirPedidoDaFila(inicio.pedidoId);
      }
      if (sinal.aborted) {
        // Abortou durante o envio: agora se sabe o que desfazer.
        await this.desistir(orquestradorId, acompanhamento);
      }
      return await acompanhamento.resultado;
    } finally {
      sinal.removeEventListener("abort", aoAbortar);
      // Solta a assinatura (e a espera) se ainda abertas: um erro ao enviar, por exemplo.
      acompanhamento.finalizar({ situacao: "cancelado", motivo: MOTIVO_DO_CANCELAMENTO });
    }
  }

  /**
   * Um turno alheio parou a fila, ou o pedido acabou de entrar nela, e depois
   * de uma espera o pedido continua lá com o Orquestrador livre e nenhuma
   * retomada marcada: ninguém mais o tira.
   * - A fila parou por falha, cancelamento ou plano pendente: o pedido sai da
   *   fila e a etapa falha, sem passar por cima da decisão do usuário.
   * - Nada parou a fila (o turno que o segurava acabou antes de ele entrar):
   *   envia agora.
   */
  private async conferirAFila(
    orquestradorId: string,
    acompanhamento: AcompanhamentoDoPedido,
    viuAFilaParar: boolean,
  ): Promise<ResultadoDoPedidoDaRotina | null> {
    const { repositorio, servico } = this.dependencias;
    const pedidoId = acompanhamento.aindaNaFila;
    if (pedidoId === null) {
      return null;
    }
    const orquestrador = repositorio.buscarPorId(orquestradorId);
    if (orquestrador === null) {
      return ORQUESTRADOR_INEXISTENTE;
    }
    if (orquestrador.turnoEmAndamento !== null || orquestrador.retomadaPendente !== null) {
      return null;
    }
    try {
      if (!viuAFilaParar) {
        // O `pedido_retirado_da_fila` e o `turno_iniciado` que isso publica levam o acompanhamento ao turno.
        await servico.enviarDaFila(orquestradorId, pedidoId);
        return null;
      }
      await acompanhamento.retirarDaFila(() => servico.removerDaFila(orquestradorId, pedidoId));
    } catch (erro) {
      if (erro instanceof ErroDeOrquestracao && (erro.motivo === "turno_em_andamento" || erro.motivo === "nao_encontrado")) {
        // Outro turno começou, ou o pedido já saiu da fila (o usuário o enviou ou o removeu): os eventos dizem o resto.
        return null;
      }
      return { situacao: "falhou", motivo: `Não foi possível enviar o pedido ao orquestrador: ${descreverErro(erro)}` };
    }
    return {
      situacao: "falhou",
      motivo: `A fila de "${orquestrador.nome}" parou depois de um pedido que falhou, foi cancelado ou deixou um plano para aprovar, e o pedido da rotina saiu dela sem rodar. Resolva no orquestrador e execute a rotina de novo.`,
    };
  }

  /** A rotina foi cancelada (ou o app está fechando): o pedido sai da fila ou o turno dele é cancelado. */
  private async desistir(orquestradorId: string, acompanhamento: AcompanhamentoDoPedido): Promise<void> {
    const { servico } = this.dependencias;
    const naFila = acompanhamento.aindaNaFila;
    const noTurno = acompanhamento.turnoEmCurso;
    // Antes de mexer no Orquestrador: o evento de o pedido sair da fila não pode virar o motivo da etapa.
    acompanhamento.finalizar({ situacao: "cancelado", motivo: MOTIVO_DO_CANCELAMENTO });
    try {
      if (naFila !== null) {
        await servico.removerDaFila(orquestradorId, naFila);
      } else if (noTurno !== null) {
        // Também cancela a retomada automática marcada, se o turno já tiver terminado.
        await servico.cancelar(orquestradorId);
      }
    } catch (erro) {
      // Sem turno em andamento ou sem o pedido na fila: já terminou ou saiu sozinho.
      if (!(erro instanceof ErroDeOrquestracao)) {
        console.warn(`[rotinas] Não foi possível desfazer o pedido no orquestrador "${orquestradorId}":`, descreverErro(erro));
      }
    }
  }
}
