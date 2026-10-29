import { DadosDoAnexo } from "./Anexo";
import { EventoDoMotor, UsoDoTurno } from "./EventoDeOrquestracao";
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
}

/**
 * Uma mensagem do usuário ao Orquestrador e tudo o que ela desencadeou: os
 * Subagentes lançados e a resposta final. Objeto interno do agregado
 * `Orquestrador`.
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
  ) {}

  static iniciar(id: string, texto: string, agora: Date, anexos: readonly DadosDoAnexo[] = []): Turno {
    return new Turno(id, texto, agora.getTime(), null, "em_andamento", "", null, null, [], anexos);
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
      dados.anexos ?? [],
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

  concluir(resposta: string, uso: UsoDoTurno, agora: Date): void {
    this.respostaFinal = resposta;
    this.usoFinal = uso;
    this.encerrar("concluido", agora);
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
