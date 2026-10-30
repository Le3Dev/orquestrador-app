import path from "node:path";

import { describe, expect, it } from "vitest";

import { ConfiguracaoDoOrquestrador } from "./ConfiguracaoDoOrquestrador";
import { ErroDeOrquestracao } from "./ErroDeOrquestracao";
import { Orquestrador } from "./Orquestrador";
import { PastaDeTrabalho } from "./PastaDeTrabalho";

const raiz = path.resolve("/projetos");
const agora = new Date("2026-10-28T12:00:00Z");
const uso = { duracaoMs: 1000, tokensDeEntrada: 10, tokensDeSaida: 5, subagentesLancados: 2 };

function novoOrquestrador(): Orquestrador {
  return Orquestrador.criar({
    id: "o1",
    nome: "  Painel  ",
    pastaDeTrabalho: PastaDeTrabalho.dentroDe(raiz, "painel"),
    sessaoId: "s1",
    configuracao: ConfiguracaoDoOrquestrador.de({
      modeloDoOrquestrador: "opus",
      modeloDosSubagentes: "sonnet",
      quantidadeDeSubagentes: { modo: "automatica", limite: 3 },
      nivelDePermissao: "leitura",
    }),
    agora,
  });
}

function capturarErro(acao: () => unknown): ErroDeOrquestracao {
  try {
    acao();
  } catch (erro) {
    if (erro instanceof ErroDeOrquestracao) {
      return erro;
    }
  }
  throw new Error("Era esperado um ErroDeOrquestracao.");
}

describe("Orquestrador", () => {
  it("nasce ocioso, com o nome aparado e sem sessão iniciada", () => {
    const orquestrador = novoOrquestrador();

    expect(orquestrador.nome).toBe("Painel");
    expect(orquestrador.situacao).toBe("ocioso");
    expect(orquestrador.sessaoIniciada).toBe(false);
  });

  it("recusa nome vazio", () => {
    const erro = capturarErro(() =>
      Orquestrador.criar({
        id: "o1",
        nome: "   ",
        pastaDeTrabalho: PastaDeTrabalho.dentroDe(raiz, "painel"),
        sessaoId: "s1",
        configuracao: novoOrquestrador().configuracao,
        agora,
      }),
    );
    expect(erro.motivo).toBe("dados_invalidos");
  });

  it("recusa um segundo turno enquanto o primeiro está em andamento", () => {
    const orquestrador = novoOrquestrador();
    orquestrador.iniciarTurno("t1", "analise o projeto", agora);

    const erro = capturarErro(() => orquestrador.iniciarTurno("t2", "outra coisa", agora));

    expect(erro.motivo).toBe("turno_em_andamento");
    expect(orquestrador.situacao).toBe("trabalhando");
  });

  it("aceita um novo turno depois que o anterior termina", () => {
    const orquestrador = novoOrquestrador();
    orquestrador.iniciarTurno("t1", "analise o projeto", agora);
    orquestrador.concluirTurno("t1", "pronto", uso, agora);

    const evento = orquestrador.iniciarTurno("t2", "e agora?", agora);

    expect(evento).toMatchObject({ tipo: "turno_iniciado", turnoId: "t2", texto: "e agora?" });
    expect(orquestrador.totalDeTurnos).toBe(2);
  });

  it("marca a sessão como iniciada quando o motor avisa", () => {
    const orquestrador = novoOrquestrador();
    orquestrador.iniciarTurno("t1", "oi", agora);

    orquestrador.registrarDoMotor("t1", { tipo: "sessao_iniciada" });

    expect(orquestrador.sessaoIniciada).toBe(true);
  });

  it("ao cancelar, encerra o turno e os subagentes que ainda rodavam", () => {
    const orquestrador = novoOrquestrador();
    orquestrador.iniciarTurno("t1", "analise", agora);
    orquestrador.registrarDoMotor("t1", { tipo: "subagente_iniciado", subagenteId: "a", descricao: "A", tarefa: "" });
    orquestrador.registrarDoMotor("t1", { tipo: "subagente_iniciado", subagenteId: "b", descricao: "B", tarefa: "" });
    orquestrador.registrarDoMotor("t1", {
      tipo: "subagente_concluido",
      subagenteId: "a",
      situacao: "concluido",
      resumo: "feito",
      tokens: 100,
      duracaoMs: 2000,
    });

    const evento = orquestrador.cancelarTurno("t1", agora);

    const turno = orquestrador.paraDados().turnos[0];
    expect(evento).toEqual({ tipo: "turno_cancelado", turnoId: "t1" });
    expect(turno?.situacao).toBe("cancelado");
    expect(turno?.subagentes.map((subagente) => subagente.situacao)).toEqual(["concluido", "cancelado"]);
    expect(orquestrador.situacao).toBe("ocioso");
  });

  it("não aceita eventos de um turno que já terminou", () => {
    const orquestrador = novoOrquestrador();
    orquestrador.iniciarTurno("t1", "analise", agora);
    orquestrador.falharTurno("t1", "sem cota", agora);

    const erro = capturarErro(() => orquestrador.registrarDoMotor("t1", { tipo: "texto_do_orquestrador", texto: "x" }));

    expect(erro.motivo).toBe("sem_turno_em_andamento");
  });

  it("alterar a configuração vale para o próximo turno e mantém o que não mudou", () => {
    const orquestrador = novoOrquestrador();

    orquestrador.alterarConfiguracao({ quantidadeDeSubagentes: { modo: "fixa", limite: 2 } });
    const evento = orquestrador.iniciarTurno("t1", "analise", agora);

    expect(evento).toMatchObject({
      configuracao: {
        modeloDoOrquestrador: "opus",
        quantidadeDeSubagentes: { modo: "fixa", limite: 2 },
      },
    });
  });

  it("interrompe o turno pendente ao reabrir o histórico", () => {
    const orquestrador = novoOrquestrador();
    orquestrador.iniciarTurno("t1", "analise", agora);

    const reaberto = Orquestrador.reconstituir(orquestrador.paraDados());
    const evento = reaberto.interromperTurnoEmAndamento(agora);

    expect(evento).toEqual({ tipo: "turno_interrompido", turnoId: "t1" });
    expect(reaberto.situacao).toBe("ocioso");
    expect(reaberto.interromperTurnoEmAndamento(agora)).toBeNull();
  });
});

