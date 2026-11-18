import { describe, expect, it } from "vitest";

import { DadosDaEtapa } from "./EtapaDaRotina";
import { ErroDeRotina } from "./ErroDeRotina";
import {
  ExecucaoDaRotina,
  MOTIVO_PADRAO_DA_RECUSA,
  OrigemDaExecucao,
  TAMANHO_MAXIMO_DA_RESPOSTA,
} from "./ExecucaoDaRotina";
import { Rotina } from "./Rotina";

const PEDIDO: DadosDaEtapa = { tipo: "pedido", orquestradorId: "orq-1", texto: "Rode os testes.", modo: "execucao" };
const PLANEJAMENTO: DadosDaEtapa = { ...PEDIDO, texto: "Planeje a migração.", modo: "planejamento" };
const APROVACAO: DadosDaEtapa = { tipo: "aprovacao", mensagem: "Confira o relatório." };
const ESPERA: DadosDaEtapa = { tipo: "espera", minutos: 10 };

function instante(minuto: number): Date {
  return new Date(Date.UTC(2026, 10, 17, 9, minuto));
}

function rotinaCom(...etapas: DadosDaEtapa[]): Rotina {
  return Rotina.criar({
    id: "rot-1",
    nome: "Relatório",
    gatilho: { tipo: "diario", hora: "09:00" },
    etapas,
    agora: instante(0),
  });
}

function comecar(etapas: DadosDaEtapa[], origem: OrigemDaExecucao = "manual"): ExecucaoDaRotina {
  return ExecucaoDaRotina.iniciar({ id: "exe-1", rotina: rotinaCom(...etapas), origem, agora: instante(0) });
}

function erroDe(acao: () => unknown): ErroDeRotina {
  try {
    acao();
  } catch (erro) {
    if (erro instanceof ErroDeRotina) {
      return erro;
    }
    throw erro;
  }
  throw new Error("Esperava um ErroDeRotina, mas nada foi lançado.");
}

describe("ExecucaoDaRotina: andamento", () => {
  it("começa em andamento na primeira etapa, com o nome e as etapas da Rotina", () => {
    const execucao = comecar([PEDIDO, ESPERA], "agendada");

    expect(execucao.situacao).toBe("em_andamento");
    expect(execucao.ativa).toBe(true);
    expect(execucao.posicaoDaEtapaAtual).toBe(0);
    expect(execucao.etapaIniciada).toBe(false);
    expect(execucao.paraDados()).toMatchObject({
      id: "exe-1",
      rotinaId: "rot-1",
      rotinaNome: "Relatório",
      origem: "agendada",
      situacao: "em_andamento",
      etapaAtual: 0,
      etapas: [PEDIDO, ESPERA],
      resultados: [],
      encerradaEm: null,
      motivo: null,
      pendencia: null,
    });
  });

  it("percorre as etapas e termina concluída, com o resultado de cada uma", () => {
    const execucao = comecar([PEDIDO, ESPERA]);

    execucao.iniciarEtapa(instante(1));
    execucao.concluirEtapa("Testes passaram.", instante(2));
    expect(execucao.situacao).toBe("em_andamento");
    expect(execucao.posicaoDaEtapaAtual).toBe(1);

    execucao.iniciarEtapa(instante(2));
    execucao.concluirEtapa(null, instante(12));

    expect(execucao.situacao).toBe("concluida");
    expect(execucao.ativa).toBe(false);
    expect(execucao.etapaAtual).toBeNull();
    expect(execucao.encerradaEm).toEqual(instante(12));
    expect(execucao.paraDados().etapaAtual).toBeNull();
    expect(execucao.paraDados().resultados).toEqual([
      {
        tipo: "pedido",
        situacao: "concluida",
        iniciadaEm: instante(1).toISOString(),
        encerradaEm: instante(2).toISOString(),
        resposta: "Testes passaram.",
        plano: null,
        erro: null,
      },
      {
        tipo: "espera",
        situacao: "concluida",
        iniciadaEm: instante(2).toISOString(),
        encerradaEm: instante(12).toISOString(),
        resposta: null,
        plano: null,
        erro: null,
      },
    ]);
  });

  it("a resposta longa é resumida", () => {
    const execucao = comecar([PEDIDO]);
    execucao.iniciarEtapa(instante(1));

    execucao.concluirEtapa("x".repeat(TAMANHO_MAXIMO_DA_RESPOSTA + 500), instante(2));

    const resposta = execucao.paraDados().resultados[0]?.resposta ?? "";
    expect(resposta).toHaveLength(TAMANHO_MAXIMO_DA_RESPOSTA);
    expect(resposta.endsWith("…")).toBe(true);
  });

  it("não deixa iniciar a mesma etapa duas vezes nem concluir uma etapa que não começou", () => {
    const execucao = comecar([PEDIDO]);

    expect(erroDe(() => execucao.concluirEtapa("x", instante(1))).motivo).toBe("conflito");
    execucao.iniciarEtapa(instante(1));
    expect(erroDe(() => execucao.iniciarEtapa(instante(1))).message).toBe("A etapa desta execução já foi iniciada.");
  });

  it("guarda as etapas de quando começou: editar a Rotina depois não muda a execução", () => {
    const rotina = rotinaCom(PEDIDO);
    const execucao = ExecucaoDaRotina.iniciar({ id: "exe-1", rotina, origem: "manual", agora: instante(0) });

    rotina.alterar({ etapas: [ESPERA, ESPERA], nome: "Outro nome" }, instante(1));

    expect(execucao.paraDados().etapas).toEqual([PEDIDO]);
    expect(execucao.paraDados().rotinaNome).toBe("Relatório");
  });
});

