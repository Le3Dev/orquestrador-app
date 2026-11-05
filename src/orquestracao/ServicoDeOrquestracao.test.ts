import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ControleDeExecucoesEmMemoria } from "../infraestrutura/execucoes/ControleDeExecucoesEmMemoria";
import { Anexo } from "./Anexo";
import { ArmazemDeAnexos } from "./ArmazemDeAnexos";
import { DadosDaConfiguracao } from "./ConfiguracaoDoOrquestrador";
import { ConsumoDoTurno } from "./ConsumoDoTurno";
import { ConsultaDeEsforcoHerdado, EsforcoDaMaquina } from "./EsforcoDaMaquina";
import { EsforcoHerdado } from "./EsforcoHerdado";
import { EventoDeOrquestracao, EventoDoMotor, EventoRegistrado, SinalDeVida } from "./EventoDeOrquestracao";
import { MARCADOR_DE_PLANO } from "./InstrucoesDoOrquestrador";
import { MedidorDeConsumo, PeriodoDoTurno } from "./MedidorDeConsumo";
import { UsoDeTokens } from "./UsoDeTokens";
import { MotorDeAgentes, PedidoDeTurno, ResultadoDoTurno } from "./MotorDeAgentes";
import { Orquestrador } from "./Orquestrador";
import { PastaDeTrabalho } from "./PastaDeTrabalho";
import { GerenciadorDeWorktrees, PreparoDeWorktree } from "./PreparoDeWorktree";
import { ConversaArquivada, RepositorioDeOrquestradores } from "./RepositorioDeOrquestradores";
import { ServicoDeOrquestracao } from "./ServicoDeOrquestracao";

class RepositorioEmMemoria implements RepositorioDeOrquestradores {
  readonly orquestradores = new Map<string, Orquestrador>();
  readonly eventos: EventoRegistrado[] = [];

  listar(): readonly Orquestrador[] {
    return [...this.orquestradores.values()];
  }
  buscarPorId(id: string): Orquestrador | null {
    return this.orquestradores.get(id) ?? null;
  }
  async salvar(orquestrador: Orquestrador): Promise<void> {
    this.orquestradores.set(orquestrador.id, orquestrador);
  }
  async remover(id: string): Promise<void> {
    this.orquestradores.delete(id);
  }
  anexarEvento(_orquestradorId: string, evento: EventoDeOrquestracao): EventoRegistrado {
    const registrado = { ...evento, sequencia: this.eventos.length + 1, em: "agora" };
    this.eventos.push(registrado);
    return registrado;
  }
  /** Ids dos Orquestradores cujas conversas foram arquivadas, na ordem. */
  readonly arquivamentos: string[] = [];
  arquivarConversa(orquestrador: Orquestrador, evento: EventoDeOrquestracao): ConversaArquivada {
    this.orquestradores.set(orquestrador.id, orquestrador);
    this.arquivamentos.push(orquestrador.id);
    return { registrado: this.anexarEvento(orquestrador.id, evento), gravacao: Promise.resolve() };
  }
  lerEventos(): readonly EventoRegistrado[] {
    return this.eventos;
  }
}

function resultadoComResposta(resposta: string): ResultadoDoTurno {
  return {
    sucesso: true,
    resposta,
    uso: { duracaoMs: 10, tokensDeEntrada: 1, tokensDeSaida: 1, subagentesLancados: 0 },
  };
}

/** Motor que emite os eventos combinados e só termina quando liberado ou abortado. */
class MotorFalso implements MotorDeAgentes {
  pedidos: PedidoDeTurno[] = [];
  eventos: EventoDoMotor[] = [];
  resultado: ResultadoDoTurno = {
    sucesso: true,
    resposta: "síntese",
    uso: { duracaoMs: 10, tokensDeEntrada: 1, tokensDeSaida: 1, subagentesLancados: 1 },
  };
  // Preparar o worktree introduz awaits antes de `executarTurno`, então o
  // `terminar` do teste pode chegar antes de o turno começar. Casamos pedidos
  // de término (`terminacoes`) com turnos iniciados por um contador: cada turno
  // libera quando houver um término correspondente.
  private readonly liberadores: Array<() => void> = [];
  private terminacoes = 0;

  executarTurno(
    pedido: PedidoDeTurno,
    aoObservar: (evento: EventoDoMotor) => void,
    sinal: AbortSignal,
  ): Promise<ResultadoDoTurno> {
    this.pedidos.push(pedido);
    this.eventos.forEach(aoObservar);
    return new Promise((resolver) => {
      if (sinal.aborted) {
        resolver({ sucesso: false, motivo: "morto", uso: null });
        return;
      }
      sinal.addEventListener("abort", () => resolver({ sucesso: false, motivo: "morto", uso: null }));
      const liberar = (): void => resolver(this.resultado);
      if (this.terminacoes > 0) {
        this.terminacoes -= 1;
        liberar();
      } else {
        this.liberadores.push(liberar);
      }
    });
  }

