import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { ControleDeExecucoesEmMemoria } from "../infraestrutura/execucoes/ControleDeExecucoesEmMemoria";
import { Anexo } from "./Anexo";
import { ArmazemDeAnexos } from "./ArmazemDeAnexos";
import { DadosDaConfiguracao } from "./ConfiguracaoDoOrquestrador";
import { EventoDeOrquestracao, EventoDoMotor, EventoRegistrado, SinalDeVida } from "./EventoDeOrquestracao";
import { MotorDeAgentes, PedidoDeTurno, ResultadoDoTurno } from "./MotorDeAgentes";
import { Orquestrador } from "./Orquestrador";
import { PastaDeTrabalho } from "./PastaDeTrabalho";
import { GerenciadorDeWorktrees, PreparoDeWorktree } from "./PreparoDeWorktree";
import { RepositorioDeOrquestradores } from "./RepositorioDeOrquestradores";
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
  lerEventos(): readonly EventoRegistrado[] {
    return this.eventos;
  }
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
  let worktrees: GerenciadorDeWorktreesFalso;
  let servico: ServicoDeOrquestracao;
  let ids: number;

  beforeEach(() => {
    repositorio = new RepositorioEmMemoria();
    motor = new MotorFalso();
    armazem = new ArmazemEmMemoria();
    sinais = [];
    worktrees = new GerenciadorDeWorktreesFalso();
    ids = 0;
    servico = new ServicoDeOrquestracao({
      repositorio,
      motor,
      execucoes: new ControleDeExecucoesEmMemoria(),
      publicador: { publicar: () => undefined, sinalizar: (_id, sinal) => sinais.push(sinal) },
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
  });
});
