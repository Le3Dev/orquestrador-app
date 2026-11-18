import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { Anexo } from "../orquestracao/Anexo";
import { ArmazemDeAnexos } from "../orquestracao/ArmazemDeAnexos";
import { DadosDaConfiguracao } from "../orquestracao/ConfiguracaoDoOrquestrador";
import { EventoDeOrquestracao, EventoDoMotor, EventoRegistrado } from "../orquestracao/EventoDeOrquestracao";
import { MARCADOR_DE_PLANO } from "../orquestracao/InstrucoesDoOrquestrador";
import { MotorDeAgentes, PedidoDeTurno, ResultadoDoTurno } from "../orquestracao/MotorDeAgentes";
import { Orquestrador } from "../orquestracao/Orquestrador";
import { PastaDeTrabalho } from "../orquestracao/PastaDeTrabalho";
import { GerenciadorDeWorktrees, PreparoDeWorktree } from "../orquestracao/PreparoDeWorktree";
import { PreferenciasGlobais } from "../orquestracao/PreferenciasGlobais";
import { ConversaArquivada, RepositorioDeOrquestradores } from "../orquestracao/RepositorioDeOrquestradores";
import { RepositorioDePreferencias } from "../orquestracao/RepositorioDePreferencias";
import { ServicoDeOrquestracao } from "../orquestracao/ServicoDeOrquestracao";
import { AgendadorDeTarefas } from "../orquestracao/VigiaDoTurno";
import { Temporizador } from "../rotinas/Temporizador";
import { ControleDeExecucoesEmMemoria } from "./execucoes/ControleDeExecucoesEmMemoria";
import {
  ExecutorDePedidosDaOrquestracao,
  TAMANHO_MAXIMO_DA_RESPOSTA_DA_ETAPA,
} from "./ExecutorDePedidosDaOrquestracao";
import { CanalDeEventos } from "./sse/CanalDeEventos";

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
  arquivarConversa(orquestrador: Orquestrador, evento: EventoDeOrquestracao): ConversaArquivada {
    this.orquestradores.set(orquestrador.id, orquestrador);
    return { registrado: this.anexarEvento(orquestrador.id, evento), gravacao: Promise.resolve() };
  }
  lerEventos(): readonly EventoRegistrado[] {
    return this.eventos;
  }
}

/** Motor que só termina quando o teste manda (`terminar`) ou o turno é abortado. */
class MotorFalso implements MotorDeAgentes {
  pedidos: PedidoDeTurno[] = [];
  private readonly liberadores: Array<(resultado: ResultadoDoTurno) => void> = [];
  private readonly adiantados: ResultadoDoTurno[] = [];

  executarTurno(pedido: PedidoDeTurno, _aoObservar: (evento: EventoDoMotor) => void, sinal: AbortSignal): Promise<ResultadoDoTurno> {
    this.pedidos.push(pedido);
    return new Promise((resolver) => {
      const abortar = (): void => resolver({ sucesso: false, motivo: "morto", uso: null });
      if (sinal.aborted) {
        abortar();
        return;
      }
      sinal.addEventListener("abort", abortar, { once: true });
      const adiantado = this.adiantados.shift();
      if (adiantado === undefined) {
        this.liberadores.push(resolver);
      } else {
        resolver(adiantado);
      }
    });
  }

  /** Termina o próximo turno (o já em andamento, ou o próximo que começar). */
  terminar(resultado: ResultadoDoTurno): void {
    const liberar = this.liberadores.shift();
    if (liberar === undefined) {
      this.adiantados.push(resultado);
    } else {
      liberar(resultado);
    }
  }
}

function sucesso(resposta: string): ResultadoDoTurno {
  return { sucesso: true, resposta, uso: { duracaoMs: 1, tokensDeEntrada: 1, tokensDeSaida: 1, subagentesLancados: 0 } };
}

class ArmazemEmMemoria implements ArmazemDeAnexos {
  async guardar(_orquestradorId: string, _anexo: Anexo, _conteudo: Uint8Array): Promise<void> {
    return undefined;
  }
  caminhoDe(orquestradorId: string, arquivo: string): string {
    return `/anexos/${orquestradorId}/${arquivo}`;
  }
  caminhoDoTextoDe(): string | null {
    return null;
  }
  pastaDe(orquestradorId: string): string {
    return `/anexos/${orquestradorId}`;
  }
  async removerTodos(): Promise<void> {
    return undefined;
  }
}

