import type {
  DadosDaConfiguracao,
  DadosDaConfiguracaoGravada,
  EventoDeOrquestracao,
  EventoRegistrado,
} from "../api/tipos";
import { aplicarEvento, ESTADO_INICIAL, type EstadoDaConversa } from "./aplicarEvento";

const configuracao: DadosDaConfiguracao = {
  modeloDoOrquestrador: "opus",
  esforcoDoOrquestrador: "padrao",
  modeloDosSubagentes: "sonnet",
  esforcoDosSubagentes: "padrao",
  quantidadeDeSubagentes: { modo: "automatica", limite: 3 },
  nivelDePermissao: "leitura",
  permitirCommitEPush: false,
};

function registrar(eventos: EventoDeOrquestracao[]): EventoRegistrado[] {
  return eventos.map((evento, indice) => ({ ...evento, sequencia: indice + 1, em: `2026-10-28T12:00:0${indice % 10}Z` }));
}

function reproduzir(eventos: EventoRegistrado[], inicial: EstadoDaConversa = ESTADO_INICIAL): EstadoDaConversa {
  return eventos.reduce(aplicarEvento, inicial);
}

const historico = registrar([
  { tipo: "turno_iniciado", turnoId: "t1", texto: "analise o projeto", configuracao },
  { tipo: "sessao_iniciada", turnoId: "t1" },
  { tipo: "texto_do_orquestrador", turnoId: "t1", texto: "Vou dividir em duas partes." },
  { tipo: "subagente_iniciado", turnoId: "t1", subagenteId: "a", descricao: "Domínio", tarefa: "leia o domínio" },
  { tipo: "subagente_iniciado", turnoId: "t1", subagenteId: "b", descricao: "Testes", tarefa: "leia os testes" },
  {
    tipo: "progresso_do_subagente",
    turnoId: "t1",
    subagenteId: "a",
    atividade: "Lendo Periodo.ts",
    ultimaFerramenta: "Read",
    tokens: 1200,
    ferramentasUsadas: 1,
    duracaoMs: 900,
  },
  { tipo: "texto_do_subagente", turnoId: "t1", subagenteId: "a", texto: "Periodo é um objeto de valor." },
  { tipo: "subagente_concluido", turnoId: "t1", subagenteId: "a", situacao: "concluido", resumo: "ok", tokens: 1500, duracaoMs: 2000 },
  { tipo: "resultado_do_subagente", turnoId: "t1", subagenteId: "a", resultado: "Relatório A" },
  { tipo: "uso_da_cota", turnoId: "t1", janelas: [{ nome: "5 horas", utilizacao: 0.1, renovaEm: null, situacao: "allowed" }] },
  { tipo: "texto_do_orquestrador", turnoId: "t1", texto: "Síntese final" },
]);

