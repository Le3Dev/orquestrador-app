import { copiarPergunta, PerguntaDoApp } from "../perguntas/PerguntaDoApp";
import { categoriaDoTipo, DadosDoAnexo } from "./Anexo";
import { ErroDeOrquestracao } from "./ErroDeOrquestracao";
import { EventoDoMotor, UsoDoTurno } from "./EventoDeOrquestracao";
import { DecisaoDoPlano, ModoDoTurno } from "./ModoDoTurno";
import { DadosDoSubagente, Subagente } from "./Subagente";

export type SituacaoDoTurno = "em_andamento" | "concluido" | "cancelado" | "falhou" | "interrompido";

export interface DadosDoTurno {
  id: string;
  texto: string;
  iniciadoEm: string;
  encerradoEm: string | null;
  situacao: SituacaoDoTurno;
  resposta: string;
  motivoDaFalha: string | null;
  uso: UsoDoTurno | null;
  subagentes: DadosDoSubagente[];
  anexos: DadosDoAnexo[];
  /** Ausente em turnos gravados antes do modo de planejamento: valem como execução. */
  modo?: ModoDoTurno;
  decisaoDoPlano?: DecisaoDoPlano | null;
  /** Perguntas com opções da resposta final. Ausente em turnos gravados antes do campo: vale []. */
  perguntas?: PerguntaDoApp[];
}

/**
 * Uma mensagem do usuário ao Orquestrador e tudo o que ela desencadeou: os
 * Subagentes lançados e a resposta final. Objeto interno do agregado
 * `Orquestrador`.
 *
 * Num turno de planejamento, a resposta final é um Plano: ao concluir, ele
 * fica pendente até o usuário aprová-lo ou descartá-lo. O mesmo vale para um
 * turno de execução em que o Orquestrador propôs um Plano antes de mexer.
 */
export class Turno {
  private constructor(
    public readonly id: string,
    public readonly texto: string,
    private readonly iniciadoEmMs: number,
    private encerradoEmMs: number | null,
    private situacaoAtual: SituacaoDoTurno,
    private respostaFinal: string,
    private motivo: string | null,
    private usoFinal: UsoDoTurno | null,
    private readonly subagentes: Subagente[],
    public readonly anexos: readonly DadosDoAnexo[],
    public readonly modo: ModoDoTurno,
    private decisao: DecisaoDoPlano | null,
    private perguntasDaResposta: readonly PerguntaDoApp[],
  ) {}

  static iniciar(
    id: string,
    texto: string,
    agora: Date,
    anexos: readonly DadosDoAnexo[] = [],
    modo: ModoDoTurno = "execucao",
  ): Turno {
    return new Turno(id, texto, agora.getTime(), null, "em_andamento", "", null, null, [], anexos, modo, null, []);
  }

  static reconstituir(dados: DadosDoTurno): Turno {
    return new Turno(
      dados.id,
      dados.texto,
      Date.parse(dados.iniciadoEm),
      dados.encerradoEm === null ? null : Date.parse(dados.encerradoEm),
      dados.situacao,
      dados.resposta,
      dados.motivoDaFalha,
      dados.uso,
      dados.subagentes.map((subagente) => Subagente.reconstituir(subagente)),
      // Turnos gravados antes de existirem anexos não têm o campo.
      // Anexos anteriores aos documentos não têm `categoria`: eram só imagens.
      (dados.anexos ?? []).map((anexo) => ({ ...anexo, categoria: anexo.categoria ?? categoriaDoTipo(anexo.tipoDeMidia) })),
      // Nem os gravados antes do modo de planejamento: eram todos de execução.
      dados.modo ?? "execucao",
      dados.decisaoDoPlano ?? null,
      (dados.perguntas ?? []).map(copiarPergunta),
    );
  }

  get situacao(): SituacaoDoTurno {
    return this.situacaoAtual;
  }

  get emAndamento(): boolean {
    return this.situacaoAtual === "em_andamento";
  }

  get iniciadoEm(): Date {
    return new Date(this.iniciadoEmMs);
  }

  get resposta(): string {
    return this.respostaFinal;
  }

  get motivoDaFalha(): string | null {
    return this.motivo;
  }