describe("ExecucaoDaRotina: etapa de aprovação", () => {
  it("para até o usuário decidir; aprovar segue para a próxima etapa", () => {
    const execucao = comecar([APROVACAO, PEDIDO]);
    execucao.iniciarEtapa(instante(1));

    execucao.aguardarAprovacao();
    expect(execucao.situacao).toBe("aguardando_aprovacao");
    expect(execucao.ativa).toBe(true);
    expect(execucao.pendencia).toEqual({ tipo: "aprovacao", mensagem: "Confira o relatório." });
    expect(execucao.paraDados().resultados[0]?.situacao).toBe("aguardando_aprovacao");

    expect(execucao.aprovar(instante(5))).toBe("aprovacao");

    expect(execucao.situacao).toBe("em_andamento");
    expect(execucao.pendencia).toBeNull();
    expect(execucao.posicaoDaEtapaAtual).toBe(1);
    expect(execucao.paraDados().resultados[0]).toMatchObject({
      situacao: "concluida",
      encerradaEm: instante(5).toISOString(),
    });
  });

  it("aprovar a última etapa conclui a execução", () => {
    const execucao = comecar([PEDIDO, APROVACAO]);
    execucao.iniciarEtapa(instante(1));
    execucao.concluirEtapa("ok", instante(2));
    execucao.iniciarEtapa(instante(2));
    execucao.aguardarAprovacao();

    execucao.aprovar(instante(30));

    expect(execucao.situacao).toBe("concluida");
    expect(execucao.encerradaEm).toEqual(instante(30));
  });

  it("recusar encerra como recusada, com o motivo (ou o padrão)", () => {
    const comMotivo = comecar([APROVACAO, PEDIDO]);
    comMotivo.iniciarEtapa(instante(1));
    comMotivo.aguardarAprovacao();
    comMotivo.recusar(instante(3), "  O relatório está incompleto.  ");

    expect(comMotivo.situacao).toBe("recusada");
    expect(comMotivo.motivo).toBe("O relatório está incompleto.");
    expect(comMotivo.pendencia).toBeNull();
    expect(comMotivo.paraDados().resultados[0]).toMatchObject({ situacao: "recusada" });
    expect(comMotivo.encerradaEm).toEqual(instante(3));

    const semMotivo = comecar([APROVACAO]);
    semMotivo.iniciarEtapa(instante(1));
    semMotivo.aguardarAprovacao();
    semMotivo.recusar(instante(3), "   ");
    expect(semMotivo.motivo).toBe(MOTIVO_PADRAO_DA_RECUSA);
  });

  it("aguardarAprovacao só vale numa etapa de aprovação", () => {
    const execucao = comecar([PEDIDO]);
    execucao.iniciarEtapa(instante(1));

    expect(erroDe(() => execucao.aguardarAprovacao()).message).toBe("A etapa em curso não é uma aprovação.");
  });
});