describe("aplicarEvento", () => {
  it("reconstrói um turno em andamento com os subagentes", () => {
    const estado = reproduzir(historico);
    const [turno] = estado.turnos;

    expect(estado.ultimaSequencia).toBe(historico.length);
    expect(turno?.situacao).toBe("em_andamento");
    expect(turno?.textosDoOrquestrador).toEqual(["Vou dividir em duas partes.", "Síntese final"]);
    expect(turno?.subagentes.map((subagente) => [subagente.id, subagente.situacao])).toEqual([
      ["a", "concluido"],
      ["b", "executando"],
    ]);
    expect(turno?.subagentes[0]).toMatchObject({
      atividade: "Lendo Periodo.ts",
      tokens: 1500,
      textos: ["Periodo é um objeto de valor."],
      resultado: "Relatório A",
    });
    expect(estado.cota?.[0]?.nome).toBe("5 horas");
  });

  it("ignora eventos repetidos, como na reconexão do SSE", () => {
    const umaVez = reproduzir(historico);
    const duasVezes = reproduzir(historico, umaVez);

    expect(duasVezes).toBe(umaVez);
  });

  it("ao concluir, guarda a resposta sem repeti-la entre os textos do orquestrador", () => {
    const concluido: EventoRegistrado = {
      tipo: "turno_concluido",
      turnoId: "t1",
      resposta: "Síntese final",
      uso: { duracaoMs: 5000, tokensDeEntrada: 10, tokensDeSaida: 5, subagentesLancados: 2 },
      sequencia: historico.length + 1,
      em: "2026-10-28T12:01:00Z",
    };
    const estado = aplicarEvento(reproduzir(historico), concluido);
    const [turno] = estado.turnos;

    expect(turno?.situacao).toBe("concluido");
    expect(turno?.resposta).toBe("Síntese final");
    expect(turno?.textosDoOrquestrador).toEqual(["Vou dividir em duas partes."]);
    expect(turno?.subagentes[1]?.situacao).toBe("cancelado");
  });

  it("registra a falha com o motivo e ações bloqueadas", () => {
    const estado = reproduzir(
      registrar([
        { tipo: "turno_iniciado", turnoId: "t1", texto: "faça o commit", configuracao },
        { tipo: "permissao_negada", turnoId: "t1", ferramenta: "PowerShell", detalhe: "git commit -m x" },
        { tipo: "ferramenta_do_orquestrador", turnoId: "t1", ferramenta: "PowerShell", detalhe: "git commit -m x" },
        { tipo: "turno_falhou", turnoId: "t1", motivo: "Limite de uso atingido." },
      ]),
    );
    const [turno] = estado.turnos;

    expect(turno?.situacao).toBe("falhou");
    expect(turno?.motivoDaFalha).toBe("Limite de uso atingido.");
    expect(turno?.permissoesNegadas).toEqual([{ ferramenta: "PowerShell", detalhe: "git commit -m x" }]);
    expect(turno?.ferramentasDiretas).toHaveLength(1);
  });

  it("registra no subagente quando ele começou e terminou, para o cronômetro", () => {
    const [turno] = reproduzir(historico).turnos;

    expect(turno?.subagentes[0]).toMatchObject({ iniciadoEm: historico[3]?.em, encerradoEm: historico[7]?.em });
    expect(turno?.subagentes[1]?.encerradoEm).toBeNull();
  });

  it("monta o log do terminal com quem fez o quê", () => {
    const [turno] = reproduzir(historico).turnos;

    expect(turno?.log.map((linha) => [linha.origem, linha.tipo])).toEqual([
      ["orquestrador", "sistema"],
      ["orquestrador", "sistema"],
      ["orquestrador", "texto"],
      ["orquestrador", "spawn"],
      ["orquestrador", "spawn"],
      ["a", "ferramenta"],
      ["a", "fim"],
      ["orquestrador", "texto"],
    ]);
    expect(turno?.log[3]?.texto).toContain("Domínio");
    expect(turno?.log[5]?.texto).toBe("Read · Lendo Periodo.ts");
  });

  it("guarda as imagens do pedido e a hora da última atividade", () => {
    const anexo = { id: "a1", nome: "tela.png", tipoDeMidia: "image/png" as const, tamanhoEmBytes: 10, arquivo: "a1.png" };
    const estado = reproduzir(
      registrar([
        { tipo: "turno_iniciado", turnoId: "t1", texto: "veja", configuracao, anexos: [anexo] },
        { tipo: "sessao_iniciada", turnoId: "t1" },
      ]),
    );
    const [turno] = estado.turnos;

    expect(turno?.anexos).toEqual([anexo]);
    expect(turno?.ultimaAtividadeEm).toBe("2026-10-28T12:00:01Z");
  });

  it("lê pedidos gravados antes de existirem imagens", () => {
    const [turno] = reproduzir(registrar([{ tipo: "turno_iniciado", turnoId: "t1", texto: "antigo", configuracao }])).turnos;

    expect(turno?.anexos).toEqual([]);
  });

  it("mantém turnos separados numa conversa com vários pedidos", () => {
    const estado = reproduzir(
      registrar([
        { tipo: "turno_iniciado", turnoId: "t1", texto: "um", configuracao },
        { tipo: "turno_cancelado", turnoId: "t1" },
        { tipo: "turno_iniciado", turnoId: "t2", texto: "dois", configuracao },
        { tipo: "turno_interrompido", turnoId: "t2" },
      ]),
    );

    expect(estado.turnos.map((turno) => [turno.texto, turno.situacao])).toEqual([
      ["um", "cancelado"],
      ["dois", "interrompido"],
    ]);
  });

  it("lê como execução os pedidos gravados antes do plan mode", () => {
    const estado = reproduzir(
      registrar([
        { tipo: "turno_iniciado", turnoId: "t1", texto: "antigo", configuracao },
        {
          tipo: "turno_concluido",
          turnoId: "t1",
          resposta: "feito",
          uso: { duracaoMs: 1000, tokensDeEntrada: 1, tokensDeSaida: 1, subagentesLancados: 0 },
        },
      ]),
    );
    const [turno] = estado.turnos;

    expect(turno).toMatchObject({ modo: "execucao", decisaoDoPlano: null });
    expect(turno?.log[0]?.texto).toMatch(/^turno iniciado/);
  });

  it("lê com commit e push bloqueados os eventos gravados antes da opção existir", () => {
    const configuracaoAntiga: DadosDaConfiguracaoGravada = {
      modeloDoOrquestrador: "opus",
      modeloDosSubagentes: "sonnet",
      quantidadeDeSubagentes: { modo: "automatica", limite: 3 },
      nivelDePermissao: "edicao_e_comandos",
    };
    const [antigo, novo] = reproduzir(
      registrar([
        { tipo: "configuracao_alterada", configuracao: configuracaoAntiga },
        { tipo: "turno_iniciado", turnoId: "t1", texto: "antigo", configuracao: configuracaoAntiga },
        { tipo: "turno_cancelado", turnoId: "t1" },
        { tipo: "turno_iniciado", turnoId: "t2", texto: "novo", configuracao: { ...configuracao, permitirCommitEPush: true } },
      ]),
    ).turnos;

    expect(antigo?.configuracao).toEqual({
      ...configuracaoAntiga,
      permitirCommitEPush: false,
      esforcoDoOrquestrador: "padrao",
      esforcoDosSubagentes: "padrao",
    });
    expect(novo?.configuracao.permitirCommitEPush).toBe(true);
  });

  it("lê com o esforço padrão do modelo os eventos gravados antes da escolha do esforço", () => {
    const configuracaoAntiga: DadosDaConfiguracaoGravada = {
      modeloDoOrquestrador: "opus",
      modeloDosSubagentes: "sonnet",
      quantidadeDeSubagentes: { modo: "automatica", limite: 3 },
      nivelDePermissao: "leitura",
      permitirCommitEPush: false,
    };
    const [antigo, novo] = reproduzir(
      registrar([
        { tipo: "turno_iniciado", turnoId: "t1", texto: "antigo", configuracao: configuracaoAntiga },
        { tipo: "turno_cancelado", turnoId: "t1" },
        {
          tipo: "turno_iniciado",
          turnoId: "t2",
          texto: "novo",
          configuracao: { ...configuracao, esforcoDoOrquestrador: "alto", esforcoDosSubagentes: "baixo" },
        },
      ]),
    ).turnos;

    expect(antigo?.configuracao).toMatchObject({ esforcoDoOrquestrador: "padrao", esforcoDosSubagentes: "padrao" });
    expect(novo?.configuracao).toMatchObject({ esforcoDoOrquestrador: "alto", esforcoDosSubagentes: "baixo" });
  });

  describe("plan mode", () => {
    const uso = { duracaoMs: 3000, tokensDeEntrada: 10, tokensDeSaida: 5, subagentesLancados: 0 };
    const planoEntregue: EventoDeOrquestracao[] = [
      { tipo: "turno_iniciado", turnoId: "t1", texto: "planeje a migração", configuracao, modo: "planejamento" },
      { tipo: "turno_concluido", turnoId: "t1", resposta: "1. Ler o domínio\n2. Migrar", uso },
    ];

    it("o plano entregue fica pendente de decisão", () => {
      const em = reproduzir(registrar(planoEntregue.slice(0, 1))).turnos[0];
      const [turno] = reproduzir(registrar(planoEntregue)).turnos;

      expect(em).toMatchObject({ modo: "planejamento", decisaoDoPlano: null });
      expect(turno).toMatchObject({ situacao: "concluido", decisaoDoPlano: "pendente", resposta: "1. Ler o domínio\n2. Migrar" });
      expect(turno?.log[0]?.texto).toMatch(/^plan mode · turno iniciado/);
    });

    it("ao aprovar, marca o plano e o novo turno de execução segue separado", () => {
      const estado = reproduzir(
        registrar([
          ...planoEntregue,
          { tipo: "plano_aprovado", turnoId: "t1" },
          { tipo: "turno_iniciado", turnoId: "t2", texto: "Execute o plano aprovado.", configuracao, modo: "execucao" },
        ]),
      );
      const [plano, execucao] = estado.turnos;

      expect(plano?.decisaoDoPlano).toBe("aprovado");
      expect(plano?.log.at(-1)).toMatchObject({ tipo: "fim", texto: "plano aprovado · execução iniciada" });
      expect(execucao).toMatchObject({ modo: "execucao", situacao: "em_andamento", decisaoDoPlano: null });
    });

    it("ao descartar, marca o plano como descartado", () => {
      const [turno] = reproduzir(registrar([...planoEntregue, { tipo: "plano_descartado", turnoId: "t1" }])).turnos;

      expect(turno?.decisaoDoPlano).toBe("descartado");
      expect(turno?.log.at(-1)).toMatchObject({ tipo: "sistema", texto: "plano descartado" });
    });

    it("plano que não chegou ao fim não fica pendente", () => {
      const [turno] = reproduzir(
        registrar([...planoEntregue.slice(0, 1), { tipo: "turno_cancelado", turnoId: "t1" }]),
      ).turnos;

      expect(turno).toMatchObject({ situacao: "cancelado", decisaoDoPlano: null });
    });
  });
});
