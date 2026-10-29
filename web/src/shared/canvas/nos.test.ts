import type { DadosDaConfiguracao, EventoDeOrquestracao, EventoRegistrado } from "../api/tipos";
import { aplicarEvento, ESTADO_INICIAL, type EstadoDaConversa } from "../estado/aplicarEvento";
import {
  arestasDosBixinhos,
  idDoBixinho,
  layoutDosNos,
  type NoDoCanvas,
  novoTerminal,
  semTerminal,
  sincronizarBixinhos,
} from "./nos";
import { TAMANHO_DO_BIXINHO } from "./layout";

const configuracao: DadosDaConfiguracao = {
  modeloDoOrquestrador: "opus",
  modeloDosSubagentes: "haiku",
  quantidadeDeSubagentes: { modo: "fixa", limite: 2 },
  nivelDePermissao: "leitura",
};

function conversa(eventos: EventoDeOrquestracao[]): EstadoDaConversa {
  return eventos
    .map((evento, indice): EventoRegistrado => ({ ...evento, sequencia: indice + 1, em: "2026-10-28T12:00:00Z" }))
    .reduce(aplicarEvento, ESTADO_INICIAL);
}

const doisSubagentes = conversa([
  { tipo: "turno_iniciado", turnoId: "t1", texto: "analise", configuracao },
  { tipo: "subagente_iniciado", turnoId: "t1", subagenteId: "s1", descricao: "A", tarefa: "" },
  { tipo: "subagente_iniciado", turnoId: "t1", subagenteId: "s2", descricao: "B", tarefa: "" },
  { tipo: "subagente_concluido", turnoId: "t1", subagenteId: "s1", situacao: "concluido", resumo: "", tokens: 1, duracaoMs: 1 },
]);

const terminal = novoTerminal("o1", { x: 100, y: 100 }, 600, 500);

describe("sincronizarBixinhos", () => {
  it("cria um bixinho por subagente, filho do terminal e abaixo dele", () => {
    const nos = sincronizarBixinhos([terminal], new Map([["o1", doisSubagentes]]));
    const bixinhos = nos.filter((no) => no.type === "bixinho");

    expect(bixinhos.map((no) => no.id)).toEqual([idDoBixinho("o1", "s1"), idDoBixinho("o1", "s2")]);
    expect(bixinhos.every((no) => no.parentId === "o1" && no.position.y > 500)).toBe(true);
    // O pai precisa vir antes dos filhos no array.
    expect(nos[0]?.id).toBe("o1");
  });

  it("devolve o mesmo array quando nada mudou, e mantém a posição de quem foi arrastado", () => {
    const conversas = new Map([["o1", doisSubagentes]]);
    const primeira = sincronizarBixinhos([terminal], conversas);
    const arrastado = primeira.map((no): NoDoCanvas => (no.id === idDoBixinho("o1", "s1") ? { ...no, position: { x: 5, y: 5 } } : no));

    const segunda = sincronizarBixinhos(arrastado, conversas);

    expect(segunda).toBe(arrastado);
    expect(segunda.find((no) => no.id === idDoBixinho("o1", "s1"))?.position).toEqual({ x: 5, y: 5 });
  });

  it("redistribui o grupo quando os subagentes nascem um de cada vez", () => {
    const umSo = conversa([
      { tipo: "turno_iniciado", turnoId: "t1", texto: "analise", configuracao },
      { tipo: "subagente_iniciado", turnoId: "t1", subagenteId: "s1", descricao: "A", tarefa: "" },
    ]);
    const comUm = sincronizarBixinhos([terminal], new Map([["o1", umSo]]));
    const comDois = sincronizarBixinhos(comUm, new Map([["o1", doisSubagentes]]));

    const [primeiro, segundo] = comDois.filter((no) => no.type === "bixinho").map((no) => no.position.x);
    expect(Math.abs((segundo ?? 0) - (primeiro ?? 0))).toBeGreaterThanOrEqual(TAMANHO_DO_BIXINHO.largura);
  });

  it("troca os bixinhos quando começa um pedido novo", () => {
    const comBixinhos = sincronizarBixinhos([terminal], new Map([["o1", doisSubagentes]]));
    const novoPedido = aplicarEvento(doisSubagentes, {
      tipo: "turno_iniciado",
      turnoId: "t2",
      texto: "e agora?",
      configuracao,
      sequencia: 99,
      em: "2026-10-28T12:01:00Z",
    });

    expect(sincronizarBixinhos(comBixinhos, new Map([["o1", novoPedido]]))).toEqual([terminal]);
  });
});

describe("arestasDosBixinhos", () => {
  it("liga o terminal a cada bixinho, animando só quem trabalha", () => {
    const conversas = new Map([["o1", doisSubagentes]]);
    const arestas = arestasDosBixinhos(sincronizarBixinhos([terminal], conversas), conversas);

    expect(arestas.map((aresta) => [aresta.source, aresta.target, aresta.animated, aresta.className])).toEqual([
      ["o1", idDoBixinho("o1", "s1"), false, "aresta-concluido"],
      ["o1", idDoBixinho("o1", "s2"), true, "aresta-executando"],
    ]);
  });
});

describe("semTerminal e layoutDosNos", () => {
  it("fechar o terminal leva os bixinhos junto, e o layout guarda só terminais", () => {
    const nos = sincronizarBixinhos([terminal], new Map([["o1", doisSubagentes]]));

    expect(semTerminal(nos, "o1")).toEqual([]);
    expect(layoutDosNos(nos, null)).toEqual({
      terminais: { o1: { x: 100, y: 100, largura: 600, altura: 500 } },
      viewport: null,
    });
  });
});
