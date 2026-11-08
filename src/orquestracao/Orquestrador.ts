import { copiarPergunta, PerguntaDoApp } from "../perguntas/PerguntaDoApp";
import { Anexo, MAXIMO_DE_IMAGENS_POR_MENSAGEM } from "./Anexo";
import {
  AlteracoesDaConfiguracao,
  ConfiguracaoDoOrquestrador,
  DadosDaConfiguracao,
} from "./ConfiguracaoDoOrquestrador";
import { ConsumoDoTurno } from "./ConsumoDoTurno";
import { ErroDeOrquestracao } from "./ErroDeOrquestracao";
import { EventoDeOrquestracao, EventoDoMotor, UsoDoTurno } from "./EventoDeOrquestracao";
import { ModoDoTurno } from "./ModoDoTurno";
import { PastaDeTrabalho } from "./PastaDeTrabalho";
import {
  DadosDoPedidoNaFila,
  MotivoDaRetiradaDaFila,
  PedidoNaFila,
  TAMANHO_MAXIMO_DA_MENSAGEM,
} from "./PedidoNaFila";
import {
  NomeDaPredefinicao,
  PredefinicaoDeConfiguracao,
  predefinicaoCorrespondente,
} from "./PredefinicaoDeConfiguracao";
import { DadosDoTurno, Turno } from "./Turno";

export { TAMANHO_MAXIMO_DA_MENSAGEM } from "./PedidoNaFila";

export const TAMANHO_MAXIMO_DO_NOME = 60;
/** Quantos pedidos cabem na fila de um Orquestrador. */
export const LIMITE_DA_FILA = 10;

export type SituacaoDoOrquestrador = "ocioso" | "trabalhando";

/**
 * A fila do Orquestrador já tem `LIMITE_DA_FILA` pedidos: conflito com o
 * estado atual (HTTP 409), como um turno em andamento. Fica à parte do
 * `ErroDeOrquestracao` porque `fila_cheia` não está entre os `MotivoDoErro`.
 */
export class ErroDeFilaCheia extends Error {
  readonly motivo = "fila_cheia";

  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroDeFilaCheia";
  }
}

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
  /** Ausente nos `orquestrador.json` gravados antes da fila: vale fila vazia. */
  fila?: DadosDoPedidoNaFila[];
  /**
   * Se algum pedido da conversa atual já levou instruções personalizadas.
   * Ausente nos dados gravados antes de elas existirem: vale `false`.
   */
  instrucoesNaConversa?: boolean | undefined;
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
 * Os pedidos que chegam enquanto ele trabalha esperam na fila (até
 * `LIMITE_DA_FILA`), na ordem em que chegaram.
 *
 * Cada mudança de estado devolve o evento correspondente, que o serviço grava
 * no histórico e publica para a tela.
 */