describe("Orquestrador no modo de planejamento", () => {
  function comPlanoPendente(): Orquestrador {
    const orquestrador = novoOrquestrador();
    orquestrador.iniciarTurno("t1", "planeje a migração", agora, [], "planejamento");
    orquestrador.concluirTurno("t1", "1. ... 2. ...", uso, agora);
    return orquestrador;
  }

  it("um turno começa em execução por padrão e o evento leva o modo", () => {
    const orquestrador = novoOrquestrador();

    expect(orquestrador.iniciarTurno("t1", "analise", agora)).toMatchObject({ tipo: "turno_iniciado", modo: "execucao" });
    expect(orquestrador.paraDados().turnos[0]).toMatchObject({ modo: "execucao", decisaoDoPlano: null });
  });

  it("recusa aprovar ou descartar sem plano pendente", () => {
    const orquestrador = novoOrquestrador();
    orquestrador.iniciarTurno("t1", "analise", agora);
    orquestrador.concluirTurno("t1", "pronto", uso, agora);

    const erro = capturarErro(() => orquestrador.aprovarPlano());

    expect(erro.motivo).toBe("sem_plano_pendente");
    expect(erro.message).toBe('"Painel" não tem plano aguardando aprovação.');
    expect(capturarErro(() => orquestrador.descartarPlano()).motivo).toBe("sem_plano_pendente");
  });

  it("o plano só fica pendente quando o turno de planejamento conclui", () => {
    const orquestrador = novoOrquestrador();
    const inicio = orquestrador.iniciarTurno("t1", "planeje", agora, [], "planejamento");

    expect(inicio).toMatchObject({ tipo: "turno_iniciado", turnoId: "t1", modo: "planejamento" });
    expect(orquestrador.turnoComPlanoPendente).toBeNull();

    orquestrador.concluirTurno("t1", "o plano", uso, agora);

    expect(orquestrador.turnoComPlanoPendente?.id).toBe("t1");
    expect(orquestrador.paraDados().turnos[0]).toMatchObject({ modo: "planejamento", decisaoDoPlano: "pendente" });
  });

  it("um planejamento que falha não deixa plano pendente", () => {
    const orquestrador = novoOrquestrador();
    orquestrador.iniciarTurno("t1", "planeje", agora, [], "planejamento");
    orquestrador.falharTurno("t1", "sem cota", agora);

    expect(orquestrador.turnoComPlanoPendente).toBeNull();
  });

  it("aprova o plano uma única vez", () => {
    const orquestrador = comPlanoPendente();

    expect(orquestrador.aprovarPlano()).toEqual({ tipo: "plano_aprovado", turnoId: "t1" });
    expect(orquestrador.paraDados().turnos[0]?.decisaoDoPlano).toBe("aprovado");
    expect(orquestrador.turnoComPlanoPendente).toBeNull();
    expect(capturarErro(() => orquestrador.aprovarPlano()).motivo).toBe("sem_plano_pendente");
    expect(capturarErro(() => orquestrador.descartarPlano()).motivo).toBe("sem_plano_pendente");
  });

  it("descarta o plano", () => {
    const orquestrador = comPlanoPendente();

    expect(orquestrador.descartarPlano()).toEqual({ tipo: "plano_descartado", turnoId: "t1" });
    expect(orquestrador.paraDados().turnos[0]?.decisaoDoPlano).toBe("descartado");
    expect(capturarErro(() => orquestrador.aprovarPlano()).motivo).toBe("sem_plano_pendente");
  });

  it("um pedido novo deixa o plano anterior para trás", () => {
    const orquestrador = comPlanoPendente();

    orquestrador.iniciarTurno("t2", "planeje de outro jeito", agora, [], "planejamento");

    expect(orquestrador.turnoComPlanoPendente).toBeNull();
    expect(capturarErro(() => orquestrador.aprovarPlano()).motivo).toBe("sem_plano_pendente");

    orquestrador.concluirTurno("t2", "plano novo", uso, agora);

    expect(orquestrador.aprovarPlano()).toEqual({ tipo: "plano_aprovado", turnoId: "t2" });
  });

  it("mantém o plano pendente ao reabrir o histórico", () => {
    const reaberto = Orquestrador.reconstituir(comPlanoPendente().paraDados());

    expect(reaberto.turnoComPlanoPendente?.id).toBe("t1");
  });

  it("reabre turnos gravados antes do modo de planejamento como execução", () => {
    const dados = novoOrquestrador().paraDados();
    const turnoAntigo = {
      id: "t0",
      texto: "antigo",
      iniciadoEm: "2026-10-28T10:00:00.000Z",
      encerradoEm: "2026-10-28T10:01:00.000Z",
      situacao: "concluido" as const,
      resposta: "ok",
      motivoDaFalha: null,
      uso: null,
      subagentes: [],
      anexos: [],
    };

    const reaberto = Orquestrador.reconstituir({ ...dados, turnos: [turnoAntigo] });

    expect(reaberto.paraDados().turnos[0]).toMatchObject({ modo: "execucao", decisaoDoPlano: null });
    expect(reaberto.ultimoTurno?.modo).toBe("execucao");
    expect(reaberto.turnoComPlanoPendente).toBeNull();
  });
});