  get subagentesAtivos(): number {
    return this.subagentes.filter((subagente) => subagente.ativo).length;
  }

  /**
   * `null` em turnos de execução que não propuseram Plano e em planejamentos
   * que não chegaram a entregá-lo.
   */
  get decisaoDoPlano(): DecisaoDoPlano | null {
    return this.decisao;
  }

  /** As perguntas com opções que o Orquestrador fez na resposta final; vazio se nenhuma. */
  get perguntas(): readonly PerguntaDoApp[] {
    return this.perguntasDaResposta;
  }

  /** O Plano deste turno aguarda o usuário aprovar ou descartar. */
  get planoPendente(): boolean {
    return this.decisao === "pendente";
  }

  /** Aplica o que o motor observou. Eventos que não mudam o resumo do turno são ignorados. */
  registrar(evento: EventoDoMotor): void {
    switch (evento.tipo) {
      case "subagente_iniciado":
        if (!this.subagentes.some((subagente) => subagente.id === evento.subagenteId)) {
          this.subagentes.push(Subagente.iniciar(evento.subagenteId, evento.descricao));
        }
        return;
      case "progresso_do_subagente":
        this.subagente(evento.subagenteId)?.registrarProgresso(evento.tokens, evento.duracaoMs);
        return;
      case "subagente_concluido":
        this.subagente(evento.subagenteId)?.concluir(
          evento.situacao,
          evento.resumo,
          evento.tokens,
          evento.duracaoMs,
        );
        return;
      default:
        return;
    }
  }

  /**
   * `planoProposto`: num turno de execução, o Orquestrador achou o pedido
   * grande e respondeu com um Plano em vez de executar.
   * `perguntas`: as perguntas com opções da resposta, já fora do texto.
   */
  concluir(
    resposta: string,
    uso: UsoDoTurno,
    agora: Date,
    planoProposto = false,
    perguntas: readonly PerguntaDoApp[] = [],
  ): void {
    this.respostaFinal = resposta;
    this.perguntasDaResposta = perguntas.map(copiarPergunta);
    this.usoFinal = uso;
    if (this.modo === "planejamento" || planoProposto) {
      // A resposta é o Plano: nada foi executado ainda, o usuário decide.
      this.decisao = "pendente";
    }
    this.encerrar("concluido", agora);
  }

  decidirPlano(decisao: Exclude<DecisaoDoPlano, "pendente">): void {
    if (!this.planoPendente) {
      throw new ErroDeOrquestracao("sem_plano_pendente", "Este pedido não tem plano aguardando aprovação.");
    }
    this.decisao = decisao;
  }

  cancelar(agora: Date): void {
    this.encerrar("cancelado", agora);
  }

  falhar(motivo: string, agora: Date): void {
    this.motivo = motivo;
    this.encerrar("falhou", agora);
  }

  /** O servidor parou no meio do turno; o processo do Claude Code já não existe. */
  interromper(agora: Date): void {
    this.encerrar("interrompido", agora);
  }

  paraDados(): DadosDoTurno {
    return {
      id: this.id,
      texto: this.texto,
      iniciadoEm: new Date(this.iniciadoEmMs).toISOString(),
      encerradoEm: this.encerradoEmMs === null ? null : new Date(this.encerradoEmMs).toISOString(),
      situacao: this.situacaoAtual,
      resposta: this.respostaFinal,
      motivoDaFalha: this.motivo,
      uso: this.usoFinal,
      subagentes: this.subagentes.map((subagente) => subagente.paraDados()),
      anexos: [...this.anexos],
      modo: this.modo,
      decisaoDoPlano: this.decisao,
      perguntas: this.perguntasDaResposta.map(copiarPergunta),
    };
  }

  private encerrar(situacao: Exclude<SituacaoDoTurno, "em_andamento">, agora: Date): void {
    this.situacaoAtual = situacao;
    this.encerradoEmMs = agora.getTime();
    for (const subagente of this.subagentes) {
      subagente.interromper();
    }
  }

  private subagente(id: string): Subagente | undefined {
    return this.subagentes.find((subagente) => subagente.id === id);
  }
}
