import { DadosDaEtapa, EtapaDaRotina } from "./EtapaDaRotina";
import { ControleDeExecucoesDeRotinas } from "./ControleDeExecucoesDeRotinas";
import {
  ErroDeRotina,
  MENSAGEM_DE_EXECUCAO_NAO_ENCONTRADA,
  MENSAGEM_DE_ROTINA_NAO_ENCONTRADA,
} from "./ErroDeRotina";
import { PublicadorDeRotinas } from "./EventoDeRotina";
import { ExecucaoDaRotina, OrigemDaExecucao } from "./ExecucaoDaRotina";
import { ExecutorDePedidos, ResultadoDoPedidoDaRotina } from "./ExecutorDePedidos";
import { DadosDoGatilho } from "./Gatilho";
import { RepositorioDeExecucoes } from "./RepositorioDeExecucoes";
import { RepositorioDeRotinas } from "./RepositorioDeRotinas";
import { AoPerder, Rotina } from "./Rotina";
import { Temporizador } from "./Temporizador";

export const LIMITE_DE_ROTINAS = 50;
/**
 * Quanto uma hora marcada pode atrasar e ainda contar como "na hora". Passou
 * disso (o computador dormiu, o app ficou parado), vale a regra do `aoPerder`.
 */
export const TOLERANCIA_DE_ATRASO_EM_MS = 5 * 60_000;

export const MENSAGEM_DE_LIMITE_DE_ROTINAS = `Você pode ter até ${LIMITE_DE_ROTINAS} rotinas. Remova alguma para criar outra.`;
export const MOTIVO_DE_ROTINA_REMOVIDA = "A rotina foi removida.";
export const MOTIVO_DE_CANCELAMENTO = "Cancelada pelo usuário.";
export const MOTIVO_DE_INTERRUPCAO = "O app foi fechado durante a execução.";
export const MOTIVO_DE_OCORRENCIA_PERDIDA = "O app estava fechado na hora agendada.";
export const MOTIVO_DE_EXECUCAO_EM_ANDAMENTO = "A execução anterior ainda está em andamento.";
export const MOTIVO_DE_EXECUCAO_AGUARDANDO = "A execução anterior ainda aguarda aprovação.";

const UM_MINUTO_EM_MS = 60_000;

export interface DependenciasDoServicoDeRotinas {
  repositorioDeRotinas: RepositorioDeRotinas;
  repositorioDeExecucoes: RepositorioDeExecucoes;
  executor: ExecutorDePedidos;
  publicador: PublicadorDeRotinas;
  controle: ControleDeExecucoesDeRotinas;
  temporizador: Temporizador;
  gerarId: () => string;
  agora: () => Date;
}

export interface PedidoDeRotina {
  nome: string;
  gatilho: DadosDoGatilho;
  etapas: readonly DadosDaEtapa[];
  aoPerder?: AoPerder | undefined;
  /** Padrão: ativa. */
  ativa?: boolean | undefined;
}

/** Só o que vier preenchido muda; o resto da Rotina fica como está. */
export interface AlteracoesPedidasDaRotina {
  nome?: string | undefined;
  gatilho?: DadosDoGatilho | undefined;
  etapas?: readonly DadosDaEtapa[] | undefined;
  aoPerder?: AoPerder | undefined;
  ativa?: boolean | undefined;
}

type RetomadaDaExecucao = "etapa_atual" | "plano_aprovado";

