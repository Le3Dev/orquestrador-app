import { afterEach, describe, expect, it, vi } from "vitest";

import {
  APROVACAO_DE_TESTE,
  ContextoDoServico,
  PEDIDO_DE_TESTE,
  esvaziarFilas,
  exigir,
  montarContextoDoServico,
  rotinaDeTeste,
} from "../../rotinas/duplasDeTeste";
import { ServicoDeRotinas } from "../../rotinas/ServicoDeRotinas";
import { Agendador, INTERVALO_DE_VERIFICACAO_EM_MS } from "./Agendador";

const SEGUNDO = 1_000;
const MINUTO = 60_000;
const HORA = 60 * MINUTO;

/** Um serviço que conta as verificações e deixa o teste decidir quando elas terminam ou falham. */
class ServicoQueConta extends ServicoDeRotinas {
  verificacoes = 0;
  falhasPendentes = 0;
  private liberacoes: Array<() => void> = [];
  segurar = false;

  constructor(contexto: ContextoDoServico) {
    super({
      repositorioDeRotinas: contexto.repositorio,
      repositorioDeExecucoes: contexto.repositorio,
      executor: contexto.executor,
      publicador: contexto.publicador,
      controle: contexto.controle,
      temporizador: contexto.relogio,
      gerarId: () => "id-fixo",
      agora: contexto.relogio.agora,
    });
  }

  override async dispararVencidas(): Promise<void> {
    this.verificacoes++;
    if (this.falhasPendentes > 0) {
      this.falhasPendentes--;
      throw new Error("Falha de teste na verificação.");
    }
    if (this.segurar) {
      await new Promise<void>((resolver) => this.liberacoes.push(resolver));
    }
  }

  liberar(): void {
    this.liberacoes.splice(0).forEach((liberar) => liberar());
  }
}

function agendadorDe(contexto: ContextoDoServico, servico: ServicoDeRotinas = contexto.servico): Agendador {
  return new Agendador({ servico, temporizador: contexto.relogio });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Agendador: o ritmo", () => {
  it("verifica a cada 30 segundos, e a primeira só depois de 30 segundos", async () => {
    const contexto = montarContextoDoServico();
    const servico = new ServicoQueConta(contexto);
    const agendador = agendadorDe(contexto, servico);

    await agendador.iniciar();
    expect(INTERVALO_DE_VERIFICACAO_EM_MS).toBe(30 * SEGUNDO);
    expect(servico.verificacoes).toBe(0);

    await contexto.relogio.avancar(29 * SEGUNDO);
    expect(servico.verificacoes).toBe(0);
    await contexto.relogio.avancar(SEGUNDO);
    expect(servico.verificacoes).toBe(1);
    await contexto.relogio.avancar(MINUTO);
    expect(servico.verificacoes).toBe(3);

    await agendador.encerrar();
  });

  it("aceita outro intervalo", async () => {
    const contexto = montarContextoDoServico();
    const servico = new ServicoQueConta(contexto);
    const agendador = new Agendador({ servico, temporizador: contexto.relogio, intervaloEmMs: 5 * SEGUNDO });

    await agendador.iniciar();
    await contexto.relogio.avancar(20 * SEGUNDO);

    expect(servico.verificacoes).toBe(4);
    await agendador.encerrar();
  });

  it("iniciar duas vezes não cria dois laços", async () => {
    const contexto = montarContextoDoServico();
    const servico = new ServicoQueConta(contexto);
    const agendador = agendadorDe(contexto, servico);

    await agendador.iniciar();
    await agendador.iniciar();

    expect(contexto.relogio.avisosPendentes).toBe(1);
    await contexto.relogio.avancar(30 * SEGUNDO);
    expect(servico.verificacoes).toBe(1);
    await agendador.encerrar();
  });

  it("as verificações não se sobrepõem: a próxima só é marcada depois de a anterior terminar", async () => {
    const contexto = montarContextoDoServico();
    const servico = new ServicoQueConta(contexto);
    servico.segurar = true;
    const agendador = agendadorDe(contexto, servico);
    await agendador.iniciar();

    await contexto.relogio.avancar(10 * MINUTO);
    expect(servico.verificacoes).toBe(1);
    expect(contexto.relogio.avisosPendentes).toBe(0);

    servico.segurar = false;
    servico.liberar();
    await esvaziarFilas();
    expect(contexto.relogio.avisosPendentes).toBe(1);
    await contexto.relogio.avancar(30 * SEGUNDO);
    expect(servico.verificacoes).toBe(2);
    await agendador.encerrar();
  });

  it("a falha de uma verificação é registrada e não derruba o laço", async () => {
    const erroNoLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const contexto = montarContextoDoServico();
    const servico = new ServicoQueConta(contexto);
    servico.falhasPendentes = 1;
    const agendador = agendadorDe(contexto, servico);
    await agendador.iniciar();

    await contexto.relogio.avancar(MINUTO + 30 * SEGUNDO);

    expect(servico.verificacoes).toBe(3);
    expect(erroNoLog).toHaveBeenCalledTimes(1);
    await agendador.encerrar();
  });
});

