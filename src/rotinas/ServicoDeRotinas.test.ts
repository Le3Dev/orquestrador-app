import { afterEach, describe, expect, it, vi } from "vitest";

import { DadosDaEtapa } from "./EtapaDaRotina";
import { ErroDeRotina, MENSAGEM_DE_EXECUCAO_NAO_ENCONTRADA, MENSAGEM_DE_ROTINA_NAO_ENCONTRADA } from "./ErroDeRotina";
import { ExecucaoDaRotina } from "./ExecucaoDaRotina";
import {
  APROVACAO_DE_TESTE,
  ContextoDoServico,
  PEDIDO_DE_TESTE,
  esvaziarFilas,
  exigir,
  montarContextoDoServico,
  rotinaDeTeste,
} from "./duplasDeTeste";
import {
  LIMITE_DE_ROTINAS,
  MENSAGEM_DE_LIMITE_DE_ROTINAS,
  MOTIVO_DE_CANCELAMENTO,
  MOTIVO_DE_EXECUCAO_AGUARDANDO,
  MOTIVO_DE_EXECUCAO_EM_ANDAMENTO,
  MOTIVO_DE_INTERRUPCAO,
  MOTIVO_DE_OCORRENCIA_PERDIDA,
  TOLERANCIA_DE_ATRASO_EM_MS,
} from "./ServicoDeRotinas";

const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const PLANEJAMENTO: DadosDaEtapa = { ...PEDIDO_DE_TESTE, texto: "Planeje a migração.", modo: "planejamento" };
const PEDIDO_FINAL: DadosDaEtapa = { ...PEDIDO_DE_TESTE, texto: "Agora faça o que planejou." };

/** Terça-feira, 17/11/2026, às 9h no relógio local. */
function as9(dia: number): Date {
  return new Date(2026, 10, dia, 9, 0, 0, 0);
}

function ultimaExecucao(contexto: ContextoDoServico, rotinaId: string): ExecucaoDaRotina {
  return exigir(contexto.servico.listarExecucoes(rotinaId)[0]);
}

/** Cria a rotina e a executa até o executor parar (resposta pendente) ou a execução parar/terminar. */
async function executarEEsperar(contexto: ContextoDoServico, rotinaId: string): Promise<ExecucaoDaRotina> {
  const iniciada = await contexto.servico.executarAgora(rotinaId);
  await esvaziarFilas();
  return iniciada;
}

