import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ControleDeExecucoesEmMemoria } from "../infraestrutura/execucoes/ControleDeExecucoesEmMemoria";
import { Anexo } from "./Anexo";
import { ArmazemDeAnexos } from "./ArmazemDeAnexos";
import { DadosDaConfiguracao } from "./ConfiguracaoDoOrquestrador";
import { ConsumoDoTurno } from "./ConsumoDoTurno";
import { DiagnosticadorDoClaude, DiagnosticoDoClaude } from "./DiagnosticoDoClaude";
import { ConsultaDeEsforcoHerdado, EsforcoDaMaquina } from "./EsforcoDaMaquina";
import { EsforcoHerdado } from "./EsforcoHerdado";
import { EventoDeOrquestracao, EventoDoMotor, EventoRegistrado, SinalDeVida } from "./EventoDeOrquestracao";
import { MARCADOR_DE_PLANO, PEDIDO_DE_COMMIT_AO_FINAL } from "./InstrucoesDoOrquestrador";
import { MedidorDeConsumo, PeriodoDoTurno } from "./MedidorDeConsumo";
import { UsoDeTokens } from "./UsoDeTokens";
import { CausaDaFalha, MotorDeAgentes, PedidoDeTurno, ResultadoDoTurno } from "./MotorDeAgentes";
import { Orquestrador } from "./Orquestrador";
import { PastaDeTrabalho } from "./PastaDeTrabalho";
import { PedidoNaFila } from "./PedidoNaFila";
import { GerenciadorDeWorktrees, PreparoDeWorktree } from "./PreparoDeWorktree";
import { PreferenciasGlobais } from "./PreferenciasGlobais";
import { formatarHora } from "./RecuperacaoDoTurno";
import { ConversaArquivada, RepositorioDeOrquestradores } from "./RepositorioDeOrquestradores";
import { RepositorioDePreferencias } from "./RepositorioDePreferencias";
import { MensagemEnviada, ServicoDeOrquestracao } from "./ServicoDeOrquestracao";
import { AgendadorDeTarefas } from "./VigiaDoTurno";