describe("ExecucaoDaRotina: plano para aprovação", () => {
  function aguardandoPlano(): ExecucaoDaRotina {
    const execucao = comecar([PLANEJAMENTO, PEDIDO]);
    execucao.iniciarEtapa(instante(1));
    execucao.aguardarAprovacaoDoPlano("1. Migrar a tabela\n2. Rodar os testes");
    return execucao;
  }

  it("o pedido que termina em plano deixa a execução aguardando aprovação, com o plano guardado", () => {
    const execucao = aguardandoPlano();

    expect(execucao.situacao).toBe("aguardando_aprovacao");
    expect(execucao.pendencia).toEqual({ tipo: "plano", plano: "1. Migrar a tabela\n2. Rodar os testes" });
    expect(execucao.paraDados().resultados[0]).toMatchObject({
      situacao: "aguardando_aprovacao",
      plano: "1. Migrar a tabela\n2. Rodar os testes",
    });
  });

  it("aprovar o plano volta a rodar a mesma etapa (quem conduz manda executar o plano)", () => {
    const execucao = aguardandoPlano();

    expect(execucao.aprovar(instante(5))).toBe("plano");

    expect(execucao.situacao).toBe("em_andamento");
    expect(execucao.posicaoDaEtapaAtual).toBe(0);
    expect(execucao.etapaIniciada).toBe(true);
    expect(execucao.paraDados().resultados[0]).toMatchObject({ situacao: "em_andamento", plano: expect.any(String) });

    execucao.concluirEtapa("Migração feita.", instante(9));

    expect(execucao.posicaoDaEtapaAtual).toBe(1);
    expect(execucao.paraDados().resultados[0]).toMatchObject({ situacao: "concluida", resposta: "Migração feita." });
  });

  it("recusar o plano encerra como recusada", () => {
    const execucao = aguardandoPlano();

    execucao.recusar(instante(5));

    expect(execucao.situacao).toBe("recusada");
    expect(execucao.paraDados().resultados[0]).toMatchObject({ situacao: "recusada" });
  });

  it("um plano só pode vir de uma etapa de pedido", () => {
    const execucao = comecar([APROVACAO]);
    execucao.iniciarEtapa(instante(1));

    expect(erroDe(() => execucao.aguardarAprovacaoDoPlano("plano")).message).toBe("A etapa em curso não é um pedido.");
  });
});

describe("ExecucaoDaRotina: fins e transições proibidas", () => {
  it("falhar encerra como falhou e marca o erro na etapa em curso", () => {
    const execucao = comecar([PEDIDO]);
    execucao.iniciarEtapa(instante(1));

    execucao.falhar("O orquestrador não respondeu.", instante(2));

    expect(execucao.situacao).toBe("falhou");
    expect(execucao.motivo).toBe("O orquestrador não respondeu.");
    expect(execucao.paraDados().resultados[0]).toMatchObject({
      situacao: "falhou",
      erro: "O orquestrador não respondeu.",
      encerradaEm: instante(2).toISOString(),
    });
  });

  it("cancelar vale para a que roda e para a que espera aprovação", () => {
    const rodando = comecar([PEDIDO]);
    rodando.iniciarEtapa(instante(1));
    rodando.cancelar("Cancelada pelo usuário.", instante(2));
    expect(rodando.situacao).toBe("cancelada");

    const aguardando = comecar([APROVACAO]);
    aguardando.iniciarEtapa(instante(1));
    aguardando.aguardarAprovacao();
    aguardando.cancelar("Cancelada pelo usuário.", instante(2));
    expect(aguardando.situacao).toBe("cancelada");
    expect(aguardando.pendencia).toBeNull();
  });

  it("interromper só vale para a que estava em andamento (a que espera aprovação continua aprovável)", () => {
    const rodando = comecar([PEDIDO]);
    rodando.iniciarEtapa(instante(1));
    rodando.interromper("O app foi fechado.", instante(2));
    expect(rodando.situacao).toBe("interrompida");
    expect(rodando.encerradaEm).toEqual(instante(2));

    const aguardando = comecar([APROVACAO]);
    aguardando.iniciarEtapa(instante(1));
    aguardando.aguardarAprovacao();
    expect(erroDe(() => aguardando.interromper("O app foi fechado.", instante(2))).motivo).toBe("conflito");
    expect(aguardando.situacao).toBe("aguardando_aprovacao");
  });

  it("recusar e aprovar só valem aguardando aprovação; a execução não muda quando recusa", () => {
    const execucao = comecar([PEDIDO]);
    execucao.iniciarEtapa(instante(1));
    const antes = execucao.paraDados();

    expect(erroDe(() => execucao.aprovar(instante(2))).message).toBe("Esta execução não está aguardando aprovação.");
    expect(erroDe(() => execucao.recusar(instante(2))).message).toBe("Esta execução não está aguardando aprovação.");
    expect(execucao.paraDados()).toEqual(antes);
  });

  it("depois de terminar, nenhuma transição vale", () => {
    const execucao = comecar([PEDIDO]);
    execucao.iniciarEtapa(instante(1));
    execucao.cancelar("Cancelada pelo usuário.", instante(2));
    const antes = execucao.paraDados();

    const tentativas = [
      () => execucao.iniciarEtapa(instante(3)),
      () => execucao.concluirEtapa("x", instante(3)),
      () => execucao.aguardarAprovacao(),
      () => execucao.aguardarAprovacaoDoPlano("plano"),
      () => execucao.aprovar(instante(3)),
      () => execucao.recusar(instante(3)),
      () => execucao.falhar("erro", instante(3)),
      () => execucao.cancelar("de novo", instante(3)),
      () => execucao.interromper("fechou", instante(3)),
    ];
    for (const tentativa of tentativas) {
      expect(erroDe(tentativa).motivo).toBe("conflito");
    }
    expect(execucao.paraDados()).toEqual(antes);
  });

  it("a execução pulada nasce encerrada, com o motivo, e sem etapas iniciadas", () => {
    const execucao = ExecucaoDaRotina.pular({
      id: "exe-9",
      rotina: rotinaCom(PEDIDO),
      origem: "perdida",
      agora: instante(7),
      motivo: "O app estava fechado na hora agendada.",
    });

    expect(execucao.situacao).toBe("pulada");
    expect(execucao.ativa).toBe(false);
    expect(execucao.origem).toBe("perdida");
    expect(execucao.paraDados()).toMatchObject({
      situacao: "pulada",
      etapaAtual: null,
      resultados: [],
      motivo: "O app estava fechado na hora agendada.",
      iniciadaEm: instante(7).toISOString(),
      encerradaEm: instante(7).toISOString(),
    });
  });
});