async function erroDaPromessa(promessa: Promise<unknown>): Promise<ErroDeRotina> {
  try {
    await promessa;
  } catch (erro) {
    if (erro instanceof ErroDeRotina) {
      return erro;
    }
    throw erro;
  }
  throw new Error("Esperava um ErroDeRotina, mas a promessa resolveu.");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ServicoDeRotinas: criar e alterar", () => {
  it("cria a rotina com a próxima execução calculada e avisa", async () => {
    const contexto = montarContextoDoServico();

    const rotina = await contexto.servico.criar(rotinaDeTeste());

    expect(rotina.proximaExecucaoEm).toEqual(as9(17));
    expect(contexto.servico.listar().map((item) => item.id)).toEqual([rotina.id]);
    expect(contexto.servico.buscar(rotina.id).nome).toBe("Relatório semanal");
    expect(contexto.publicador.tipos).toEqual(["rotina_criada"]);
  });

  it("recusa orquestrador que não existe, dizendo em qual etapa, e não grava nada", async () => {
    const contexto = montarContextoDoServico();

    const erro = await erroDaPromessa(
      contexto.servico.criar(rotinaDeTeste({ etapas: [PEDIDO_DE_TESTE, { ...PEDIDO_DE_TESTE, orquestradorId: "orq-9" }] })),
    );

    expect(erro.motivo).toBe("dados_invalidos");
    expect(erro.message).toBe("O orquestrador escolhido na etapa 2 não existe.");
    expect(contexto.servico.listar()).toEqual([]);
    expect(contexto.publicador.eventos).toEqual([]);
  });

  it("repassa as regras do domínio (nome, etapas, gatilho)", async () => {
    const contexto = montarContextoDoServico();

    expect((await erroDaPromessa(contexto.servico.criar(rotinaDeTeste({ nome: "" })))).motivo).toBe("dados_invalidos");
    expect((await erroDaPromessa(contexto.servico.criar(rotinaDeTeste({ etapas: [] })))).motivo).toBe("dados_invalidos");
    expect(
      (await erroDaPromessa(contexto.servico.criar(rotinaDeTeste({ gatilho: { tipo: "intervalo", minutos: 5 } })))).motivo,
    ).toBe("dados_invalidos");
  });

  it(`aceita até ${LIMITE_DE_ROTINAS} rotinas`, async () => {
    const contexto = montarContextoDoServico();
    for (let numero = 1; numero <= LIMITE_DE_ROTINAS; numero++) {
      await contexto.servico.criar(rotinaDeTeste({ nome: `Rotina ${numero}` }));
    }

    const erro = await erroDaPromessa(contexto.servico.criar(rotinaDeTeste()));

    expect(erro.motivo).toBe("conflito");
    expect(erro.message).toBe(MENSAGEM_DE_LIMITE_DE_ROTINAS);
    expect(contexto.servico.listar()).toHaveLength(LIMITE_DE_ROTINAS);
  });

  it("alterar troca o que veio, recalcula a agenda e avisa; sem mudança real, não avisa", async () => {
    const contexto = montarContextoDoServico();
    const rotina = await contexto.servico.criar(rotinaDeTeste());
    contexto.publicador.limpar();

    const alterada = await contexto.servico.alterar(rotina.id, { nome: "Outro nome", gatilho: { tipo: "diario", hora: "07:00" } });

    expect(alterada.nome).toBe("Outro nome");
    expect(alterada.proximaExecucaoEm).toEqual(new Date(2026, 10, 18, 7, 0));
    expect(contexto.servico.buscar(rotina.id).nome).toBe("Outro nome");
    expect(contexto.publicador.tipos).toEqual(["rotina_alterada"]);

    contexto.publicador.limpar();
    await contexto.servico.alterar(rotina.id, { nome: "Outro nome" });
    await contexto.servico.alterar(rotina.id, {});
    expect(contexto.publicador.eventos).toEqual([]);
  });

  it("alterar inválido não grava nada pela metade", async () => {
    const contexto = montarContextoDoServico();
    const rotina = await contexto.servico.criar(rotinaDeTeste());
    const antes = contexto.servico.buscar(rotina.id).paraDados();

    const erro = await erroDaPromessa(contexto.servico.alterar(rotina.id, { nome: "Novo", etapas: [] }));

    expect(erro.motivo).toBe("dados_invalidos");
    expect(contexto.servico.buscar(rotina.id).paraDados()).toEqual(antes);
  });

  it("alterar as etapas confere os orquestradores; alterar só o nome não consulta ninguém", async () => {
    const contexto = montarContextoDoServico();
    const rotina = await contexto.servico.criar(rotinaDeTeste());

    const erro = await erroDaPromessa(
      contexto.servico.alterar(rotina.id, { etapas: [{ ...PEDIDO_DE_TESTE, orquestradorId: "orq-9" }] }),
    );
    expect(erro.message).toBe("O orquestrador escolhido na etapa 1 não existe.");

    contexto.executor.orquestradores.clear();
    await expect(contexto.servico.alterar(rotina.id, { nome: "Só o nome" })).resolves.toBeDefined();
  });

  it("desativar apaga a próxima execução; ativar recalcula a partir de agora", async () => {
    const contexto = montarContextoDoServico();
    const rotina = await contexto.servico.criar(rotinaDeTeste());

    const desativada = await contexto.servico.alterar(rotina.id, { ativa: false });
    expect(desativada.ativa).toBe(false);
    expect(desativada.proximaExecucaoEm).toBeNull();

    await contexto.relogio.avancar(3 * HORA);
    const ativada = await contexto.servico.alterar(rotina.id, { ativa: true });
    expect(ativada.ativa).toBe(true);
    expect(ativada.proximaExecucaoEm).toEqual(as9(18));
  });

  it("buscar, alterar e remover uma rotina que não existe dão 'não encontrada'", async () => {
    const contexto = montarContextoDoServico();

    expect(() => contexto.servico.buscar("rot-9")).toThrow(MENSAGEM_DE_ROTINA_NAO_ENCONTRADA);
    expect((await erroDaPromessa(contexto.servico.alterar("rot-9", { nome: "x" }))).motivo).toBe("nao_encontrado");
    expect((await erroDaPromessa(contexto.servico.remover("rot-9"))).motivo).toBe("nao_encontrado");
    expect((await erroDaPromessa(contexto.servico.executarAgora("rot-9"))).motivo).toBe("nao_encontrado");
    expect(() => contexto.servico.listarExecucoes("rot-9")).toThrow(MENSAGEM_DE_ROTINA_NAO_ENCONTRADA);
  });
});

