import { Anexo } from "./Anexo";
import { ArmazemDeAnexos } from "./ArmazemDeAnexos";
import {
  AlteracoesDaConfiguracao,
  ConfiguracaoDoOrquestrador,
  DadosDaConfiguracao,
} from "./ConfiguracaoDoOrquestrador";
import { ControleDeExecucoes, PublicadorDeEventos } from "./ControleDeExecucoes";
import { ErroDeOrquestracao } from "./ErroDeOrquestracao";
import { EventoDeOrquestracao, EventoDoMotor } from "./EventoDeOrquestracao";
import { MotorDeAgentes, ResultadoDoTurno } from "./MotorDeAgentes";
import { Orquestrador } from "./Orquestrador";
import { PastaDeTrabalho } from "./PastaDeTrabalho";
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
}

function descreverErro(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

/**
 * Casos de uso da orquestração: criar Orquestradores, conversar com eles e
 * cancelar o que estiverem fazendo.
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
   * Inicia um turno e devolve assim que ele começa; o trabalho segue em
   * segundo plano e é acompanhado pelos eventos.
   */
  async enviarMensagem(id: string, texto: string, imagens: readonly ImagemRecebida[] = []): Promise<MensagemEnviada> {
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
    const inicio = orquestrador.iniciarTurno(turnoId, texto, agora(), anexosDoTurno);
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

    const conclusao = this.executar(orquestrador, turnoId, sinal).finally(() =>
      execucoes.encerrar(orquestrador.id),
    );
    return { turnoId, conclusao };
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

  private async executar(orquestrador: Orquestrador, turnoId: string, sinal: AbortSignal): Promise<void> {
    const { motor, repositorio, anexos, worktrees, agora } = this.dependencias;
    const turno = orquestrador.turnoEmAndamento;
    const anexosDoTurno = turno?.anexos ?? [];

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
          configuracao: orquestrador.configuracao,
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

    try {
      if (sinal.aborted) {
        this.publicar(orquestrador, orquestrador.cancelarTurno(turnoId, agora()));
      } else if (resultado !== null && resultado.sucesso) {
        this.publicar(
          orquestrador,
          orquestrador.concluirTurno(turnoId, resultado.resposta, resultado.uso, agora()),
        );
      } else {
        const motivo = resultado !== null && !resultado.sucesso ? resultado.motivo : descreverErro(erro);
        this.publicar(orquestrador, orquestrador.falharTurno(turnoId, motivo, agora()));
      }
      await repositorio.salvar(orquestrador);
    } catch (falha) {
      console.error(`[orquestracao] Não foi possível encerrar o turno ${turnoId}:`, falha);
    }
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
