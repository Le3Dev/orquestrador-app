import { AlvoDoDiagnostico, DiagnosticadorDoClaude, DiagnosticoDoClaude } from "./DiagnosticoDoClaude";
import { ESPERA_MAXIMA_MS, formatarDuracao } from "./RecuperacaoDoTurno";

/** Quem marca as esperas da vigia e da retomada. Injetável para os testes não dependerem do relógio. */
export interface AgendadorDeTarefas {
  /** Roda `tarefa` daqui a `ms`; devolve a função que desmarca. */
  agendar(ms: number, tarefa: () => void): () => void;
}

/** O agendador de verdade, com `setTimeout`. Não segura o processo aberto ao desligar. */
export const agendadorDoRelogio: AgendadorDeTarefas = {
  agendar(ms, tarefa) {
    const marcado = setTimeout(tarefa, Math.min(Math.max(0, ms), ESPERA_MAXIMA_MS));
    marcado.unref();
    return () => clearTimeout(marcado);
  },
};

/** Sem nenhuma linha do processo por este tempo, a vigia passa a diagnosticar. */
export const SILENCIO_ANTES_DO_DIAGNOSTICO_MS = 90_000;
/** Intervalo entre um diagnóstico e o seguinte, enquanto o silêncio durar. */
export const INTERVALO_DO_DIAGNOSTICO_MS = 30_000;
/** Silêncio mínimo para dar o turno como travado, sem nenhum comando aberto. */
export const SILENCIO_PARA_TRAVADO_MS = 5 * 60_000;
/** Com um comando aberto (mas sem CPU), a vigia tolera mais: ele pode estar esperando E/S. */
export const SILENCIO_PARA_TRAVADO_COM_COMANDO_MS = 15 * 60_000;
/** Diagnósticos seguidos sem sinal de trabalho para dar o turno como travado. */
export const DIAGNOSTICOS_PARADOS_PARA_TRAVADO = 3;
/** Diagnósticos seguidos com o processo morto: um só pode ser um `ps` que falhou. */
export const DIAGNOSTICOS_SEM_PROCESSO_PARA_TRAVADO = 2;
/** CPU (%) a partir da qual um processo conta como trabalhando. */
export const CPU_DE_TRABALHO = 2;

/** O que a tela mostra durante o silêncio (vai no `SinalDeVida.diagnostico`). */
export interface LeituraDaVigia {
  situacao: "trabalhando" | "suspeito";
  resumo: string;
  /** Sem a lista de processos (Windows), a vigia só avisa: não encerra nem retoma o turno sozinha. */
  semRetomadaAutomatica?: true;
}

export interface OpcoesDaVigia {
  alvo: AlvoDoDiagnostico;
  diagnosticador: DiagnosticadorDoClaude;
  agendador: AgendadorDeTarefas;
  agora: () => Date;
  /** Se a vigia pode encerrar o turno (a preferência de autorrecuperação), lido a cada vez. */
  podeAgir: () => boolean;
  /** Cada diagnóstico feito durante o silêncio. */
  aoDiagnosticar: (leitura: LeituraDaVigia) => void;
  /** O turno travou e a vigia pode agir: encerre-o. Chamado no máximo uma vez; depois a vigia se desliga. */
  aoTravar: (resumo: string) => void;
}

/**
 * Vigia um turno em andamento (ver ADR-36): conta o tempo desde a última
 * linha do processo do Claude e, quando ele fica em silêncio, examina o que
 * está acontecendo para separar "trabalhando calado" (um `npm test` longo,
 * subagentes escrevendo nas transcrições) de "travado".
 *
 * O Claude esperando a resposta da API tem CPU perto de zero, por isso o
 * critério principal é a falta de linhas e de transcrição crescendo, por
 * vários diagnósticos seguidos, e não a CPU sozinha.
 *
 * Onde o sistema não deixa ver os processos (Windows), a vigia não dá o turno
 * como travado por silêncio: só avisa, e o usuário decide se interrompe.
 */
export class VigiaDoTurno {
  private ligada = false;
  private ultimaLinhaEm = 0;
  private parados = 0;
  private semProcesso = 0;
  private desmarcar: (() => void) | null = null;

  constructor(private readonly opcoes: OpcoesDaVigia) {}

  ligar(): void {
    if (this.ligada) {
      return;
    }
    this.ligada = true;
    this.ultimaLinhaEm = this.agoraMs();
    this.agendar(SILENCIO_ANTES_DO_DIAGNOSTICO_MS);
  }

  /** Uma linha (ou evento) do processo: o silêncio recomeça do zero. */
  registrarLinha(): void {
    this.ultimaLinhaEm = this.agoraMs();
    this.parados = 0;
    this.semProcesso = 0;
  }

  desligar(): void {
    this.ligada = false;
    this.desmarcar?.();
    this.desmarcar = null;
  }

  private agoraMs(): number {
    return this.opcoes.agora().getTime();
  }