describe("ServicoDeRotinas: executar agora", () => {
  it("conduz as etapas, guarda o resultado e avisa, sem mexer na agenda", async () => {
    const contexto = montarContextoDoServico();
    const { servico, executor, publicador } = contexto;
    executor.prepararRespostas({ situacao: "concluido", resposta: "Relatório pronto." });
    const rotina = await servico.criar(rotinaDeTeste());
    publicador.limpar();

    const iniciada = await servico.executarAgora(rotina.id);
    await contexto.controle.aguardarTodas();

    expect(iniciada.situacao).toBe("em_andamento");
    expect(iniciada.origem).toBe("manual");
    expect(executor.pedidos).toEqual([
      { orquestradorId: "orq-1", texto: "Rode os testes e faça um relatório.", modo: "execucao" },
    ]);
    const final = ultimaExecucao(contexto, rotina.id);
    expect(final.situacao).toBe("concluida");
    expect(final.paraDados().resultados[0]).toMatchObject({ situacao: "concluida", resposta: "Relatório pronto." });
    expect(servico.execucaoAtivaDaRotina(rotina.id)).toBeNull();
    const atualizada = servico.buscar(rotina.id);
    expect(atualizada.ultimaExecucaoEm).toEqual(contexto.relogio.agora());
    expect(atualizada.proximaExecucaoEm).toEqual(as9(17));
    expect(publicador.tipos).toEqual([
      "rotina_alterada",
      "execucao_iniciada",
      "etapa_iniciada",
      "etapa_concluida",
      "execucao_encerrada",
    ]);
    expect(publicador.eventos.at(-1)).toMatchObject({ tipo: "execucao_encerrada", situacao: "concluida" });
  });

  it("uma execução por vez: enquanto roda ou espera aprovação, não começa outra", async () => {
    const contexto = montarContextoDoServico();
    const rotina = await contexto.servico.criar(rotinaDeTeste({ etapas: [PEDIDO_DE_TESTE, APROVACAO_DE_TESTE] }));
    await executarEEsperar(contexto, rotina.id);

    const rodando = await erroDaPromessa(contexto.servico.executarAgora(rotina.id));
    expect(rodando.motivo).toBe("conflito");
    expect(rodando.message).toBe("Esta rotina já está em execução.");

    contexto.executor.responder({ situacao: "concluido", resposta: "ok" });
    await contexto.controle.aguardarTodas();
    expect(ultimaExecucao(contexto, rotina.id).situacao).toBe("aguardando_aprovacao");

    const aguardando = await erroDaPromessa(contexto.servico.executarAgora(rotina.id));
    expect(aguardando.message).toContain("aguardando aprovação");
  });

  it("falha do executor (exceção) vira execução falhou, com mensagem clara", async () => {
    const contexto = montarContextoDoServico();
    contexto.executor.prepararRespostas(new Error("conexão recusada"));
    const rotina = await contexto.servico.criar(rotinaDeTeste());

    await contexto.servico.executarAgora(rotina.id);
    await contexto.controle.aguardarTodas();

    const final = ultimaExecucao(contexto, rotina.id);
    expect(final.situacao).toBe("falhou");
    expect(final.motivo).toBe("Não foi possível falar com o orquestrador: conexão recusada");
    expect(final.paraDados().resultados[0]?.erro).toBe(final.motivo);
  });

  it("o pedido que falha ou é cancelado pelo orquestrador encerra a execução assim", async () => {
    const contexto = montarContextoDoServico();
    contexto.executor.prepararRespostas(
      { situacao: "falhou", motivo: "O motor caiu." },
      { situacao: "cancelado", motivo: "O turno foi cancelado." },
    );
    const rotina = await contexto.servico.criar(rotinaDeTeste());

    await contexto.servico.executarAgora(rotina.id);
    await contexto.controle.aguardarTodas();
    await contexto.servico.executarAgora(rotina.id);
    await contexto.controle.aguardarTodas();

    const [segunda, primeira] = contexto.servico.listarExecucoes(rotina.id);
    expect([primeira?.situacao, primeira?.motivo]).toEqual(["falhou", "O motor caiu."]);
    expect([segunda?.situacao, segunda?.motivo]).toEqual(["cancelada", "O turno foi cancelado."]);
  });

  it("a falha numa etapa interrompe as seguintes", async () => {
    const contexto = montarContextoDoServico();
    contexto.executor.prepararRespostas({ situacao: "falhou", motivo: "Deu erro." });
    const rotina = await contexto.servico.criar(rotinaDeTeste({ etapas: [PEDIDO_DE_TESTE, PEDIDO_FINAL] }));

    await contexto.servico.executarAgora(rotina.id);
    await contexto.controle.aguardarTodas();

    expect(contexto.executor.pedidos).toHaveLength(1);
    expect(ultimaExecucao(contexto, rotina.id).paraDados().resultados).toHaveLength(1);
  });

  it("as etapas valem como eram quando a execução começou, mesmo se a rotina mudar no meio", async () => {
    const contexto = montarContextoDoServico();
    const rotina = await contexto.servico.criar(rotinaDeTeste({ etapas: [PEDIDO_DE_TESTE, PEDIDO_FINAL] }));
    await executarEEsperar(contexto, rotina.id);

    await contexto.servico.alterar(rotina.id, { etapas: [{ tipo: "espera", minutos: 5 }] });
    contexto.executor.responder({ situacao: "concluido", resposta: "ok" });
    contexto.executor.prepararRespostas({ situacao: "concluido", resposta: "fim" });
    await contexto.controle.aguardarTodas();

    expect(contexto.executor.pedidos.map((pedido) => pedido.texto)).toEqual([
      "Rode os testes e faça um relatório.",
      "Agora faça o que planejou.",
    ]);
    expect(ultimaExecucao(contexto, rotina.id).situacao).toBe("concluida");
  });
});