describe("ExecucaoDaRotina: reconstituir", () => {
  it("devolve o mesmo que foi gravado, em qualquer situação", () => {
    const concluida = comecar([PEDIDO]);
    concluida.iniciarEtapa(instante(1));
    concluida.concluirEtapa("ok", instante(2));
    const aguardando = comecar([PLANEJAMENTO]);
    aguardando.iniciarEtapa(instante(1));
    aguardando.aguardarAprovacaoDoPlano("plano");
    const recusada = comecar([APROVACAO]);
    recusada.iniciarEtapa(instante(1));
    recusada.aguardarAprovacao();
    recusada.recusar(instante(2), "Não.");

    for (const execucao of [concluida, aguardando, recusada]) {
      expect(ExecucaoDaRotina.reconstituir(execucao.paraDados()).paraDados()).toEqual(execucao.paraDados());
    }
  });

  it("a execução que esperava aprovação continua aprovável depois de reabrir", () => {
    const antes = comecar([PLANEJAMENTO, PEDIDO]);
    antes.iniciarEtapa(instante(1));
    antes.aguardarAprovacaoDoPlano("plano");

    const depois = ExecucaoDaRotina.reconstituir(antes.paraDados());

    expect(depois.situacao).toBe("aguardando_aprovacao");
    expect(depois.aprovar(instante(60))).toBe("plano");
    depois.concluirEtapa("feito", instante(61));
    expect(depois.posicaoDaEtapaAtual).toBe(1);
  });

  it("recusa dados que não fazem sentido", () => {
    const dados = comecar([PEDIDO]).paraDados();

    expect(() => ExecucaoDaRotina.reconstituir({ ...dados, situacao: "voando" as unknown as "falhou" })).toThrow(ErroDeRotina);
    expect(() => ExecucaoDaRotina.reconstituir({ ...dados, origem: "sorteio" as unknown as "manual" })).toThrow(ErroDeRotina);
    expect(() => ExecucaoDaRotina.reconstituir({ ...dados, situacao: "aguardando_aprovacao", pendencia: null })).toThrow(
      ErroDeRotina,
    );
    expect(() => ExecucaoDaRotina.reconstituir({ ...dados, etapas: [{ tipo: "sono" } as unknown as DadosDaEtapa] })).toThrow(
      ErroDeRotina,
    );
  });
});
