import type { SituacaoDoSubagente, SituacaoDoTurno } from "../api/tipos";
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

function turno(situacao: SituacaoDoTurno, subagentes: SituacaoDoSubagente[]): TurnoNaTela {
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
      modeloDosSubagentes: "opus",
      quantidadeDeSubagentes: { modo: "automatica", limite: 3 },
      nivelDePermissao: "leitura",
    },
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
});