describe("ServicoDeRotinas: aprovação", () => {
  it("a etapa de aprovação para a execução; aprovar segue (a espera usa o temporizador) até concluir", async () => {
    const contexto = montarContextoDoServico();
    const { servico, executor, relogio, publicador } = contexto;
    executor.prepararRespostas({ situacao: "concluido", resposta: "Relatório pronto." }, { situacao: "concluido", resposta: "Y feito." });
    const rotina = await servico.criar(
      rotinaDeTeste({
        etapas: [PEDIDO_DE_TESTE, APROVACAO_DE_TESTE, { tipo: "espera", minutos: 10 }, { ...PEDIDO_DE_TESTE, texto: "Agora faça Y." }],
      }),
    );

    await servico.executarAgora(rotina.id);
    await contexto.controle.aguardarTodas();

    const aguardando = exigir(servico.execucaoAtivaDaRotina(rotina.id));
    expect(aguardando.situacao).toBe("aguardando_aprovacao");
    expect(aguardando.pendencia).toEqual({ tipo: "aprovacao", mensagem: APROVACAO_DE_TESTE.mensagem });
    expect(executor.pedidos).toHaveLength(1);
    expect(publicador.tipos).toContain("aguardando_aprovacao");

    const aprovada = await servico.aprovar(aguardando.id);
    expect(aprovada.situacao).toBe("em_andamento");
    await esvaziarFilas();
    expect(relogio.avisosPendentes).toBe(1);

    await relogio.avancar(9 * MINUTO);
    expect(executor.pedidos).toHaveLength(1);
    await relogio.avancar(MINUTO);
    await contexto.controle.aguardarTodas();

    expect(executor.pedidos.map((pedido) => pedido.texto)).toEqual(["Rode os testes e faça um relatório.", "Agora faça Y."]);
    const final = ultimaExecucao(contexto, rotina.id);
    expect(final.situacao).toBe("concluida");
    expect(final.paraDados().resultados.map((resultado) => resultado.situacao)).toEqual([
      "concluida",
      "concluida",
      "concluida",
      "concluida",
    ]);
  });

  it("o pedido que termina em plano espera aprovação; aprovar manda o orquestrador executar o plano e segue", async () => {
    const contexto = montarContextoDoServico();
    const { servico, executor } = contexto;
    executor.prepararRespostas(
      { situacao: "plano_para_aprovacao", plano: "1. Migrar\n2. Testar" },
      { situacao: "concluido", resposta: "Plano executado." },
      { situacao: "concluido", resposta: "Etapa final." },
    );
    const rotina = await servico.criar(rotinaDeTeste({ etapas: [PLANEJAMENTO, PEDIDO_FINAL] }));

    await servico.executarAgora(rotina.id);
    await contexto.controle.aguardarTodas();

    const aguardando = exigir(servico.execucaoAtivaDaRotina(rotina.id));
    expect(aguardando.situacao).toBe("aguardando_aprovacao");
    expect(aguardando.pendencia).toEqual({ tipo: "plano", plano: "1. Migrar\n2. Testar" });
    expect(executor.pedidos).toHaveLength(1);
    expect(executor.pedidos[0]).toMatchObject({ modo: "planejamento" });
    expect(executor.aprovacoesDePlano).toEqual([]);

    await servico.aprovar(aguardando.id);
    await contexto.controle.aguardarTodas();

    expect(executor.aprovacoesDePlano).toEqual(["orq-1"]);
    expect(executor.pedidos.map((pedido) => pedido.texto)).toEqual(["Planeje a migração.", "Agora faça o que planejou."]);
    const final = ultimaExecucao(contexto, rotina.id);
    expect(final.situacao).toBe("concluida");
    expect(final.paraDados().resultados[0]).toMatchObject({
      situacao: "concluida",
      plano: "1. Migrar\n2. Testar",
      resposta: "Plano executado.",
    });
  });

  it("aprovar um plano e o orquestrador devolver outro plano volta a aguardar aprovação", async () => {
    const contexto = montarContextoDoServico();
    contexto.executor.prepararRespostas(
      { situacao: "plano_para_aprovacao", plano: "Plano 1" },
      { situacao: "plano_para_aprovacao", plano: "Plano 2" },
    );
    const rotina = await contexto.servico.criar(rotinaDeTeste({ etapas: [PLANEJAMENTO] }));
    await contexto.servico.executarAgora(rotina.id);
    await contexto.controle.aguardarTodas();

    await contexto.servico.aprovar(exigir(contexto.servico.execucaoAtivaDaRotina(rotina.id)).id);
    await contexto.controle.aguardarTodas();

    expect(exigir(contexto.servico.execucaoAtivaDaRotina(rotina.id)).pendencia).toEqual({ tipo: "plano", plano: "Plano 2" });
  });

  it("recusar a aprovação encerra como recusada e as etapas seguintes não rodam", async () => {
    const contexto = montarContextoDoServico();
    contexto.executor.prepararRespostas({ situacao: "concluido", resposta: "ok" });
    const rotina = await contexto.servico.criar(rotinaDeTeste({ etapas: [PEDIDO_DE_TESTE, APROVACAO_DE_TESTE, PEDIDO_FINAL] }));
    await contexto.servico.executarAgora(rotina.id);
    await contexto.controle.aguardarTodas();
    contexto.publicador.limpar();

    const recusada = await contexto.servico.recusar(exigir(contexto.servico.execucaoAtivaDaRotina(rotina.id)).id, "Está incompleto.");

    expect(recusada.situacao).toBe("recusada");
    expect(recusada.motivo).toBe("Está incompleto.");
    expect(contexto.executor.pedidos).toHaveLength(1);
    expect(contexto.executor.planosDescartados).toEqual([]);
    expect(ultimaExecucao(contexto, rotina.id).situacao).toBe("recusada");
    expect(contexto.servico.execucaoAtivaDaRotina(rotina.id)).toBeNull();
    expect(contexto.publicador.eventos).toEqual([
      expect.objectContaining({ tipo: "execucao_encerrada", situacao: "recusada" }),
    ]);
  });

  it("recusar um plano também o descarta no orquestrador (e a falha em descartar só é registrada)", async () => {
    const contexto = montarContextoDoServico();
    contexto.executor.prepararRespostas(
      { situacao: "plano_para_aprovacao", plano: "Plano A" },
      { situacao: "plano_para_aprovacao", plano: "Plano B" },
    );
    const rotina = await contexto.servico.criar(rotinaDeTeste({ etapas: [PLANEJAMENTO] }));
    await contexto.servico.executarAgora(rotina.id);
    await contexto.controle.aguardarTodas();

    const recusada = await contexto.servico.recusar(exigir(contexto.servico.execucaoAtivaDaRotina(rotina.id)).id);

    expect(recusada.situacao).toBe("recusada");
    expect(contexto.executor.planosDescartados).toEqual(["orq-1"]);

    const erroNoLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    contexto.executor.falhaAoDescartar = true;
    await contexto.servico.executarAgora(rotina.id);
    await contexto.controle.aguardarTodas();
    const outra = await contexto.servico.recusar(exigir(contexto.servico.execucaoAtivaDaRotina(rotina.id)).id);
    expect(outra.situacao).toBe("recusada");
    expect(erroNoLog).toHaveBeenCalled();
  });

  it("aprovar, recusar e cancelar uma execução que não existe, ou que não espera, dão erro claro", async () => {
    const contexto = montarContextoDoServico();
    contexto.executor.prepararRespostas({ situacao: "concluido", resposta: "ok" });
    const rotina = await contexto.servico.criar(rotinaDeTeste());
    await contexto.servico.executarAgora(rotina.id);
    await contexto.controle.aguardarTodas();
    const concluida = ultimaExecucao(contexto, rotina.id);

    for (const acao of [
      () => contexto.servico.aprovar("exe-9"),
      () => contexto.servico.recusar("exe-9"),
      () => contexto.servico.cancelar("exe-9"),
    ]) {
      const erro = await erroDaPromessa(acao());
      expect([erro.motivo, erro.message]).toEqual(["nao_encontrado", MENSAGEM_DE_EXECUCAO_NAO_ENCONTRADA]);
    }
    for (const acao of [() => contexto.servico.aprovar(concluida.id), () => contexto.servico.recusar(concluida.id)]) {
      const erro = await erroDaPromessa(acao());
      expect([erro.motivo, erro.message]).toEqual(["conflito", "Esta execução não está aguardando aprovação."]);
    }
    expect((await erroDaPromessa(contexto.servico.cancelar(concluida.id))).message).toBe("Esta execução já terminou.");
  });

  it("aprovar duas vezes seguidas: só a primeira vale", async () => {
    const contexto = montarContextoDoServico();
    contexto.executor.prepararRespostas({ situacao: "concluido", resposta: "ok" });
    const rotina = await contexto.servico.criar(rotinaDeTeste({ etapas: [APROVACAO_DE_TESTE, PEDIDO_DE_TESTE] }));
    await contexto.servico.executarAgora(rotina.id);
    await contexto.controle.aguardarTodas();
    const id = exigir(contexto.servico.execucaoAtivaDaRotina(rotina.id)).id;

    const resultados = await Promise.allSettled([contexto.servico.aprovar(id), contexto.servico.aprovar(id)]);
    await contexto.controle.aguardarTodas();

    expect(resultados.map((resultado) => resultado.status)).toEqual(["fulfilled", "rejected"]);
    expect(contexto.executor.pedidos).toHaveLength(1);
  });
});