  terminar(): void {
    const liberar = this.liberadores.shift();
    if (liberar === undefined) {
      this.terminacoes += 1;
      return;
    }
    liberar();
  }
}

class ArmazemEmMemoria implements ArmazemDeAnexos {
  readonly guardados = new Map<string, Uint8Array>();
  removidos: string[] = [];

  async guardar(orquestradorId: string, anexo: Anexo, conteudo: Uint8Array): Promise<void> {
    this.guardados.set(this.caminhoDe(orquestradorId, anexo.arquivo), conteudo);
  }
  caminhoDe(orquestradorId: string, arquivo: string): string {
    return `${this.pastaDe(orquestradorId)}/${arquivo}`;
  }
  pastaDe(orquestradorId: string): string {
    return `/anexos/${orquestradorId}`;
  }
  async removerTodos(orquestradorId: string): Promise<void> {
    this.removidos.push(orquestradorId);
  }
}

/** Por padrão não há worktree (pasta sem git): o turno roda na própria pasta. */
class GerenciadorDeWorktreesFalso implements GerenciadorDeWorktrees {
  preparo: PreparoDeWorktree | null = null;
  removerAoConcluir = false;
  concluidos: string[] = [];

  async preparar(_id: string, pastaDeTrabalho: string): Promise<PreparoDeWorktree> {
    return this.preparo ?? { cwd: pastaDeTrabalho, worktree: null };
  }
  async concluir(id: string): Promise<boolean> {
    this.concluidos.push(id);
    return this.removerAoConcluir;
  }
}

const configuracao: DadosDaConfiguracao = {
  modeloDoOrquestrador: "opus",
  modeloDosSubagentes: "haiku",
  quantidadeDeSubagentes: { modo: "fixa", limite: 2 },
  nivelDePermissao: "edicao",
};