function detalheDe(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

/**
 * Casos de uso das Rotinas: criar, alterar, executar, aprovar e acompanhar.
 *
 * Não guarda estado: Rotinas e execuções vêm dos repositórios; o que está
 * rodando agora fica no controle de execuções; o relógio, o temporizador e o
 * gerador de identidade são injetados. Os Orquestradores só são alcançados
 * pelo `ExecutorDePedidos`.
 */
export class ServicoDeRotinas {
  constructor(private readonly dependencias: DependenciasDoServicoDeRotinas) {}

  listar(): readonly Rotina[] {
    return this.dependencias.repositorioDeRotinas.todas();
  }

  buscar(id: string): Rotina {
    const rotina = this.dependencias.repositorioDeRotinas.buscar(id);
    if (rotina === null) {
      throw new ErroDeRotina("nao_encontrado", MENSAGEM_DE_ROTINA_NAO_ENCONTRADA);
    }
    return rotina;
  }

  /** A execução da Rotina que roda ou espera aprovação, se houver. */
  execucaoAtivaDaRotina(rotinaId: string): ExecucaoDaRotina | null {
    return this.dependencias.repositorioDeExecucoes.ativaDaRotina(rotinaId);
  }

  /** Da mais recente para a mais antiga. */
  listarExecucoes(rotinaId: string): readonly ExecucaoDaRotina[] {
    this.buscar(rotinaId);
    return this.dependencias.repositorioDeExecucoes.daRotina(rotinaId);
  }

  async criar(pedido: PedidoDeRotina): Promise<Rotina> {
    const { repositorioDeRotinas, publicador, gerarId, agora } = this.dependencias;
    const rotina = Rotina.criar({ ...pedido, id: gerarId(), agora: agora() });
    await this.garantirOrquestradores(rotina.etapas);
    // O limite é conferido depois da espera: dois pedidos juntos não passam dele.
    if (repositorioDeRotinas.todas().length >= LIMITE_DE_ROTINAS) {
      throw new ErroDeRotina("conflito", MENSAGEM_DE_LIMITE_DE_ROTINAS);
    }
    await repositorioDeRotinas.salvar(rotina);
    publicador.publicar({ tipo: "rotina_criada", rotina: rotina.paraDados() });
    return rotina;
  }

  /**
   * Aplica as alterações numa cópia buscada do repositório: se alguma for
   * inválida, a exceção descarta a cópia e nada é gravado. Ativar e desativar
   * entram aqui como `ativa`. Execuções em curso não mudam: guardam as etapas
   * de quando começaram.
   */
  async alterar(id: string, alteracoes: AlteracoesPedidasDaRotina): Promise<Rotina> {
    const { repositorioDeRotinas, publicador, agora } = this.dependencias;
    // Primeiro numa cópia descartável, para recusar o inválido antes de qualquer espera.
    const tentativa = this.buscar(id);
    this.aplicar(tentativa, alteracoes, agora());
    if (alteracoes.etapas !== undefined) {
      await this.garantirOrquestradores(tentativa.etapas);
    }

    // A Rotina pode ter mudado (a agenda anda) durante a espera: a alteração vale sobre a versão de agora.
    const rotina = this.buscar(id);
    const antes = JSON.stringify(rotina.paraDados());
    this.aplicar(rotina, alteracoes, agora());
    if (JSON.stringify(rotina.paraDados()) === antes) {
      return rotina;
    }
    await repositorioDeRotinas.salvar(rotina);
    publicador.publicar({ tipo: "rotina_alterada", rotina: rotina.paraDados() });
    return rotina;
  }

  /**
   * As execuções em curso são canceladas (e o plano que esperava aprovação é
   * descartado); as execuções guardadas saem junto com a Rotina.
   */
  async remover(id: string): Promise<void> {
    const { repositorioDeRotinas, repositorioDeExecucoes, controle, publicador, agora } = this.dependencias;
    this.buscar(id);
    const aguardando = repositorioDeExecucoes.ativaDaRotina(id);
    const orquestradorDoPlano = aguardando === null ? null : this.orquestradorDoPlanoPendente(aguardando);
    for (const execucao of controle.daRotina(id)) {
      if (execucao.ativa) {
        execucao.cancelar(MOTIVO_DE_ROTINA_REMOVIDA, agora());
      }
      controle.abortar(execucao.id);
    }
    await repositorioDeRotinas.remover(id);
    publicador.publicar({ tipo: "rotina_removida", id });
    await this.descartarPlano(orquestradorDoPlano);
  }

  /**
   * Começa uma execução agora, a pedido do usuário, e devolve sem esperar o
   * fim: ela corre por trás e avisa pelos eventos. Não mexe na agenda.
   */
  async executarAgora(id: string): Promise<ExecucaoDaRotina> {
    const rotina = this.buscar(id);
    const ativa = this.dependencias.repositorioDeExecucoes.ativaDaRotina(id);
    if (ativa !== null) {
      throw new ErroDeRotina(
        "conflito",
        ativa.situacao === "aguardando_aprovacao"
          ? "Esta rotina tem uma execução aguardando aprovação. Aprove, recuse ou cancele antes de executar de novo."
          : "Esta rotina já está em execução.",
      );
    }
    const agora = this.dependencias.agora();
    rotina.registrarExecucao(agora);
    return this.comecar(rotina, "manual", agora);
  }

  /**
   * O usuário aprovou o que a execução esperava. Uma etapa de aprovação segue
   * para a próxima; um plano é entregue ao Orquestrador para ser executado.
   * Devolve sem esperar o fim.
   */
  async aprovar(execucaoId: string): Promise<ExecucaoDaRotina> {
    const { publicador, controle, agora } = this.dependencias;
    const execucao = this.buscarExecucao(execucaoId);
    const indice = execucao.posicaoDaEtapaAtual ?? 0;
    const aprovado = execucao.aprovar(agora());
    await this.guardar(execucao);

    if (aprovado === "plano") {
      publicador.publicar({ tipo: "etapa_iniciada", execucao: execucao.paraDados(), indice });
    } else {
      publicador.publicar({ tipo: "etapa_concluida", execucao: execucao.paraDados(), indice });
      if (!execucao.ativa) {
        publicador.publicar({ tipo: "execucao_encerrada", execucao: execucao.paraDados(), situacao: execucao.situacao });
      }
    }

    const instantaneo = ExecucaoDaRotina.reconstituir(execucao.paraDados());
    if (execucao.ativa) {
      const retomada: RetomadaDaExecucao = aprovado === "plano" ? "plano_aprovado" : "etapa_atual";
      controle.iniciar(execucao, (sinal) => this.conduzir(execucao, sinal, retomada));
    }
    return instantaneo;
  }

  /** Encerra a execução como `recusada`; um plano que esperava é descartado no Orquestrador. */
  async recusar(execucaoId: string, motivo?: string): Promise<ExecucaoDaRotina> {
    const execucao = this.buscarExecucao(execucaoId);
    const orquestradorDoPlano = this.orquestradorDoPlanoPendente(execucao);
    execucao.recusar(this.dependencias.agora(), motivo);
    await this.encerrada(execucao);
    await this.descartarPlano(orquestradorDoPlano);
    return execucao;
  }

  /** Vale para a execução que roda (o pedido em curso é abortado) e para a que espera aprovação. */
  async cancelar(execucaoId: string): Promise<ExecucaoDaRotina> {
    const { controle, agora } = this.dependencias;
    const viva = controle.buscar(execucaoId);
    if (viva !== null) {
      const orquestradorDoPlano = this.orquestradorDoPlanoPendente(viva);
      // Muda a instância que o condutor usa antes de abortar: ele acorda e encontra a execução já cancelada.
      viva.cancelar(MOTIVO_DE_CANCELAMENTO, agora());
      controle.abortar(execucaoId);
      await this.encerrada(viva);
      await this.descartarPlano(orquestradorDoPlano);
      return ExecucaoDaRotina.reconstituir(viva.paraDados());
    }
    const execucao = this.buscarExecucao(execucaoId);
    const orquestradorDoPlano = this.orquestradorDoPlanoPendente(execucao);
    execucao.cancelar(MOTIVO_DE_CANCELAMENTO, agora());
    await this.encerrada(execucao);
    await this.descartarPlano(orquestradorDoPlano);
    return execucao;
  }

  /**
   * Ao abrir o app: o que estava `em_andamento` não está mais (o app fechou)
   * e vira `interrompida`; o que esperava aprovação continua aprovável; e as
   * horas que passaram com o app fechado seguem o `aoPerder` da Rotina, no
   * máximo uma execução de recuperação por Rotina.
   */
  async recuperarAoIniciar(): Promise<void> {
    const { repositorioDeExecucoes, repositorioDeRotinas, controle, agora } = this.dependencias;
    const instante = agora();

    for (const execucao of repositorioDeExecucoes.ativas()) {
      if (execucao.situacao !== "em_andamento" || controle.buscar(execucao.id) !== null) {
        continue;
      }
      try {
        execucao.interromper(MOTIVO_DE_INTERRUPCAO, instante);
        await this.encerrada(execucao);
      } catch (erro) {
        console.error(`[rotinas] Falha ao marcar a execução "${execucao.id}" como interrompida:`, erro);
      }
    }

    for (const { id } of repositorioDeRotinas.todas()) {
      await this.dispararSeVenceu(id, instante, "perdida");
    }
  }

  /**
   * Um ciclo do agendador: dispara as Rotinas cuja hora chegou. Hora que
   * atrasou além da tolerância (o computador dormiu) conta como perdida.
   */
  async dispararVencidas(): Promise<void> {
    const instante = this.dependencias.agora();
    for (const { id } of this.dependencias.repositorioDeRotinas.todas()) {
      await this.dispararSeVenceu(id, instante, null);
    }
  }

  /**
   * O app vai fechar: as execuções que rodam são abortadas e ficam
   * `interrompida`. As que esperam aprovação ficam como estão.
   */
  async interromperEmAndamento(): Promise<void> {
    const { controle, agora } = this.dependencias;
    const instante = agora();
    const interrompidas: ExecucaoDaRotina[] = [];
    for (const execucao of controle.todas()) {
      if (execucao.situacao === "em_andamento") {
        execucao.interromper(MOTIVO_DE_INTERRUPCAO, instante);
        interrompidas.push(execucao);
      }
      controle.abortar(execucao.id);
    }
    await Promise.all(interrompidas.map((execucao) => this.encerrada(execucao)));
    await controle.aguardarTodas();
  }

  private aplicar(rotina: Rotina, alteracoes: AlteracoesPedidasDaRotina, agora: Date): void {
    const { ativa, ...resto } = alteracoes;
    rotina.alterar(resto, agora);
    if (ativa === true) {
      rotina.ativar(agora);
    } else if (ativa === false) {
      rotina.desativar();
    }
  }

  private async garantirOrquestradores(etapas: readonly EtapaDaRotina[]): Promise<void> {
    const { executor } = this.dependencias;
    const pedidos = etapas.flatMap((etapa, indice) =>
      etapa.dados.tipo === "pedido" ? [{ posicao: indice + 1, orquestradorId: etapa.dados.orquestradorId }] : [],
    );
    const existentes = new Map<string, boolean>();
    for (const orquestradorId of new Set(pedidos.map((pedido) => pedido.orquestradorId))) {
      existentes.set(orquestradorId, await executor.orquestradorExiste(orquestradorId));
    }
    const ausente = pedidos.find((pedido) => existentes.get(pedido.orquestradorId) !== true);
    if (ausente !== undefined) {
      throw new ErroDeRotina("dados_invalidos", `O orquestrador escolhido na etapa ${ausente.posicao} não existe.`);
    }
  }

  /** O Orquestrador que guarda o plano que a execução espera aprovar, se for o caso. */
  private orquestradorDoPlanoPendente(execucao: ExecucaoDaRotina): string | null {
    const etapa = execucao.etapaAtual;
    if (execucao.pendencia?.tipo !== "plano" || etapa === null || etapa.dados.tipo !== "pedido") {
      return null;
    }
    return etapa.dados.orquestradorId;
  }

  /** O plano não aprovado não pode ficar pendente no Orquestrador; se não der para descartá-lo, só se registra. */
  private async descartarPlano(orquestradorId: string | null): Promise<void> {
    if (orquestradorId === null) {
      return;
    }
    try {
      await this.dependencias.executor.descartarPlano(orquestradorId);
    } catch (erro) {
      console.error(`[rotinas] Não foi possível descartar o plano pendente do orquestrador "${orquestradorId}":`, erro);
    }
  }

  private buscarExecucao(id: string): ExecucaoDaRotina {
    const execucao = this.dependencias.repositorioDeExecucoes.buscarExecucao(id);
    if (execucao === null) {
      throw new ErroDeRotina("nao_encontrado", MENSAGEM_DE_EXECUCAO_NAO_ENCONTRADA);
    }
    return execucao;
  }

  /**
   * `origem` nula: a Rotina venceu num ciclo normal; só vira perdida se atrasou
   * além da tolerância. Relê a Rotina: ela pode ter mudado desde a listagem.
   */
  private async dispararSeVenceu(id: string, instante: Date, origem: "perdida" | null): Promise<void> {
    try {
      const rotina = this.dependencias.repositorioDeRotinas.buscar(id);
      if (rotina === null || !rotina.venceu(instante)) {
        return;
      }
      const perdida = origem === "perdida" || rotina.atrasoEm(instante) > TOLERANCIA_DE_ATRASO_EM_MS;
      await this.dispararPorAgenda(rotina, perdida ? "perdida" : "agendada", instante);
    } catch (erro) {
      console.error(`[rotinas] Falha ao disparar a rotina "${id}":`, erro);
    }
  }

  /**
   * A hora marcada da Rotina chegou. A agenda sempre anda para a frente (o que
   * passou não se repete); a execução é pulada, com o motivo registrado, se a
   * anterior ainda não terminou ou se uma hora perdida manda pular.
   */
  private async dispararPorAgenda(rotina: Rotina, origem: "agendada" | "perdida", agora: Date): Promise<void> {
    const { repositorioDeRotinas, repositorioDeExecucoes, publicador, gerarId } = this.dependencias;
    const ativa = repositorioDeExecucoes.ativaDaRotina(rotina.id);
    let motivoDoSalto: string | null = null;
    if (ativa !== null) {
      motivoDoSalto = ativa.situacao === "aguardando_aprovacao" ? MOTIVO_DE_EXECUCAO_AGUARDANDO : MOTIVO_DE_EXECUCAO_EM_ANDAMENTO;
    } else if (origem === "perdida" && rotina.aoPerder === "pular") {
      motivoDoSalto = MOTIVO_DE_OCORRENCIA_PERDIDA;
    }

    rotina.avancarAgenda(agora);
    if (motivoDoSalto === null) {
      rotina.registrarExecucao(agora);
      await this.comecar(rotina, origem, agora);
      return;
    }

    const execucao = ExecucaoDaRotina.pular({ id: gerarId(), rotina, origem, agora, motivo: motivoDoSalto });
    await Promise.all([repositorioDeRotinas.salvar(rotina), repositorioDeExecucoes.salvarExecucao(execucao)]);
    publicador.publicar({ tipo: "rotina_alterada", rotina: rotina.paraDados() });
    publicador.publicar({ tipo: "execucao_encerrada", execucao: execucao.paraDados(), situacao: execucao.situacao });
  }

  /** Grava a Rotina (com a agenda e a última execução já ajustadas) e a nova execução, e começa a conduzi-la. */
  private async comecar(rotina: Rotina, origem: OrigemDaExecucao, agora: Date): Promise<ExecucaoDaRotina> {
    const { repositorioDeRotinas, repositorioDeExecucoes, publicador, controle, gerarId } = this.dependencias;
    const execucao = ExecucaoDaRotina.iniciar({ id: gerarId(), rotina, origem, agora });
    // As duas gravações são pedidas sem espera entre elas: outra execução da mesma Rotina já encontra esta.
    await Promise.all([repositorioDeRotinas.salvar(rotina), repositorioDeExecucoes.salvarExecucao(execucao)]);
    publicador.publicar({ tipo: "rotina_alterada", rotina: rotina.paraDados() });
    publicador.publicar({ tipo: "execucao_iniciada", execucao: execucao.paraDados() });
    const instantaneo = ExecucaoDaRotina.reconstituir(execucao.paraDados());
    controle.iniciar(execucao, (sinal) => this.conduzir(execucao, sinal, "etapa_atual"));
    return instantaneo;
  }

  private async guardar(execucao: ExecucaoDaRotina): Promise<void> {
    await this.dependencias.repositorioDeExecucoes.salvarExecucao(execucao);
  }

  private async encerrada(execucao: ExecucaoDaRotina): Promise<void> {
    await this.guardar(execucao);
    this.dependencias.publicador.publicar({
      tipo: "execucao_encerrada",
      execucao: execucao.paraDados(),
      situacao: execucao.situacao,
    });
  }

  /** O condutor de uma execução: o que escapar dele vira falha da execução, nunca exceção solta. */
  private async conduzir(execucao: ExecucaoDaRotina, sinal: AbortSignal, retomada: RetomadaDaExecucao): Promise<void> {
    try {
      await this.percorrer(execucao, sinal, retomada === "plano_aprovado");
    } catch (erro) {
      console.error(`[rotinas] Erro inesperado na execução "${execucao.id}":`, erro);
      if (sinal.aborted || execucao.situacao !== "em_andamento") {
        return;
      }
      try {
        execucao.falhar(`Erro inesperado: ${detalheDe(erro)}`, this.dependencias.agora());
        await this.encerrada(execucao);
      } catch (erroAoFalhar) {
        console.error(`[rotinas] Não foi possível registrar a falha da execução "${execucao.id}":`, erroAoFalhar);
      }
    }
  }

  /**
   * Roda as etapas em ordem até a execução terminar ou parar esperando o
   * usuário. Se o sinal abortar, sai sem mexer em nada: quem abortou já
   * deixou a execução no estado certo.
   */
  private async percorrer(execucao: ExecucaoDaRotina, sinal: AbortSignal, aprovandoPlano: boolean): Promise<void> {
    const { publicador, agora } = this.dependencias;
    let planoAprovado = aprovandoPlano;

    while (execucao.situacao === "em_andamento") {
      if (sinal.aborted) {
        return;
      }
      const etapa = execucao.etapaAtual;
      const indice = execucao.posicaoDaEtapaAtual;
      if (etapa === null || indice === null) {
        return;
      }

      if (!execucao.etapaIniciada) {
        execucao.iniciarEtapa(agora());
        await this.guardar(execucao);
        if (sinal.aborted) {
          return;
        }
        publicador.publicar({ tipo: "etapa_iniciada", execucao: execucao.paraDados(), indice });
      }

      const dados = etapa.dados;
      if (dados.tipo === "aprovacao") {
        execucao.aguardarAprovacao();
        await this.guardar(execucao);
        publicador.publicar({ tipo: "aguardando_aprovacao", execucao: execucao.paraDados() });
        return;
      }

      if (dados.tipo === "espera") {
        await this.esperar(dados.minutos * UM_MINUTO_EM_MS, sinal);
        if (sinal.aborted) {
          return;
        }
        await this.concluirEtapa(execucao, null, indice);
        continue;
      }

      const resultado = await this.pedirAoOrquestrador(dados, planoAprovado, sinal);
      planoAprovado = false;
      if (sinal.aborted) {
        return;
      }
      await this.aplicarResultado(execucao, resultado, indice);
    }
  }

  private async pedirAoOrquestrador(
    pedido: { orquestradorId: string; texto: string; modo: "execucao" | "planejamento" },
    planoAprovado: boolean,
    sinal: AbortSignal,
  ): Promise<ResultadoDoPedidoDaRotina> {
    const { executor } = this.dependencias;
    try {
      if (planoAprovado) {
        return await executor.aprovarPlano(pedido.orquestradorId, sinal);
      }
      return await executor.executar(
        { orquestradorId: pedido.orquestradorId, texto: pedido.texto, modo: pedido.modo },
        sinal,
      );
    } catch (erro) {
      return { situacao: "falhou", motivo: `Não foi possível falar com o orquestrador: ${detalheDe(erro)}` };
    }
  }

  private async aplicarResultado(
    execucao: ExecucaoDaRotina,
    resultado: ResultadoDoPedidoDaRotina,
    indice: number,
  ): Promise<void> {
    const { publicador, agora } = this.dependencias;
    switch (resultado.situacao) {
      case "concluido":
        await this.concluirEtapa(execucao, resultado.resposta, indice);
        return;
      case "plano_para_aprovacao":
        execucao.aguardarAprovacaoDoPlano(resultado.plano);
        await this.guardar(execucao);
        publicador.publicar({ tipo: "aguardando_aprovacao", execucao: execucao.paraDados() });
        return;
      case "falhou":
        execucao.falhar(resultado.motivo, agora());
        await this.encerrada(execucao);
        return;
      case "cancelado":
        execucao.cancelar(resultado.motivo, agora());
        await this.encerrada(execucao);
        return;
    }
  }

  private async concluirEtapa(execucao: ExecucaoDaRotina, resposta: string | null, indice: number): Promise<void> {
    const { publicador, agora } = this.dependencias;
    execucao.concluirEtapa(resposta, agora());
    await this.guardar(execucao);
    publicador.publicar({ tipo: "etapa_concluida", execucao: execucao.paraDados(), indice });
    if (!execucao.ativa) {
      publicador.publicar({ tipo: "execucao_encerrada", execucao: execucao.paraDados(), situacao: execucao.situacao });
    }
  }

  /** Espera `ms` pelo temporizador; o sinal abortado encerra a espera na hora. */
  private esperar(ms: number, sinal: AbortSignal): Promise<void> {
    const { temporizador } = this.dependencias;
    return new Promise((resolver) => {
      if (sinal.aborted) {
        resolver();
        return;
      }
      let cancelarAviso: () => void = () => undefined;
      const aoAbortar = (): void => {
        cancelarAviso();
        resolver();
      };
      cancelarAviso = temporizador.agendar(() => {
        sinal.removeEventListener("abort", aoAbortar);
        resolver();
      }, ms);
      sinal.addEventListener("abort", aoAbortar, { once: true });
    });
  }
}