class GerenciadorDeWorktreesFalso implements GerenciadorDeWorktrees {
  async preparar(_id: string, pastaDeTrabalho: string): Promise<PreparoDeWorktree> {
    return { cwd: pastaDeTrabalho, worktree: null };
  }
  async concluir(): Promise<boolean> {
    return false;
  }
}

/** Relógio manual: o teste dispara as esperas quando quer. */
class TemporizadorManual implements Temporizador, AgendadorDeTarefas {
  private readonly marcados: Array<{ executar: () => void; ativo: boolean; ms: number }> = [];

  agendar(primeiro: (() => void) | number, segundo: number | (() => void)): () => void {
    // `Temporizador.agendar(aoVencer, ms)` e `AgendadorDeTarefas.agendar(ms, tarefa)`.
    const executar = typeof primeiro === "function" ? primeiro : (segundo as () => void);
    const ms = typeof primeiro === "number" ? primeiro : (segundo as number);
    const marcado = { executar, ativo: true, ms };
    this.marcados.push(marcado);
    return () => {
      marcado.ativo = false;
    };
  }

  get ativos(): number {
    return this.marcados.filter((marcado) => marcado.ativo).length;
  }

  /** Vence tudo o que está marcado agora. */
  disparar(): void {
    for (const marcado of this.marcados.filter((candidato) => candidato.ativo)) {
      marcado.ativo = false;
      marcado.executar();
    }
  }
}

const configuracao: DadosDaConfiguracao = {
  modeloDoOrquestrador: "opus",
  modeloDosSubagentes: "haiku",
  quantidadeDeSubagentes: { modo: "fixa", limite: 2 },
  nivelDePermissao: "edicao",
};

const LIMITE_DA_FILA = 10;