describe("ServicoDeRotinas: cancelar e remover", () => {
  it("cancelar a execução que roda aborta o pedido em curso e encerra uma vez só", async () => {
    const contexto = montarContextoDoServico();
    const rotina = await contexto.servico.criar(rotinaDeTeste({ etapas: [PEDIDO_DE_TESTE, PEDIDO_FINAL] }));
    const iniciada = await executarEEsperar(contexto, rotina.id);
    expect(contexto.executor.quantosPendentes).toBe(1);
    contexto.publicador.limpar();

    const cancelada = await contexto.servico.cancelar(iniciada.id);
    await contexto.controle.aguardarTodas();

    expect(cancelada.situacao).toBe("cancelada");
    expect(cancelada.motivo).toBe(MOTIVO_DE_CANCELAMENTO);
    expect(exigir(contexto.executor.sinais[0]).aborted).toBe(true);
    expect(contexto.executor.pedidos).toHaveLength(1);
    expect(ultimaExecucao(contexto, rotina.id).situacao).toBe("cancelada");
    expect(contexto.publicador.tipos).toEqual(["execucao_encerrada"]);
  });

  it("cancelar durante uma espera tira o aviso do temporizador", async () => {
    const contexto = montarContextoDoServico();
    const rotina = await contexto.servico.criar(rotinaDeTeste({ etapas: [{ tipo: "espera", minutos: 60 }, PEDIDO_DE_TESTE] }));
    const iniciada = await executarEEsperar(contexto, rotina.id);
    expect(contexto.relogio.avisosPendentes).toBe(1);

    await contexto.servico.cancelar(iniciada.id);
    await contexto.controle.aguardarTodas();
    await contexto.relogio.avancar(2 * HORA);

    expect(contexto.relogio.avisosPendentes).toBe(0);
    expect(contexto.executor.pedidos).toEqual([]);
    expect(ultimaExecucao(contexto, rotina.id).situacao).toBe("cancelada");
  });

  it("cancelar a que espera aprovação encerra e, sendo plano, descarta o plano", async () => {
    const contexto = montarContextoDoServico();
    contexto.executor.prepararRespostas({ situacao: "plano_para_aprovacao", plano: "Plano" });
    const rotina = await contexto.servico.criar(rotinaDeTeste({ etapas: [PLANEJAMENTO] }));
    await contexto.servico.executarAgora(rotina.id);
    await contexto.controle.aguardarTodas();

    const cancelada = await contexto.servico.cancelar(exigir(contexto.servico.execucaoAtivaDaRotina(rotina.id)).id);

    expect(cancelada.situacao).toBe("cancelada");
    expect(contexto.executor.planosDescartados).toEqual(["orq-1"]);
  });

  it("remover a rotina cancela a execução em curso, descarta o plano pendente e leva as execuções junto", async () => {
    const contexto = montarContextoDoServico();
    const rodando = await contexto.servico.criar(rotinaDeTeste({ nome: "Roda" }));
    await executarEEsperar(contexto, rodando.id);
    contexto.executor.prepararRespostas({ situacao: "plano_para_aprovacao", plano: "Plano" });
    const comPlano = await contexto.servico.criar(rotinaDeTeste({ nome: "Plano", etapas: [PLANEJAMENTO] }));
    await contexto.servico.executarAgora(comPlano.id);
    await esvaziarFilas();
    contexto.publicador.limpar();

    await contexto.servico.remover(rodando.id);
    await contexto.servico.remover(comPlano.id);
    await contexto.controle.aguardarTodas();

    expect(exigir(contexto.executor.sinais[0]).aborted).toBe(true);
    expect(contexto.executor.planosDescartados).toEqual(["orq-1"]);
    expect(contexto.servico.listar()).toEqual([]);
    expect(contexto.repositorio.ativas()).toEqual([]);
    expect(contexto.publicador.eventos).toEqual([
      { tipo: "rotina_removida", id: rodando.id },
      { tipo: "rotina_removida", id: comPlano.id },
    ]);
  });
});