describe("Orquestrador e a opção de commit e push", () => {
  it("reabre a configuração gravada antes da opção de commit e push como desligada", () => {
    const dados = novoOrquestrador().paraDados();
    const { permitirCommitEPush: _semOCampo, ...configuracaoAntiga } = dados.configuracao;

    const reaberto = Orquestrador.reconstituir({ ...dados, configuracao: configuracaoAntiga });

    expect(reaberto.configuracao.permitirCommitEPush).toBe(false);
    expect(reaberto.paraDados().configuracao.permitirCommitEPush).toBe(false);
  });

  it("o turno iniciado leva a cópia da configuração com a opção de commit e push", () => {
    const orquestrador = novoOrquestrador();
    orquestrador.alterarConfiguracao({ permitirCommitEPush: true });

    const evento = orquestrador.iniciarTurno("t1", "commite", agora);

    expect(evento).toMatchObject({ tipo: "turno_iniciado", configuracao: { permitirCommitEPush: true } });
  });

  it("a alteração de configuração publica a opção de commit e push", () => {
    expect(novoOrquestrador().alterarConfiguracao({ nivelDePermissao: "edicao" })).toMatchObject({
      tipo: "configuracao_alterada",
      configuracao: { nivelDePermissao: "edicao", permitirCommitEPush: false },
    });
  });
});

describe("Orquestrador e o esforço de raciocínio", () => {
  it("reabre a configuração gravada antes do esforço existir com o esforço padrão", () => {
    const dados = novoOrquestrador().paraDados();
    const {
      esforcoDoOrquestrador: _semOrquestrador,
      esforcoDosSubagentes: _semSubagentes,
      ...configuracaoAntiga
    } = dados.configuracao;

    const reaberto = Orquestrador.reconstituir({ ...dados, configuracao: configuracaoAntiga });

    expect(reaberto.paraDados().configuracao).toMatchObject({
      esforcoDoOrquestrador: "padrao",
      esforcoDosSubagentes: "padrao",
    });
  });

  it("o turno iniciado e a alteração de configuração levam os dois esforços", () => {
    const orquestrador = novoOrquestrador();

    expect(orquestrador.alterarConfiguracao({ esforcoDoOrquestrador: "extra_alto" })).toMatchObject({
      tipo: "configuracao_alterada",
      configuracao: { esforcoDoOrquestrador: "extra_alto", esforcoDosSubagentes: "padrao" },
    });
    expect(orquestrador.iniciarTurno("t1", "analise", agora)).toMatchObject({
      tipo: "turno_iniciado",
      configuracao: { esforcoDoOrquestrador: "extra_alto", esforcoDosSubagentes: "padrao" },
    });
  });
});