describe("Agendador: disparar na hora", () => {
  it("dispara a rotina na hora marcada, como execução agendada, uma vez só", async () => {
    const contexto = montarContextoDoServico();
    contexto.executor.prepararRespostas({ situacao: "concluido", resposta: "ok" });
    const rotina = await contexto.servico.criar(rotinaDeTeste());
    const agendador = agendadorDe(contexto);
    await agendador.iniciar();

    await contexto.relogio.avancar(59 * MINUTO);
    expect(contexto.servico.listarExecucoes(rotina.id)).toEqual([]);
    await contexto.relogio.avancar(2 * MINUTO);
    await contexto.controle.aguardarTodas();

    const execucoes = contexto.servico.listarExecucoes(rotina.id);
    expect(execucoes).toHaveLength(1);
    expect(execucoes[0]).toMatchObject({ origem: "agendada", situacao: "concluida" });
    expect(contexto.executor.pedidos).toHaveLength(1);
    expect(contexto.servico.buscar(rotina.id).proximaExecucaoEm).toEqual(new Date(2026, 10, 18, 9, 0));
    await agendador.encerrar();
  });

  it("uma execução por vez por rotina: enquanto a anterior roda, as horas seguintes viram execuções puladas", async () => {
    const contexto = montarContextoDoServico();
    const rotina = await contexto.servico.criar(rotinaDeTeste({ gatilho: { tipo: "intervalo", minutos: 15 } }));
    const agendador = agendadorDe(contexto);
    await agendador.iniciar();

    await contexto.relogio.avancar(45 * MINUTO);

    const execucoes = contexto.servico.listarExecucoes(rotina.id);
    expect(execucoes.map((execucao) => execucao.situacao)).toEqual(["pulada", "pulada", "em_andamento"]);
    expect(contexto.executor.pedidos).toHaveLength(1);
    await agendador.encerrar();
  });

  it("o computador dormiu além da tolerância: a hora vale como perdida e segue o aoPerder", async () => {
    const contexto = montarContextoDoServico();
    contexto.executor.prepararRespostas({ situacao: "concluido", resposta: "ok" });
    const quePula = await contexto.servico.criar(rotinaDeTeste({ nome: "Pula", aoPerder: "pular" }));
    const queExecuta = await contexto.servico.criar(rotinaDeTeste({ nome: "Executa", aoPerder: "executar_ao_abrir" }));
    const agendador = agendadorDe(contexto);
    await agendador.iniciar();

    contexto.relogio.saltar(3 * HORA); // 11h: as 9h passaram sem nenhuma verificação
    await contexto.relogio.avancar(30 * SEGUNDO);
    await contexto.controle.aguardarTodas();

    expect(contexto.servico.listarExecucoes(quePula.id)[0]).toMatchObject({ situacao: "pulada", origem: "perdida" });
    expect(contexto.servico.listarExecucoes(queExecuta.id)[0]).toMatchObject({ situacao: "concluida", origem: "perdida" });
    await agendador.encerrar();
  });
});