  private agendar(ms: number): void {
    this.desmarcar = this.opcoes.agendador.agendar(ms, () => {
      this.desmarcar = null;
      void this.conferir();
    });
  }

  private async conferir(): Promise<void> {
    if (!this.ligada) {
      return;
    }
    const silencio = this.agoraMs() - this.ultimaLinhaEm;
    if (silencio < SILENCIO_ANTES_DO_DIAGNOSTICO_MS) {
      this.agendar(SILENCIO_ANTES_DO_DIAGNOSTICO_MS - silencio);
      return;
    }

    let diagnostico: DiagnosticoDoClaude;
    try {
      diagnostico = await this.opcoes.diagnosticador.diagnosticar(this.opcoes.alvo);
    } catch (falha) {
      // A porta promete não lançar; se lançar, só tenta de novo depois.
      console.warn("[vigia] Diagnóstico do turno falhou:", falha instanceof Error ? falha.message : falha);
      if (this.ligada) {
        this.agendar(INTERVALO_DO_DIAGNOSTICO_MS);
      }
      return;
    }
    if (!this.ligada) {
      return;
    }
    // Uma linha pode ter chegado enquanto o diagnóstico rodava.
    const silencioAgora = this.agoraMs() - this.ultimaLinhaEm;
    if (silencioAgora < SILENCIO_ANTES_DO_DIAGNOSTICO_MS) {
      this.agendar(SILENCIO_ANTES_DO_DIAGNOSTICO_MS - silencioAgora);
      return;
    }

    const { leitura, travado } = this.avaliar(diagnostico, silencioAgora);
    this.opcoes.aoDiagnosticar(leitura);
    if (travado !== null && this.opcoes.podeAgir()) {
      this.desligar();
      this.opcoes.aoTravar(travado);
      return;
    }
    this.agendar(INTERVALO_DO_DIAGNOSTICO_MS);
  }

  /** O que mostrar agora e, se o turno travou, o resumo do travamento (senão `null`). */
  private avaliar(diagnostico: DiagnosticoDoClaude, silencioMs: number): { leitura: LeituraDaVigia; travado: string | null } {
    const semSaida = `sem saída há ${formatarDuracao(silencioMs)}`;

    if (!diagnostico.processoVivo) {
      this.semProcesso += 1;
      return {
        leitura: { situacao: "suspeito", resumo: `${semSaida}, processo do Claude não encontrado` },
        travado:
          this.semProcesso >= DIAGNOSTICOS_SEM_PROCESSO_PARA_TRAVADO
            ? `${semSaida}; o processo do Claude terminou sem fechar o turno`
            : null,
      };
    }
    this.semProcesso = 0;

    const comandoOcupado = diagnostico.filhos.find((filho) => filho.cpu >= CPU_DE_TRABALHO);
    if (comandoOcupado !== undefined) {
      this.parados = 0;
      return {
        leitura: {
          situacao: "trabalhando",
          resumo: `rodando \`${comandoOcupado.comando}\` há ${formatarDuracao(comandoOcupado.haMs)}`,
        },
        travado: null,
      };
    }
    if (diagnostico.transcricoesCrescendo) {
      this.parados = 0;
      return { leitura: { situacao: "trabalhando", resumo: "subagentes escrevendo" }, travado: null };
    }
    if (diagnostico.cpuDoClaude >= CPU_DE_TRABALHO) {
      this.parados = 0;
      return { leitura: { situacao: "trabalhando", resumo: "Claude processando" }, travado: null };
    }
    if (!diagnostico.processosConhecidos) {
      // Sem CPU nem filhos à vista, um `npm test` longo parece travado: a
      // decisão fica com o usuário, e a retomada automática não dispara.
      return {
        leitura: {
          situacao: "suspeito",
          resumo: `${semSaida}; não dá para ver os processos neste sistema, então o app não encerra o pedido sozinho`,
          semRetomadaAutomatica: true,
        },
        travado: null,
      };
    }

    this.parados += 1;
    const comandoAberto = diagnostico.filhos[0];
    const resumo =
      comandoAberto === undefined
        ? `${semSaida}, sem CPU`
        : `${semSaida}, sem CPU; \`${comandoAberto.comando}\` aberto há ${formatarDuracao(comandoAberto.haMs)}, parado`;
    const silencioMinimo =
      comandoAberto === undefined ? SILENCIO_PARA_TRAVADO_MS : SILENCIO_PARA_TRAVADO_COM_COMANDO_MS;
    const travou = this.parados >= DIAGNOSTICOS_PARADOS_PARA_TRAVADO && silencioMs >= silencioMinimo;
    return {
      leitura: { situacao: "suspeito", resumo },
      travado: !travou
        ? null
        : comandoAberto === undefined
          ? `${semSaida}, sem CPU e sem transcrição crescendo`
          : `${semSaida}; \`${comandoAberto.comando}\` aberto há ${formatarDuracao(comandoAberto.haMs)}, sem CPU`,
    };
  }
}
