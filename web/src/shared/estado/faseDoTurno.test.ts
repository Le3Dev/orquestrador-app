import type { ModoDoTurno, SituacaoDoSubagente, SituacaoDoTurno } from "../api/tipos";
import type { SubagenteNaTela, TurnoNaTela } from "./aplicarEvento";
import { faseDoTurno } from "./faseDoTurno";

function subagente(situacao: SituacaoDoSubagente): SubagenteNaTela {
  return {
    id: Math.random().toString(36),
    descricao: "",
    tarefa: "",
    situacao,
    iniciadoEm: "2026-10-28T12:00:00Z",
    encerradoEm: null,
    atividade: "",
    ultimaFerramenta: null,
    tokens: 0,
    ferramentasUsadas: 0,
    duracaoMs: 0,
    resumo: "",
    resultado: null,
    textos: [],
  };
}

function turno(
  situacao: SituacaoDoTurno,
  subagentes: SituacaoDoSubagente[],
  modo: ModoDoTurno = "execucao",
): TurnoNaTela {
  return {
    id: "t1",
    texto: "",
    anexos: [],
    ultimaAtividadeEm: "2026-10-28T12:00:00Z",
    iniciadoEm: "2026-10-28T12:00:00Z",
    encerradoEm: null,
    situacao,
    configuracao: {
      modeloDoOrquestrador: "opus",
      esforcoDoOrquestrador: "padrao",
      modeloDosSubagentes: "opus",
      esforcoDosSubagentes: "padrao",
      quantidadeDeSubagentes: { modo: "automatica", limite: 3 },
      nivelDePermissao: "leitura",
      permitirCommitEPush: false,
    },
    modo,
    decisaoDoPlano: null,
    textosDoOrquestrador: [],
    resposta: null,
    motivoDaFalha: null,
    uso: null,
    subagentes: subagentes.map(subagente),
    ferramentasDiretas: [],
    permissoesNegadas: [],
    log: [],
  };
}

describe("faseDoTurno", () => {
  it("planeja enquanto não há subagentes", () => {
    expect(faseDoTurno(turno("em_andamento", []))).toMatchObject({ atual: "planejar", parado: false });
  });

  it("executa enquanto algum subagente roda, dizendo quantos", () => {
    expect(faseDoTurno(turno("em_andamento", ["executando", "concluido", "executando"]))).toMatchObject({
      atual: "executar",
      descricao: "2 de 3 agentes em execução",
    });
  });

  it("sintetiza quando todos terminaram e o turno segue aberto", () => {
    expect(faseDoTurno(turno("em_andamento", ["concluido", "falhou"])).atual).toBe("sintetizar");
  });

  it("concluído não tem fase atual; sem subagentes, foi resposta direta", () => {
    expect(faseDoTurno(turno("concluido", ["concluido"]))).toMatchObject({ atual: null, direto: false });
    expect(faseDoTurno(turno("concluido", []))).toMatchObject({ atual: null, direto: true });
  });

  it("cancelado para na fase em que estava", () => {
    expect(faseDoTurno(turno("cancelado", ["concluido", "cancelado"]))).toMatchObject({ atual: "executar", parado: true });
    expect(faseDoTurno(turno("interrompido", ["concluido"]))).toMatchObject({ atual: "sintetizar", parado: true });
    expect(faseDoTurno(turno("falhou", []))).toMatchObject({ atual: "planejar", parado: true });
  });

  it("no plan mode investiga para montar o plano e, ao concluir, entrega o plano", () => {
    expect(faseDoTurno(turno("em_andamento", [], "planejamento"))).toMatchObject({
      atual: "planejar",
      descricao: "Investigando para montar o plano…",
    });
    expect(faseDoTurno(turno("concluido", ["concluido"], "planejamento"))).toMatchObject({
      atual: null,
      descricao: "Plano entregue",
    });
  });

  it("no plan mode mantém as demais frases", () => {
    expect(faseDoTurno(turno("em_andamento", ["executando"], "planejamento")).descricao).toBe("1 de 1 agente em execução");
    expect(faseDoTurno(turno("cancelado", [], "planejamento")).descricao).toBe("Cancelado");
  });
});
