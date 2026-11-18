import { copiarPergunta, PerguntaDoApp } from "../perguntas/PerguntaDoApp";
import { Anexo, problemaDosAnexosDaMensagem } from "./Anexo";
import {
  AlteracoesDaConfiguracao,
  ConfiguracaoDoOrquestrador,
  DadosDaConfiguracao,
} from "./ConfiguracaoDoOrquestrador";
import { ConsumoDoTurno } from "./ConsumoDoTurno";
import { contextoDaTroca as montarContextoDaTroca } from "./ContextoDaConversa";
import { ErroDeOrquestracao } from "./ErroDeOrquestracao";
import { CausaDaRecuperacao, EventoDeOrquestracao, EventoDoMotor, UsoDoTurno } from "./EventoDeOrquestracao";
import { ModoDoTurno } from "./ModoDoTurno";
import { ehMotor, Motor, MOTOR_PADRAO } from "./Motor";
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

/** O nome aparado, de 1 a `TAMANHO_MAXIMO_DO_NOME` caracteres: vale ao criar e ao renomear. */
function nomeValido(nome: string): string {
  const aparado = nome.trim();
  if (aparado === "") {
    throw new ErroDeOrquestracao("dados_invalidos", "Dê um nome ao orquestrador.");
  }
  if (aparado.length > TAMANHO_MAXIMO_DO_NOME) {
    throw new ErroDeOrquestracao(
      "dados_invalidos",
      `O nome do orquestrador deve ter até ${TAMANHO_MAXIMO_DO_NOME} caracteres.`,
    );
  }
  return aparado;
}

/**
 * Os textos gravados por motor, só os de motor conhecido (`serve`) e com
 * conteúdo: um `orquestrador.json` editado à mão não pode derrubar a leitura.
 */
function textosPorMotor(
  gravados: Partial<Record<Motor, string>> | undefined,
  serve: (motor: Motor) => boolean,
): Partial<Record<Motor, string>> {
  const validos: Partial<Record<Motor, string>> = {};
  for (const [motor, texto] of Object.entries(gravados ?? {})) {
    if (ehMotor(motor) && serve(motor) && typeof texto === "string" && texto.trim() !== "") {
      validos[motor] = texto;
    }
  }
  return validos;
}

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

/**
 * A retomada automática marcada depois de um turno que travou ou falhou (ver
 * ADR-36). Fica no agregado, e no `orquestrador.json`, para sobreviver a um
 * reinício do app durante a espera.
 */
export interface DadosDaRetomadaPendente {
  /** O turno que travou ou falhou. */
  deTurnoId: string;
  causa: CausaDaRecuperacao;
  /** A tentativa que a retomada vai fazer (1 na primeira). */
  tentativa: number;
  /** ISO: quando retomar. */
  retomarEm: string;
}

