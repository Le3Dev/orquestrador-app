import { Anexo, MAXIMO_DE_IMAGENS_POR_MENSAGEM } from "./Anexo";
import {
  AlteracoesDaConfiguracao,
  ConfiguracaoDoOrquestrador,
  DadosDaConfiguracao,
} from "./ConfiguracaoDoOrquestrador";
import { ErroDeOrquestracao } from "./ErroDeOrquestracao";
import { EventoDeOrquestracao, EventoDoMotor, UsoDoTurno } from "./EventoDeOrquestracao";
import { PastaDeTrabalho } from "./PastaDeTrabalho";
import { DadosDoTurno, Turno } from "./Turno";

export const TAMANHO_MAXIMO_DO_NOME = 60;
export const TAMANHO_MAXIMO_DA_MENSAGEM = 50_000;

export type SituacaoDoOrquestrador = "ocioso" | "trabalhando";

/**
 * Worktree git isolado deste Orquestrador. `ativo` diz se ele existe e está em
 * uso agora (um turno rodando dentro dele); entre turnos sem alterações, o
 * worktree é removido e o estado volta a `null`.
 */
export interface DadosDoWorktree {
  branch: string;
  caminho: string;
  ativo: boolean;
}

export interface DadosDoOrquestrador {
  id: string;
  nome: string;
  pastaDeTrabalho: string;
  sessaoId: string;
  sessaoIniciada: boolean;
  criadoEm: string;
  configuracao: DadosDaConfiguracao;
  turnos: DadosDoTurno[];
  worktree?: DadosDoWorktree | null;
}

export interface NovoOrquestrador {
  id: string;
  nome: string;
  pastaDeTrabalho: PastaDeTrabalho;
  sessaoId: string;
  configuracao: ConfiguracaoDoOrquestrador;
  agora: Date;
}

/**
 * Raiz do agregado: uma conversa com o Claude sobre uma pasta de trabalho,
 * com os Turnos dessa conversa.
 *
 * A regra central mora aqui: um Orquestrador atende um pedido por vez. Vários
 * Orquestradores podem trabalhar ao mesmo tempo, cada um na sua pasta — é a
 * separação que permite cuidar de dois projetos em paralelo sem que um pedido
 * atropele o outro.
 *
 * Cada mudança de estado devolve o evento correspondente, que o serviço grava
 * no histórico e publica para a tela.
 */
export class Orquestrador {
  private constructor(
    public readonly id: string,
    public readonly nome: string,
    public readonly pastaDeTrabalho: PastaDeTrabalho,
    public readonly sessaoId: string,
    private readonly criadoEmMs: number,
    private sessaoJaIniciada: boolean,
    private configuracaoAtual: ConfiguracaoDoOrquestrador,
    private readonly turnos: Turno[],
    private worktreeAtual: DadosDoWorktree | null,
  ) {}

  static criar(novo: NovoOrquestrador): Orquestrador {
    const nome = novo.nome.trim();
    if (nome === "") {
      throw new ErroDeOrquestracao("dados_invalidos", "Dê um nome ao orquestrador.");
    }
    if (nome.length > TAMANHO_MAXIMO_DO_NOME) {
      throw new ErroDeOrquestracao(
        "dados_invalidos",
        `O nome do orquestrador deve ter até ${TAMANHO_MAXIMO_DO_NOME} caracteres.`,
      );
    }
    return new Orquestrador(
      novo.id,
      nome,
      novo.pastaDeTrabalho,
      novo.sessaoId,
      novo.agora.getTime(),
      false,
      novo.configuracao,
      [],
      null,
    );
  }

  static reconstituir(dados: DadosDoOrquestrador): Orquestrador {
    return new Orquestrador(
      dados.id,
      dados.nome,
      PastaDeTrabalho.reconstituir(dados.pastaDeTrabalho),
      dados.sessaoId,
      Date.parse(dados.criadoEm),
      dados.sessaoIniciada,
      ConfiguracaoDoOrquestrador.de(dados.configuracao),
      dados.turnos.map((turno) => Turno.reconstituir(turno)),
      // Ao reabrir, nenhum turno está de fato rodando: um worktree salvo como
      // "ativo" era de um turno interrompido pela queda do servidor.
      dados.worktree === undefined || dados.worktree === null ? null : { ...dados.worktree, ativo: false },
    );
  }

  get configuracao(): ConfiguracaoDoOrquestrador {
    return this.configuracaoAtual;
  }

  /** O worktree isolado deste Orquestrador, ou `null` quando não há um. */
  get worktree(): DadosDoWorktree | null {
    return this.worktreeAtual === null ? null : { ...this.worktreeAtual };
  }

  /** Registra o worktree em uso para o turno atual. */
  usarWorktree(branch: string, caminho: string): void {
    this.worktreeAtual = { branch, caminho, ativo: true };
  }

  /** O worktree segue existindo mas nenhum turno o usa agora. */
  liberarWorktree(): void {
    if (this.worktreeAtual !== null) {
      this.worktreeAtual = { ...this.worktreeAtual, ativo: false };
    }
  }

  /** Worktree removido: sem estado a expor. */
  limparWorktree(): void {
    this.worktreeAtual = null;
  }

