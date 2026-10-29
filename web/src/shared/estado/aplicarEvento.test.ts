import type { DadosDaConfiguracao, EventoDeOrquestracao, EventoRegistrado } from "../api/tipos";
import { aplicarEvento, ESTADO_INICIAL, type EstadoDaConversa } from "./aplicarEvento";

const configuracao: DadosDaConfiguracao = {
  modeloDoOrquestrador: "opus",
  modeloDosSubagentes: "sonnet",
  quantidadeDeSubagentes: { modo: "automatica", limite: 3 },
  nivelDePermissao: "leitura",
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
});
