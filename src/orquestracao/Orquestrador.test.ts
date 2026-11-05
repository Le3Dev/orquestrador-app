import path from "node:path";

import { describe, expect, it } from "vitest";

import { ConfiguracaoDoOrquestrador } from "./ConfiguracaoDoOrquestrador";
import { ConsumoDoTurno } from "./ConsumoDoTurno";
import { ErroDeOrquestracao } from "./ErroDeOrquestracao";
import { ErroDeFilaCheia, LIMITE_DA_FILA, Orquestrador } from "./Orquestrador";
import { PastaDeTrabalho } from "./PastaDeTrabalho";
import { PedidoNaFila } from "./PedidoNaFila";
import { PredefinicaoDeConfiguracao, predefinicaoPorNome } from "./PredefinicaoDeConfiguracao";
import { UsoDeTokens } from "./UsoDeTokens";

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

  it("o turno de planejamento concluído publica o plano pendente no evento", () => {
    const orquestrador = novoOrquestrador();
    orquestrador.iniciarTurno("t1", "planeje", agora, [], "planejamento");

    expect(orquestrador.concluirTurno("t1", "o plano", uso, agora)).toEqual({
      tipo: "turno_concluido",
      turnoId: "t1",
      resposta: "o plano",
      uso,
      planoPendente: true,
    });
  });

  it("um turno de execução que propôs plano deixa o plano pendente", () => {
    const orquestrador = novoOrquestrador();
    orquestrador.iniciarTurno("t1", "refatore tudo", agora);

    const evento = orquestrador.concluirTurno("t1", "proponho: 1. ... 2. ...", uso, agora, true);

    expect(evento).toMatchObject({ tipo: "turno_concluido", turnoId: "t1", planoPendente: true });
    expect(orquestrador.turnoComPlanoPendente?.id).toBe("t1");
    expect(orquestrador.paraDados().turnos[0]).toMatchObject({ modo: "execucao", decisaoDoPlano: "pendente" });
    expect(orquestrador.aprovarPlano()).toEqual({ tipo: "plano_aprovado", turnoId: "t1" });
  });

  it("um turno de execução sem plano proposto conclui sem pendência", () => {
    const orquestrador = novoOrquestrador();
    orquestrador.iniciarTurno("t1", "analise", agora);

    expect(orquestrador.concluirTurno("t1", "pronto", uso, agora)).toMatchObject({ planoPendente: false });
    expect(orquestrador.turnoComPlanoPendente).toBeNull();
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

describe("Orquestrador ao limpar a conversa", () => {
  function comConversa(): Orquestrador {
    const orquestrador = novoOrquestrador();
    orquestrador.iniciarTurno("t1", "analise", agora);
    orquestrador.registrarDoMotor("t1", { tipo: "sessao_iniciada" });
    orquestrador.concluirTurno("t1", "pronto", uso, agora);
    return orquestrador;
  }

  it("troca a sessão, zera os turnos e volta a pedir uma sessão nova", () => {
    const orquestrador = comConversa();
    orquestrador.iniciarTurno("t2", "planeje", agora, [], "planejamento");
    orquestrador.concluirTurno("t2", "o plano", uso, agora);

    const evento = orquestrador.limparConversa("s2");

    expect(evento).toEqual({
      tipo: "conversa_limpa",
      turnosAnteriores: 2,
      planoDescartado: true,
      worktreeComAlteracoes: false,
    });
    expect(orquestrador.sessaoId).toBe("s2");
    expect(orquestrador.sessaoIniciada).toBe(false);
    expect(orquestrador.totalDeTurnos).toBe(0);
    expect(orquestrador.ultimoTurno).toBeNull();
    expect(orquestrador.turnoComPlanoPendente).toBeNull();
    expect(capturarErro(() => orquestrador.aprovarPlano()).motivo).toBe("sem_plano_pendente");
  });

  it("mantém nome, configuração e worktree, e avisa do worktree com alterações", () => {
    const orquestrador = comConversa();
    orquestrador.alterarConfiguracao({ nivelDePermissao: "edicao" });
    orquestrador.usarWorktree("orquestrador/o1", "/worktrees/o1");
    orquestrador.liberarWorktree();

    const evento = orquestrador.limparConversa("s2");

    expect(evento).toMatchObject({ planoDescartado: false, worktreeComAlteracoes: true, turnosAnteriores: 1 });
    expect(orquestrador.nome).toBe("Painel");
    expect(orquestrador.configuracao.nivelDePermissao).toBe("edicao");
    expect(orquestrador.worktree).toEqual({ branch: "orquestrador/o1", caminho: "/worktrees/o1", ativo: false });
  });

  it("recusa limpar com um turno em andamento", () => {
    const orquestrador = comConversa();
    orquestrador.iniciarTurno("t2", "outra", agora);

    const erro = capturarErro(() => orquestrador.limparConversa("s2"));

    expect(erro.motivo).toBe("turno_em_andamento");
    expect(erro.message).toBe('Cancele o pedido em andamento de "Painel" antes de limpar a conversa.');
    expect(orquestrador.sessaoId).toBe("s1");
    expect(orquestrador.totalDeTurnos).toBe(2);
  });

  it("a conversa limpa sobrevive a gravar e reabrir", () => {
    const orquestrador = comConversa();
    orquestrador.limparConversa("s2");

    const dados = orquestrador.paraDados();
    const reaberto = Orquestrador.reconstituir(dados);

    expect(dados).toMatchObject({ sessaoId: "s2", sessaoIniciada: false, turnos: [] });
    expect(reaberto.sessaoId).toBe("s2");
    expect(reaberto.sessaoIniciada).toBe(false);
    expect(reaberto.totalDeTurnos).toBe(0);
    expect(reaberto.paraDados()).toEqual(dados);
  });

  it("aceita um turno novo depois de limpar", () => {
    const orquestrador = comConversa();
    orquestrador.limparConversa("s2");

    orquestrador.iniciarTurno("t3", "do zero", agora);

    expect(orquestrador.totalDeTurnos).toBe(1);
    expect(orquestrador.ultimoTurno?.id).toBe("t3");
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

describe("Orquestrador e a economia de tokens", () => {
  const consumo = ConsumoDoTurno.criar({
    principal: UsoDeTokens.criar({ entrada: 6, criacaoDeCache: 33062, leituraDeCache: 62885, saida: 383 }),
    subagentes: UsoDeTokens.vazio,
    subagentesMedidos: 0,
    parcial: false,
    modeloDoPrincipal: "claude-opus-5-5",
  });

  function economico(): PredefinicaoDeConfiguracao {
    const predefinicao = predefinicaoPorNome("economico");
    if (predefinicao === null) {
      throw new Error("predefinição econômica ausente");
    }
    return predefinicao;
  }

  it("aplicar a predefinição registra configuracao_alterada com o nome dela", () => {
    const orquestrador = novoOrquestrador();
    expect(orquestrador.predefinicaoCorrespondente).toBeNull();

    const evento = orquestrador.aplicarPredefinicao(economico());

    expect(evento).toEqual({
      tipo: "configuracao_alterada",
      configuracao: orquestrador.configuracao.paraDados(),
      predefinicao: "economico",
    });
    expect(orquestrador.configuracao.paraDados()).toMatchObject({
      modeloDosSubagentes: "sonnet",
      esforcoDoOrquestrador: "medio",
      nivelDePermissao: "leitura",
    });
    expect(orquestrador.predefinicaoCorrespondente).toBe("economico");

    orquestrador.alterarConfiguracao({ esforcoDoOrquestrador: "alto" });
    expect(orquestrador.predefinicaoCorrespondente).toBeNull();
  });

  it("registra o consumo de um turno concluído como veio", () => {
    const orquestrador = novoOrquestrador();
    orquestrador.iniciarTurno("t1", "analise", agora);
    orquestrador.concluirTurno("t1", "ok", uso, agora);

    expect(orquestrador.registrarConsumoDoTurno("t1", consumo)).toEqual({
      tipo: "consumo_do_turno_medido",
      turnoId: "t1",
      consumo: consumo.paraDados(),
    });
  });

  it("marca como parcial o consumo de um turno cancelado ou com falha", () => {
    const orquestrador = novoOrquestrador();
    orquestrador.iniciarTurno("t1", "analise", agora);
    orquestrador.cancelarTurno("t1", agora);
    orquestrador.iniciarTurno("t2", "de novo", agora);
    orquestrador.falharTurno("t2", "caiu", agora);

    expect(orquestrador.registrarConsumoDoTurno("t1", consumo)).toMatchObject({ consumo: { parcial: true } });
    expect(orquestrador.registrarConsumoDoTurno("t2", consumo)).toMatchObject({ consumo: { parcial: true } });
  });

  it("recusa registrar consumo de turno em andamento ou desconhecido", () => {
    const orquestrador = novoOrquestrador();
    orquestrador.iniciarTurno("t1", "analise", agora);

    expect(capturarErro(() => orquestrador.registrarConsumoDoTurno("t1", consumo)).motivo).toBe(
      "sem_turno_em_andamento",
    );
    expect(capturarErro(() => orquestrador.registrarConsumoDoTurno("t9", consumo)).motivo).toBe(
      "sem_turno_em_andamento",
    );
  });
});

describe("Orquestrador e a fila de pedidos", () => {
  function pedido(id: string, texto = `pedido ${id}`): PedidoNaFila {
    return PedidoNaFila.criar({ id, texto, modo: "execucao", enfileiradoEm: agora });
  }

  it("enfileira até o limite, com ou sem turno em andamento, e recusa o seguinte", () => {
    const orquestrador = novoOrquestrador();

    expect(orquestrador.enfileirarPedido(pedido("p1"))).toEqual({
      tipo: "pedido_enfileirado",
      pedido: { id: "p1", texto: "pedido p1", modo: "execucao", enfileiradoEm: agora.toISOString() },
    });
    orquestrador.iniciarTurno("t1", "analise", agora);
    for (let numero = 2; numero <= LIMITE_DA_FILA; numero += 1) {
      orquestrador.enfileirarPedido(pedido(`p${numero}`));
    }

    let recusa: unknown = null;
    try {
      orquestrador.enfileirarPedido(pedido("p11"));
    } catch (erro) {
      recusa = erro;
    }

    expect(LIMITE_DA_FILA).toBe(10);
    expect(recusa).toBeInstanceOf(ErroDeFilaCheia);
    expect(recusa).toMatchObject({ motivo: "fila_cheia", message: 'A fila de "Painel" está cheia (máximo 10 pedidos).' });
    expect(orquestrador.fila.map((item) => item.id)).toEqual(["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9", "p10"]);
  });

  it("retira um pedido mantendo a ordem dos outros", () => {
    const orquestrador = novoOrquestrador();
    orquestrador.enfileirarPedido(pedido("p1"));
    orquestrador.enfileirarPedido(pedido("p2"));
    orquestrador.enfileirarPedido(pedido("p3"));

    expect(orquestrador.retirarDaFila("p2", "removido")).toEqual({
      tipo: "pedido_retirado_da_fila",
      pedidoId: "p2",
      motivo: "removido",
    });
    expect(orquestrador.retirarDaFila("p1", "enviado")).toMatchObject({ motivo: "enviado" });
    expect(orquestrador.fila.map((item) => item.id)).toEqual(["p3"]);
  });

  it("recusa retirar ou buscar um pedido que não está na fila", () => {
    const orquestrador = novoOrquestrador();
    orquestrador.enfileirarPedido(pedido("p1"));

    const erro = capturarErro(() => orquestrador.retirarDaFila("p9", "removido"));

    expect(erro.motivo).toBe("nao_encontrado");
    expect(erro.message).toBe("Pedido não encontrado na fila.");
    expect(capturarErro(() => orquestrador.pedidoDaFila("p9")).motivo).toBe("nao_encontrado");
    expect(orquestrador.fila).toHaveLength(1);
  });

  it("a fila exposta é uma cópia", () => {
    const orquestrador = novoOrquestrador();
    orquestrador.enfileirarPedido(pedido("p1"));

    (orquestrador.fila as PedidoNaFila[]).pop();

    expect(orquestrador.fila).toHaveLength(1);
  });

  it("a fila sobrevive a gravar e reabrir", () => {
    const orquestrador = novoOrquestrador();
    orquestrador.enfileirarPedido(pedido("p1"));
    orquestrador.enfileirarPedido(PedidoNaFila.criar({ id: "p2", texto: "planeje", modo: "planejamento", enfileiradoEm: agora }));

    const dados = orquestrador.paraDados();
    const reaberto = Orquestrador.reconstituir(dados);

    expect(dados.fila).toEqual([
      { id: "p1", texto: "pedido p1", modo: "execucao", enfileiradoEm: agora.toISOString() },
      { id: "p2", texto: "planeje", modo: "planejamento", enfileiradoEm: agora.toISOString() },
    ]);
    expect(reaberto.fila.map((item) => item.paraDados())).toEqual(dados.fila);
    expect(reaberto.paraDados()).toEqual(dados);
  });

  it("reabre um orquestrador.json gravado antes da fila com a fila vazia", () => {
    const { fila: _semOCampo, ...dadosAntigos } = novoOrquestrador().paraDados();

    const reaberto = Orquestrador.reconstituir(dadosAntigos);

    expect(reaberto.fila).toEqual([]);
    expect(reaberto.paraDados().fila).toEqual([]);
  });

  it("limpar a conversa mantém a fila", () => {
    const orquestrador = novoOrquestrador();
    orquestrador.iniciarTurno("t1", "analise", agora);
    orquestrador.concluirTurno("t1", "pronto", uso, agora);
    orquestrador.enfileirarPedido(pedido("p1"));

    orquestrador.limparConversa("s2");

    expect(orquestrador.fila.map((item) => item.id)).toEqual(["p1"]);
  });

  describe("o próximo da fila depois de um turno", () => {
    function comFila(): Orquestrador {
      const orquestrador = novoOrquestrador();
      orquestrador.enfileirarPedido(pedido("p1"));
      orquestrador.enfileirarPedido(pedido("p2"));
      orquestrador.iniciarTurno("t1", "analise", agora);
      return orquestrador;
    }

    it("é o primeiro da fila quando o turno conclui sem plano pendente", () => {
      const orquestrador = comFila();
      orquestrador.concluirTurno("t1", "pronto", uso, agora);

      expect(orquestrador.proximoDaFilaApos("t1")?.id).toBe("p1");
    });

    it.each<[string, (orquestrador: Orquestrador) => void]>([
      ["cancelado", (orquestrador) => orquestrador.cancelarTurno("t1", agora)],
      ["com falha", (orquestrador) => orquestrador.falharTurno("t1", "sem cota", agora)],
      ["com plano pendente", (orquestrador) => orquestrador.concluirTurno("t1", "o plano", uso, agora, true)],
      ["interrompido", (orquestrador) => orquestrador.interromperTurnoEmAndamento(agora)],
      ["ainda em andamento", () => undefined],
    ])("não há próximo com o turno %s", (_situacao, encerrar) => {
      const orquestrador = comFila();
      encerrar(orquestrador);

      expect(orquestrador.proximoDaFilaApos("t1")).toBeNull();
      expect(orquestrador.fila).toHaveLength(2);
    });

    it("não há próximo se outro turno já começou depois dele", () => {
      const orquestrador = comFila();
      orquestrador.concluirTurno("t1", "pronto", uso, agora);
      orquestrador.iniciarTurno("t2", "do usuário", agora);

      expect(orquestrador.proximoDaFilaApos("t1")).toBeNull();
    });

    it("não há próximo com a fila vazia", () => {
      const orquestrador = novoOrquestrador();
      orquestrador.iniciarTurno("t1", "analise", agora);
      orquestrador.concluirTurno("t1", "pronto", uso, agora);

      expect(orquestrador.proximoDaFilaApos("t1")).toBeNull();
    });
  });
});