  /**
   * Se a sessão do Claude Code já existe. Define se o próximo turno começa uma
   * sessão nova ou retoma a anterior — é o que dá memória à conversa.
   */
  get sessaoIniciada(): boolean {
    return this.sessaoJaIniciada;
  }

  get criadoEm(): Date {
    return new Date(this.criadoEmMs);
  }

  get turnoEmAndamento(): Turno | null {
    return this.turnos.find((turno) => turno.emAndamento) ?? null;
  }

  get situacao(): SituacaoDoOrquestrador {
    return this.turnoEmAndamento === null ? "ocioso" : "trabalhando";
  }

  get ultimoTurno(): Turno | null {
    return this.turnos.at(-1) ?? null;
  }

  get totalDeTurnos(): number {
    return this.turnos.length;
  }

  /** Vale a partir do próximo turno; um turno em andamento segue com a configuração com que começou. */
  alterarConfiguracao(alteracoes: AlteracoesDaConfiguracao): EventoDeOrquestracao {
    this.configuracaoAtual = this.configuracaoAtual.com(alteracoes);
    return { tipo: "configuracao_alterada", configuracao: this.configuracaoAtual.paraDados() };
  }

  iniciarTurno(turnoId: string, texto: string, agora: Date, anexos: readonly Anexo[] = []): EventoDeOrquestracao {
    const mensagem = texto.trim();
    if (mensagem === "") {
      throw new ErroDeOrquestracao("dados_invalidos", "Escreva uma mensagem para o orquestrador.");
    }
    if (mensagem.length > TAMANHO_MAXIMO_DA_MENSAGEM) {
      throw new ErroDeOrquestracao(
        "dados_invalidos",
        `A mensagem deve ter até ${TAMANHO_MAXIMO_DA_MENSAGEM} caracteres.`,
      );
    }
    if (anexos.length > MAXIMO_DE_IMAGENS_POR_MENSAGEM) {
      throw new ErroDeOrquestracao(
        "dados_invalidos",
        `Anexe até ${MAXIMO_DE_IMAGENS_POR_MENSAGEM} imagens por mensagem.`,
      );
    }
    if (this.turnoEmAndamento !== null) {
      throw new ErroDeOrquestracao(
        "turno_em_andamento",
        `"${this.nome}" ainda está trabalhando no pedido anterior. Aguarde terminar ou cancele.`,
      );
    }

    const dadosDosAnexos = anexos.map((anexo) => anexo.paraDados());
    this.turnos.push(Turno.iniciar(turnoId, mensagem, agora, dadosDosAnexos));
    return {
      tipo: "turno_iniciado",
      turnoId,
      texto: mensagem,
      configuracao: this.configuracaoAtual.paraDados(),
      anexos: dadosDosAnexos,
    };
  }

  registrarDoMotor(turnoId: string, evento: EventoDoMotor): EventoDeOrquestracao {
    if (evento.tipo === "sessao_iniciada") {
      this.sessaoJaIniciada = true;
    }
    this.turnoAtivo(turnoId).registrar(evento);
    return { ...evento, turnoId };
  }

  concluirTurno(turnoId: string, resposta: string, uso: UsoDoTurno, agora: Date): EventoDeOrquestracao {
    this.turnoAtivo(turnoId).concluir(resposta, uso, agora);
    return { tipo: "turno_concluido", turnoId, resposta, uso };
  }

  cancelarTurno(turnoId: string, agora: Date): EventoDeOrquestracao {
    this.turnoAtivo(turnoId).cancelar(agora);
    return { tipo: "turno_cancelado", turnoId };
  }

  falharTurno(turnoId: string, motivo: string, agora: Date): EventoDeOrquestracao {
    this.turnoAtivo(turnoId).falhar(motivo, agora);
    return { tipo: "turno_falhou", turnoId, motivo };
  }

  /** Usado ao reabrir o histórico: um turno que estava rodando quando o servidor parou. */
  interromperTurnoEmAndamento(agora: Date): EventoDeOrquestracao | null {
    const turno = this.turnoEmAndamento;
    if (turno === null) {
      return null;
    }
    turno.interromper(agora);
    return { tipo: "turno_interrompido", turnoId: turno.id };
  }

  paraDados(): DadosDoOrquestrador {
    return {
      id: this.id,
      nome: this.nome,
      pastaDeTrabalho: this.pastaDeTrabalho.caminho,
      sessaoId: this.sessaoId,
      sessaoIniciada: this.sessaoJaIniciada,
      criadoEm: new Date(this.criadoEmMs).toISOString(),
      configuracao: this.configuracaoAtual.paraDados(),
      turnos: this.turnos.map((turno) => turno.paraDados()),
      worktree: this.worktreeAtual === null ? null : { ...this.worktreeAtual },
    };
  }

  private turnoAtivo(turnoId: string): Turno {
    const turno = this.turnos.find((candidato) => candidato.id === turnoId);
    if (turno === undefined || !turno.emAndamento) {
      throw new ErroDeOrquestracao(
        "sem_turno_em_andamento",
        `O turno ${turnoId} não está em andamento em "${this.nome}".`,
      );
    }
    return turno;
  }
}