describe("Agendador: ao iniciar", () => {
  it("o que estava em andamento vira interrompida; o que esperava aprovação continua aprovável", async () => {
    const antes = montarContextoDoServico();
    const rodando = await antes.servico.criar(rotinaDeTeste({ nome: "Roda" }));
    await antes.servico.executarAgora(rodando.id);
    await esvaziarFilas();
    antes.executor.prepararRespostas({ situacao: "concluido", resposta: "ok" });
    const esperando = await antes.servico.criar(rotinaDeTeste({ nome: "Espera", etapas: [PEDIDO_DE_TESTE, APROVACAO_DE_TESTE] }));
    await antes.servico.executarAgora(esperando.id);
    await esvaziarFilas();
    // O app cai e abre de novo sobre os mesmos dados.
    const depois = montarContextoDoServico({ repositorio: antes.repositorio, relogio: antes.relogio, executor: antes.executor });
    const agendador = agendadorDe(depois);

    await agendador.iniciar();

    expect(exigir(depois.servico.listarExecucoes(rodando.id)[0]).situacao).toBe("interrompida");
    const aguardando = exigir(depois.servico.execucaoAtivaDaRotina(esperando.id));
    expect(aguardando.situacao).toBe("aguardando_aprovacao");
    await depois.servico.aprovar(aguardando.id);
    await depois.controle.aguardarTodas();
    expect(exigir(depois.servico.listarExecucoes(esperando.id)[0]).situacao).toBe("concluida");
    await agendador.encerrar();
  });

  it("as horas perdidas seguem o aoPerder: no máximo UMA execução de recuperação por rotina", async () => {
    const antes = montarContextoDoServico();
    const quePula = await antes.servico.criar(
      rotinaDeTeste({ nome: "Pula", aoPerder: "pular", gatilho: { tipo: "intervalo", minutos: 15 } }),
    );
    const queExecuta = await antes.servico.criar(
      rotinaDeTeste({ nome: "Executa", aoPerder: "executar_ao_abrir", gatilho: { tipo: "intervalo", minutos: 15 } }),
    );
    await antes.relogio.avancar(6 * HORA); // 24 ocorrências de 15 minutos passaram
    const depois = montarContextoDoServico({ repositorio: antes.repositorio, relogio: antes.relogio, executor: antes.executor });
    depois.executor.prepararRespostas({ situacao: "concluido", resposta: "ok" });
    const agendador = agendadorDe(depois);

    await agendador.iniciar();
    await depois.controle.aguardarTodas();

    const puladas = depois.servico.listarExecucoes(quePula.id);
    const executadas = depois.servico.listarExecucoes(queExecuta.id);
    expect(puladas).toHaveLength(1);
    expect(puladas[0]).toMatchObject({ situacao: "pulada", origem: "perdida" });
    expect(executadas).toHaveLength(1);
    expect(executadas[0]).toMatchObject({ situacao: "concluida", origem: "perdida" });
    expect(depois.executor.pedidos).toHaveLength(1);
    await agendador.encerrar();
  });

  it("uma falha ao recuperar não impede o agendador de funcionar", async () => {
    const erroNoLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const contexto = montarContextoDoServico();
    const servico = new ServicoQueConta(contexto);
    vi.spyOn(servico, "recuperarAoIniciar").mockRejectedValue(new Error("Disco cheio."));
    const agendador = agendadorDe(contexto, servico);

    await agendador.iniciar();
    await contexto.relogio.avancar(30 * SEGUNDO);

    expect(erroNoLog).toHaveBeenCalled();
    expect(servico.verificacoes).toBe(1);
    await agendador.encerrar();
  });
});

describe("Agendador: encerrar", () => {
  it("para o laço e aborta as execuções em andamento (ficam interrompidas)", async () => {
    const contexto = montarContextoDoServico();
    const rotina = await contexto.servico.criar(rotinaDeTeste());
    const agendador = agendadorDe(contexto);
    await agendador.iniciar();
    await contexto.servico.executarAgora(rotina.id);
    await esvaziarFilas();
    expect(contexto.executor.quantosPendentes).toBe(1);

    await agendador.encerrar();

    expect(exigir(contexto.executor.sinais[0]).aborted).toBe(true);
    expect(exigir(contexto.servico.listarExecucoes(rotina.id)[0]).situacao).toBe("interrompida");
    expect(contexto.relogio.avisosPendentes).toBe(0);
    await contexto.relogio.avancar(24 * HORA);
    expect(contexto.servico.listarExecucoes(rotina.id)).toHaveLength(1);
  });

  it("espera a verificação em curso terminar e não marca outra", async () => {
    const contexto = montarContextoDoServico();
    const servico = new ServicoQueConta(contexto);
    servico.segurar = true;
    const agendador = agendadorDe(contexto, servico);
    await agendador.iniciar();
    await contexto.relogio.avancar(30 * SEGUNDO);
    expect(servico.verificacoes).toBe(1);

    let terminou = false;
    const encerrando = agendador.encerrar().then(() => {
      terminou = true;
    });
    await esvaziarFilas();
    expect(terminou).toBe(false);

    servico.liberar();
    await encerrando;

    expect(terminou).toBe(true);
    expect(contexto.relogio.avisosPendentes).toBe(0);
    await contexto.relogio.avancar(10 * MINUTO);
    expect(servico.verificacoes).toBe(1);
  });

  it("encerrar sem ter iniciado não faz mal", async () => {
    const contexto = montarContextoDoServico();

    await expect(agendadorDe(contexto).encerrar()).resolves.toBeUndefined();
  });
});