describe("ServicoDeOrquestracao", () => {
  let repositorio: RepositorioEmMemoria;
  let motor: MotorFalso;
  let armazem: ArmazemEmMemoria;
  let sinais: SinalDeVida[];
  let publicados: EventoRegistrado[];
  let worktrees: GerenciadorDeWorktreesFalso;
  let servico: ServicoDeOrquestracao;
  let ids: number;

  beforeEach(() => {
    repositorio = new RepositorioEmMemoria();
    motor = new MotorFalso();
    armazem = new ArmazemEmMemoria();
    sinais = [];
    publicados = [];
    worktrees = new GerenciadorDeWorktreesFalso();
    ids = 0;
    servico = new ServicoDeOrquestracao({
      repositorio,
      motor,
      execucoes: new ControleDeExecucoesEmMemoria(),
      publicador: {
        publicar: (_id, evento) => publicados.push(evento),
        sinalizar: (_id, sinal) => sinais.push(sinal),
      },
      anexos: armazem,
      worktrees,
      gerarId: () => `id${++ids}`,
      agora: () => new Date("2026-10-28T12:00:00Z"),
    });
  });

  async function criar(): Promise<Orquestrador> {
    return servico.criarOrquestrador({
      nome: "Painel",
      pastaDeTrabalho: PastaDeTrabalho.dentroDe(path.resolve("/projetos"), "painel"),
      configuracao,
    });
  }

  it("executa um turno completo e grava os eventos na ordem", async () => {
    const orquestrador = await criar();
    motor.eventos = [
      { tipo: "sessao_iniciada" },
      { tipo: "subagente_iniciado", subagenteId: "a", descricao: "Ler", tarefa: "ler tudo" },
      { tipo: "subagente_concluido", subagenteId: "a", situacao: "concluido", resumo: "ok", tokens: 5, duracaoMs: 9 },
    ];

    const { conclusao } = await servico.enviarMensagem(orquestrador.id, "analise");
    motor.terminar();
    await conclusao;

    expect(repositorio.eventos.map((evento) => evento.tipo)).toEqual([
      "turno_iniciado",
      "sessao_iniciada",
      "subagente_iniciado",
      "subagente_concluido",
      "turno_concluido",
    ]);
    expect(orquestrador.ultimoTurno?.resposta).toBe("síntese");
    expect(orquestrador.situacao).toBe("ocioso");
  });

  it("cria a sessão no primeiro turno e a retoma no seguinte", async () => {
    const orquestrador = await criar();
    motor.eventos = [{ tipo: "sessao_iniciada" }];

    const primeiro = await servico.enviarMensagem(orquestrador.id, "um");
    motor.terminar();
    await primeiro.conclusao;
    const segundo = await servico.enviarMensagem(orquestrador.id, "dois");
    motor.terminar();
    await segundo.conclusao;

    expect(motor.pedidos.map((pedido) => pedido.sessaoIniciada)).toEqual([false, true]);
    expect(motor.pedidos[1]?.texto).toBe("dois");
  });

  it("cancelar aborta o motor e registra o turno como cancelado", async () => {
    const orquestrador = await criar();
    const { conclusao } = await servico.enviarMensagem(orquestrador.id, "analise");

    await servico.cancelar(orquestrador.id);
    await conclusao;

    expect(repositorio.eventos.at(-1)?.tipo).toBe("turno_cancelado");
    expect(orquestrador.ultimoTurno?.situacao).toBe("cancelado");
  });

  it("registra a falha do motor com o motivo", async () => {
    const orquestrador = await criar();
    motor.resultado = { sucesso: false, motivo: "Limite de uso atingido.", uso: null };

    const { conclusao } = await servico.enviarMensagem(orquestrador.id, "analise");
    motor.terminar();
    await conclusao;

    expect(repositorio.eventos.at(-1)).toMatchObject({ tipo: "turno_falhou", motivo: "Limite de uso atingido." });
  });

  it("não deixa excluir nem cancelar fora de hora", async () => {
    const orquestrador = await criar();

    await expect(servico.cancelar(orquestrador.id)).rejects.toMatchObject({ motivo: "sem_turno_em_andamento" });

    const { conclusao } = await servico.enviarMensagem(orquestrador.id, "analise");
    await expect(servico.remover(orquestrador.id)).rejects.toMatchObject({ motivo: "turno_em_andamento" });
    await expect(servico.enviarMensagem(orquestrador.id, "outra")).rejects.toMatchObject({
      motivo: "turno_em_andamento",
    });

    motor.terminar();
    await conclusao;
    await servico.remover(orquestrador.id);
    expect(repositorio.buscarPorId(orquestrador.id)).toBeNull();
    expect(armazem.removidos).toEqual([orquestrador.id]);
  });

  it("repassa o sinal de vida para a tela sem gravá-lo no histórico", async () => {
    const orquestrador = await criar();
    motor.eventos = [{ tipo: "sinal_de_vida", tokensPensando: 1234 }];

    const { turnoId, conclusao } = await servico.enviarMensagem(orquestrador.id, "analise");
    motor.terminar();
    await conclusao;

    expect(sinais).toEqual([{ turnoId, em: "2026-10-28T12:00:00.000Z", tokensPensando: 1234 }]);
    expect(repositorio.eventos.map((evento) => evento.tipo)).toEqual(["turno_iniciado", "turno_concluido"]);
  });

  it("guarda as imagens e as entrega ao motor pelo caminho em disco", async () => {
    const orquestrador = await criar();
    const conteudo = new Uint8Array([1, 2, 3]);

    const { conclusao } = await servico.enviarMensagem(orquestrador.id, "veja o print", [
      { nome: "tela.png", tipoDeMidia: "image/png", conteudo },
    ]);
    motor.terminar();
    await conclusao;

    const pedido = motor.pedidos[0];
    expect(pedido?.imagens).toEqual([{ caminho: `/anexos/${orquestrador.id}/id4.png`, tipoDeMidia: "image/png" }]);
    expect(pedido?.pastaDasImagens).toBe(`/anexos/${orquestrador.id}`);
    expect(armazem.guardados.get(`/anexos/${orquestrador.id}/id4.png`)).toBe(conteudo);
    expect(repositorio.eventos[0]).toMatchObject({
      tipo: "turno_iniciado",
      anexos: [{ nome: "tela.png", tipoDeMidia: "image/png", tamanhoEmBytes: 3, arquivo: "id4.png" }],
    });
  });

  it("recusa formato de imagem não suportado antes de iniciar o turno", async () => {
    const orquestrador = await criar();

    await expect(
      servico.enviarMensagem(orquestrador.id, "veja", [
        { nome: "doc.pdf", tipoDeMidia: "application/pdf", conteudo: new Uint8Array([1]) },
      ]),
    ).rejects.toMatchObject({ motivo: "dados_invalidos" });
    expect(orquestrador.situacao).toBe("ocioso");
    expect(armazem.guardados.size).toBe(0);
  });

  it("roda o turno no worktree e o remove quando não houve alterações", async () => {
    const orquestrador = await criar();
    worktrees.preparo = {
      cwd: path.resolve("/dados/worktrees/abc"),
      worktree: { branch: "orquestrador/id1", caminho: path.resolve("/dados/worktrees/abc") },
    };
    worktrees.removerAoConcluir = true;

    const { conclusao } = await servico.enviarMensagem(orquestrador.id, "analise");
    motor.terminar();
    await conclusao;

    expect(motor.pedidos[0]?.pastaDeTrabalho.caminho).toBe(path.resolve("/dados/worktrees/abc"));
    expect(worktrees.concluidos).toEqual([orquestrador.id]);
    expect(orquestrador.worktree).toBeNull();
  });

  it("mantém o worktree com alterações, marcado como inativo entre turnos", async () => {
    const orquestrador = await criar();
    worktrees.preparo = {
      cwd: path.resolve("/dados/worktrees/abc"),
      worktree: { branch: "orquestrador/id1", caminho: path.resolve("/dados/worktrees/abc") },
    };
    worktrees.removerAoConcluir = false;

    const { conclusao } = await servico.enviarMensagem(orquestrador.id, "analise");
    motor.terminar();
    await conclusao;

    expect(orquestrador.worktree).toEqual({
      branch: "orquestrador/id1",
      caminho: path.resolve("/dados/worktrees/abc"),
      ativo: false,
    });
  });

  it("sem repo git, roda na própria pasta e não expõe worktree", async () => {
    const orquestrador = await criar();

    const { conclusao } = await servico.enviarMensagem(orquestrador.id, "analise");
    motor.terminar();
    await conclusao;

    expect(motor.pedidos[0]?.pastaDeTrabalho.caminho).toBe(orquestrador.pastaDeTrabalho.caminho);
    expect(worktrees.concluidos).toEqual([]);
    expect(orquestrador.worktree).toBeNull();
  });

  it("sem imagens, o motor não recebe pasta de imagens", async () => {
    const orquestrador = await criar();

    const { conclusao } = await servico.enviarMensagem(orquestrador.id, "analise");
    motor.terminar();
    await conclusao;

    expect(motor.pedidos[0]).toMatchObject({ imagens: [], pastaDasImagens: null, orquestradorId: orquestrador.id });
  });

  describe("modo de planejamento", () => {
    async function planejar(orquestrador: Orquestrador): Promise<string> {
      motor.eventos = [{ tipo: "sessao_iniciada" }];
      const { turnoId, conclusao } = await servico.enviarMensagem(orquestrador.id, "planeje", [], "planejamento");
      motor.terminar();
      await conclusao;
      motor.eventos = [];
      return turnoId;
    }

    it("o pedido chega ao motor em planejamento e o plano fica pendente", async () => {
      const orquestrador = await criar();

      const turnoId = await planejar(orquestrador);

      expect(motor.pedidos[0]?.modo).toBe("planejamento");
      expect(repositorio.eventos[0]).toMatchObject({ tipo: "turno_iniciado", turnoId, modo: "planejamento" });
      expect(orquestrador.turnoComPlanoPendente?.id).toBe(turnoId);
    });

    it("sem modo informado, o pedido é de execução", async () => {
      const orquestrador = await criar();

      const { conclusao } = await servico.enviarMensagem(orquestrador.id, "analise");
      motor.terminar();
      await conclusao;

      expect(motor.pedidos[0]?.modo).toBe("execucao");
      expect(orquestrador.turnoComPlanoPendente).toBeNull();
    });

    it("aprovar publica a decisão e abre um turno de execução que retoma a sessão", async () => {
      const orquestrador = await criar();
      const turnoDoPlano = await planejar(orquestrador);

      const { turnoId, conclusao } = await servico.aprovarPlano(orquestrador.id, "sem mexer nos testes");
      motor.terminar();
      await conclusao;

      expect(turnoId).not.toBe(turnoDoPlano);
      expect(repositorio.eventos.map((evento) => evento.tipo)).toEqual([
        "turno_iniciado",
        "sessao_iniciada",
        "turno_concluido",
        "plano_aprovado",
        "turno_iniciado",
        "turno_concluido",
      ]);
      expect(repositorio.eventos[3]).toMatchObject({ tipo: "plano_aprovado", turnoId: turnoDoPlano });
      expect(repositorio.eventos[4]).toMatchObject({ tipo: "turno_iniciado", turnoId, modo: "execucao" });

      const execucao = motor.pedidos[1];
      expect(execucao).toMatchObject({ modo: "execucao", sessaoIniciada: true, sessaoId: orquestrador.sessaoId });
      expect(execucao?.texto).toMatch(/^Plano aprovado\. Execute agora o plano/);
      expect(execucao?.texto).toContain("Observações do usuário: sem mexer nos testes");

      const turnos = repositorio.buscarPorId(orquestrador.id)?.paraDados().turnos;
      expect(turnos?.map((turno) => [turno.modo, turno.decisaoDoPlano])).toEqual([
        ["planejamento", "aprovado"],
        ["execucao", null],
      ]);
    });

    it("o planejamento e a execução rodam no mesmo worktree, onde está a sessão", async () => {
      const orquestrador = await criar();
      const caminho = path.resolve("/dados/worktrees/abc");
      worktrees.preparo = { cwd: caminho, worktree: { branch: "orquestrador/id1", caminho } };
      worktrees.removerAoConcluir = true;

      await planejar(orquestrador);
      const { conclusao } = await servico.aprovarPlano(orquestrador.id);
      motor.terminar();
      await conclusao;

      expect(motor.pedidos.map((pedido) => [pedido.modo, pedido.pastaDeTrabalho.caminho])).toEqual([
        ["planejamento", caminho],
        ["execucao", caminho],
      ]);
      expect(worktrees.concluidos).toEqual([orquestrador.id, orquestrador.id]);
    });

    it("descartar publica a decisão e não inicia turno", async () => {
      const orquestrador = await criar();
      const turnoDoPlano = await planejar(orquestrador);

      await servico.descartarPlano(orquestrador.id);

      expect(repositorio.eventos.at(-1)).toEqual(
        expect.objectContaining({ tipo: "plano_descartado", turnoId: turnoDoPlano }),
      );
      expect(motor.pedidos).toHaveLength(1);
      expect(orquestrador.situacao).toBe("ocioso");
      expect(repositorio.buscarPorId(orquestrador.id)?.paraDados().turnos[0]?.decisaoDoPlano).toBe("descartado");
    });

    it("não aprova sem plano pendente nem duas vezes", async () => {
      const orquestrador = await criar();

      await expect(servico.aprovarPlano(orquestrador.id)).rejects.toMatchObject({ motivo: "sem_plano_pendente" });

      await planejar(orquestrador);
      const { conclusao } = await servico.aprovarPlano(orquestrador.id);
      await expect(servico.aprovarPlano(orquestrador.id)).rejects.toMatchObject({ motivo: "sem_plano_pendente" });
      await expect(servico.descartarPlano(orquestrador.id)).rejects.toMatchObject({ motivo: "sem_plano_pendente" });
      motor.terminar();
      await conclusao;
    });

    it("o marcador sai da resposta de um planejamento, que fica pendente como sempre", async () => {
      const orquestrador = await criar();
      motor.resultado = resultadoComResposta(`O plano.\n${MARCADOR_DE_PLANO}`);

      await planejar(orquestrador);

      expect(orquestrador.ultimoTurno?.resposta).not.toContain(MARCADOR_DE_PLANO);
      expect(orquestrador.turnoComPlanoPendente).not.toBeNull();
      expect(publicados.at(-1)).toMatchObject({ tipo: "turno_concluido", planoPendente: true });
    });
  });

  describe("plano proposto num turno de execução", () => {
    const respostaComPlano = `Proponho:\n1. separar o módulo\n2. migrar os testes\n${MARCADOR_DE_PLANO}`;

    async function executar(orquestrador: Orquestrador, antesDeTerminar?: () => Promise<unknown>): Promise<void> {
      const { conclusao } = await servico.enviarMensagem(orquestrador.id, "refatore o projeto inteiro");
      await antesDeTerminar?.();
      motor.terminar();
      await conclusao;
    }

    beforeEach(() => {
      motor.resultado = resultadoComResposta(respostaComPlano);
    });

    it("com a opção ligada, o plano fica pendente e o marcador sai da resposta", async () => {
      const orquestrador = await criar();

      await executar(orquestrador);

      const turno = orquestrador.ultimoTurno;
      expect(turno?.modo).toBe("execucao");
      expect(orquestrador.turnoComPlanoPendente?.id).toBe(turno?.id);
      expect(turno?.resposta).toContain("Proponho:");
      expect(turno?.resposta).not.toContain(MARCADOR_DE_PLANO);
      const concluido = publicados.at(-1);
      expect(concluido).toMatchObject({ tipo: "turno_concluido", planoPendente: true });
      expect(concluido?.tipo === "turno_concluido" ? concluido.resposta : "").not.toContain(MARCADOR_DE_PLANO);
    });

    it("o plano proposto é aprovado como o de um planejamento", async () => {
      const orquestrador = await criar();
      await executar(orquestrador);
      motor.resultado = resultadoComResposta("feito");

      const { conclusao } = await servico.aprovarPlano(orquestrador.id);
      motor.terminar();
      await conclusao;

      expect(motor.pedidos[1]?.texto).toMatch(/^Plano aprovado\./);
      expect(orquestrador.turnoComPlanoPendente).toBeNull();
    });

    it("com a opção desligada, a resposta sai limpa e sem plano pendente", async () => {
      const orquestrador = await criar();
      await servico.alterarConfiguracao(orquestrador.id, { proporPlanoEmPedidosGrandes: false });

      await executar(orquestrador);

      expect(orquestrador.ultimoTurno?.resposta).toContain("Proponho:");
      expect(orquestrador.ultimoTurno?.resposta).not.toContain(MARCADOR_DE_PLANO);
      expect(orquestrador.turnoComPlanoPendente).toBeNull();
      expect(publicados.at(-1)).toMatchObject({ tipo: "turno_concluido", planoPendente: false });
    });

    it("vale a configuração do início do turno, não a alterada enquanto ele roda", async () => {
      const orquestrador = await criar();

      await executar(orquestrador, () =>
        servico.alterarConfiguracao(orquestrador.id, { proporPlanoEmPedidosGrandes: false }),
      );

      expect(orquestrador.turnoComPlanoPendente).not.toBeNull();
      expect(motor.pedidos[0]?.configuracao.propoePlanoEmPedidosGrandes("execucao")).toBe(true);
      expect(orquestrador.configuracao.propoePlanoEmPedidosGrandes("execucao")).toBe(false);
    });

    it("sem o marcador, o turno de execução conclui sem plano pendente", async () => {
      const orquestrador = await criar();
      motor.resultado = resultadoComResposta("feito");

      await executar(orquestrador);

      expect(orquestrador.ultimoTurno?.resposta).toBe("feito");
      expect(orquestrador.turnoComPlanoPendente).toBeNull();
    });
  });

  describe("limpar a conversa", () => {
    async function conversar(orquestrador: Orquestrador, texto: string): Promise<void> {
      const { conclusao } = await servico.enviarMensagem(orquestrador.id, texto);
      motor.terminar();
      await conclusao;
    }

    it("o pedido seguinte abre uma sessão nova, com outro id, que os próximos retomam", async () => {
      const orquestrador = await criar();
      motor.eventos = [{ tipo: "sessao_iniciada" }];
      await conversar(orquestrador, "um");
      const sessaoAnterior = orquestrador.sessaoId;

      await servico.limparConversa(orquestrador.id);
      await conversar(orquestrador, "dois");
      await conversar(orquestrador, "três");

      expect(orquestrador.sessaoId).not.toBe(sessaoAnterior);
      expect(motor.pedidos.map((pedido) => [pedido.sessaoIniciada, pedido.sessaoId])).toEqual([
        [false, sessaoAnterior],
        [false, orquestrador.sessaoId],
        [true, orquestrador.sessaoId],
      ]);
      expect(orquestrador.totalDeTurnos).toBe(2);
    });

    it("arquiva, publica conversa_limpa e descarta o plano pendente", async () => {
      const orquestrador = await criar();
      motor.eventos = [{ tipo: "sessao_iniciada" }];
      const { conclusao } = await servico.enviarMensagem(orquestrador.id, "planeje", [], "planejamento");
      motor.terminar();
      await conclusao;

      const limpo = await servico.limparConversa(orquestrador.id);

      expect(limpo).toBe(orquestrador);
      expect(limpo.totalDeTurnos).toBe(0);
      expect(limpo.sessaoIniciada).toBe(false);
      expect(repositorio.arquivamentos).toEqual([orquestrador.id]);
      expect(publicados.at(-1)).toEqual({
        tipo: "conversa_limpa",
        turnosAnteriores: 1,
        planoDescartado: true,
        worktreeComAlteracoes: false,
        sequencia: repositorio.eventos.length,
        em: "agora",
      });
      await expect(servico.aprovarPlano(orquestrador.id)).rejects.toMatchObject({ motivo: "sem_plano_pendente" });
    });

    it("sem conversa para limpar, não arquiva nem publica nada", async () => {
      const orquestrador = await criar();
      const sessao = orquestrador.sessaoId;

      await servico.limparConversa(orquestrador.id);
      await conversar(orquestrador, "um");
      await servico.limparConversa(orquestrador.id);
      const depoisDaPrimeira = repositorio.eventos.length;
      await servico.limparConversa(orquestrador.id);

      expect(repositorio.arquivamentos).toEqual([orquestrador.id]);
      expect(repositorio.eventos).toHaveLength(depoisDaPrimeira);
      expect(motor.pedidos[0]?.sessaoId).toBe(sessao);
    });

    it("recusa limpar com um pedido em andamento", async () => {
      const orquestrador = await criar();
      const { conclusao } = await servico.enviarMensagem(orquestrador.id, "analise");

      await expect(servico.limparConversa(orquestrador.id)).rejects.toMatchObject({ motivo: "turno_em_andamento" });
      expect(repositorio.arquivamentos).toEqual([]);

      motor.terminar();
      await conclusao;
      expect(orquestrador.totalDeTurnos).toBe(1);
    });

    it("recusa orquestrador inexistente", async () => {
      await expect(servico.limparConversa("nao-existe")).rejects.toMatchObject({ motivo: "nao_encontrado" });
    });
  });
});

