import type {
  DadosDaConfiguracao,
  DadosDaConfiguracaoGravada,
  DadosDoPedidoNaFila,
  EventoDeOrquestracao,
  EventoRegistrado,
  ModoDoTurno,
} from "../api/tipos";
import { aplicarEvento, ESTADO_INICIAL, type EstadoDaConversa, filaDePedidos } from "./aplicarEvento";

const configuracao: DadosDaConfiguracao = {
  modeloDoOrquestrador: "opus",
  esforcoDoOrquestrador: "padrao",
  modeloDosSubagentes: "sonnet",
  esforcoDosSubagentes: "padrao",
  quantidadeDeSubagentes: { modo: "automatica", limite: 3 },
  nivelDePermissao: "leitura",
  permitirCommitEPush: false,
  permitirArtefatosOnline: false,
  instrucoesPersonalizadas: "",
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

  it("no log, o subagente aparece pelo tipo; eventos antigos sem tipo valem executor", () => {
    const [turno] = reproduzir(
      registrar([
        { tipo: "turno_iniciado", turnoId: "t1", texto: "conte", configuracao },
        { tipo: "subagente_iniciado", turnoId: "t1", subagenteId: "abcd1234", descricao: "Contar", tarefa: "x", papel: "contador-de-linhas" },
        { tipo: "subagente_iniciado", turnoId: "t1", subagenteId: "efgh5678", descricao: "Ler", tarefa: "y" },
      ]),
    ).turnos;

    const spawns = turno?.log.filter((linha) => linha.tipo === "spawn").map((linha) => linha.texto) ?? [];
    expect(spawns[0]).toMatch(/^instanciou contador-de-linhas#/);
    expect(spawns[1]).toMatch(/^instanciou executor#/);
  });

  it("guarda o papel do subagente para o bixinho; eventos antigos sem o campo ficam sem papel", () => {
    const [turno] = reproduzir(
      registrar([
        { tipo: "turno_iniciado", turnoId: "t1", texto: "conte", configuracao },
        { tipo: "subagente_iniciado", turnoId: "t1", subagenteId: "a", descricao: "Contar", tarefa: "x", papel: "contador-de-linhas" },
        { tipo: "subagente_iniciado", turnoId: "t1", subagenteId: "b", descricao: "Ler", tarefa: "y", papel: "executor" },
        { tipo: "subagente_iniciado", turnoId: "t1", subagenteId: "c", descricao: "Antigo", tarefa: "z" },
      ]),
    ).turnos;

    expect(turno?.subagentes.map((subagente) => [subagente.id, subagente.papel])).toEqual([
      ["a", "contador-de-linhas"],
      ["b", "executor"],
      ["c", null],
    ]);
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

  it("guarda documentos do pedido com a categoria, e anexos antigos seguem sem ela", () => {
    const documento = {
      id: "a2",
      nome: "contrato.pdf",
      categoria: "documento" as const,
      tipoDeMidia: "application/pdf",
      tamanhoEmBytes: 2048,
      arquivo: "a2.pdf",
    };
    const antigo = { id: "a1", nome: "tela.png", tipoDeMidia: "image/png", tamanhoEmBytes: 10, arquivo: "a1.png" };
    const [turno] = reproduzir(
      registrar([{ tipo: "turno_iniciado", turnoId: "t1", texto: "leia", configuracao, anexos: [antigo, documento] }]),
    ).turnos;

    expect(turno?.anexos).toEqual([antigo, documento]);
    expect(turno?.anexos[0]?.categoria).toBeUndefined();
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
      permitirArtefatosOnline: false,
      esforcoDoOrquestrador: "padrao",
      esforcoDosSubagentes: "padrao",
      instrucoesPersonalizadas: "",
    });
    expect(novo?.configuracao.permitirCommitEPush).toBe(true);
  });

  it("lê sem instruções personalizadas os eventos gravados antes delas e mantém as dos novos", () => {
    const configuracaoAntiga: DadosDaConfiguracaoGravada = {
      modeloDoOrquestrador: "opus",
      modeloDosSubagentes: "sonnet",
      quantidadeDeSubagentes: { modo: "automatica", limite: 3 },
      nivelDePermissao: "leitura",
    };
    const [antigo, novo] = reproduzir(
      registrar([
        { tipo: "turno_iniciado", turnoId: "t1", texto: "antigo", configuracao: configuracaoAntiga },
        { tipo: "turno_cancelado", turnoId: "t1" },
        {
          tipo: "turno_iniciado",
          turnoId: "t2",
          texto: "novo",
          configuracao: { ...configuracao, instrucoesPersonalizadas: "Comece com PIRULITO." },
        },
      ]),
    ).turnos;

    expect(antigo?.configuracao.instrucoesPersonalizadas).toBe("");
    expect(novo?.configuracao.instrucoesPersonalizadas).toBe("Comece com PIRULITO.");
  });

  it("ferramenta usada pelo próprio orquestrador vira uma linha normal de atividade, com o verbo da ferramenta", () => {
    const [turno] = reproduzir(
      registrar([
        { tipo: "turno_iniciado", turnoId: "t1", texto: "veja o package.json", configuracao },
        { tipo: "ferramenta_do_orquestrador", turnoId: "t1", ferramenta: "Read", detalhe: "package.json" },
        { tipo: "ferramenta_do_orquestrador", turnoId: "t1", ferramenta: "Grep", detalhe: "useMemo" },
        { tipo: "ferramenta_do_orquestrador", turnoId: "t1", ferramenta: "Glob", detalhe: "src/**/*.ts" },
        { tipo: "ferramenta_do_orquestrador", turnoId: "t1", ferramenta: "PowerShell", detalhe: "git status" },
        { tipo: "ferramenta_do_orquestrador", turnoId: "t1", ferramenta: "Bash", detalhe: "ls" },
        { tipo: "ferramenta_do_orquestrador", turnoId: "t1", ferramenta: "WebFetch", detalhe: "https://exemplo.com" },
        { tipo: "ferramenta_do_orquestrador", turnoId: "t1", ferramenta: "WebSearch", detalhe: "vitest" },
        { tipo: "ferramenta_do_orquestrador", turnoId: "t1", ferramenta: "TodoWrite", detalhe: "" },
      ]),
    ).turnos;

    expect(turno?.log.slice(1).map((linha) => [linha.origem, linha.tipo, linha.texto])).toEqual([
      ["orquestrador", "ferramenta", "lendo package.json"],
      ["orquestrador", "ferramenta", "buscando useMemo"],
      ["orquestrador", "ferramenta", "listando src/**/*.ts"],
      ["orquestrador", "ferramenta", "executando git status"],
      ["orquestrador", "ferramenta", "executando ls"],
      ["orquestrador", "ferramenta", "abrindo https://exemplo.com"],
      ["orquestrador", "ferramenta", "pesquisando vitest"],
      ["orquestrador", "ferramenta", "usando TodoWrite"],
    ]);
    expect(turno?.log.some((linha) => linha.tipo === "erro")).toBe(false);
    expect(turno?.ferramentasDiretas).toHaveLength(8);
  });

  describe("tarefas do orquestrador", () => {
    it("guarda a última lista do turno, que substitui a anterior, com uma linha de atividade por atualização", () => {
      const [turno] = reproduzir(
        registrar([
          { tipo: "turno_iniciado", turnoId: "t1", texto: "corrija o bug", configuracao },
          {
            tipo: "tarefas_atualizadas",
            turnoId: "t1",
            tarefas: [
              { texto: "Lendo o código", situacao: "em_andamento" },
              { texto: "Rodar os testes", situacao: "pendente" },
            ],
          },
          {
            tipo: "tarefas_atualizadas",
            turnoId: "t1",
            tarefas: [
              { texto: "Ler o código", situacao: "concluida" },
              { texto: "Rodando os testes", situacao: "em_andamento" },
              { texto: "Atualizar o README", situacao: "pendente" },
            ],
          },
        ]),
      ).turnos;

      expect(turno?.tarefas).toEqual([
        { texto: "Ler o código", situacao: "concluida" },
        { texto: "Rodando os testes", situacao: "em_andamento" },
        { texto: "Atualizar o README", situacao: "pendente" },
      ]);
      expect(turno?.log.slice(1).map((linha) => [linha.tipo, linha.texto])).toEqual([
        ["ferramenta", "tarefas: 0 de 2 concluídas · Lendo o código"],
        ["ferramenta", "tarefas: 1 de 3 concluídas · Rodando os testes"],
      ]);
      expect(turno?.ferramentasDiretas).toEqual([]);
    });

    it("sem o evento (histórico antigo), o turno fica sem tarefas", () => {
      const [turno] = reproduzir(historico).turnos;

      expect(turno?.tarefas).toEqual([]);
    });
  });

  describe("orquestrador renomeado", () => {
    it("guarda o nome mais recente sem mexer nos turnos, também durante um pedido e depois do /clear", () => {
      const eventos = registrar([
        { tipo: "turno_iniciado", turnoId: "t1", texto: "analise", configuracao },
        { tipo: "orquestrador_renomeado", nome: "Primeiro" },
        { tipo: "orquestrador_renomeado", nome: "Segundo" },
        { tipo: "turno_cancelado", turnoId: "t1" },
        { tipo: "conversa_limpa", turnosAnteriores: 1, planoDescartado: false, worktreeComAlteracoes: false },
      ]);

      const durante = reproduzir(eventos.slice(0, 3));
      expect(ESTADO_INICIAL.nome).toBeNull();
      expect(durante.nome).toBe("Segundo");
      expect(durante.ultimaSequencia).toBe(3);
      expect(durante.turnos.map((turno) => [turno.id, turno.situacao, turno.log.length])).toEqual([
        ["t1", "em_andamento", 1],
      ]);
      expect(reproduzir(eventos).nome).toBe("Segundo");
    });

    it("um evento repetido (reconexão) não volta o nome", () => {
      const [antigo, novo] = registrar([
        { tipo: "orquestrador_renomeado", nome: "Antigo" },
        { tipo: "orquestrador_renomeado", nome: "Novo" },
      ]);

      expect(reproduzir([antigo!, novo!, antigo!]).nome).toBe("Novo");
    });
  });

  describe("conversa nova (/clear)", () => {
    const cota =[{ nome: "5 horas", utilizacao: 0.2, renovaEm: null, situacao: "allowed" }];
    const anterior = registrar([
      { tipo: "turno_iniciado", turnoId: "t1", texto: "um", configuracao },
      { tipo: "uso_da_cota", turnoId: "t1", janelas: cota },
      {
        tipo: "turno_concluido",
        turnoId: "t1",
        resposta: "feito",
        uso: { duracaoMs: 1000, tokensDeEntrada: 1, tokensDeSaida: 1, subagentesLancados: 0 },
      },
      { tipo: "conversa_limpa", turnosAnteriores: 1, planoDescartado: false, worktreeComAlteracoes: false },
    ]);

    it("esvazia os pedidos, mantém a sequência e a cota e marca quando a conversa começou", () => {
      const antes = reproduzir(anterior.slice(0, 3));
      const estado = reproduzir(anterior);

      expect(antes.conversaIniciadaEm).toBeNull();
      expect(estado.turnos).toEqual([]);
      expect(estado.ultimaSequencia).toBe(4);
      expect(estado.cota).toEqual(cota);
      expect(estado.conversaIniciadaEm).toBe(anterior[3]?.em);
      expect(antes.avisosDaConversaNova).toEqual({ worktreeComAlteracoes: false, planoDescartado: false });
      expect(estado.avisosDaConversaNova).toEqual({ worktreeComAlteracoes: false, planoDescartado: false });
    });

    it("guarda os avisos do /clear (worktree alterada, plano descartado) até o próximo /clear", () => {
      const comAvisos = registrar([
        { tipo: "turno_iniciado", turnoId: "t1", texto: "um", configuracao },
        { tipo: "conversa_limpa", turnosAnteriores: 1, planoDescartado: true, worktreeComAlteracoes: true },
        { tipo: "turno_iniciado", turnoId: "t2", texto: "dois", configuracao },
        { tipo: "turno_cancelado", turnoId: "t2" },
      ]);
      const segundo: EventoRegistrado = {
        tipo: "conversa_limpa",
        turnosAnteriores: 1,
        planoDescartado: false,
        worktreeComAlteracoes: true,
        sequencia: comAvisos.length + 1,
        em: "2026-10-28T12:10:00Z",
      };

      const depois = reproduzir(comAvisos);
      expect(depois.avisosDaConversaNova).toEqual({ worktreeComAlteracoes: true, planoDescartado: true });
      expect(aplicarEvento(depois, segundo).avisosDaConversaNova).toEqual({
        worktreeComAlteracoes: true,
        planoDescartado: false,
      });
    });

    it("o pedido seguinte aparece sozinho na conversa nova", () => {
      const estado = reproduzir([
        ...anterior,
        {
          tipo: "turno_iniciado",
          turnoId: "t2",
          texto: "dois",
          configuracao,
          sequencia: 5,
          em: "2026-10-28T12:10:00Z",
        },
      ]);

      expect(estado.turnos.map((turno) => [turno.id, turno.situacao])).toEqual([["t2", "em_andamento"]]);
      expect(estado.conversaIniciadaEm).toBe(anterior[3]?.em);
    });

    it("repetido na reconexão, não muda nada", () => {
      const estado = reproduzir(anterior);

      expect(reproduzir(anterior, estado)).toBe(estado);
    });
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

  describe("perguntas com opções", () => {
    const uso = { duracaoMs: 3000, tokensDeEntrada: 10, tokensDeSaida: 5, subagentesLancados: 0 };
    const perguntas = [
      {
        pergunta: "Qual banco usar?",
        opcoes: [
          { rotulo: "PostgreSQL", descricao: "Relacional" },
          { rotulo: "SQLite", descricao: null },
        ],
        multipla: false,
      },
    ];

    it("o turno concluído guarda as perguntas; sem o campo (evento antigo), ficam vazias", () => {
      const [comPerguntas, semCampo] = reproduzir(
        registrar([
          { tipo: "turno_iniciado", turnoId: "t1", texto: "crie o cadastro", configuracao },
          { tipo: "turno_concluido", turnoId: "t1", resposta: "Antes, uma dúvida.", uso, perguntas },
          { tipo: "turno_iniciado", turnoId: "t2", texto: "Qual banco usar? → SQLite", configuracao },
          { tipo: "turno_concluido", turnoId: "t2", resposta: "Feito.", uso },
        ]),
      ).turnos;

      expect(comPerguntas).toMatchObject({ situacao: "concluido", resposta: "Antes, uma dúvida.", perguntas });
      expect(semCampo?.perguntas).toEqual([]);
    });

    it("o bloco cru da pergunta não aparece no log nem nos textos do orquestrador", () => {
      const [turno] = reproduzir(
        registrar([
          { tipo: "turno_iniciado", turnoId: "t1", texto: "crie o cadastro", configuracao },
          { tipo: "texto_do_orquestrador", turnoId: "t1", texto: "```pergunta-do-app\n{\"perguntas\":[]}\n```" },
          { tipo: "texto_do_orquestrador", turnoId: "t1", texto: "```pergunta-do-app\n{\"perguntas\":[" },
          { tipo: "texto_do_orquestrador", turnoId: "t1", texto: "Antes, uma dúvida.\n```pergunta-do-app\n{}\n```" },
        ]),
      ).turnos;

      expect(turno?.textosDoOrquestrador).toEqual(["Antes, uma dúvida."]);
      expect(turno?.log.filter((linha) => linha.tipo === "texto").map((linha) => linha.texto)).toEqual([
        "Antes, uma dúvida.",
      ]);
      expect(turno?.log.some((linha) => linha.texto.includes("pergunta-do-app"))).toBe(false);
    });
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

    it("plano proposto num pedido de execução também fica pendente, com a linha de aguardando aprovação", () => {
      const [turno] = reproduzir(
        registrar([
          { tipo: "turno_iniciado", turnoId: "t1", texto: "migre o projeto inteiro", configuracao },
          { tipo: "turno_concluido", turnoId: "t1", resposta: "1. Ler\n2. Migrar", uso, planoPendente: true },
        ]),
      ).turnos;

      expect(turno).toMatchObject({ modo: "execucao", situacao: "concluido", decisaoDoPlano: "pendente" });
      expect(turno?.log.at(-1)?.texto).toMatch(/^plano proposto · aguardando aprovação · /);
    });

    it("com o campo informado, vale o que o servidor diz", () => {
      const [execucao, planejamento] = reproduzir(
        registrar([
          { tipo: "turno_iniciado", turnoId: "t1", texto: "corrija", configuracao },
          { tipo: "turno_concluido", turnoId: "t1", resposta: "feito", uso, planoPendente: false },
          { tipo: "turno_iniciado", turnoId: "t2", texto: "planeje", configuracao, modo: "planejamento" },
          { tipo: "turno_concluido", turnoId: "t2", resposta: "1. Ler", uso, planoPendente: true },
        ]),
      ).turnos;

      expect(execucao?.decisaoDoPlano).toBeNull();
      expect(execucao?.log.at(-1)?.texto).toMatch(/^síntese entregue/);
      expect(planejamento?.decisaoDoPlano).toBe("pendente");
      expect(planejamento?.log.at(-1)?.texto).toMatch(/^síntese entregue/);
    });

    it("sem o campo (eventos antigos), só o plan mode deixa plano pendente", () => {
      const [execucao] = reproduzir(
        registrar([
          { tipo: "turno_iniciado", turnoId: "t1", texto: "corrija", configuracao },
          { tipo: "turno_concluido", turnoId: "t1", resposta: "feito", uso },
        ]),
      ).turnos;
      const [plano] = reproduzir(registrar(planoEntregue)).turnos;

      expect(execucao?.decisaoDoPlano).toBeNull();
      expect(plano?.decisaoDoPlano).toBe("pendente");
    });

    it("plano que não chegou ao fim não fica pendente", () => {
      const [turno] = reproduzir(
        registrar([...planoEntregue.slice(0, 1), { tipo: "turno_cancelado", turnoId: "t1" }]),
      ).turnos;

      expect(turno).toMatchObject({ situacao: "cancelado", decisaoDoPlano: null });
    });
  });

  describe("servidores de desenvolvimento", () => {
    const usoDoTurno = { duracaoMs: 1000, tokensDeEntrada: 10, tokensDeSaida: 5, subagentesLancados: 0 };

    it("guarda o endereço detectado pelo servidor e deixa uma linha no terminal", () => {
      const estado = reproduzir(
        registrar([
          { tipo: "turno_iniciado", turnoId: "t1", texto: "suba o site", configuracao },
          { tipo: "endereco_local_detectado", turnoId: "t1", url: "http://localhost:5173" },
        ]),
      );

      expect(estado.enderecosLocais).toEqual(["http://localhost:5173"]);
      expect(estado.turnos[0]?.log.at(-1)).toMatchObject({
        origem: "orquestrador",
        tipo: "sistema",
        texto: "servidor no ar em http://localhost:5173",
      });
    });

    it("só o evento do servidor conta: endereços citados no texto ou na resposta não viram servidor no ar", () => {
      const estado = reproduzir(
        registrar([
          { tipo: "turno_iniciado", turnoId: "t1", texto: "suba o site", configuracao },
          { tipo: "texto_do_orquestrador", turnoId: "t1", texto: "Configure o CORS para http://localhost:8080." },
          { tipo: "endereco_local_detectado", turnoId: "t1", url: "http://localhost:5173" },
          { tipo: "turno_concluido", turnoId: "t1", resposta: "O backend deve rodar em http://localhost:3000", uso: usoDoTurno },
        ]),
      );

      expect(estado.enderecosLocais).toEqual(["http://localhost:5173"]);
    });

    it("guarda o endereço do evento como veio, sem repetir, o mais recente por último", () => {
      const estado = reproduzir(
        registrar([
          { tipo: "turno_iniciado", turnoId: "t1", texto: "suba o site", configuracao },
          { tipo: "endereco_local_detectado", turnoId: "t1", url: "http://localhost:5173/foo_" },
          { tipo: "endereco_local_detectado", turnoId: "t1", url: "http://localhost:3001" },
          { tipo: "endereco_local_detectado", turnoId: "t1", url: "http://localhost:5173/foo_" },
        ]),
      );

      expect(estado.enderecosLocais).toEqual(["http://localhost:3001", "http://localhost:5173/foo_"]);
    });

    it("descarta o evento com um endereço que não é http(s) local", () => {
      const estado = reproduzir(
        registrar([
          { tipo: "turno_iniciado", turnoId: "t1", texto: "suba o site", configuracao },
          { tipo: "endereco_local_detectado", turnoId: "t1", url: "javascript:alert(document.cookie)" },
          { tipo: "endereco_local_detectado", turnoId: "t1", url: "https://example.com:443" },
        ]),
      );

      expect(estado.enderecosLocais).toEqual([]);
    });

    it("eventos sem endereço não trocam a lista", () => {
      const comEndereco = reproduzir(
        registrar([
          { tipo: "turno_iniciado", turnoId: "t1", texto: "suba o site", configuracao },
          { tipo: "endereco_local_detectado", turnoId: "t1", url: "http://localhost:5173" },
        ]),
      );
      const depois = aplicarEvento(comEndereco, {
        tipo: "texto_do_orquestrador",
        turnoId: "t1",
        texto: "Tudo certo.",
        sequencia: comEndereco.ultimaSequencia + 1,
        em: "2026-10-28T12:01:00Z",
      });

      expect(depois.enderecosLocais).toBe(comEndereco.enderecosLocais);
    });

    it("a conversa nova esquece os endereços", () => {
      const estado = reproduzir(
        registrar([
          { tipo: "turno_iniciado", turnoId: "t1", texto: "suba o site", configuracao },
          { tipo: "endereco_local_detectado", turnoId: "t1", url: "http://localhost:5173" },
          { tipo: "conversa_limpa", turnosAnteriores: 1, planoDescartado: false, worktreeComAlteracoes: false },
        ]),
      );

      expect(estado.enderecosLocais).toEqual([]);
      expect(estado.ultimoEnderecoDaResposta).toBeNull();
      expect(estado.ultimoFimDeTurno).toBeNull();
    });

    it("só o endereço citado na resposta (origem resposta) vira a abertura automática, com a sequência e a hora", () => {
      const eventos = registrar([
        { tipo: "turno_iniciado", turnoId: "t1", texto: "suba o site", configuracao },
        { tipo: "endereco_local_detectado", turnoId: "t1", url: "http://localhost:5173", origem: "resposta" },
        { tipo: "texto_do_orquestrador", turnoId: "t1", texto: "Pronto." },
      ]);
      const estado = reproduzir(eventos);

      expect(estado.ultimoEnderecoDaResposta).toEqual({
        url: "http://localhost:5173",
        sequencia: eventos[1]?.sequencia,
        em: eventos[1]?.em,
      });
      expect(estado.enderecosLocais).toEqual(["http://localhost:5173"]);
    });

    it("origem ferramenta e a falta de origem só entram na faixa de servidores, sem abertura automática", () => {
      const estado = reproduzir(
        registrar([
          { tipo: "turno_iniciado", turnoId: "t1", texto: "teste a API", configuracao },
          { tipo: "endereco_local_detectado", turnoId: "t1", url: "http://localhost:3000", origem: "ferramenta" },
          { tipo: "endereco_local_detectado", turnoId: "t1", url: "http://localhost:5173" },
        ]),
      );

      expect(estado.enderecosLocais).toEqual(["http://localhost:3000", "http://localhost:5173"]);
      expect(estado.ultimoEnderecoDaResposta).toBeNull();
      expect(estado.turnos[0]?.enderecosDaResposta).toBeUndefined();
    });

    it("guarda a sequência do último anúncio de cada endereço, e só dos que seguem na lista", () => {
      const eventos = registrar([
        { tipo: "turno_iniciado", turnoId: "t1", texto: "suba", configuracao },
        { tipo: "endereco_local_detectado", turnoId: "t1", url: "http://localhost:3000" },
        { tipo: "endereco_local_detectado", turnoId: "t1", url: "http://localhost:5173" },
        { tipo: "endereco_local_detectado", turnoId: "t1", url: "http://localhost:3000" },
      ]);
      const estado = reproduzir(eventos);

      expect(estado.sequenciasDosEnderecos).toEqual({
        "http://localhost:3000": eventos[3]?.sequencia,
        "http://localhost:5173": eventos[2]?.sequencia,
      });

      const limpa = reproduzir(
        registrar([
          { tipo: "turno_iniciado", turnoId: "t1", texto: "suba", configuracao },
          { tipo: "endereco_local_detectado", turnoId: "t1", url: "http://localhost:3000" },
          { tipo: "conversa_limpa", turnosAnteriores: 1, planoDescartado: false, worktreeComAlteracoes: false },
        ]),
      );
      expect(limpa.sequenciasDosEnderecos).toEqual({});
    });

    it("uma ferramenta depois da citação na resposta não apaga a abertura automática", () => {
      const estado = reproduzir(
        registrar([
          { tipo: "turno_iniciado", turnoId: "t1", texto: "suba o site", configuracao },
          { tipo: "endereco_local_detectado", turnoId: "t1", url: "http://localhost:5173", origem: "resposta" },
          { tipo: "endereco_local_detectado", turnoId: "t1", url: "http://localhost:3000", origem: "ferramenta" },
        ]),
      );

      expect(estado.ultimoEnderecoDaResposta?.url).toBe("http://localhost:5173");
    });
  });

  describe("fim do turno e prévias do agente", () => {
    const uso = { duracaoMs: 1000, tokensDeEntrada: 10, tokensDeSaida: 5, subagentesLancados: 0 };

    it("guarda o fim do turno com o início, os endereços citados na resposta e as prévias a fechar", () => {
      const eventos = registrar([
        { tipo: "turno_iniciado", turnoId: "t1", texto: "mostre o painel", configuracao },
        { tipo: "endereco_local_detectado", turnoId: "t1", url: "http://localhost:5173", origem: "resposta" },
        { tipo: "endereco_local_detectado", turnoId: "t1", url: "http://localhost:3000", origem: "ferramenta" },
        {
          tipo: "turno_concluido",
          turnoId: "t1",
          resposta: "Pronto.",
          uso,
          previasParaFechar: ["http://localhost:4000", "javascript:alert(1)"],
        },
      ]);
      const estado = reproduzir(eventos);

      expect(estado.ultimoFimDeTurno).toEqual({
        sequencia: eventos[3]?.sequencia,
        em: eventos[3]?.em,
        iniciadoEm: eventos[0]?.em,
        enderecosCitados: ["http://localhost:5173"],
        previasParaFechar: ["http://localhost:4000"],
      });
    });

    it("sem o campo previasParaFechar, o turno concluído não pede fechamento de nenhum endereço", () => {
      const estado = reproduzir(
        registrar([
          { tipo: "turno_iniciado", turnoId: "t1", texto: "oi", configuracao },
          { tipo: "turno_concluido", turnoId: "t1", resposta: "Olá.", uso },
        ]),
      );

      expect(estado.ultimoFimDeTurno).toMatchObject({ enderecosCitados: [], previasParaFechar: [] });
    });

    it("turno cancelado ou falho também termina o turno, sem prévias a fechar", () => {
      const cancelado = reproduzir(
        registrar([
          { tipo: "turno_iniciado", turnoId: "t1", texto: "oi", configuracao },
          { tipo: "turno_cancelado", turnoId: "t1" },
        ]),
      );
      const falho = reproduzir(
        registrar([
          { tipo: "turno_iniciado", turnoId: "t1", texto: "oi", configuracao },
          { tipo: "turno_falhou", turnoId: "t1", motivo: "erro" },
        ]),
      );

      expect(cancelado.ultimoFimDeTurno?.previasParaFechar).toEqual([]);
      expect(falho.ultimoFimDeTurno?.sequencia).toBe(2);
    });

    it("o endereço citado por um turno não vale para o seguinte", () => {
      const estado = reproduzir(
        registrar([
          { tipo: "turno_iniciado", turnoId: "t1", texto: "mostre", configuracao },
          { tipo: "endereco_local_detectado", turnoId: "t1", url: "http://localhost:5173", origem: "resposta" },
          { tipo: "turno_concluido", turnoId: "t1", resposta: "Veja.", uso },
          { tipo: "turno_iniciado", turnoId: "t2", texto: "ajuste", configuracao },
          { tipo: "turno_concluido", turnoId: "t2", resposta: "Feito.", uso },
        ]),
      );

      expect(estado.ultimoFimDeTurno?.enderecosCitados).toEqual([]);
      expect(estado.turnos[0]?.enderecosDaResposta).toEqual(["http://localhost:5173"]);
    });

    it("a conversa nova esquece o fim do turno", () => {
      const estado = reproduzir(
        registrar([
          { tipo: "turno_iniciado", turnoId: "t1", texto: "oi", configuracao },
          { tipo: "turno_concluido", turnoId: "t1", resposta: "Olá.", uso },
          { tipo: "conversa_limpa", turnosAnteriores: 1, planoDescartado: false, worktreeComAlteracoes: false },
        ]),
      );

      expect(estado.ultimoFimDeTurno).toBeNull();
    });

    it("o bloco cru das prévias a fechar não aparece no log nem nos textos do orquestrador", () => {
      const [turno] = reproduzir(
        registrar([
          { tipo: "turno_iniciado", turnoId: "t1", texto: "feche a prévia", configuracao },
          { tipo: "texto_do_orquestrador", turnoId: "t1", texto: "```previa-do-app\n{\"fechar\":[\"http://localhost:5173\"]}\n```" },
          { tipo: "texto_do_orquestrador", turnoId: "t1", texto: "```previa-do-app\n{\"fechar\":[" },
          { tipo: "texto_do_orquestrador", turnoId: "t1", texto: "Pronto.\n```previa-do-app\n{}\n```" },
        ]),
      ).turnos;

      expect(turno?.textosDoOrquestrador).toEqual(["Pronto."]);
      expect(turno?.log.some((linha) => linha.texto.includes("previa-do-app"))).toBe(false);
    });
  });

  describe("consumo medido do turno", () => {
    const consumo = {
      principal: { entrada: 1000, criacaoDeCache: 2000, leituraDeCache: 50_000, saida: 300 },
      subagentes: { entrada: 500, criacaoDeCache: 0, leituraDeCache: 10_000, saida: 100 },
      subagentesMedidos: 1,
      parcial: false,
      indiceDeCusto: 12_500,
      modeloDoPrincipal: "claude-opus-5-5",
    };
    const turnoConcluido = registrar([
      { tipo: "turno_iniciado", turnoId: "t1", texto: "corrija", configuracao },
      {
        tipo: "turno_concluido",
        turnoId: "t1",
        resposta: "feito",
        uso: { duracaoMs: 1000, tokensDeEntrada: 1, tokensDeSaida: 1, subagentesLancados: 0 },
      },
    ]);

    it("começa sem consumo e guarda o medido no turno, depois do fim, sem linha nova no log", () => {
      const antes = reproduzir(turnoConcluido);
      const depois = aplicarEvento(antes, {
        tipo: "consumo_do_turno_medido",
        turnoId: "t1",
        consumo,
        sequencia: 3,
        em: "2026-10-28T12:01:00Z",
      });

      expect(antes.turnos[0]?.consumo).toBeNull();
      expect(depois.turnos[0]?.consumo).toEqual(consumo);
      expect(depois.turnos[0]?.situacao).toBe("concluido");
      expect(depois.turnos[0]?.log).toHaveLength(antes.turnos[0]?.log.length ?? -1);
    });

    it("evento repetido é ignorado e turno desconhecido não muda nenhum turno", () => {
      const medido: EventoRegistrado = {
        tipo: "consumo_do_turno_medido",
        turnoId: "t1",
        consumo,
        sequencia: 3,
        em: "2026-10-28T12:01:00Z",
      };
      const umaVez = aplicarEvento(reproduzir(turnoConcluido), medido);
      expect(aplicarEvento(umaVez, medido)).toBe(umaVez);

      const desconhecido = aplicarEvento(umaVez, { ...medido, turnoId: "outro", sequencia: 4 });
      expect(desconhecido.ultimaSequencia).toBe(4);
      expect(desconhecido.turnos).toHaveLength(1);
      expect(desconhecido.turnos[0]).toBe(umaVez.turnos[0]);
    });
  });

  describe("autorrecuperação do turno", () => {
    // No fuso do computador: a linha mostra a hora local da retomada.
    const local = (hora: number, minuto: number) => new Date(2026, 9, 28, hora, minuto).toISOString();
    const base = { causa: "silencio" as const, tentativa: 1, de: 2, retomaEm: null };
    const travado: EventoRegistrado[] = [
      { tipo: "turno_iniciado", turnoId: "t1", texto: "corrija o bug", configuracao, sequencia: 1, em: local(14, 0) },
      {
        tipo: "recuperacao_do_turno",
        turnoId: "t1",
        etapa: "encerrado",
        ...base,
        resumo: "sem saída há 5 min, sem CPU",
        sequencia: 2,
        em: local(14, 30),
      },
      { tipo: "turno_falhou", turnoId: "t1", motivo: "O Claude ficou em silêncio.", sequencia: 3, em: local(14, 30) },
      {
        tipo: "recuperacao_do_turno",
        turnoId: "t1",
        etapa: "aguardando",
        ...base,
        resumo: "retomo em 2 min",
        retomaEm: local(14, 32),
        sequencia: 4,
        em: local(14, 30),
      },
    ];
    const textosDoLog = (estado: EstadoDaConversa, indice = 0) => estado.turnos[indice]?.log.map((linha) => [linha.tipo, linha.texto]);

    it("cada etapa deixa uma linha curta no log e o turno guarda a última", () => {
      const estado = reproduzir(travado);

      expect(textosDoLog(estado)?.slice(1)).toEqual([
        ["erro", "travado: sem saída há 5 min, sem CPU · encerrado (tentativa 1 de 2)"],
        ["erro", "falhou · O Claude ficou em silêncio."],
        ["sistema", "retoma às 14:32 (Claude em silêncio) · tentativa 1 de 2"],
      ]);
      expect(estado.turnos[0]?.recuperacao).toEqual({
        etapa: "aguardando",
        causa: "silencio",
        tentativa: 1,
        de: 2,
        resumo: "retomo em 2 min",
        retomaEm: local(14, 32),
        em: local(14, 30),
      });
    });

    it("retomando, cancelada e desistiu; causas da API com o nome legível", () => {
      const etapa = (
        sequencia: number,
        etapa: "retomando" | "cancelada" | "desistiu" | "encerrado" | "aguardando",
        extra: Partial<Extract<EventoRegistrado, { tipo: "recuperacao_do_turno" }>> = {},
      ): EventoRegistrado => ({
        tipo: "recuperacao_do_turno",
        turnoId: "t1",
        etapa,
        ...base,
        resumo: "detalhe",
        sequencia,
        em: local(14, 31),
        ...extra,
      });
      const estado = reproduzir([
        ...travado,
        etapa(5, "retomando"),
        etapa(6, "cancelada"),
        etapa(7, "desistiu", { resumo: "Tentei 2 vezes e o Claude travou nas duas.\nÚltimo comando: npm test" }),
        etapa(8, "aguardando", { causa: "limite_de_uso", retomaEm: null }),
        etapa(9, "encerrado", { causa: "sobrecarga", tentativa: 2, de: 3, resumo: "a API respondeu 529" }),
      ]);

      expect(textosDoLog(estado)?.slice(4)).toEqual([
        ["sistema", "retomando sozinho (tentativa 1 de 2)"],
        ["sistema", "retomada cancelada"],
        ["erro", "não consegui retomar · Tentei 2 vezes e o Claude travou nas duas."],
        ["sistema", "retoma em instantes (limite de uso) · tentativa 1 de 2"],
        ["erro", "API sobrecarregada: a API respondeu 529 · encerrado (tentativa 2 de 3)"],
      ]);
      expect(estado.turnos[0]?.recuperacao?.etapa).toBe("encerrado");
    });

    it("conta como atividade do turno a que pertence (a cota não conta)", () => {
      const iniciado = reproduzir(travado.slice(0, 1));
      const comCota = aplicarEvento(iniciado, {
        tipo: "uso_da_cota",
        turnoId: "t1",
        janelas: [],
        sequencia: 2,
        em: local(14, 10),
      });
      expect(comCota.turnos[0]?.ultimaAtividadeEm).toBe(local(14, 0));

      const recuperando = aplicarEvento(comCota, { ...travado[1]!, sequencia: 3 } as EventoRegistrado);
      expect(recuperando.turnos[0]?.ultimaAtividadeEm).toBe(local(14, 30));
    });

    it("o turno aberto para retomar fica marcado como retomada; os pedidos comuns não", () => {
      const estado = reproduzir([
        ...travado,
        {
          tipo: "turno_iniciado",
          turnoId: "t2",
          texto: "Continue de onde parou.",
          configuracao,
          retomada: { deTurnoId: "t1", tentativa: 1 },
          sequencia: 5,
          em: local(14, 32),
        },
      ]);

      expect(estado.turnos[0]?.retomada).toBeNull();
      expect(estado.turnos[1]?.retomada).toEqual({ deTurnoId: "t1", tentativa: 1 });
      expect(estado.turnos[1]?.recuperacao).toBeNull();
      expect(estado.turnos[1]?.log[0]?.texto).toBe(
        "retomada automática (tentativa 1) · turno iniciado · opus → sonnet · ≤3 agentes",
      );
    });
  });

  describe("fila de pedidos", () => {
    function pedido(id: string, segundo: number, modo: ModoDoTurno = "execucao"): DadosDoPedidoNaFila {
      return { id, texto: `pedido ${id}`, modo, enfileiradoEm: `2026-10-28T12:00:0${segundo}.000Z` };
    }
    const a = pedido("a", 1);
    const b = pedido("b", 2, "planejamento");
    const c = pedido("c", 3);
    const limpa: EventoDeOrquestracao = {
      tipo: "conversa_limpa",
      turnosAnteriores: 1,
      planoDescartado: false,
      worktreeComAlteracoes: false,
    };

    it("o estado inicial da fila vem do resumo do servidor", () => {
      expect(ESTADO_INICIAL.pedidosEnfileirados).toEqual([]);
      expect(filaDePedidos(ESTADO_INICIAL, [a, b])).toEqual([a, b]);
      expect(filaDePedidos(ESTADO_INICIAL, [])).toEqual([]);
    });

    it("pedido_enfileirado entra no fim da fila, sem mexer no turno em andamento nem no log", () => {
      const estado = reproduzir(
        registrar([
          { tipo: "turno_iniciado", turnoId: "t1", texto: "um", configuracao },
          { tipo: "pedido_enfileirado", pedido: a },
          { tipo: "pedido_enfileirado", pedido: b },
        ]),
      );

      expect(estado.ultimaSequencia).toBe(3);
      expect(filaDePedidos(estado, [])).toEqual([a, b]);
      expect(estado.turnos).toHaveLength(1);
      expect(estado.turnos[0]?.log).toHaveLength(1);
    });

    it("pedido_retirado_da_fila tira o pedido, removido pelo usuário ou enviado como turno", () => {
      const estado = reproduzir(
        registrar([
          { tipo: "pedido_enfileirado", pedido: a },
          { tipo: "pedido_enfileirado", pedido: b },
          { tipo: "pedido_enfileirado", pedido: c },
          { tipo: "pedido_retirado_da_fila", pedidoId: "b", motivo: "removido" },
          { tipo: "pedido_retirado_da_fila", pedidoId: "a", motivo: "enviado" },
          { tipo: "turno_iniciado", turnoId: "t2", texto: a.texto, configuracao },
        ]),
      );

      expect(filaDePedidos(estado, [])).toEqual([c]);
      expect(estado.turnos.map((turno) => [turno.texto, turno.situacao])).toEqual([["pedido a", "em_andamento"]]);
    });

    it("os eventos corrigem o resumo defasado: tiram o que saiu e acrescentam o que entrou depois da consulta, sem repetir", () => {
      const estado = reproduzir(
        registrar([
          { tipo: "pedido_retirado_da_fila", pedidoId: "a", motivo: "enviado" },
          { tipo: "pedido_enfileirado", pedido: c },
        ]),
      );

      expect(filaDePedidos(estado, [a, b])).toEqual([b, c]);
      expect(filaDePedidos(estado, [b, c])).toEqual([b, c]);
    });

    it("repetidos são ignorados: na reconexão do SSE e com o mesmo pedido de novo", () => {
      const eventos = registrar([
        { tipo: "pedido_enfileirado", pedido: a },
        { tipo: "pedido_retirado_da_fila", pedidoId: "a", motivo: "removido" },
      ]);
      const umaVez = reproduzir(eventos);
      expect(reproduzir(eventos, umaVez)).toBe(umaVez);

      const soAEntrada = reproduzir(eventos.slice(0, 1));
      const deNovo = aplicarEvento(soAEntrada, { tipo: "pedido_enfileirado", pedido: a, sequencia: 7, em: "2026-10-28T12:00:07Z" });
      expect(deNovo.pedidosEnfileirados).toEqual([a]);
      expect(deNovo.ultimaSequencia).toBe(7);

      const retiradaDeNovo = aplicarEvento(umaVez, {
        tipo: "pedido_retirado_da_fila",
        pedidoId: "a",
        motivo: "removido",
        sequencia: 8,
        em: "2026-10-28T12:00:08Z",
      });
      expect(retiradaDeNovo.pedidosRetirados).toEqual(["a"]);
    });

    it("fora de ordem: evento de sequência antiga é ignorado, e a entrada que chega depois da retirada também", () => {
      const estado = reproduzir(
        registrar([
          { tipo: "pedido_enfileirado", pedido: b },
          { tipo: "pedido_retirado_da_fila", pedidoId: "a", motivo: "removido" },
          { tipo: "pedido_enfileirado", pedido: a },
        ]),
      );
      expect(filaDePedidos(estado, [])).toEqual([b]);
      expect(filaDePedidos(estado, [a, b])).toEqual([b]);

      const atrasado = aplicarEvento(estado, { tipo: "pedido_enfileirado", pedido: c, sequencia: 2, em: "2026-10-28T12:00:02Z" });
      expect(atrasado).toBe(estado);
    });

    it("o /clear não esvazia a fila: daí em diante ela vem do resumo, ainda filtrada pelas retiradas", () => {
      const estado = reproduzir(
        registrar([
          { tipo: "pedido_enfileirado", pedido: a },
          { tipo: "pedido_enfileirado", pedido: b },
          { tipo: "pedido_retirado_da_fila", pedidoId: "a", motivo: "removido" },
          limpa,
        ]),
      );
      expect(estado.turnos).toEqual([]);
      expect(estado.pedidosEnfileirados).toEqual([]);
      expect(filaDePedidos(estado, [a, b])).toEqual([b]);

      // Terminal aberto depois do /clear: o histórico só tem o conversa_limpa, e a fila vem do resumo.
      const abertoDepois = reproduzir(registrar([limpa]));
      expect(filaDePedidos(abertoDepois, [b])).toEqual([b]);
    });
  });
});
