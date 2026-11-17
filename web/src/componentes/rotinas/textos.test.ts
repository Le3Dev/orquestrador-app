import { descreverEtapa, descreverGatilho, descreverMinutos, descreverMomento, descreverProximaExecucao, resumirTexto } from "./textos";

describe("descreverGatilho", () => {
  it("fala de um dia só como 'Toda segunda às 09:00' e 'Todo sábado'", () => {
    expect(descreverGatilho({ tipo: "semanal", dias: [1], hora: "09:00" })).toBe("Toda segunda às 09:00");
    expect(descreverGatilho({ tipo: "semanal", dias: [6], hora: "18:30" })).toBe("Todo sábado às 18:30");
    expect(descreverGatilho({ tipo: "semanal", dias: [0], hora: "08:00" })).toBe("Todo domingo às 08:00");
  });

  it("lista vários dias na ordem da semana, começando na segunda", () => {
    expect(descreverGatilho({ tipo: "semanal", dias: [5, 3, 1], hora: "09:00" })).toBe("Segunda, quarta e sexta às 09:00");
    expect(descreverGatilho({ tipo: "semanal", dias: [0, 6], hora: "10:00" })).toBe("Sábado e domingo às 10:00");
  });

  it("resume a semana útil e a semana toda", () => {
    expect(descreverGatilho({ tipo: "semanal", dias: [1, 2, 3, 4, 5], hora: "09:00" })).toBe("De segunda a sexta às 09:00");
    expect(descreverGatilho({ tipo: "semanal", dias: [0, 1, 2, 3, 4, 5, 6], hora: "09:00" })).toBe("Todo dia às 09:00");
    expect(descreverGatilho({ tipo: "diario", hora: "07:15" })).toBe("Todo dia às 07:15");
  });

  it("descreve o intervalo em minutos, horas ou dias", () => {
    expect(descreverGatilho({ tipo: "intervalo", minutos: 30 })).toBe("A cada 30 minutos");
    expect(descreverGatilho({ tipo: "intervalo", minutos: 60 })).toBe("A cada 1 hora");
    expect(descreverGatilho({ tipo: "intervalo", minutos: 120 })).toBe("A cada 2 horas");
    expect(descreverGatilho({ tipo: "intervalo", minutos: 90 })).toBe("A cada 1 h 30 min");
    expect(descreverGatilho({ tipo: "intervalo", minutos: 2_880 })).toBe("A cada 2 dias");
  });

  it("mostra data e hora da execução única", () => {
    const texto = descreverGatilho({ tipo: "uma_vez", em: new Date(2026, 11, 5, 9, 30).toISOString() });
    expect(texto).toMatch(/^Uma vez, em 05\/12\/2026 às 09:30$/);
    expect(descreverGatilho({ tipo: "uma_vez", em: "lixo" })).toBe("Uma vez");
  });
});

describe("descreverMomento e descreverProximaExecucao", () => {
  const agora = new Date(2026, 10, 17, 10, 0);

  it("diz hoje, amanhã ou a data", () => {
    expect(descreverMomento(new Date(2026, 10, 17, 15, 0).toISOString(), agora)).toBe("hoje às 15:00");
    expect(descreverMomento(new Date(2026, 10, 18, 9, 0).toISOString(), agora)).toBe("amanhã às 09:00");
    expect(descreverMomento(new Date(2026, 10, 20, 9, 0).toISOString(), agora)).toBe("20/11 às 09:00");
    expect(descreverMomento("lixo", agora)).toBe("—");
  });

  it("desativada não tem próxima; ativa sem data diz que não há", () => {
    expect(descreverProximaExecucao({ ativa: false, proximaExecucaoEm: null }, agora)).toBe("Desativada: não roda sozinha");
    expect(descreverProximaExecucao({ ativa: true, proximaExecucaoEm: null }, agora)).toBe("Sem próxima execução");
    expect(descreverProximaExecucao({ ativa: true, proximaExecucaoEm: new Date(2026, 10, 18, 9, 0).toISOString() }, agora)).toBe(
      "amanhã às 09:00",
    );
  });
});

describe("descreverEtapa", () => {
  const nome = (id: string) => (id === "o1" ? "Backend" : null);

  it("cita o orquestrador, o modo e o começo do pedido", () => {
    expect(descreverEtapa({ tipo: "pedido", orquestradorId: "o1", texto: "Rode  os\ntestes", modo: "execucao" }, nome)).toBe(
      "Pedido (executar) para Backend: Rode os testes",
    );
    expect(descreverEtapa({ tipo: "pedido", orquestradorId: "x", texto: "Planeje", modo: "planejamento" }, nome)).toBe(
      "Pedido (planejar) para orquestrador removido: Planeje",
    );
  });

  it("descreve a aprovação e a espera", () => {
    expect(descreverEtapa({ tipo: "aprovacao", mensagem: "Posso publicar?" }, nome)).toBe("Pedir aprovação: Posso publicar?");
    expect(descreverEtapa({ tipo: "espera", minutos: 90 }, nome)).toBe("Esperar 1 h 30 min");
  });
});

describe("descreverMinutos e resumirTexto", () => {
  it("usa o singular e corta o texto longo com reticências", () => {
    expect(descreverMinutos(1)).toBe("1 minuto");
    expect(descreverMinutos(1_440)).toBe("1 dia");
    expect(resumirTexto("a".repeat(20), 10)).toBe(`${"a".repeat(9)}…`);
    expect(resumirTexto("curto", 10)).toBe("curto");
  });
});