/** Medidor que devolve o consumo combinado (ou falha) e guarda os períodos pedidos. */
class MedidorFalso implements MedidorDeConsumo {
  periodos: PeriodoDoTurno[] = [];
  consumo: ConsumoDoTurno | null = ConsumoDoTurno.criar({
    principal: UsoDeTokens.criar({ entrada: 6, criacaoDeCache: 33062, leituraDeCache: 62885, saida: 383 }),
    subagentes: UsoDeTokens.criar({ entrada: 1, criacaoDeCache: 0, leituraDeCache: 0, saida: 1 }),
    subagentesMedidos: 1,
    parcial: false,
    modeloDoPrincipal: "claude-opus-5-5",
  });
  falha: Error | null = null;

  async medirTurno(periodo: PeriodoDoTurno): Promise<ConsumoDoTurno | null> {
    this.periodos.push(periodo);
    if (this.falha !== null) {
      throw this.falha;
    }
    return this.consumo;
  }
}

class EsforcoDaMaquinaFalso implements EsforcoDaMaquina {
  consultas: ConsultaDeEsforcoHerdado[] = [];
  falha: Error | null = null;

  async herdadoPara(consulta: ConsultaDeEsforcoHerdado): Promise<EsforcoHerdado | null> {
    this.consultas.push(consulta);
    if (this.falha !== null) {
      throw this.falha;
    }
    return consulta.modelo === "opus"
      ? EsforcoHerdado.criar({ nivel: "extra_alto", origem: "CLAUDE_CODE_EFFORT_LEVEL", modelo: consulta.modeloReal })
      : null;
  }
}