export class Orquestrador {
  private constructor(
    public readonly id: string,
    public readonly nome: string,
    public readonly pastaDeTrabalho: PastaDeTrabalho,
    private sessaoAtual: string,
    private readonly criadoEmMs: number,
    private sessaoJaIniciada: boolean,
    private configuracaoAtual: ConfiguracaoDoOrquestrador,
    private turnos: Turno[],
    private worktreeAtual: DadosDoWorktree | null,
    private filaAtual: PedidoNaFila[],
    private instrucoesJaEnviadas: boolean,
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
      [],
      false,
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
      (dados.fila ?? []).map((pedido) => PedidoNaFila.reconstituir(pedido)),
      dados.instrucoesNaConversa ?? false,
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

  /** A sessão do Claude Code da conversa atual; muda quando a conversa é limpa. */
  get sessaoId(): string {
    return this.sessaoAtual;
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

  /**
   * O turno cujo Plano aguarda a decisão do usuário. Só o último turno conta:
   * um pedido novo deixa para trás o Plano anterior.
   */
  get turnoComPlanoPendente(): Turno | null {
    const ultimo = this.ultimoTurno;
    return ultimo !== null && ultimo.planoPendente ? ultimo : null;
  }

  /** Os pedidos à espera, na ordem em que vão sair (o primeiro sai antes). */
  get fila(): readonly PedidoNaFila[] {
    return [...this.filaAtual];
  }

  /**
   * Guarda um pedido no fim da fila. Vale com ou sem turno em andamento: sem
   * turno, o pedido espera até o usuário mandar enviar.
   */
  enfileirarPedido(pedido: PedidoNaFila): EventoDeOrquestracao {
    if (this.filaAtual.length >= LIMITE_DA_FILA) {
      throw new ErroDeFilaCheia(`A fila de "${this.nome}" está cheia (máximo ${LIMITE_DA_FILA} pedidos).`);
    }
    this.filaAtual.push(pedido);
    return { tipo: "pedido_enfileirado", pedido: pedido.paraDados() };
  }

  /** O pedido da fila com esse id. */
  pedidoDaFila(pedidoId: string): PedidoNaFila {
    const pedido = this.filaAtual.find((candidato) => candidato.id === pedidoId);
    if (pedido === undefined) {
      throw new ErroDeOrquestracao("nao_encontrado", "Pedido não encontrado na fila.");
    }
    return pedido;
  }

  /** Tira o pedido da fila: o usuário o removeu ou ele virou um turno (`enviado`). */
  retirarDaFila(pedidoId: string, motivo: MotivoDaRetiradaDaFila): EventoDeOrquestracao {
    const pedido = this.pedidoDaFila(pedidoId);
    this.filaAtual = this.filaAtual.filter((candidato) => candidato !== pedido);
    return { tipo: "pedido_retirado_da_fila", pedidoId, motivo };
  }

  /**
   * O pedido que sai sozinho da fila depois do turno `turnoId`, ou `null`
   * quando a fila deve esperar o usuário. Ela só anda se esse turno ainda é o
   * último da conversa e terminou concluído, sem Plano aguardando decisão:
   * cancelado, com falha, interrompido ou com Plano pendente, a fila pausa
   * (o usuário segue com "enviar agora"). Outro turno já iniciado depois dele
   * também pausa: a fila anda quando esse outro terminar.
   */
  proximoDaFilaApos(turnoId: string): PedidoNaFila | null {
    const ultimo = this.ultimoTurno;
    if (ultimo === null || ultimo.id !== turnoId || ultimo.situacao !== "concluido" || ultimo.planoPendente) {
      return null;
    }
    return this.filaAtual[0] ?? null;
  }

  /** Vale a partir do próximo turno; um turno em andamento segue com a configuração com que começou. */
  alterarConfiguracao(alteracoes: AlteracoesDaConfiguracao): EventoDeOrquestracao {
    this.configuracaoAtual = this.configuracaoAtual.com(alteracoes);
    return { tipo: "configuracao_alterada", configuracao: this.configuracaoAtual.paraDados() };
  }

  /**
   * Aplica uma predefinição (ex.: "Modo econômico"): só os campos dela mudam,
   * e a configuração segue editável depois. Vale a partir do próximo turno.
   */
  aplicarPredefinicao(predefinicao: PredefinicaoDeConfiguracao): EventoDeOrquestracao {
    this.configuracaoAtual = predefinicao.aplicarEm(this.configuracaoAtual);
    return {
      tipo: "configuracao_alterada",
      configuracao: this.configuracaoAtual.paraDados(),
      predefinicao: predefinicao.nome,
    };
  }

  /** A predefinição cujos campos batem com a configuração atual, ou `null`. */
  get predefinicaoCorrespondente(): NomeDaPredefinicao | null {
    return predefinicaoCorrespondente(this.configuracaoAtual);
  }

  /**
   * Registra quanto um turno já encerrado gastou. Um turno que não terminou
   * com sucesso (cancelado, com falha, interrompido) pode ter parado antes de
   * gastar tudo o que gastaria: o consumo fica marcado como parcial.
   */
  registrarConsumoDoTurno(turnoId: string, consumo: ConsumoDoTurno): EventoDeOrquestracao {
    const turno = this.turnos.find((candidato) => candidato.id === turnoId);
    if (turno === undefined || turno.emAndamento) {
      throw new ErroDeOrquestracao(
        "sem_turno_em_andamento",
        `O turno ${turnoId} não está encerrado em "${this.nome}" para registrar o consumo.`,
      );
    }
    const medido = turno.situacao === "concluido" ? consumo : consumo.comoParcial();
    return { tipo: "consumo_do_turno_medido", turnoId, consumo: medido.paraDados() };
  }

  /**
   * Começa uma conversa nova ("/clear") no mesmo Orquestrador: os turnos saem
   * do agregado (o histórico anterior é arquivado pelo repositório) e o
   * próximo turno abre outra sessão do Claude Code, sem memória da anterior.
   * Nome, pasta, configuração, worktree e a fila de pedidos continuam os mesmos.
   *
   * Um Plano pendente é descartado junto. `worktreeComAlteracoes` avisa que o
   * worktree segue com trabalho: worktrees sem alterações são removidos ao
   * fim de cada turno, então um worktree registrado aqui é um que ficou.
   */
  limparConversa(novaSessaoId: string): EventoDeOrquestracao {
    if (this.turnoEmAndamento !== null) {
      throw new ErroDeOrquestracao(
        "turno_em_andamento",
        `Cancele o pedido em andamento de "${this.nome}" antes de limpar a conversa.`,
      );
    }

    const turnosAnteriores = this.turnos.length;
    const planoDescartado = this.turnoComPlanoPendente !== null;
    const worktreeComAlteracoes = this.worktreeAtual !== null;

    this.turnos = [];
    this.sessaoAtual = novaSessaoId;
    this.sessaoJaIniciada = false;
    this.instrucoesJaEnviadas = false;
    return { tipo: "conversa_limpa", turnosAnteriores, planoDescartado, worktreeComAlteracoes };
  }

  iniciarTurno(
    turnoId: string,
    texto: string,
    agora: Date,
    anexos: readonly Anexo[] = [],
    modo: ModoDoTurno = "execucao",
  ): EventoDeOrquestracao {
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
    this.turnos.push(Turno.iniciar(turnoId, mensagem, agora, dadosDosAnexos, modo));
    return {
      tipo: "turno_iniciado",
      turnoId,
      texto: mensagem,
      configuracao: this.configuracaoAtual.paraDados(),
      anexos: dadosDosAnexos,
      modo,
    };
  }

  /**
   * Registra se o pedido que começa leva instruções personalizadas e diz se
   * ele precisa revogar as anteriores: sem instruções agora, mas com
   * instruções já enviadas nesta conversa (que seguem no histórico da sessão).
   * Quem nunca usou instruções nunca recebe a revogação.
   */
  registrarInstrucoesDoPedido(comInstrucoes: boolean): { revogarAnteriores: boolean } {
    const revogarAnteriores = !comInstrucoes && this.instrucoesJaEnviadas;
    if (comInstrucoes) {
      this.instrucoesJaEnviadas = true;
    }
    return { revogarAnteriores };
  }

  /** O usuário aprovou o Plano: a execução vem num turno novo, na mesma sessão. */
  aprovarPlano(): EventoDeOrquestracao {
    const turno = this.turnoDoPlanoPendente();
    turno.decidirPlano("aprovado");
    return { tipo: "plano_aprovado", turnoId: turno.id };
  }

  descartarPlano(): EventoDeOrquestracao {
    const turno = this.turnoDoPlanoPendente();
    turno.decidirPlano("descartado");
    return { tipo: "plano_descartado", turnoId: turno.id };
  }

  registrarDoMotor(turnoId: string, evento: EventoDoMotor): EventoDeOrquestracao {
    if (evento.tipo === "sessao_iniciada") {
      this.sessaoJaIniciada = true;
    }
    this.turnoAtivo(turnoId).registrar(evento);
    return { ...evento, turnoId };
  }

  /**
   * `planoProposto`: num turno de execução, o Orquestrador respondeu com um
   * Plano em vez de executar (pedido grande) — ele fica pendente como o de um
   * turno de planejamento.
   *
   * `perguntas`: as perguntas com opções que o Orquestrador fez na resposta
   * (blocos ```pergunta-do-app), já fora do texto.
   */
  concluirTurno(
    turnoId: string,
    resposta: string,
    uso: UsoDoTurno,
    agora: Date,
    planoProposto = false,
    perguntas: readonly PerguntaDoApp[] = [],
  ): EventoDeOrquestracao {
    const turno = this.turnoAtivo(turnoId);
    turno.concluir(resposta, uso, agora, planoProposto, perguntas);
    return {
      tipo: "turno_concluido",
      turnoId,
      resposta,
      uso,
      planoPendente: turno.planoPendente,
      perguntas: turno.perguntas.map(copiarPergunta),
    };
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
      sessaoId: this.sessaoAtual,
      sessaoIniciada: this.sessaoJaIniciada,
      criadoEm: new Date(this.criadoEmMs).toISOString(),
      configuracao: this.configuracaoAtual.paraDados(),
      turnos: this.turnos.map((turno) => turno.paraDados()),
      worktree: this.worktreeAtual === null ? null : { ...this.worktreeAtual },
      fila: this.filaAtual.map((pedido) => pedido.paraDados()),
      instrucoesNaConversa: this.instrucoesJaEnviadas,
    };
  }

  private turnoDoPlanoPendente(): Turno {
    const turno = this.turnoComPlanoPendente;
    if (turno === null) {
      throw new ErroDeOrquestracao("sem_plano_pendente", `"${this.nome}" não tem plano aguardando aprovação.`);
    }
    return turno;
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