describe("ServicoDeRotinas: ao abrir e ao fechar o app", () => {
  it("interromperEmAndamento aborta o que roda e deixa interrompida; o que espera aprovação continua", async () => {
    const contexto = montarContextoDoServico();
    const rodando = await contexto.servico.criar(rotinaDeTeste({ nome: "Roda" }));
    await executarEEsperar(contexto, rodando.id);
    contexto.executor.prepararRespostas({ situacao: "concluido", resposta: "ok" });
    const esperando = await contexto.servico.criar(rotinaDeTeste({ nome: "Espera", etapas: [PEDIDO_DE_TESTE, APROVACAO_DE_TESTE] }));
    await contexto.servico.executarAgora(esperando.id);
    await esvaziarFilas();

    await contexto.servico.interromperEmAndamento();

    const interrompida = ultimaExecucao(contexto, rodando.id);
    expect(interrompida.situacao).toBe("interrompida");
    expect(interrompida.motivo).toBe(MOTIVO_DE_INTERRUPCAO);
    expect(exigir(contexto.executor.sinais[0]).aborted).toBe(true);
    expect(ultimaExecucao(contexto, esperando.id).situacao).toBe("aguardando_aprovacao");
  });

  it("ao iniciar: o que estava em andamento vira interrompida; o que esperava aprovação continua aprovável", async () => {
    const antes = montarContextoDoServico();
    const rodando = await antes.servico.criar(rotinaDeTeste({ nome: "Roda" }));
    await executarEEsperar(antes, rodando.id);
    antes.executor.prepararRespostas({ situacao: "plano_para_aprovacao", plano: "Plano" });
    const esperando = await antes.servico.criar(rotinaDeTeste({ nome: "Espera", etapas: [PLANEJAMENTO, PEDIDO_FINAL] }));
    await antes.servico.executarAgora(esperando.id);
    await esvaziarFilas();
    // O app cai: nada é fechado com cuidado, e um novo serviço abre sobre os mesmos dados.
    const depois = montarContextoDoServico({ repositorio: antes.repositorio, relogio: antes.relogio, executor: antes.executor });

    await depois.servico.recuperarAoIniciar();

    const interrompida = ultimaExecucao(depois, rodando.id);
    expect(interrompida.situacao).toBe("interrompida");
    expect(interrompida.motivo).toBe(MOTIVO_DE_INTERRUPCAO);
    const aguardando = exigir(depois.servico.execucaoAtivaDaRotina(esperando.id));
    expect(aguardando.situacao).toBe("aguardando_aprovacao");

    depois.executor.prepararRespostas({ situacao: "concluido", resposta: "Plano executado." }, { situacao: "concluido", resposta: "Fim." });
    await depois.servico.aprovar(aguardando.id);
    await depois.controle.aguardarTodas();
    expect(ultimaExecucao(depois, esperando.id).situacao).toBe("concluida");
  });

  it("hora perdida com aoPerder 'pular': registra a execução pulada, avança a agenda e não executa", async () => {
    const antes = montarContextoDoServico();
    const rotina = await antes.servico.criar(rotinaDeTeste({ aoPerder: "pular" }));
    await antes.relogio.avancar(2 * 24 * HORA + 2 * HORA); // 19/11, 10h: as 9h de 17, 18 e 19 passaram
    const depois = montarContextoDoServico({ repositorio: antes.repositorio, relogio: antes.relogio, executor: antes.executor });

    await depois.servico.recuperarAoIniciar();

    const execucoes = depois.servico.listarExecucoes(rotina.id);
    expect(execucoes).toHaveLength(1);
    expect(execucoes[0]?.situacao).toBe("pulada");
    expect(execucoes[0]?.origem).toBe("perdida");
    expect(execucoes[0]?.motivo).toBe(MOTIVO_DE_OCORRENCIA_PERDIDA);
    expect(depois.executor.pedidos).toEqual([]);
    expect(depois.servico.buscar(rotina.id).proximaExecucaoEm).toEqual(as9(20));
    expect(depois.publicador.eventos.at(-1)).toMatchObject({ tipo: "execucao_encerrada", situacao: "pulada" });
  });

  it("hora perdida com 'executar ao abrir': só UMA execução de recuperação, mesmo com muitas ocorrências perdidas", async () => {
    const antes = montarContextoDoServico();
    const rotina = await antes.servico.criar(
      rotinaDeTeste({ aoPerder: "executar_ao_abrir", gatilho: { tipo: "intervalo", minutos: 15 } }),
    );
    await antes.relogio.avancar(3 * HORA); // 12 ocorrências de 15 minutos passaram
    const depois = montarContextoDoServico({ repositorio: antes.repositorio, relogio: antes.relogio, executor: antes.executor });
    depois.executor.prepararRespostas({ situacao: "concluido", resposta: "ok" });

    await depois.servico.recuperarAoIniciar();
    await depois.controle.aguardarTodas();
    await depois.servico.recuperarAoIniciar();

    const execucoes = depois.servico.listarExecucoes(rotina.id);
    expect(execucoes).toHaveLength(1);
    expect(execucoes[0]?.origem).toBe("perdida");
    expect(execucoes[0]?.situacao).toBe("concluida");
    expect(depois.executor.pedidos).toHaveLength(1);
    expect(depois.servico.buscar(rotina.id).proximaExecucaoEm).toEqual(new Date(depois.relogio.agora().getTime() + 15 * MINUTO));
  });

  it("a hora perdida de uma execução única desativa a rotina; rotina desativada não é recuperada", async () => {
    const antes = montarContextoDoServico();
    const umaVez = await antes.servico.criar(
      rotinaDeTeste({ nome: "Uma vez", aoPerder: "pular", gatilho: { tipo: "uma_vez", em: new Date(2026, 10, 17, 10, 0).toISOString() } }),
    );
    const parada = await antes.servico.criar(rotinaDeTeste({ nome: "Parada", aoPerder: "executar_ao_abrir" }));
    await antes.servico.alterar(parada.id, { ativa: false });
    await antes.relogio.avancar(5 * HORA);
    const depois = montarContextoDoServico({ repositorio: antes.repositorio, relogio: antes.relogio, executor: antes.executor });

    await depois.servico.recuperarAoIniciar();

    expect(depois.servico.buscar(umaVez.id).ativa).toBe(false);
    expect(depois.servico.buscar(umaVez.id).proximaExecucaoEm).toBeNull();
    expect(ultimaExecucao(depois, umaVez.id).situacao).toBe("pulada");
    expect(depois.servico.listarExecucoes(parada.id)).toEqual([]);
  });

  it("hora perdida com execução anterior aguardando aprovação: pulada, sem passar por cima dela", async () => {
    const antes = montarContextoDoServico();
    antes.executor.prepararRespostas({ situacao: "concluido", resposta: "ok" });
    const rotina = await antes.servico.criar(
      rotinaDeTeste({ aoPerder: "executar_ao_abrir", etapas: [PEDIDO_DE_TESTE, APROVACAO_DE_TESTE] }),
    );
    await antes.servico.executarAgora(rotina.id);
    await antes.controle.aguardarTodas();
    await antes.relogio.avancar(24 * HORA);
    const depois = montarContextoDoServico({ repositorio: antes.repositorio, relogio: antes.relogio, executor: antes.executor });

    await depois.servico.recuperarAoIniciar();

    const [recente, anterior] = depois.servico.listarExecucoes(rotina.id);
    expect([recente?.situacao, recente?.motivo]).toEqual(["pulada", MOTIVO_DE_EXECUCAO_AGUARDANDO]);
    expect(anterior?.situacao).toBe("aguardando_aprovacao");
    expect(depois.executor.pedidos).toHaveLength(1);
  });
});