describe("ServicoDeOrquestracao e a economia de tokens", () => {
  let repositorio: RepositorioEmMemoria;
  let motor: MotorFalso;
  let medidor: MedidorFalso;
  let esforco: EsforcoDaMaquinaFalso;
  let worktrees: GerenciadorDeWorktreesFalso;
  let servico: ServicoDeOrquestracao;
  let ids: number;
  const inicio = new Date("2026-10-28T12:00:00Z");
  const fim = new Date("2026-10-28T12:05:00Z");
  let relogio: Date;

  beforeEach(() => {
    repositorio = new RepositorioEmMemoria();
    motor = new MotorFalso();
    medidor = new MedidorFalso();
    esforco = new EsforcoDaMaquinaFalso();
    worktrees = new GerenciadorDeWorktreesFalso();
    ids = 0;
    relogio = inicio;
    servico = new ServicoDeOrquestracao({
      repositorio,
      motor,
      execucoes: new ControleDeExecucoesEmMemoria(),
      publicador: { publicar: () => undefined, sinalizar: () => undefined },
      anexos: new ArmazemEmMemoria(),
      worktrees,
      gerarId: () => `id${++ids}`,
      agora: () => relogio,
      medidor,
      esforcoDaMaquina: esforco,
    });
  });

  async function criar(): Promise<Orquestrador> {
    return servico.criarOrquestrador({
      nome: "Painel",
      pastaDeTrabalho: PastaDeTrabalho.dentroDe(path.resolve("/projetos"), "painel"),
      configuracao,
    });
  }

  it("mede o turno concluído depois do fim, com sessão, pasta e horário do turno", async () => {
    const orquestrador = await criar();
    worktrees.preparo = {
      cwd: path.resolve("/dados/worktrees/abc"),
      worktree: { branch: "orquestrador/id1", caminho: path.resolve("/dados/worktrees/abc") },
    };

    const { turnoId, conclusao, medicao } = await servico.enviarMensagem(orquestrador.id, "analise");
    relogio = fim;
    motor.terminar();
    await conclusao;
    await medicao;

    expect(medidor.periodos).toEqual([
      { sessaoId: orquestrador.sessaoId, pastaDeTrabalho: path.resolve("/dados/worktrees/abc"), inicio, fim },
    ]);
    expect(repositorio.eventos.map((evento) => evento.tipo)).toEqual([
      "turno_iniciado",
      "turno_concluido",
      "consumo_do_turno_medido",
    ]);
    expect(repositorio.eventos.at(-1)).toMatchObject({
      tipo: "consumo_do_turno_medido",
      turnoId,
      consumo: { parcial: false, indiceDeCusto: 49543, subagentesMedidos: 1, modeloDoPrincipal: "claude-opus-5-5" },
    });
  });

  it("sem worktree, mede na pasta do projeto", async () => {
    const orquestrador = await criar();

    const { medicao } = await servico.enviarMensagem(orquestrador.id, "analise");
    motor.terminar();
    await medicao;

    expect(medidor.periodos[0]?.pastaDeTrabalho).toBe(orquestrador.pastaDeTrabalho.caminho);
  });

  it("marca como parcial o consumo de um turno com falha", async () => {
    const orquestrador = await criar();
    motor.resultado = { sucesso: false, motivo: "Limite de uso atingido.", uso: null };

    const { medicao } = await servico.enviarMensagem(orquestrador.id, "analise");
    motor.terminar();
    await medicao;

    expect(repositorio.eventos.map((evento) => evento.tipo).slice(-2)).toEqual([
      "turno_falhou",
      "consumo_do_turno_medido",
    ]);
    expect(repositorio.eventos.at(-1)).toMatchObject({ consumo: { parcial: true } });
  });

  it("marca como parcial o consumo de um turno cancelado", async () => {
    const orquestrador = await criar();

    const { medicao } = await servico.enviarMensagem(orquestrador.id, "analise");
    await servico.cancelar(orquestrador.id);
    await medicao;

    expect(repositorio.eventos.map((evento) => evento.tipo).slice(-2)).toEqual([
      "turno_cancelado",
      "consumo_do_turno_medido",
    ]);
    expect(repositorio.eventos.at(-1)).toMatchObject({ consumo: { parcial: true } });
  });

  it("sem transcrição, não registra consumo", async () => {
    const orquestrador = await criar();
    medidor.consumo = null;

    const { medicao } = await servico.enviarMensagem(orquestrador.id, "analise");
    motor.terminar();
    await medicao;

    expect(medidor.periodos).toHaveLength(1);
    expect(repositorio.eventos.map((evento) => evento.tipo)).toEqual(["turno_iniciado", "turno_concluido"]);
  });

  it("um erro do medidor não quebra o turno nem o próximo pedido", async () => {
    const orquestrador = await criar();
    medidor.falha = new Error("transcrição corrompida");
    const avisos = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const primeiro = await servico.enviarMensagem(orquestrador.id, "analise");
    motor.terminar();
    await primeiro.conclusao;
    await primeiro.medicao;
    const segundo = await servico.enviarMensagem(orquestrador.id, "de novo");
    motor.terminar();
    await segundo.conclusao;

    expect(orquestrador.ultimoTurno?.situacao).toBe("concluido");
    expect(repositorio.eventos.some((evento) => evento.tipo === "consumo_do_turno_medido")).toBe(false);
    expect(avisos).toHaveBeenCalled();
    avisos.mockRestore();
  });

  it("aplica a predefinição, publica configuracao_alterada e mantém a configuração editável", async () => {
    const orquestrador = await criar();

    await servico.aplicarPredefinicao(orquestrador.id, "economico");

    expect(repositorio.eventos.at(-1)).toMatchObject({ tipo: "configuracao_alterada", predefinicao: "economico" });
    expect(orquestrador.predefinicaoCorrespondente).toBe("economico");
    expect(orquestrador.configuracao.nivelDePermissao).toBe("edicao");

    await servico.alterarConfiguracao(orquestrador.id, { modeloDosSubagentes: "haiku" });
    expect(orquestrador.predefinicaoCorrespondente).toBeNull();
  });

  it("recusa predefinição desconhecida e orquestrador inexistente", async () => {
    const orquestrador = await criar();

    await expect(servico.aplicarPredefinicao(orquestrador.id, "turbo")).rejects.toMatchObject({
      motivo: "dados_invalidos",
      message: "Predefinição desconhecida.",
    });
    await expect(servico.aplicarPredefinicao("nao-existe", "economico")).rejects.toMatchObject({
      motivo: "nao_encontrado",
    });
  });

  it("o esforço herdado usa os modelos atuais e o modelo real do último consumo medido", async () => {
    const orquestrador = await criar();
    const antes = await servico.esforcoHerdadoDe(orquestrador.id);

    const { medicao } = await servico.enviarMensagem(orquestrador.id, "analise");
    motor.terminar();
    await medicao;
    const depois = await servico.esforcoHerdadoDe(orquestrador.id);

    expect(antes.orquestrador?.modelo).toBeNull();
    expect(antes.subagentes).toBeNull();
    expect(depois.orquestrador?.paraDados()).toEqual({
      nivel: "extra_alto",
      origem: "CLAUDE_CODE_EFFORT_LEVEL",
      modelo: "claude-opus-5-5",
      deveAvisar: true,
    });
    expect(esforco.consultas.at(-1)).toEqual({
      modelo: "haiku",
      pastaDoProjeto: orquestrador.pastaDeTrabalho.caminho,
      modeloReal: null,
    });
  });

  it("um erro ao ler o esforço herdado vira null", async () => {
    const orquestrador = await criar();
    esforco.falha = new Error("settings.json inválido");
    const avisos = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(await servico.esforcoHerdadoDe(orquestrador.id)).toEqual({ orquestrador: null, subagentes: null });
    avisos.mockRestore();
  });
});