describe("ExecutorDePedidosDaOrquestracao", () => {
  let repositorio: RepositorioEmMemoria;
  let motor: MotorFalso;
  let servico: ServicoDeOrquestracao;
  let relogio: TemporizadorManual;
  let executor: ExecutorDePedidosDaOrquestracao;
  let ids: number;
  let sinal: AbortController;
  let canal: CanalDeEventos;

  beforeEach(() => {
    repositorio = new RepositorioEmMemoria();
    motor = new MotorFalso();
    relogio = new TemporizadorManual();
    ids = 0;
    sinal = new AbortController();
    canal = new CanalDeEventos();
    servico = new ServicoDeOrquestracao({
      repositorio,
      motor,
      execucoes: new ControleDeExecucoesEmMemoria(),
      publicador: {
        publicar: (id, evento) => {
          canal.publicar(id, evento);
        },
        sinalizar: () => undefined,
      },
      anexos: new ArmazemEmMemoria(),
      worktrees: new GerenciadorDeWorktreesFalso(),
      pastaDeArtefatos: (orquestradorId) => `/dados/artefatos/entrada/orquestradores/${orquestradorId}`,
      preferencias: new PreferenciasEmMemoria(),
      gerarId: () => `id${++ids}`,
      agora: () => new Date("2026-10-28T12:00:00Z"),
      agendador: relogio,
    });
    executor = new ExecutorDePedidosDaOrquestracao({ servico, repositorio, canal, temporizador: relogio });
  });

  async function criar(extra: Partial<DadosDaConfiguracao> = {}): Promise<Orquestrador> {
    return servico.criarOrquestrador({
      nome: "Painel",
      pastaDeTrabalho: PastaDeTrabalho.dentroDe(path.resolve("/projetos"), "painel"),
      configuracao: { ...configuracao, ...extra },
    });
  }

  /** Dá tempo de os `await` do serviço andarem. */
  const aguardar = async (): Promise<void> => {
    for (let volta = 0; volta < 20; volta += 1) {
      await Promise.resolve();
    }
    await new Promise((resolver) => setTimeout(resolver, 0));
  };

  const executarPedido = (orquestradorId: string, texto = "faça isso", modo: "execucao" | "planejamento" = "execucao") =>
    executor.executar({ orquestradorId, texto, modo }, sinal.signal);

  describe("com o Orquestrador livre", () => {
    it("manda o pedido como um turno e devolve a resposta quando ele termina", async () => {
      const orquestrador = await criar();

      const resultado = executarPedido(orquestrador.id, "resuma o README");
      await aguardar();
      motor.terminar(sucesso("O README fala de X."));

      expect(await resultado).toEqual({ situacao: "concluido", resposta: "O README fala de X." });
      expect(motor.pedidos).toHaveLength(1);
      expect(motor.pedidos[0]).toMatchObject({ texto: "resuma o README", modo: "execucao" });
      expect(orquestrador.situacao).toBe("ocioso");
      expect(orquestrador.fila).toHaveLength(0);
    });

    it("o modo de planejamento vai ao turno", async () => {
      const orquestrador = await criar();

      const resultado = executarPedido(orquestrador.id, "planeje", "planejamento");
      await aguardar();
      motor.terminar(sucesso("Plano: 1. x"));
      await resultado;

      expect(motor.pedidos[0]?.modo).toBe("planejamento");
    });

    it("um turno que termina antes de o envio voltar também é visto (o evento chega antes de se saber o turno)", async () => {
      const orquestrador = await criar();
      motor.terminar(sucesso("rápido"));

      expect(await executarPedido(orquestrador.id)).toEqual({ situacao: "concluido", resposta: "rápido" });
    });

    it("resume a resposta longa em até 4 mil caracteres, dizendo que cortou", async () => {
      const orquestrador = await criar();
      motor.terminar(sucesso("x".repeat(10_000)));

      const resultado = await executarPedido(orquestrador.id);

      expect(resultado.situacao).toBe("concluido");
      const resposta = resultado.situacao === "concluido" ? resultado.resposta : "";
      expect(resposta.startsWith("x".repeat(TAMANHO_MAXIMO_DA_RESPOSTA_DA_ETAPA))).toBe(true);
      expect(resposta).toContain("resposta cortada");
      expect(resposta.length).toBeLessThan(TAMANHO_MAXIMO_DA_RESPOSTA_DA_ETAPA + 120);
    });

    it("um Orquestrador que não existe falha com mensagem clara; orquestradorExiste diz se existe", async () => {
      const orquestrador = await criar();

      expect(await executor.orquestradorExiste(orquestrador.id)).toBe(true);
      expect(await executor.orquestradorExiste("nao-existe")).toBe(false);
      expect(await executarPedido("nao-existe")).toEqual({
        situacao: "falhou",
        motivo: "O orquestrador escolhido não existe mais.",
      });
    });

    it("uma recusa do domínio (texto vazio) vira falha com a mensagem pronta, sem exceção", async () => {
      const orquestrador = await criar();

      expect(await executarPedido(orquestrador.id, "   ")).toEqual({
        situacao: "falhou",
        motivo: "Escreva uma mensagem para o orquestrador.",
      });
    });

    it("a falha do turno vira falhou com o motivo, depois de esperar uma decisão do app (que não vem)", async () => {
      const orquestrador = await criar();
      const resultado = executarPedido(orquestrador.id);
      await aguardar();

      motor.terminar({ sucesso: false, motivo: "O comando falhou.", uso: null });
      await aguardar();
      // Ainda espera: o app poderia continuar o pedido sozinho.
      expect(relogio.ativos).toBe(1);
      relogio.disparar();

      expect(await resultado).toEqual({ situacao: "falhou", motivo: "O comando falhou." });
    });

    it("o turno cancelado no orquestrador vira cancelado", async () => {
      const orquestrador = await criar();
      const resultado = executarPedido(orquestrador.id);
      await aguardar();

      await servico.cancelar(orquestrador.id);

      expect(await resultado).toMatchObject({ situacao: "cancelado" });
    });
  });

  describe("sinal de cancelamento", () => {
    it("já abortado: cancelado, sem mandar nada ao orquestrador", async () => {
      const orquestrador = await criar();
      sinal.abort();

      expect(await executarPedido(orquestrador.id)).toEqual({ situacao: "cancelado", motivo: "A rotina foi cancelada." });
      expect(motor.pedidos).toHaveLength(0);
      expect(orquestrador.totalDeTurnos).toBe(0);
    });

    it("abortar com o turno rodando cancela o turno e devolve cancelado", async () => {
      const orquestrador = await criar();
      const resultado = executarPedido(orquestrador.id);
      await aguardar();
      expect(orquestrador.situacao).toBe("trabalhando");

      sinal.abort();

      expect(await resultado).toEqual({ situacao: "cancelado", motivo: "A rotina foi cancelada." });
      await aguardar();
      expect(orquestrador.situacao).toBe("ocioso");
      expect(orquestrador.ultimoTurno?.situacao).toBe("cancelado");
    });
  });

  describe("planos", () => {
    it("um turno que termina com plano pendente vira plano_para_aprovacao, sem o marcador", async () => {
      const orquestrador = await criar();
      const resultado = executarPedido(orquestrador.id, "mude tudo");
      await aguardar();

      motor.terminar(sucesso(`Plano: 1. mexer em A\n2. mexer em B\n${MARCADOR_DE_PLANO}`));

      const final = await resultado;
      expect(final.situacao).toBe("plano_para_aprovacao");
      expect(final.situacao === "plano_para_aprovacao" ? final.plano : "").toContain("Plano: 1. mexer em A");
      expect(final.situacao === "plano_para_aprovacao" ? final.plano : "").not.toContain(MARCADOR_DE_PLANO);
      expect(orquestrador.turnoComPlanoPendente).not.toBeNull();
    });

    it("aprovarPlano executa o plano e devolve a resposta do turno novo", async () => {
      const orquestrador = await criar();
      const pedido = executarPedido(orquestrador.id, "mude tudo", "planejamento");
      await aguardar();
      motor.terminar(sucesso("Plano: tudo."));
      expect((await pedido).situacao).toBe("plano_para_aprovacao");

      const execucao = executor.aprovarPlano(orquestrador.id, sinal.signal);
      await aguardar();
      motor.terminar(sucesso("Feito conforme o plano."));

      expect(await execucao).toEqual({ situacao: "concluido", resposta: "Feito conforme o plano." });
      expect(motor.pedidos[1]).toMatchObject({ modo: "execucao" });
      expect(motor.pedidos[1]?.texto).toContain("Plano aprovado.");
      expect(orquestrador.turnoComPlanoPendente).toBeNull();
    });

    it("aprovarPlano sem plano pendente falha com mensagem clara (ele já foi decidido em outro lugar)", async () => {
      const orquestrador = await criar();

      const resultado = await executor.aprovarPlano(orquestrador.id, sinal.signal);

      expect(resultado.situacao).toBe("falhou");
      expect(resultado.situacao === "falhou" ? resultado.motivo : "").toContain("Não há mais um plano esperando aprovação");
    });

    it("aprovarPlano com o Orquestrador ocupado falha sem aprovar nada (o plano segue com o usuário)", async () => {
      const orquestrador = await criar();
      await servico.enviarMensagem(orquestrador.id, "outro pedido, em andamento");

      const resultado = await executor.aprovarPlano(orquestrador.id, sinal.signal);

      expect(resultado.situacao).toBe("falhou");
      expect(resultado.situacao === "falhou" ? resultado.motivo : "").toContain("está ocupado com outro pedido");
      expect(motor.pedidos).toHaveLength(1);
      motor.terminar(sucesso("fim"));
    });

    it("descartarPlano descarta o plano pendente; sem plano ou sem Orquestrador, não é erro", async () => {
      const orquestrador = await criar();
      const pedido = executarPedido(orquestrador.id, "mude tudo", "planejamento");
      await aguardar();
      motor.terminar(sucesso("Plano: tudo."));
      await pedido;

      await executor.descartarPlano(orquestrador.id);
      expect(orquestrador.turnoComPlanoPendente).toBeNull();
      await expect(executor.descartarPlano(orquestrador.id)).resolves.toBeUndefined();
      await expect(executor.descartarPlano("nao-existe")).resolves.toBeUndefined();
    });
  });

  describe("com o Orquestrador ocupado: a fila", () => {
    it("o pedido entra na fila e roda quando o turno anterior termina bem", async () => {
      const orquestrador = await criar();
      const anterior = await servico.enviarMensagem(orquestrador.id, "o pedido do usuário");
      const resultado = executarPedido(orquestrador.id, "o pedido da rotina");
      await aguardar();
      expect(orquestrador.fila.map((pedido) => pedido.texto)).toEqual(["o pedido da rotina"]);

      motor.terminar(sucesso("terminei o do usuário"));
      await anterior.conclusao;
      await aguardar();
      expect(orquestrador.fila).toHaveLength(0);
      expect(motor.pedidos.map((pedido) => pedido.texto)).toEqual(["o pedido do usuário", "o pedido da rotina"]);
      motor.terminar(sucesso("terminei o da rotina"));

      expect(await resultado).toEqual({ situacao: "concluido", resposta: "terminei o da rotina" });
    });

    it("fila cheia: a etapa falha com a mensagem da fila, sem exceção", async () => {
      const orquestrador = await criar();
      await servico.enviarMensagem(orquestrador.id, "ocupa o orquestrador");
      for (let numero = 1; numero <= LIMITE_DA_FILA; numero += 1) {
        await servico.enfileirarPedido(orquestrador.id, `pedido ${numero}`);
      }

      const resultado = await executarPedido(orquestrador.id);

      expect(resultado).toEqual({
        situacao: "falhou",
        motivo: `A fila de "Painel" está cheia (máximo ${LIMITE_DA_FILA} pedidos).`,
      });
      expect(orquestrador.fila).toHaveLength(LIMITE_DA_FILA);
    });

    it("se o pedido da frente falha, a fila para: o pedido da rotina sai dela e a etapa falha", async () => {
      const orquestrador = await criar();
      await servico.enviarMensagem(orquestrador.id, "o pedido do usuário");
      const resultado = executarPedido(orquestrador.id, "o pedido da rotina");
      await aguardar();

      motor.terminar({ sucesso: false, motivo: "quebrou", uso: null });
      await aguardar();
      relogio.disparar();

      const final = await resultado;
      expect(final.situacao).toBe("falhou");
      expect(final.situacao === "falhou" ? final.motivo : "").toContain('A fila de "Painel" parou');
      expect(orquestrador.fila).toHaveLength(0);
      expect(motor.pedidos).toHaveLength(1);
    });

    it("se o turno que o segurava acabou antes de o pedido entrar na fila, o pedido é enviado depois da espera", async () => {
      const orquestrador = await criar();
      const doTeste = servico;
      const anterior = await doTeste.enviarMensagem(orquestrador.id, "o pedido do usuário");
      // O turno termina entre a conferência (ocupado) e a entrada na fila: ninguém mais tira o pedido de lá.
      const comCorrida = new ExecutorDePedidosDaOrquestracao({
        servico: {
          enviarMensagem: doTeste.enviarMensagem.bind(doTeste),
          enviarDaFila: doTeste.enviarDaFila.bind(doTeste),
          removerDaFila: doTeste.removerDaFila.bind(doTeste),
          aprovarPlano: doTeste.aprovarPlano.bind(doTeste),
          descartarPlano: doTeste.descartarPlano.bind(doTeste),
          cancelar: doTeste.cancelar.bind(doTeste),
          enfileirarPedido: async (...argumentos) => {
            motor.terminar(sucesso("terminei o do usuário"));
            await anterior.conclusao;
            await aguardar();
            return doTeste.enfileirarPedido(...argumentos);
          },
        },
        repositorio,
        canal,
        temporizador: relogio,
      });
      const resultado = comCorrida.executar({ orquestradorId: orquestrador.id, texto: "o pedido da rotina", modo: "execucao" }, sinal.signal);
      await vi.waitFor(() => expect(orquestrador.fila).toHaveLength(1));
      expect(motor.pedidos).toHaveLength(1);

      relogio.disparar();
      await vi.waitFor(() => expect(motor.pedidos).toHaveLength(2));
      expect(orquestrador.fila).toHaveLength(0);
      expect(motor.pedidos.map((pedido) => pedido.texto)).toEqual(["o pedido do usuário", "o pedido da rotina"]);
      motor.terminar(sucesso("terminei o da rotina"));

      expect(await resultado).toEqual({ situacao: "concluido", resposta: "terminei o da rotina" });
    });

    it("abortar com o pedido na fila tira o pedido da fila e devolve cancelado", async () => {
      const orquestrador = await criar();
      await servico.enviarMensagem(orquestrador.id, "o pedido do usuário");
      const resultado = executarPedido(orquestrador.id, "o pedido da rotina");
      await aguardar();
      expect(orquestrador.fila).toHaveLength(1);

      sinal.abort();

      expect(await resultado).toEqual({ situacao: "cancelado", motivo: "A rotina foi cancelada." });
      expect(orquestrador.fila).toHaveLength(0);
      // O turno do usuário não é tocado.
      expect(orquestrador.situacao).toBe("trabalhando");
      motor.terminar(sucesso("fim"));
    });

    it("o usuário que remove o pedido da fila cancela a etapa", async () => {
      const orquestrador = await criar();
      await servico.enviarMensagem(orquestrador.id, "o pedido do usuário");
      const resultado = executarPedido(orquestrador.id, "o pedido da rotina");
      await aguardar();

      await servico.removerDaFila(orquestrador.id, orquestrador.fila[0]?.id ?? "");

      expect(await resultado).toMatchObject({ situacao: "cancelado" });
      motor.terminar(sucesso("fim"));
    });
  });

  describe("quando o app continua o pedido sozinho", () => {
    it("a reserva de motor: segue o pedido pelo turno do motor de reserva", async () => {
      const orquestrador = await criar({ ordemDeReserva: ["codex"] });
      const resultado = executarPedido(orquestrador.id, "o pedido");
      await aguardar();

      motor.terminar({ sucesso: false, motivo: "Limite de uso atingido.", causa: "limite_de_uso", uso: null });
      await aguardar();
      expect(motor.pedidos.map((pedido) => pedido.motor)).toEqual(["claude-code", "codex"]);
      // A espera pela decisão do app foi cancelada pela troca: nada a vencer.
      relogio.disparar();
      motor.terminar(sucesso("o Codex terminou"));

      expect(await resultado).toEqual({ situacao: "concluido", resposta: "o Codex terminou" });
    });

    it("a falha do motor de reserva, sem nada mais a tentar, encerra a etapa", async () => {
      const orquestrador = await criar({ ordemDeReserva: ["codex"] });
      const resultado = executarPedido(orquestrador.id, "o pedido");
      await aguardar();

      motor.terminar({ sucesso: false, motivo: "Limite de uso atingido.", causa: "limite_de_uso", uso: null });
      await aguardar();
      motor.terminar({ sucesso: false, motivo: "O Codex quebrou.", uso: null });
      await aguardar();
      relogio.disparar();

      expect(await resultado).toEqual({ situacao: "falhou", motivo: "O Codex quebrou." });
      expect(motor.pedidos.map((pedido) => pedido.motor)).toEqual(["claude-code", "codex"]);
    });

    it("a retomada automática: espera o app retomar a sessão e devolve o resultado do turno da retomada", async () => {
      const orquestrador = await criar();
      const resultado = executarPedido(orquestrador.id, "o pedido");
      await aguardar();

      motor.terminar({ sucesso: false, motivo: "Conexão perdida.", causa: "rede", uso: null });
      await aguardar();
      // A retomada está marcada: o executor não dá a etapa por falha.
      expect(orquestrador.retomadaPendente).not.toBeNull();
      relogio.disparar();
      await aguardar();
      expect(motor.pedidos).toHaveLength(2);
      motor.terminar(sucesso("retomei e terminei"));

      expect(await resultado).toEqual({ situacao: "concluido", resposta: "retomei e terminei" });
    });

    it("cancelar a rotina durante a espera da retomada cancela a retomada", async () => {
      const orquestrador = await criar();
      const resultado = executarPedido(orquestrador.id, "o pedido");
      await aguardar();
      motor.terminar({ sucesso: false, motivo: "Conexão perdida.", causa: "rede", uso: null });
      await aguardar();
      expect(orquestrador.retomadaPendente).not.toBeNull();

      sinal.abort();

      expect(await resultado).toEqual({ situacao: "cancelado", motivo: "A rotina foi cancelada." });
      await aguardar();
      expect(orquestrador.retomadaPendente).toBeNull();
      expect(motor.pedidos).toHaveLength(1);
    });
  });
});