/** Preferências globais em memória: `atuais` devolve o que o teste definiu. */
class PreferenciasEmMemoria implements RepositorioDePreferencias {
  preferencias = PreferenciasGlobais.vazias();
  atuais(): PreferenciasGlobais {
    return this.preferencias;
  }
  async salvar(preferencias: PreferenciasGlobais): Promise<void> {
    this.preferencias = preferencias;
  }
}

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
  let preferencias: PreferenciasEmMemoria;
  let ids: number;

  beforeEach(() => {
    repositorio = new RepositorioEmMemoria();
    motor = new MotorFalso();
    preferencias = new PreferenciasEmMemoria();
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
      pastaDeArtefatos: (orquestradorId) => `/dados/artefatos/entrada/orquestradores/${orquestradorId}`,
      preferencias,
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

  it("passa ao motor a pasta de artefatos do próprio Orquestrador, mesmo rodando num worktree", async () => {
    const orquestrador = await criar();
    worktrees.preparo = {
      cwd: path.resolve("/dados/worktrees/x"),
      worktree: { branch: "orquestrador/x", caminho: path.resolve("/dados/worktrees/x") },
    };

    const { conclusao } = await servico.enviarMensagem(orquestrador.id, "monte um relatório");
    motor.terminar();
    await conclusao;

    expect(motor.pedidos[0]?.pastaDeArtefatos).toBe(`/dados/artefatos/entrada/orquestradores/${orquestrador.id}`);
    expect(motor.pedidos[0]?.pastaDeTrabalho.caminho).toBe(path.resolve("/dados/worktrees/x"));
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

  describe("renomear", () => {
    it("troca o nome, grava e publica orquestrador_renomeado", async () => {
      const orquestrador = await criar();
      const salvar = vi.spyOn(repositorio, "salvar");

      const renomeado = await servico.renomear(orquestrador.id, "  Backlog  ");

      expect(renomeado.nome).toBe("Backlog");
      expect(salvar).toHaveBeenCalledWith(orquestrador);
      expect(repositorio.eventos.at(-1)).toMatchObject({ tipo: "orquestrador_renomeado", nome: "Backlog" });
      expect(publicados.at(-1)).toMatchObject({ tipo: "orquestrador_renomeado", nome: "Backlog" });
    });

    it("vale com um pedido em andamento, que segue rodando", async () => {
      const orquestrador = await criar();
      const { conclusao } = await servico.enviarMensagem(orquestrador.id, "analise");

      await servico.renomear(orquestrador.id, "Durante o pedido");

      expect(orquestrador.nome).toBe("Durante o pedido");
      expect(orquestrador.situacao).toBe("trabalhando");
      motor.terminar();
      await conclusao;
      expect(orquestrador.ultimoTurno?.situacao).toBe("concluido");
    });

    it("o mesmo nome não grava nem publica", async () => {
      const orquestrador = await criar();
      const salvar = vi.spyOn(repositorio, "salvar");

      await servico.renomear(orquestrador.id, "Painel");

      expect(salvar).not.toHaveBeenCalled();
      expect(publicados).toEqual([]);
    });

    it("recusa nome inválido e orquestrador inexistente", async () => {
      const orquestrador = await criar();

      await expect(servico.renomear(orquestrador.id, " ")).rejects.toMatchObject({ motivo: "dados_invalidos" });
      await expect(servico.renomear("nao-existe", "Outro")).rejects.toMatchObject({ motivo: "nao_encontrado" });
      expect(publicados).toEqual([]);
    });
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

    it("commitar ao final pede o commit local na aprovação quando a configuração libera", async () => {
      const orquestrador = await criar();
      await servico.alterarConfiguracao(orquestrador.id, {
        permitirCommitEPush: true,
        nivelDePermissao: "edicao_e_comandos",
      });
      await planejar(orquestrador);

      const { conclusao } = await servico.aprovarPlano(orquestrador.id, "sem mexer nos testes", true);
      motor.terminar();
      await conclusao;

      const texto = motor.pedidos[1]?.texto ?? "";
      expect(texto).toMatch(/^Plano aprovado\. Execute agora o plano/);
      expect(texto).toContain(PEDIDO_DE_COMMIT_AO_FINAL);
      expect(texto).toContain("Observações do usuário: sem mexer nos testes");
    });

    it.each<[string, Partial<DadosDaConfiguracao>]>([
      ["com commit desligado", { permitirCommitEPush: false, nivelDePermissao: "edicao_e_comandos" }],
      ["sem terminal no nível", { permitirCommitEPush: true, nivelDePermissao: "edicao" }],
    ])("commitar ao final é ignorado %s", async (_caso, alteracoes) => {
      const orquestrador = await criar();
      await servico.alterarConfiguracao(orquestrador.id, alteracoes);
      await planejar(orquestrador);

      const { conclusao } = await servico.aprovarPlano(orquestrador.id, "", true);
      motor.terminar();
      await conclusao;

      expect(motor.pedidos[1]?.texto).not.toContain(PEDIDO_DE_COMMIT_AO_FINAL);
    });

    it("sem commitar ao final, a aprovação não pede commit mesmo com ele liberado", async () => {
      const orquestrador = await criar();
      await servico.alterarConfiguracao(orquestrador.id, {
        permitirCommitEPush: true,
        nivelDePermissao: "edicao_e_comandos",
      });
      await planejar(orquestrador);

      const { conclusao } = await servico.aprovarPlano(orquestrador.id);
      motor.terminar();
      await conclusao;

      expect(motor.pedidos[1]?.texto).not.toContain(PEDIDO_DE_COMMIT_AO_FINAL);
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

    it("um orquestrador salvo com as opções antigas desligadas passa a deixar o plano pendente", async () => {
      const criado = await criar();
      const dados = criado.paraDados();
      // Como ficava o orquestrador.json quando trivial e plano eram opções da tela.
      const gravado = JSON.parse(
        JSON.stringify({
          ...dados,
          configuracao: { ...dados.configuracao, permitirTrabalhoDireto: false, proporPlanoEmPedidosGrandes: false },
        }),
      ) as typeof dados;
      const orquestrador = Orquestrador.reconstituir(gravado);
      repositorio.orquestradores.set(orquestrador.id, orquestrador);

      await executar(orquestrador);

      expect(orquestrador.turnoComPlanoPendente).not.toBeNull();
      expect(publicados.at(-1)).toMatchObject({ tipo: "turno_concluido", planoPendente: true });
      expect(motor.pedidos[0]?.configuracao.propoePlanoEmPedidosGrandes("execucao")).toBe(true);
      // Ao salvar de novo, os campos antigos somem.
      expect(orquestrador.paraDados().configuracao).not.toHaveProperty("permitirTrabalhoDireto");
      expect(orquestrador.paraDados().configuracao).not.toHaveProperty("proporPlanoEmPedidosGrandes");
    });

    it("o plano proposto fica pendente mesmo se a configuração muda enquanto o turno roda", async () => {
      const orquestrador = await criar();

      await executar(orquestrador, () => servico.alterarConfiguracao(orquestrador.id, { nivelDePermissao: "leitura" }));

      expect(orquestrador.turnoComPlanoPendente).not.toBeNull();
      expect(motor.pedidos[0]?.configuracao.nivelDePermissao).toBe("edicao");
      expect(orquestrador.configuracao.nivelDePermissao).toBe("leitura");
    });

    it("os eventos que levam a configuração não trazem mais as opções", async () => {
      const orquestrador = await criar();
      await servico.alterarConfiguracao(orquestrador.id, { nivelDePermissao: "leitura" });

      await executar(orquestrador);

      const comConfiguracao = publicados.filter(
        (evento) => evento.tipo === "turno_iniciado" || evento.tipo === "configuracao_alterada",
      );
      expect(comConfiguracao.map((evento) => evento.tipo).sort()).toEqual(["configuracao_alterada", "turno_iniciado"]);
      for (const evento of comConfiguracao) {
        const configuracaoDoEvento = "configuracao" in evento ? evento.configuracao : null;
        expect(configuracaoDoEvento).not.toBeNull();
        expect(configuracaoDoEvento).not.toHaveProperty("permitirTrabalhoDireto");
        expect(configuracaoDoEvento).not.toHaveProperty("proporPlanoEmPedidosGrandes");
      }
    });

    it("o bloco de perguntas sai da resposta, vira perguntas no evento e no turno e convive com o plano", async () => {
      const orquestrador = await criar();
      motor.resultado = resultadoComResposta(
        [
          "Proponho:",
          "1. separar o módulo",
          "```pergunta-do-app",
          '{"perguntas":[{"pergunta":"Qual banco usar?","opcoes":[{"rotulo":"Postgres","descricao":"já usado no projeto"},"SQLite"],"multipla":false}]}',
          "```",
          "```pergunta-do-app",
          "{quebrado",
          "```",
          MARCADOR_DE_PLANO,
        ].join("\n"),
      );

      await executar(orquestrador);

      const perguntas = [
        {
          pergunta: "Qual banco usar?",
          opcoes: [
            { rotulo: "Postgres", descricao: "já usado no projeto" },
            { rotulo: "SQLite", descricao: null },
          ],
          multipla: false,
        },
      ];
      const concluido = publicados.at(-1);
      expect(concluido).toMatchObject({
        tipo: "turno_concluido",
        resposta: "Proponho:\n1. separar o módulo",
        planoPendente: true,
        perguntas,
      });
      expect(orquestrador.ultimoTurno?.resposta).toBe("Proponho:\n1. separar o módulo");
      expect(repositorio.buscarPorId(orquestrador.id)?.paraDados().turnos[0]?.perguntas).toEqual(perguntas);
    });

    it("sem bloco de perguntas, o turno conclui com perguntas vazias", async () => {
      const orquestrador = await criar();
      motor.resultado = resultadoComResposta("feito");

      await executar(orquestrador);

      expect(publicados.at(-1)).toMatchObject({ tipo: "turno_concluido", resposta: "feito", perguntas: [] });
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

  describe("fila de pedidos", () => {
    const mensagemDeTurnoEmAndamento = '"Painel" ainda está trabalhando no pedido anterior. Aguarde terminar ou cancele.';

    function tipos(): string[] {
      return repositorio.eventos.map((evento) => evento.tipo);
    }

    it("enfileirar publica pedido_enfileirado, grava e, sem turno, o pedido fica parado", async () => {
      const orquestrador = await criar();

      const { pedidoId } = await servico.enfileirarPedido(orquestrador.id, "  rode os testes  ", "planejamento");

      expect(publicados.at(-1)).toMatchObject({
        tipo: "pedido_enfileirado",
        pedido: { id: pedidoId, texto: "rode os testes", modo: "planejamento", enfileiradoEm: "2026-10-28T12:00:00.000Z" },
      });
      expect(repositorio.buscarPorId(orquestrador.id)?.paraDados().fila?.map((pedido) => pedido.id)).toEqual([pedidoId]);
      expect(motor.pedidos).toHaveLength(0);
      expect(orquestrador.situacao).toBe("ocioso");
    });

    it("recusa pedido vazio e orquestrador inexistente", async () => {
      const orquestrador = await criar();

      await expect(servico.enfileirarPedido(orquestrador.id, "   ")).rejects.toMatchObject({
        motivo: "dados_invalidos",
        message: "Escreva o pedido.",
      });
      await expect(servico.enfileirarPedido("nao-existe", "oi")).rejects.toMatchObject({ motivo: "nao_encontrado" });
      expect(orquestrador.fila).toHaveLength(0);
    });

    it("turno concluído envia o primeiro da fila, que sai antes de o turno dele começar", async () => {
      const orquestrador = await criar();
      const { conclusao, envioDaFila } = await servico.enviarMensagem(orquestrador.id, "primeiro");
      const { pedidoId } = await servico.enfileirarPedido(orquestrador.id, "segundo");
      await servico.enfileirarPedido(orquestrador.id, "terceiro", "planejamento");

      motor.terminar();
      await conclusao;
      await envioDaFila;

      expect(tipos()).toEqual([
        "turno_iniciado",
        "pedido_enfileirado",
        "pedido_enfileirado",
        "turno_concluido",
        "pedido_retirado_da_fila",
        "turno_iniciado",
      ]);
      expect(repositorio.eventos[4]).toMatchObject({ tipo: "pedido_retirado_da_fila", pedidoId, motivo: "enviado" });
      expect(repositorio.eventos[5]).toMatchObject({ tipo: "turno_iniciado", texto: "segundo", modo: "execucao" });
      expect(orquestrador.fila.map((pedido) => pedido.texto)).toEqual(["terceiro"]);
      expect(orquestrador.situacao).toBe("trabalhando");
      await vi.waitFor(() => expect(motor.pedidos.map((pedido) => pedido.texto)).toEqual(["primeiro", "segundo"]));

      // E a fila segue andando: o terceiro sai quando o segundo termina, no modo dele.
      motor.terminar();
      await vi.waitFor(() => expect(motor.pedidos).toHaveLength(3));
      expect(motor.pedidos[2]).toMatchObject({ texto: "terceiro", modo: "planejamento" });
      expect(orquestrador.fila).toEqual([]);
    });

    it.each<[string, (orquestradorId: string) => Promise<MensagemEnviada>]>([
      [
        "cancelado",
        async (orquestradorId) => {
          const enviada = await servico.enviarMensagem(orquestradorId, "primeiro");
          await servico.enfileirarPedido(orquestradorId, "segundo");
          await servico.cancelar(orquestradorId);
          return enviada;
        },
      ],
      [
        "com falha",
        async (orquestradorId) => {
          motor.resultado = { sucesso: false, motivo: "Limite de uso atingido.", uso: null };
          const enviada = await servico.enviarMensagem(orquestradorId, "primeiro");
          await servico.enfileirarPedido(orquestradorId, "segundo");
          motor.terminar();
          return enviada;
        },
      ],
      [
        "com plano pendente de um planejamento",
        async (orquestradorId) => {
          const enviada = await servico.enviarMensagem(orquestradorId, "primeiro", [], "planejamento");
          await servico.enfileirarPedido(orquestradorId, "segundo");
          motor.terminar();
          return enviada;
        },
      ],
      [
        "com plano proposto numa execução",
        async (orquestradorId) => {
          motor.resultado = resultadoComResposta(`Proponho mudar tudo.\n${MARCADOR_DE_PLANO}`);
          const enviada = await servico.enviarMensagem(orquestradorId, "primeiro");
          await servico.enfileirarPedido(orquestradorId, "segundo");
          motor.terminar();
          return enviada;
        },
      ],
    ])("turno %s não envia nada da fila", async (_situacao, encerrarTurno) => {
      const orquestrador = await criar();

      const { conclusao, envioDaFila } = await encerrarTurno(orquestrador.id);
      await conclusao;
      await envioDaFila;

      expect(motor.pedidos).toHaveLength(1);
      expect(tipos()).not.toContain("pedido_retirado_da_fila");
      expect(orquestrador.fila.map((pedido) => pedido.texto)).toEqual(["segundo"]);
      expect(orquestrador.situacao).toBe("ocioso");
    });

    it("enviar agora sem turno retira o pedido e inicia o turno com o texto e o modo dele", async () => {
      const orquestrador = await criar();
      const { pedidoId } = await servico.enfileirarPedido(orquestrador.id, "planeje a migração", "planejamento");

      const { turnoId, conclusao } = await servico.enviarDaFila(orquestrador.id, pedidoId);

      expect(tipos()).toEqual(["pedido_enfileirado", "pedido_retirado_da_fila", "turno_iniciado"]);
      expect(repositorio.eventos[1]).toMatchObject({ pedidoId, motivo: "enviado" });
      expect(repositorio.eventos[2]).toMatchObject({ turnoId, texto: "planeje a migração", modo: "planejamento" });
      expect(orquestrador.fila).toEqual([]);
      expect(repositorio.buscarPorId(orquestrador.id)?.paraDados().fila).toEqual([]);
      motor.terminar();
      await conclusao;
      expect(motor.pedidos[0]).toMatchObject({ texto: "planeje a migração", modo: "planejamento" });
    });

    it("enviar agora com turno em andamento é recusado como uma mensagem, e o pedido continua na fila", async () => {
      const orquestrador = await criar();
      const { conclusao } = await servico.enviarMensagem(orquestrador.id, "primeiro");
      const { pedidoId } = await servico.enfileirarPedido(orquestrador.id, "segundo");

      await expect(servico.enviarDaFila(orquestrador.id, pedidoId)).rejects.toMatchObject({
        motivo: "turno_em_andamento",
        message: mensagemDeTurnoEmAndamento,
      });

      expect(orquestrador.fila.map((pedido) => pedido.id)).toEqual([pedidoId]);
      expect(tipos()).not.toContain("pedido_retirado_da_fila");
      expect(orquestrador.totalDeTurnos).toBe(1);
      await servico.cancelar(orquestrador.id);
      await conclusao;
    });

    it("enviar ou remover um pedido que não está na fila responde não encontrado", async () => {
      const orquestrador = await criar();

      await expect(servico.enviarDaFila(orquestrador.id, "nao-existe")).rejects.toMatchObject({
        motivo: "nao_encontrado",
        message: "Pedido não encontrado na fila.",
      });
      await expect(servico.removerDaFila(orquestrador.id, "nao-existe")).rejects.toMatchObject({
        motivo: "nao_encontrado",
        message: "Pedido não encontrado na fila.",
      });
      await expect(servico.enviarDaFila("nao-existe", "p1")).rejects.toMatchObject({
        message: "Orquestrador não encontrado.",
      });
    });

    it("remover publica a retirada como removido e grava a fila sem o pedido", async () => {
      const orquestrador = await criar();
      const { pedidoId } = await servico.enfileirarPedido(orquestrador.id, "um");
      const outro = await servico.enfileirarPedido(orquestrador.id, "dois");

      await servico.removerDaFila(orquestrador.id, pedidoId);

      expect(repositorio.eventos.at(-1)).toMatchObject({ tipo: "pedido_retirado_da_fila", pedidoId, motivo: "removido" });
      expect(repositorio.buscarPorId(orquestrador.id)?.paraDados().fila?.map((pedido) => pedido.id)).toEqual([
        outro.pedidoId,
      ]);
    });

    it("se o usuário inicia outro turno antes do envio automático, nada sai e o pedido fica para depois", async () => {
      const orquestrador = await criar();
      const { envioDaFila } = await servico.enviarMensagem(orquestrador.id, "primeiro");
      await servico.enfileirarPedido(orquestrador.id, "da fila");
      // O pedido do usuário chega logo depois do fim do turno, antes do envio automático.
      const doUsuario: Array<Promise<MensagemEnviada>> = [];
      const anexar = repositorio.anexarEvento.bind(repositorio);
      const espiao = vi.spyOn(repositorio, "anexarEvento").mockImplementation((id, evento) => {
        const registrado = anexar(id, evento);
        if (evento.tipo === "turno_concluido" && doUsuario.length === 0) {
          doUsuario.push(servico.enviarMensagem(orquestrador.id, "do usuário"));
        }
        return registrado;
      });

      motor.terminar();
      await envioDaFila;

      expect(orquestrador.ultimoTurno?.texto).toBe("do usuário");
      expect(orquestrador.fila.map((pedido) => pedido.texto)).toEqual(["da fila"]);
      expect(tipos()).not.toContain("pedido_retirado_da_fila");

      // Quando o turno do usuário termina bem, a fila anda.
      const turnoDoUsuario = await doUsuario[0];
      motor.terminar();
      await turnoDoUsuario?.envioDaFila;
      expect(tipos().slice(-2)).toEqual(["pedido_retirado_da_fila", "turno_iniciado"]);
      expect(orquestrador.ultimoTurno?.texto).toBe("da fila");
      espiao.mockRestore();
    });

    it("um erro no envio automático vira aviso no log, e o pedido fica como turno com falha", async () => {
      const orquestrador = await criar();
      const { conclusao, envioDaFila } = await servico.enviarMensagem(orquestrador.id, "primeiro");
      await servico.enfileirarPedido(orquestrador.id, "segundo");
      const avisos = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const salvar = repositorio.salvar.bind(repositorio);
      const espiao = vi.spyOn(repositorio, "salvar").mockImplementation(async (alvo) => {
        if (alvo.ultimoTurno?.texto === "segundo") {
          throw new Error("disco cheio");
        }
        return salvar(alvo);
      });

      motor.terminar();
      await conclusao;
      await expect(envioDaFila).resolves.toBeUndefined();

      expect(avisos).toHaveBeenCalledWith(expect.stringContaining("próximo pedido da fila"), "disco cheio");
      expect(orquestrador.ultimoTurno?.texto).toBe("segundo");
      expect(orquestrador.ultimoTurno?.situacao).toBe("falhou");
      expect(orquestrador.situacao).toBe("ocioso");
      espiao.mockRestore();
      avisos.mockRestore();
    });

    it("ao subir o servidor, o turno interrompido não tira nada da fila", async () => {
      const orquestrador = await criar();
      orquestrador.iniciarTurno("t-antigo", "analise", new Date("2026-10-28T11:00:00Z"));
      orquestrador.enfileirarPedido(
        PedidoNaFila.criar({ id: "p1", texto: "depois", modo: "execucao", enfileiradoEm: new Date("2026-10-28T11:00:00Z") }),
      );

      expect(await servico.interromperTurnosPendentes()).toBe(1);
      await new Promise((resolver) => setTimeout(resolver, 0));

      expect(tipos()).toEqual(["turno_interrompido"]);
      expect(motor.pedidos).toHaveLength(0);
      expect(orquestrador.fila.map((pedido) => pedido.id)).toEqual(["p1"]);
    });

    it("limpar a conversa mantém a fila", async () => {
      const orquestrador = await criar();
      const { conclusao } = await servico.enviarMensagem(orquestrador.id, "planeje", [], "planejamento");
      await servico.enfileirarPedido(orquestrador.id, "depois");
      motor.terminar();
      await conclusao;

      await servico.limparConversa(orquestrador.id);

      expect(orquestrador.totalDeTurnos).toBe(0);
      expect(repositorio.buscarPorId(orquestrador.id)?.paraDados().fila?.map((pedido) => pedido.texto)).toEqual([
        "depois",
      ]);
    });
  });

  describe("instruções personalizadas", () => {
    async function pedidoDoTurno(id: string, texto = "analise"): Promise<PedidoDeTurno> {
      const { conclusao } = await servico.enviarMensagem(id, texto);
      motor.terminar();
      await conclusao;
      const pedido = motor.pedidos.at(-1);
      if (pedido === undefined) {
        throw new Error("o motor não recebeu o pedido");
      }
      return pedido;
    }

    it("sem instruções próprias nem padrão, o pedido vai sem instruções", async () => {
      const orquestrador = await criar();
      expect((await pedidoDoTurno(orquestrador.id)).instrucoes).toBeNull();
    });

    it("sem instruções próprias, vale o padrão global", async () => {
      preferencias.preferencias = PreferenciasGlobais.de({ instrucoesPadrao: "Responda curto." });
      const orquestrador = await criar();
      expect((await pedidoDoTurno(orquestrador.id)).instrucoes).toEqual({ texto: "Responda curto.", origem: "padrao" });
    });

    it("as próprias vencem o padrão global, e editá-las vale no pedido seguinte", async () => {
      preferencias.preferencias = PreferenciasGlobais.de({ instrucoesPadrao: "Responda curto." });
      const orquestrador = await criar();
      await servico.alterarConfiguracao(orquestrador.id, { instrucoesPersonalizadas: "Comece com PIRULITO." });
      expect((await pedidoDoTurno(orquestrador.id)).instrucoes).toEqual({
        texto: "Comece com PIRULITO.",
        origem: "orquestrador",
      });

      await servico.alterarConfiguracao(orquestrador.id, { instrucoesPersonalizadas: "" });
      expect((await pedidoDoTurno(orquestrador.id)).instrucoes?.origem).toBe("padrao");
    });

    it("não vazam de um orquestrador para outro", async () => {
      const comInstrucoes = await criar();
      await servico.alterarConfiguracao(comInstrucoes.id, { instrucoesPersonalizadas: "Só deste." });
      const outro = await criar();

      expect((await pedidoDoTurno(comInstrucoes.id)).instrucoes?.texto).toBe("Só deste.");
      expect((await pedidoDoTurno(outro.id)).instrucoes).toBeNull();
    });

    it("um turno em andamento segue com as instruções com que começou", async () => {
      preferencias.preferencias = PreferenciasGlobais.de({ instrucoesPadrao: "Antes." });
      const orquestrador = await criar();
      const { conclusao } = await servico.enviarMensagem(orquestrador.id, "analise");
      preferencias.preferencias = PreferenciasGlobais.de({ instrucoesPadrao: "Depois." });
      motor.terminar();
      await conclusao;

      expect(motor.pedidos.at(-1)?.instrucoes?.texto).toBe("Antes.");
    });

    it("apagá-las no meio da conversa revoga as anteriores, só uma vez por conversa nova", async () => {
      const orquestrador = await criar();
      expect((await pedidoDoTurno(orquestrador.id)).revogarInstrucoesAnteriores).toBe(false);

      await servico.alterarConfiguracao(orquestrador.id, { instrucoesPersonalizadas: "Comece com PIRULITO." });
      expect((await pedidoDoTurno(orquestrador.id)).revogarInstrucoesAnteriores).toBe(false);

      await servico.alterarConfiguracao(orquestrador.id, { instrucoesPersonalizadas: "" });
      const semInstrucoes = await pedidoDoTurno(orquestrador.id);
      expect(semInstrucoes).toMatchObject({ instrucoes: null, revogarInstrucoesAnteriores: true });
      // O histórico ainda tem as instruções antigas: o aviso segue em todo pedido sem instruções.
      expect((await pedidoDoTurno(orquestrador.id)).revogarInstrucoesAnteriores).toBe(true);

      await servico.limparConversa(orquestrador.id);
      expect((await pedidoDoTurno(orquestrador.id)).revogarInstrucoesAnteriores).toBe(false);
    });

    it("o pedido leva os subagentes prontos capturados quando o turno começou", async () => {
      const revisor = { nome: "revisor", descricao: "Revisa.", prompt: "Aponte bugs.", modelo: "herdar" as const };
      const orquestrador = await criar();
      expect((await pedidoDoTurno(orquestrador.id)).subagentesProntos).toEqual([]);

      preferencias.preferencias = PreferenciasGlobais.de({ subagentesProntos: [revisor] });
      const { conclusao } = await servico.enviarMensagem(orquestrador.id, "analise");
      preferencias.preferencias = PreferenciasGlobais.vazias();
      motor.terminar();
      await conclusao;

      expect(motor.pedidos.at(-1)?.subagentesProntos).toEqual([revisor]);
    });

    it("{{pasta}} vira a pasta do turno (o worktree) e {{nome}} o nome do orquestrador", async () => {
      const orquestrador = await criar();
      const caminho = path.resolve("/dados/worktrees/abc");
      worktrees.preparo = { cwd: caminho, worktree: { branch: "orquestrador/id1", caminho } };
      await servico.alterarConfiguracao(orquestrador.id, {
        instrucoesPersonalizadas: "Trabalhe só em {{pasta}}. Assine como {{ nome }}. {{projeto}}",
      });

      const pedido = await pedidoDoTurno(orquestrador.id);

      expect(pedido.pastaDeTrabalho.caminho).toBe(caminho);
      expect(pedido.instrucoes).toEqual({
        texto: `Trabalhe só em ${caminho}. Assine como Painel. {{projeto}}`,
        origem: "orquestrador",
      });
      // Guardadas sem trocar: o próximo turno troca de novo, com a pasta dele.
      expect(orquestrador.configuracao.instrucoesPersonalizadas).toContain("{{pasta}}");
    });

    it("sem worktree, {{pasta}} vira a pasta de trabalho; vale também nas instruções gerais", async () => {
      preferencias.preferencias = PreferenciasGlobais.de({ instrucoesPadrao: "Pasta: {{pasta}}; nome: {{nome}}." });
      const orquestrador = await criar();

      const pedido = await pedidoDoTurno(orquestrador.id);

      expect(pedido.instrucoes).toEqual({
        texto: `Pasta: ${orquestrador.pastaDeTrabalho.caminho}; nome: Painel.`,
        origem: "padrao",
      });
    });

    it("instrucoesPara diz o que o próximo pedido receberia", async () => {
      const orquestrador = await criar();
      expect(servico.instrucoesPara(orquestrador.configuracao)).toBeNull();
      preferencias.preferencias = PreferenciasGlobais.de({ instrucoesPadrao: "Global." });
      expect(servico.instrucoesPara(orquestrador.configuracao)?.origem).toBe("padrao");
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
      pastaDeArtefatos: (orquestradorId) => `/dados/artefatos/entrada/orquestradores/${orquestradorId}`,
      preferencias: new PreferenciasEmMemoria(),
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

  it("o envio automático da fila não atrapalha a medição do turno que terminou", async () => {
    const orquestrador = await criar();
    const { turnoId, medicao, envioDaFila } = await servico.enviarMensagem(orquestrador.id, "analise");
    await servico.enfileirarPedido(orquestrador.id, "depois");

    relogio = fim;
    motor.terminar();
    await envioDaFila;
    await medicao;

    expect(orquestrador.ultimoTurno?.texto).toBe("depois");
    expect(repositorio.eventos.filter((evento) => evento.tipo === "consumo_do_turno_medido")).toEqual([
      expect.objectContaining({ turnoId, consumo: expect.objectContaining({ parcial: false }) }),
    ]);
    expect(medidor.periodos[0]).toMatchObject({ inicio, fim });
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

const SEGUNDO = 1_000;
const MINUTO = 60 * SEGUNDO;

const esvaziar = (): Promise<void> => new Promise((resolver) => setImmediate(resolver));

/** Relógio e agendador falsos: o tempo só anda com `avancar`, rodando as tarefas na ordem. */
class RelogioFalso implements AgendadorDeTarefas {
  agoraMs = Date.parse("2026-11-08T12:00:00Z");
  private tarefas: Array<{ em: number; tarefa: () => void }> = [];

  agora = (): Date => new Date(this.agoraMs);

  agendar(ms: number, tarefa: () => void): () => void {
    const item = { em: this.agoraMs + ms, tarefa };
    this.tarefas.push(item);
    return () => {
      this.tarefas = this.tarefas.filter((outro) => outro !== item);
    };
  }

  get pendentes(): number {
    return this.tarefas.length;
  }

  async avancar(ms: number): Promise<void> {
    const alvo = this.agoraMs + ms;
    for (;;) {
      this.tarefas.sort((a, b) => a.em - b.em);
      const proxima = this.tarefas[0];
      if (proxima === undefined || proxima.em > alvo) {
        break;
      }
      this.tarefas.shift();
      this.agoraMs = proxima.em;
      proxima.tarefa();
      await esvaziar();
    }
    this.agoraMs = alvo;
    await esvaziar();
  }
}

/** Claude parado: vivo, sem CPU, sem comando e sem transcrição crescendo. */
class DiagnosticadorParado implements DiagnosticadorDoClaude {
  readonly esquecidos: string[] = [];
  /** Falso imita o Windows, onde o sistema não deixa ver os processos. */
  processosConhecidos = true;
  async diagnosticar(): Promise<DiagnosticoDoClaude> {
    return {
      processoVivo: true,
      processosConhecidos: this.processosConhecidos,
      cpuDoClaude: 0,
      filhos: [],
      transcricoesCrescendo: false,
      ultimaEscritaEm: null,
    };
  }
  esquecer(orquestradorId: string): void {
    this.esquecidos.push(orquestradorId);
  }
}

const SUCESSO: ResultadoDoTurno = {
  sucesso: true,
  resposta: "feito",
  uso: { duracaoMs: 1, tokensDeEntrada: 1, tokensDeSaida: 1, subagentesLancados: 0 },
};

function falhaPor(causa: CausaDaFalha, liberaEm?: string): ResultadoDoTurno {
  return {
    sucesso: false,
    motivo: `falhou: ${causa}`,
    uso: null,
    causa,
    ...(liberaEm === undefined ? {} : { liberaEm }),
  };
}

/**
 * Motor que segue um roteiro, um passo por turno: um resultado na hora, ou
 * "rodando" (fica calado até ser abortado). Abortado com "silencio",
 * responde como o motor de verdade: falha com `causa: "silencio"`.
 */
class MotorRoteirizado implements MotorDeAgentes {
  readonly pedidos: PedidoDeTurno[] = [];
  roteiro: Array<ResultadoDoTurno | "rodando"> = [];

  executarTurno(
    pedido: PedidoDeTurno,
    aoObservar: (evento: EventoDoMotor) => void,
    sinal: AbortSignal,
  ): Promise<ResultadoDoTurno> {
    this.pedidos.push(pedido);
    aoObservar({ tipo: "sessao_iniciada" });
    const passo = this.roteiro.shift() ?? "rodando";
    return new Promise((resolver) => {
      sinal.addEventListener("abort", () =>
        resolver(
          sinal.reason === "silencio"
            ? { sucesso: false, motivo: "encerrado", uso: null, causa: "silencio" }
            : { sucesso: false, motivo: "morto", uso: null },
        ),
      );
      if (passo !== "rodando") {
        resolver(passo);
      }
    });
  }
}

describe("ServicoDeOrquestracao e a autorrecuperação (ADR-36)", () => {
  let repositorio: RepositorioEmMemoria;
  let motor: MotorRoteirizado;
  let relogio: RelogioFalso;
  let diagnosticador: DiagnosticadorParado;
  let preferencias: PreferenciasEmMemoria;
  let sinais: SinalDeVida[];
  let servico: ServicoDeOrquestracao;
  let ids: number;

  beforeEach(() => {
    repositorio = new RepositorioEmMemoria();
    motor = new MotorRoteirizado();
    relogio = new RelogioFalso();
    diagnosticador = new DiagnosticadorParado();
    preferencias = new PreferenciasEmMemoria();
    sinais = [];
    ids = 0;
    servico = new ServicoDeOrquestracao({
      repositorio,
      motor,
      execucoes: new ControleDeExecucoesEmMemoria(),
      publicador: { publicar: () => undefined, sinalizar: (_id, sinal) => sinais.push(sinal) },
      anexos: new ArmazemEmMemoria(),
      worktrees: new GerenciadorDeWorktreesFalso(),
      pastaDeArtefatos: (orquestradorId) => `/dados/artefatos/entrada/orquestradores/${orquestradorId}`,
      preferencias,
      gerarId: () => `id${++ids}`,
      agora: relogio.agora,
      diagnosticador,
      agendador: relogio,
    });
  });

  async function criar(): Promise<Orquestrador> {
    return servico.criarOrquestrador({
      nome: "Painel",
      pastaDeTrabalho: PastaDeTrabalho.dentroDe(path.resolve("/projetos"), "painel"),
      configuracao,
    });
  }

  /** As etapas da recuperação publicadas, como "etapa tentativa/de". */
  function etapas(): string[] {
    return repositorio.eventos.flatMap((evento) =>
      evento.tipo === "recuperacao_do_turno" ? [`${evento.etapa} ${evento.tentativa}/${evento.de}`] : [],
    );
  }

  function ultimaRecuperacao(): EventoRegistrado | undefined {
    return repositorio.eventos.filter((evento) => evento.tipo === "recuperacao_do_turno").at(-1);
  }

  it("turno travado: encerra com o motivo, espera, e retoma a mesma sessão num turno novo", async () => {
    const orquestrador = await criar();
    motor.roteiro = ["rodando", SUCESSO];
    const primeiro = await servico.enviarMensagem(orquestrador.id, "faça o painel");
    await esvaziar();

    await relogio.avancar(5 * MINUTO);
    await primeiro.conclusao;
    await primeiro.recuperacao;

    expect(sinais[0]).toEqual({
      turnoId: primeiro.turnoId,
      em: "2026-11-08T12:01:30.000Z",
      tokensPensando: 0,
      diagnostico: { situacao: "suspeito", resumo: "sem saída há 1 min, sem CPU" },
    });
    expect(repositorio.eventos.map((evento) => evento.tipo)).toEqual([
      "turno_iniciado",
      "sessao_iniciada",
      "recuperacao_do_turno",
      "turno_falhou",
      "recuperacao_do_turno",
    ]);
    expect(repositorio.eventos[2]).toMatchObject({
      turnoId: primeiro.turnoId,
      etapa: "encerrado",
      causa: "silencio",
      tentativa: 1,
      de: 2,
      resumo: "sem saída há 5 min, sem CPU e sem transcrição crescendo",
      retomaEm: null,
    });
    expect(repositorio.eventos[3]).toMatchObject({
      tipo: "turno_falhou",
      motivo:
        "O app encerrou o turno porque o Claude ficou sem dar notícias (sem saída há 5 min, sem CPU e sem transcrição crescendo).",
    });
    expect(repositorio.eventos[4]).toMatchObject({
      turnoId: primeiro.turnoId,
      etapa: "aguardando",
      tentativa: 1,
      de: 2,
      retomaEm: "2026-11-08T12:05:30.000Z",
    });
    expect(diagnosticador.esquecidos).toEqual([orquestrador.id]);

    await relogio.avancar(30 * SEGUNDO - 1);
    expect(motor.pedidos).toHaveLength(1);
    await relogio.avancar(1);
    await vi.waitFor(() => expect(orquestrador.ultimoTurno?.situacao).toBe("concluido"));

    expect(ultimaRecuperacao()).toMatchObject({ etapa: "retomando", turnoId: primeiro.turnoId, tentativa: 1 });
    const retomada = repositorio.eventos.filter((evento) => evento.tipo === "turno_iniciado").at(-1);
    expect(retomada).toMatchObject({ retomada: { deTurnoId: primeiro.turnoId, tentativa: 1 }, modo: "execucao" });
    expect(motor.pedidos[1]).toMatchObject({ sessaoId: orquestrador.sessaoId, sessaoIniciada: true });
    expect(motor.pedidos[1]?.sessaoId).toBe(motor.pedidos[0]?.sessaoId);
    expect(motor.pedidos[1]?.texto).toContain(
      "Você foi interrompido pelo app porque ficou sem dar notícias. Confira o estado atual da pasta de trabalho",
    );
    expect(orquestrador.totalDeTurnos).toBe(2);
  });

  it("silêncio: 2 retomadas (30 s e 2 min) e então desiste com o diagnóstico", async () => {
    const orquestrador = await criar();
    motor.roteiro = ["rodando", "rodando", "rodando"];
    const primeiro = await servico.enviarMensagem(orquestrador.id, "faça");
    await esvaziar();

    await relogio.avancar(5 * MINUTO); // trava o 1º
    await primeiro.recuperacao;
    await relogio.avancar(30 * SEGUNDO); // retoma
    await relogio.avancar(5 * MINUTO); // trava o 2º
    await vi.waitFor(() => expect(etapas().at(-1)).toBe("aguardando 2/2"));
    expect(ultimaRecuperacao()).toMatchObject({ retomaEm: new Date(relogio.agoraMs + 2 * MINUTO).toISOString() });
    await relogio.avancar(2 * MINUTO); // retoma
    await relogio.avancar(5 * MINUTO); // trava o 3º
    await vi.waitFor(() => expect(etapas().at(-1)).toBe("desistiu 2/2"));

    expect(etapas()).toEqual([
      "encerrado 1/2",
      "aguardando 1/2",
      "retomando 1/2",
      "encerrado 2/2",
      "aguardando 2/2",
      "retomando 2/2",
      "encerrado 2/2",
      "desistiu 2/2",
    ]);
    const desistencia = ultimaRecuperacao() as { resumo: string };
    expect(desistencia.resumo).toContain("o Claude ficou sem dar notícias");
    expect(desistencia.resumo).toContain("com esperas de 30 s, 2 min");
    expect(desistencia.resumo).toContain("sem saída há 5 min, sem CPU e sem transcrição crescendo");
    expect(motor.pedidos).toHaveLength(3);
    expect(relogio.pendentes).toBe(0);
  });

  it("limite de uso: espera até liberar mais 1 min, mesmo horas depois", async () => {
    const orquestrador = await criar();
    const liberaEm = new Date(relogio.agoraMs + 3 * 60 * MINUTO).toISOString();
    motor.roteiro = [falhaPor("limite_de_uso", liberaEm), SUCESSO];

    const primeiro = await servico.enviarMensagem(orquestrador.id, "faça");
    await primeiro.recuperacao;

    expect(repositorio.eventos.at(-2)).toMatchObject({ tipo: "turno_falhou", motivo: "falhou: limite_de_uso" });
    expect(ultimaRecuperacao()).toMatchObject({
      etapa: "aguardando",
      causa: "limite_de_uso",
      tentativa: 1,
      de: 3,
      resumo: `limite de uso, libera às ${formatarHora(new Date(liberaEm))}`,
      retomaEm: new Date(Date.parse(liberaEm) + MINUTO).toISOString(),
    });

    await relogio.avancar(3 * 60 * MINUTO);
    expect(motor.pedidos).toHaveLength(1);
    await relogio.avancar(MINUTO);
    await vi.waitFor(() => expect(orquestrador.ultimoTurno?.situacao).toBe("concluido"));
    expect(motor.pedidos[1]?.texto).toContain("limite de uso da assinatura foi atingido");
  });

  it("limite de uso sem horário: tenta de novo em 15 min", async () => {
    const orquestrador = await criar();
    motor.roteiro = [falhaPor("limite_de_uso")];

    const primeiro = await servico.enviarMensagem(orquestrador.id, "faça");
    await primeiro.recuperacao;

    expect(ultimaRecuperacao()).toMatchObject({
      etapa: "aguardando",
      retomaEm: new Date(relogio.agoraMs + 15 * MINUTO).toISOString(),
    });
  });

  it("sobrecarga: 3 tentativas (1, 3 e 5 min) e então desiste", async () => {
    const orquestrador = await criar();
    motor.roteiro = [falhaPor("sobrecarga"), falhaPor("sobrecarga"), falhaPor("sobrecarga"), falhaPor("sobrecarga")];

    const primeiro = await servico.enviarMensagem(orquestrador.id, "faça");
    await primeiro.recuperacao;
    await relogio.avancar(MINUTO);
    await vi.waitFor(() => expect(etapas().at(-1)).toBe("aguardando 2/3"));
    await relogio.avancar(3 * MINUTO);
    await vi.waitFor(() => expect(etapas().at(-1)).toBe("aguardando 3/3"));
    await relogio.avancar(5 * MINUTO);
    await vi.waitFor(() => expect(etapas().at(-1)).toBe("desistiu 3/3"));

    expect(etapas()).toEqual([
      "aguardando 1/3",
      "retomando 1/3",
      "aguardando 2/3",
      "retomando 2/3",
      "aguardando 3/3",
      "retomando 3/3",
      "desistiu 3/3",
    ]);
    expect((ultimaRecuperacao() as { resumo: string }).resumo).toBe(
      "O app desistiu de retomar sozinho: API do Claude sobrecarregada. Retomou a mesma sessão 3 vezes, " +
        "com esperas de 1 min, 3 min, 5 min, e o turno falhou de novo. Última falha: falhou: sobrecarga",
    );
    expect(motor.pedidos).toHaveLength(4);
    expect(orquestrador.ultimoTurno?.situacao).toBe("falhou");
  });

  it("as tentativas zeram quando um turno conclui", async () => {
    const orquestrador = await criar();
    motor.roteiro = [falhaPor("rede"), SUCESSO, falhaPor("rede")];

    const primeiro = await servico.enviarMensagem(orquestrador.id, "faça");
    await primeiro.recuperacao;
    await relogio.avancar(MINUTO);
    await vi.waitFor(() => expect(orquestrador.ultimoTurno?.situacao).toBe("concluido"));
    const segundo = await servico.enviarMensagem(orquestrador.id, "outra");
    await segundo.recuperacao;

    expect(etapas()).toEqual(["aguardando 1/3", "retomando 1/3", "aguardando 1/3"]);
  });

  it("cancelar durante a espera cancela a retomada; sem nada agendado, volta o 409", async () => {
    const orquestrador = await criar();
    motor.roteiro = [falhaPor("rede")];
    const primeiro = await servico.enviarMensagem(orquestrador.id, "faça");
    await primeiro.recuperacao;

    await servico.cancelar(orquestrador.id);

    expect(ultimaRecuperacao()).toMatchObject({
      etapa: "cancelada",
      turnoId: primeiro.turnoId,
      resumo: "retomada cancelada: o usuário cancelou",
      retomaEm: null,
    });
    await relogio.avancar(10 * MINUTO);
    expect(motor.pedidos).toHaveLength(1);
    await expect(servico.cancelar(orquestrador.id)).rejects.toMatchObject({ motivo: "sem_turno_em_andamento" });
  });

  it("uma mensagem do usuário durante a espera cancela a retomada antes de o turno dela começar", async () => {
    const orquestrador = await criar();
    motor.roteiro = [falhaPor("rede"), SUCESSO];
    const primeiro = await servico.enviarMensagem(orquestrador.id, "faça");
    await primeiro.recuperacao;

    const segundo = await servico.enviarMensagem(orquestrador.id, "deixa, faça outra coisa");
    await segundo.conclusao;
    await relogio.avancar(10 * MINUTO);

    expect(repositorio.eventos.map((evento) => evento.tipo).slice(-4)).toEqual([
      "recuperacao_do_turno",
      "turno_iniciado",
      "sessao_iniciada",
      "turno_concluido",
    ]);
    expect(ultimaRecuperacao()).toMatchObject({ etapa: "cancelada", resumo: "retomada cancelada: um novo pedido começou" });
    expect(repositorio.eventos.at(-3)).not.toHaveProperty("retomada");
    expect(motor.pedidos.map((pedido) => pedido.texto)).toEqual(["faça", "deixa, faça outra coisa"]);
  });

  it("limpar a conversa durante a espera cancela a retomada", async () => {
    const orquestrador = await criar();
    motor.roteiro = [falhaPor("rede")];
    const primeiro = await servico.enviarMensagem(orquestrador.id, "faça");
    await primeiro.recuperacao;

    await servico.limparConversa(orquestrador.id);
    await relogio.avancar(10 * MINUTO);

    expect(repositorio.eventos.map((evento) => evento.tipo).slice(-2)).toEqual(["recuperacao_do_turno", "conversa_limpa"]);
    expect(ultimaRecuperacao()).toMatchObject({ etapa: "cancelada", resumo: "retomada cancelada: a conversa foi limpa" });
    expect(motor.pedidos).toHaveLength(1);
  });

  it("falha por outra causa (ou sem causa) não retoma", async () => {
    const orquestrador = await criar();
    motor.roteiro = [falhaPor("outro"), { sucesso: false, motivo: "sem causa", uso: null }];

    const primeiro = await servico.enviarMensagem(orquestrador.id, "faça");
    await primeiro.recuperacao;
    const segundo = await servico.enviarMensagem(orquestrador.id, "de novo");
    await segundo.recuperacao;

    expect(etapas()).toEqual([]);
    expect(relogio.pendentes).toBe(0);
  });

  it("cancelamento do usuário no meio do turno é cancelamento, não falha: não retoma", async () => {
    const orquestrador = await criar();
    motor.roteiro = ["rodando"];
    const primeiro = await servico.enviarMensagem(orquestrador.id, "faça");
    await esvaziar();

    await servico.cancelar(orquestrador.id);
    await primeiro.recuperacao;

    expect(orquestrador.ultimoTurno?.situacao).toBe("cancelado");
    expect(etapas()).toEqual([]);
  });

  it("sem lista de processos (Windows), só mostra o diagnóstico: não encerra nem retoma", async () => {
    diagnosticador.processosConhecidos = false;
    const orquestrador = await criar();
    motor.roteiro = ["rodando"];
    const primeiro = await servico.enviarMensagem(orquestrador.id, "rode o npm test");
    await esvaziar();

    await relogio.avancar(20 * MINUTO);
    expect(orquestrador.situacao).toBe("trabalhando");
    expect(sinais.at(-1)?.diagnostico).toEqual({
      situacao: "suspeito",
      resumo: "sem saída há 20 min; não dá para ver os processos neste sistema, então o app não encerra o pedido sozinho",
      semRetomadaAutomatica: true,
    });
    expect(etapas()).toEqual([]);
    expect(motor.pedidos).toHaveLength(1);

    await servico.cancelar(orquestrador.id);
    await primeiro.recuperacao;
    expect(etapas()).toEqual([]);
  });

  it("com a autorrecuperação desligada, só mostra o diagnóstico: não encerra nem retoma", async () => {
    preferencias.preferencias = PreferenciasGlobais.de({ autorrecuperacao: false });
    const orquestrador = await criar();
    motor.roteiro = ["rodando"];
    const primeiro = await servico.enviarMensagem(orquestrador.id, "faça");
    await esvaziar();

    await relogio.avancar(20 * MINUTO);
    expect(orquestrador.situacao).toBe("trabalhando");
    expect(sinais.at(-1)?.diagnostico).toEqual({ situacao: "suspeito", resumo: "sem saída há 20 min, sem CPU" });

    await servico.cancelar(orquestrador.id);
    await primeiro.recuperacao;
    expect(etapas()).toEqual([]);

    // Falha por rede também não é retomada.
    motor.roteiro = [falhaPor("rede")];
    const segundo = await servico.enviarMensagem(orquestrador.id, "de novo");
    await segundo.recuperacao;
    expect(etapas()).toEqual([]);
    expect(relogio.pendentes).toBe(0);
  });

  describe("retomada gravada e o reinício do app", () => {
    /** Um Orquestrador cujo último turno falhou, com a retomada gravada como ficou no disco. */
    async function comRetomadaGravada(
      retomada: Partial<{ deTurnoId: string; causa: "silencio" | "rede"; tentativa: number; retomarEm: string }> = {},
    ): Promise<Orquestrador> {
      const orquestrador = await criar();
      const turnoId = `t-${orquestrador.id}`;
      orquestrador.iniciarTurno(turnoId, "faça", relogio.agora());
      orquestrador.falharTurno(turnoId, "falhou", relogio.agora());
      orquestrador.agendarRetomada({
        deTurnoId: turnoId,
        causa: "rede",
        tentativa: 1,
        retomarEm: new Date(relogio.agoraMs + 2 * MINUTO).toISOString(),
        ...retomada,
      });
      return orquestrador;
    }

    function aguardando(): Array<{ turnoId: string; retomaEm: string | null }> {
      return repositorio.eventos.flatMap((evento) =>
        evento.tipo === "recuperacao_do_turno" && evento.etapa === "aguardando"
          ? [{ turnoId: evento.turnoId, retomaEm: evento.retomaEm }]
          : [],
      );
    }

    it("ao agendar, a retomada fica no agregado; cancelar a tira", async () => {
      const orquestrador = await criar();
      motor.roteiro = [falhaPor("rede")];
      const primeiro = await servico.enviarMensagem(orquestrador.id, "faça");
      await primeiro.recuperacao;

      expect(orquestrador.retomadaPendente).toEqual({
        deTurnoId: primeiro.turnoId,
        causa: "rede",
        tentativa: 1,
        retomarEm: new Date(relogio.agoraMs + MINUTO).toISOString(),
      });

      await servico.cancelar(orquestrador.id);
      expect(orquestrador.retomadaPendente).toBeNull();
    });

    it("reagenda com a tentativa gravada, registra no log do turno e retoma na hora marcada", async () => {
      const retomarEm = new Date(relogio.agoraMs + 2 * MINUTO).toISOString();
      const orquestrador = await comRetomadaGravada({ tentativa: 3, retomarEm });
      const turnoId = `t-${orquestrador.id}`;
      motor.roteiro = [falhaPor("rede")];

      expect(await servico.reagendarRetomadasPendentes()).toBe(1);

      expect(ultimaRecuperacao()).toMatchObject({
        turnoId,
        etapa: "aguardando",
        causa: "rede",
        tentativa: 3,
        de: 3,
        resumo: `retomada reagendada após o reinício do app; retoma às ${formatarHora(new Date(retomarEm))}`,
        retomaEm: retomarEm,
      });
      expect(orquestrador.retomadaPendente).toMatchObject({ deTurnoId: turnoId, tentativa: 3, retomarEm });

      await relogio.avancar(2 * MINUTO - 1);
      expect(motor.pedidos).toHaveLength(0);
      await relogio.avancar(1);
      // A contagem voltou com a tentativa gravada: a falha seguinte já é a desistência.
      await vi.waitFor(() => expect(etapas().at(-1)).toBe("desistiu 3/3"));

      expect(etapas()).toEqual(["aguardando 3/3", "retomando 3/3", "desistiu 3/3"]);
      expect(repositorio.eventos.find((evento) => evento.tipo === "turno_iniciado")).toMatchObject({
        retomada: { deTurnoId: turnoId, tentativa: 3 },
      });
      expect(motor.pedidos[0]?.texto).toContain("Você foi interrompido por uma falha de rede");
      expect(orquestrador.retomadaPendente).toBeNull();
    });

    it("as que venceram durante o reinício saem logo, uma de cada vez", async () => {
      const vencida = new Date(relogio.agoraMs - MINUTO).toISOString();
      await comRetomadaGravada({ causa: "silencio", retomarEm: vencida });
      await comRetomadaGravada({ causa: "silencio", retomarEm: vencida });
      motor.roteiro = [SUCESSO, SUCESSO];

      expect(await servico.reagendarRetomadasPendentes()).toBe(2);
      expect(aguardando().map((evento) => evento.retomaEm)).toEqual([
        new Date(relogio.agoraMs + 10 * SEGUNDO).toISOString(),
        new Date(relogio.agoraMs + 20 * SEGUNDO).toISOString(),
      ]);

      await relogio.avancar(10 * SEGUNDO);
      await vi.waitFor(() => expect(motor.pedidos).toHaveLength(1));
      await relogio.avancar(10 * SEGUNDO);
      await vi.waitFor(() => expect(motor.pedidos).toHaveLength(2));
    });

    it("com a autorrecuperação desligada, só tira a retomada e registra no log do turno", async () => {
      preferencias.preferencias = PreferenciasGlobais.de({ autorrecuperacao: false });
      const orquestrador = await comRetomadaGravada();

      expect(await servico.reagendarRetomadasPendentes()).toBe(0);

      expect(orquestrador.retomadaPendente).toBeNull();
      expect(ultimaRecuperacao()).toMatchObject({
        turnoId: `t-${orquestrador.id}`,
        etapa: "cancelada",
        resumo: "retomada cancelada: a autorrecuperação está desligada (o app foi reiniciado durante a espera)",
        retomaEm: null,
      });
      await relogio.avancar(10 * MINUTO);
      expect(motor.pedidos).toHaveLength(0);
    });

    it("a de um turno que já não é o último só sai, sem evento", async () => {
      const orquestrador = await comRetomadaGravada({ deTurnoId: "t-de-outra-vez" });

      expect(await servico.reagendarRetomadasPendentes()).toBe(0);

      expect(orquestrador.retomadaPendente).toBeNull();
      expect(etapas()).toEqual([]);
      expect(relogio.pendentes).toBe(0);
    });
  });
});