export interface DadosDoOrquestrador {
  id: string;
  nome: string;
  pastaDeTrabalho: string;
  /** A sessão do Claude Code: o id gerado pelo app. As dos outros motores ficam em `sessoesDosMotores`. */
  sessaoId: string;
  /** Se a sessão do Claude Code já existe. */
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
  /** Ausente nos dados gravados antes de a retomada ser gravada: vale nenhuma. */
  retomadaPendente?: DadosDaRetomadaPendente | null | undefined;
  /**
   * As sessões que os motores diferentes do Claude Code criaram nesta
   * conversa: o id que cada um devolveu. Ausente nos dados gravados antes dos
   * outros motores: vale nenhuma.
   */
  sessoesDosMotores?: Partial<Record<Motor, string>> | undefined;
  /**
   * O último `liberaEm` conhecido do limite de uso de cada motor (ISO): enquanto
   * não passa, um pedido novo não começa nesse motor. Ausente nos dados gravados
   * antes dos outros motores: vale nenhum.
   */
  liberaEmDosMotores?: Partial<Record<Motor, string>> | undefined;
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
    private nomeAtual: string,
    public readonly pastaDeTrabalho: PastaDeTrabalho,
    private sessaoAtual: string,
    private readonly criadoEmMs: number,
    private sessaoJaIniciada: boolean,
    private configuracaoAtual: ConfiguracaoDoOrquestrador,
    private turnos: Turno[],
    private worktreeAtual: DadosDoWorktree | null,
    private filaAtual: PedidoNaFila[],
    private instrucoesJaEnviadas: boolean,
    private retomadaAtual: DadosDaRetomadaPendente | null,
    /** As sessões criadas pelos motores que não são o Claude Code (o Claude usa `sessaoAtual`). */
    private sessoesDosOutrosMotores: Partial<Record<Motor, string>>,
    private liberaEmPorMotor: Partial<Record<Motor, string>>,
  ) {}

  static criar(novo: NovoOrquestrador): Orquestrador {
    return new Orquestrador(
      novo.id,
      nomeValido(novo.nome),
      novo.pastaDeTrabalho,
      novo.sessaoId,
      novo.agora.getTime(),
      false,
      novo.configuracao,
      [],
      null,
      [],
      false,
      null,
      {},
      {},
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
      dados.retomadaPendente === undefined || dados.retomadaPendente === null ? null : { ...dados.retomadaPendente },
      // A sessão do Claude Code vive em `sessaoId`: uma entrada dele aqui não vale.
      textosPorMotor(dados.sessoesDosMotores, (motor) => motor !== MOTOR_PADRAO),
      textosPorMotor(dados.liberaEmDosMotores, () => true),
    );
  }

  get nome(): string {
    return this.nomeAtual;
  }

  /**
   * Troca o nome, com a mesma regra da criação. Só muda o que a tela mostra:
   * vale também com um turno em andamento. Trocar pelo mesmo nome não conta
   * como alteração (`null`, sem evento).
   */
  renomear(nome: string): EventoDeOrquestracao | null {
    const novo = nomeValido(nome);
    if (novo === this.nomeAtual) {
      return null;
    }
    this.nomeAtual = novo;
    return { tipo: "orquestrador_renomeado", nome: novo };
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

  /**
   * A sessão que `motor` guarda da conversa atual. No Claude Code, o id
   * gerado pelo app. Nos outros, o que o próprio motor criou; sem sessão ainda,
   * `id` vazio e `iniciada` falsa: o próximo turno dele cria uma.
   */
  sessaoDoMotor(motor: Motor): { id: string; iniciada: boolean } {
    if (motor === "claude-code") {
      return { id: this.sessaoAtual, iniciada: this.sessaoJaIniciada };
    }
    const id = this.sessoesDosOutrosMotores[motor];
    return id === undefined ? { id: "", iniciada: false } : { id, iniciada: true };
  }

  /**
   * Guarda a sessão que um motor criou (o id que ele devolveu). Vazio não vale,
   * e o Claude Code não entra aqui: a sessão dele é a que o app gerou.
   */
  registrarSessaoDoMotor(motor: Motor, sessaoId: string): void {
    const id = sessaoId.trim();
    if (motor === "claude-code" || id === "") {
      return;
    }
    this.sessoesDosOutrosMotores = { ...this.sessoesDosOutrosMotores, [motor]: id };
  }

  /** O último `liberaEm` conhecido do limite de uso do motor (ISO), ou `null`. */
  liberaEmDoMotor(motor: Motor): string | null {
    return this.liberaEmPorMotor[motor] ?? null;
  }

  /**
   * Guarda quando o limite de uso do motor libera. Sem horário (ou ilegível),
   * não há o que guardar: o pedido seguinte tenta o motor de novo.
   */
  registrarLimiteDoMotor(motor: Motor, liberaEm: string | null): void {
    if (liberaEm === null || Number.isNaN(Date.parse(liberaEm))) {
      return;
    }
    this.liberaEmPorMotor = { ...this.liberaEmPorMotor, [motor]: liberaEm };
  }

  /** O motor respondeu bem: o limite que se conhecia dele já não vale. */
  liberarLimiteDoMotor(motor: Motor): void {
    if (this.liberaEmPorMotor[motor] === undefined) {
      return;
    }
    const restantes = { ...this.liberaEmPorMotor };
    delete restantes[motor];
    this.liberaEmPorMotor = restantes;
  }

  /**
   * O motor com que um pedido novo começa: o do Orquestrador, salvo se o
   * limite de uso dele ainda não liberou — então o primeiro da reserva cujo
   * limite já liberou. Com todos no limite, o principal: o pedido tenta e entra
   * na espera de sempre.
   *
   * `preferido`: o motor que o pedido pede para continuar (a execução de um
   * Plano segue no motor que o propôs, que guarda a conversa dele); vale se
   * está na ordem do Orquestrador e fora do limite.
   */
  motorParaComecar(agora: Date, preferido?: Motor): Motor {
    const ordem = this.configuracaoAtual.motoresEmOrdem;
    const livre = (motor: Motor): boolean => this.limiteAtivoDoMotor(motor, agora) === null;
    if (preferido !== undefined && ordem.includes(preferido) && livre(preferido)) {
      return preferido;
    }
    return ordem.find(livre) ?? this.configuracaoAtual.motorDoOrquestrador;
  }

  /** Quando o limite de uso do motor libera (ISO), se ainda não liberou em `agora`; senão `null`. */
  limiteAtivoDoMotor(motor: Motor, agora: Date): string | null {
    const liberaEm = this.liberaEmPorMotor[motor];
    return liberaEm !== undefined && Date.parse(liberaEm) > agora.getTime() ? liberaEm : null;
  }

  /**
   * O que a sessão de `motor` não viu da conversa, para ele assumir o pedido
   * sem perder o fio (ver `contextoDaTroca`). Um turno em andamento não entra:
   * é o pedido que vai rodar agora.
   */
  contextoDaTroca(motor: Motor): string | null {
    return montarContextoDaTroca(
      this.turnos.map((turno) => ({
        texto: turno.texto,
        resposta: turno.resposta,
        situacao: turno.situacao,
        motivoDaFalha: turno.motivoDaFalha,
        motor: turno.motor,
      })),
      motor,
    );
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

  /** A retomada automática marcada, ou `null` sem nenhuma. */
  get retomadaPendente(): DadosDaRetomadaPendente | null {
    return this.retomadaAtual === null ? null : { ...this.retomadaAtual };
  }

  /** Marca (ou remarca) a retomada automática; no máximo uma por Orquestrador. */
  agendarRetomada(retomada: DadosDaRetomadaPendente): void {
    this.retomadaAtual = { ...retomada };
  }

  /** Tira a retomada marcada; diz se havia uma. */
  limparRetomada(): boolean {
    const havia = this.retomadaAtual !== null;
    this.retomadaAtual = null;
    return havia;
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
   * Nome, pasta, configuração, worktree e a fila de pedidos continuam os mesmos;
   * uma retomada marcada sai junto com o turno que ela retomaria. As sessões
   * dos outros motores também se perdem (cada um abre outra); o limite de uso
   * de cada motor é da assinatura, não da conversa, e fica.
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
    this.retomadaAtual = null;
    this.sessaoAtual = novaSessaoId;
    this.sessaoJaIniciada = false;
    this.sessoesDosOutrosMotores = {};
    this.instrucoesJaEnviadas = false;
    return { tipo: "conversa_limpa", turnosAnteriores, planoDescartado, worktreeComAlteracoes };
  }

  /**
   * `motor`: quem executa o turno; sem ele, o motor do Orquestrador. Num motor
   * de reserva, o turno roda com a configuração dele (`paraMotor`), e é essa a
   * que o evento registra.
   */
  iniciarTurno(
    turnoId: string,
    texto: string,
    agora: Date,
    anexos: readonly Anexo[] = [],
    modo: ModoDoTurno = "execucao",
    motor: Motor = this.configuracaoAtual.motorDoOrquestrador,
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
    const problemaDosAnexos = problemaDosAnexosDaMensagem(anexos);
    if (problemaDosAnexos !== null) {
      throw new ErroDeOrquestracao("dados_invalidos", problemaDosAnexos);
    }
    if (this.turnoEmAndamento !== null) {
      throw new ErroDeOrquestracao(
        "turno_em_andamento",
        `"${this.nome}" ainda está trabalhando no pedido anterior. Aguarde terminar ou cancele.`,
      );
    }

    const dadosDosAnexos = anexos.map((anexo) => anexo.paraDados());
    this.turnos.push(Turno.iniciar(turnoId, mensagem, agora, dadosDosAnexos, modo, motor));
    // Seja a própria retomada ou um pedido do usuário, a marcada deixa de valer.
    this.retomadaAtual = null;
    return {
      tipo: "turno_iniciado",
      turnoId,
      texto: mensagem,
      configuracao: this.configuracaoAtual.paraMotor(motor).paraDados(),
      anexos: dadosDosAnexos,
      modo,
      motor,
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

  /**
   * A sessão que o turno anuncia (`sessao_iniciada`) é a do motor que o
   * executa: no Claude Code, a que o app gerou passa a existir; nos outros, o
   * id que o evento traz, se trouxer.
   */
  registrarDoMotor(turnoId: string, evento: EventoDoMotor): EventoDeOrquestracao {
    if (evento.tipo === "sessao_iniciada") {
      const motor = this.turnos.find((turno) => turno.id === turnoId)?.motor ?? MOTOR_PADRAO;
      if (motor === "claude-code") {
        this.sessaoJaIniciada = true;
      } else if (evento.sessaoDoMotor !== undefined) {
        this.registrarSessaoDoMotor(motor, evento.sessaoDoMotor);
      }
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
   *
   * `previasParaFechar`: os endereços das prévias ao vivo que ele pediu para
   * fechar (bloco ```previa-do-app), já fora do texto. Só vão no evento, para a
   * tela agir na hora: não ficam no turno, para reler o histórico não fechar
   * prévias de novo.
   */
  concluirTurno(
    turnoId: string,
    resposta: string,
    uso: UsoDoTurno,
    agora: Date,
    planoProposto = false,
    perguntas: readonly PerguntaDoApp[] = [],
    previasParaFechar: readonly string[] = [],
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
      ...(previasParaFechar.length === 0 ? {} : { previasParaFechar: [...previasParaFechar] }),
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
      nome: this.nomeAtual,
      pastaDeTrabalho: this.pastaDeTrabalho.caminho,
      sessaoId: this.sessaoAtual,
      sessaoIniciada: this.sessaoJaIniciada,
      criadoEm: new Date(this.criadoEmMs).toISOString(),
      configuracao: this.configuracaoAtual.paraDados(),
      turnos: this.turnos.map((turno) => turno.paraDados()),
      worktree: this.worktreeAtual === null ? null : { ...this.worktreeAtual },
      fila: this.filaAtual.map((pedido) => pedido.paraDados()),
      instrucoesNaConversa: this.instrucoesJaEnviadas,
      retomadaPendente: this.retomadaAtual === null ? null : { ...this.retomadaAtual },
      sessoesDosMotores: { ...this.sessoesDosOutrosMotores },
      liberaEmDosMotores: { ...this.liberaEmPorMotor },
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