describe("ServicoDeRotinas: disparar as vencidas", () => {
  it("dispara na hora marcada (dentro da tolerância) como execução agendada e anda a agenda", async () => {
    const contexto = montarContextoDoServico();
    contexto.executor.prepararRespostas({ situacao: "concluido", resposta: "ok" });
    const rotina = await contexto.servico.criar(rotinaDeTeste());

    await contexto.relogio.avancar(30 * MINUTO);
    await contexto.servico.dispararVencidas();
    expect(contexto.servico.listarExecucoes(rotina.id)).toEqual([]);

    await contexto.relogio.avancar(32 * MINUTO); // 09:02: 2 minutos depois da hora marcada
    await contexto.servico.dispararVencidas();
    await contexto.controle.aguardarTodas();

    const execucao = ultimaExecucao(contexto, rotina.id);
    expect(execucao.origem).toBe("agendada");
    expect(execucao.situacao).toBe("concluida");
    const atualizada = contexto.servico.buscar(rotina.id);
    expect(atualizada.proximaExecucaoEm).toEqual(as9(18));
    expect(atualizada.ultimaExecucaoEm).toEqual(execucao.iniciadaEm);
  });

  it("atraso maior que a tolerância (o computador dormiu) vale como hora perdida e segue o aoPerder", async () => {
    const pular = montarContextoDoServico();
    const rotinaQuePula = await pular.servico.criar(rotinaDeTeste({ aoPerder: "pular" }));
    await pular.relogio.avancar(HORA + TOLERANCIA_DE_ATRASO_EM_MS + MINUTO);
    await pular.servico.dispararVencidas();
    expect(ultimaExecucao(pular, rotinaQuePula.id)).toMatchObject({ situacao: "pulada", origem: "perdida" });

    const executar = montarContextoDoServico();
    executar.executor.prepararRespostas({ situacao: "concluido", resposta: "ok" });
    const rotinaQueExecuta = await executar.servico.criar(rotinaDeTeste({ aoPerder: "executar_ao_abrir" }));
    await executar.relogio.avancar(HORA + TOLERANCIA_DE_ATRASO_EM_MS + MINUTO);
    await executar.servico.dispararVencidas();
    await executar.controle.aguardarTodas();
    expect(ultimaExecucao(executar, rotinaQueExecuta.id)).toMatchObject({ situacao: "concluida", origem: "perdida" });
  });

  it("uma execução por vez por rotina: se a anterior ainda roda, registra a nova como pulada", async () => {
    const contexto = montarContextoDoServico();
    const rotina = await contexto.servico.criar(rotinaDeTeste({ gatilho: { tipo: "intervalo", minutos: 15 } }));

    await contexto.relogio.avancar(15 * MINUTO);
    await contexto.servico.dispararVencidas();
    await esvaziarFilas();
    await contexto.relogio.avancar(15 * MINUTO);
    await contexto.servico.dispararVencidas();

    const [pulada, rodando] = contexto.servico.listarExecucoes(rotina.id);
    expect(rodando?.situacao).toBe("em_andamento");
    expect([pulada?.situacao, pulada?.origem, pulada?.motivo]).toEqual(["pulada", "agendada", MOTIVO_DE_EXECUCAO_EM_ANDAMENTO]);
    expect(contexto.executor.pedidos).toHaveLength(1);
    expect(contexto.servico.buscar(rotina.id).proximaExecucaoEm).toEqual(new Date(contexto.relogio.agora().getTime() + 15 * MINUTO));
  });

  it("se a anterior espera aprovação, a nova é pulada com esse motivo", async () => {
    const contexto = montarContextoDoServico();
    const rotina = await contexto.servico.criar(
      rotinaDeTeste({ gatilho: { tipo: "intervalo", minutos: 15 }, etapas: [APROVACAO_DE_TESTE] }),
    );
    await contexto.servico.executarAgora(rotina.id);
    await contexto.controle.aguardarTodas();

    await contexto.relogio.avancar(15 * MINUTO);
    await contexto.servico.dispararVencidas();

    expect(ultimaExecucao(contexto, rotina.id).motivo).toBe(MOTIVO_DE_EXECUCAO_AGUARDANDO);
  });

  it("execução única: roda uma vez e a rotina se desativa", async () => {
    const contexto = montarContextoDoServico();
    contexto.executor.prepararRespostas({ situacao: "concluido", resposta: "ok" });
    const rotina = await contexto.servico.criar(
      rotinaDeTeste({ gatilho: { tipo: "uma_vez", em: new Date(2026, 10, 17, 10, 0).toISOString() } }),
    );

    await contexto.relogio.avancar(2 * HORA);
    await contexto.servico.dispararVencidas();
    await contexto.controle.aguardarTodas();
    await contexto.relogio.avancar(24 * HORA);
    await contexto.servico.dispararVencidas();

    expect(contexto.servico.listarExecucoes(rotina.id)).toHaveLength(1);
    expect(contexto.servico.buscar(rotina.id)).toMatchObject({ ativa: false, proximaExecucaoEm: null });
  });

  it("rotina desativada não dispara", async () => {
    const contexto = montarContextoDoServico();
    const rotina = await contexto.servico.criar(rotinaDeTeste({ ativa: false }));

    await contexto.relogio.avancar(24 * HORA);
    await contexto.servico.dispararVencidas();

    expect(contexto.servico.listarExecucoes(rotina.id)).toEqual([]);
  });
});
