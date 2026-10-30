import type { DadosDaConfiguracao, EventoDeOrquestracao, EventoRegistrado } from "../api/tipos";
import { aplicarEvento, ESTADO_INICIAL, type EstadoDaConversa } from "../estado/aplicarEvento";
import {
  arestasDosBixinhos,
  bixinhosParaLimpar,
  ehNota,
  idDoBixinho,
  idDoNoDaNota,
  layoutDosNos,
  limparBixinhos,
  mesmasLigacoes,
  minimizarOuRestaurar,
  type NoBixinho,
  type NoDoCanvas,
  novaNota,
  novoTerminal,
  reaproveitarArestas,
  semTerminal,
  sincronizarBixinhos,
  sincronizarNotas,
  subagentesVisiveis,
} from "./nos";
import { ALTURA_DA_NOTA_MINIMIZADA, type BixinhosLimpos, TAMANHO_DO_BIXINHO } from "./layout";

const configuracao: DadosDaConfiguracao = {
  modeloDoOrquestrador: "opus",
  esforcoDoOrquestrador: "padrao",
  modeloDosSubagentes: "haiku",
  esforcoDosSubagentes: "padrao",
  quantidadeDeSubagentes: { modo: "fixa", limite: 2 },
  nivelDePermissao: "leitura",
  permitirCommitEPush: false,
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

  it("usa a aresta própria do bixinho, a que desenha a bolinha da troca", () => {
    const conversas = new Map([["o1", doisSubagentes]]);
    const arestas = arestasDosBixinhos(sincronizarBixinhos([terminal], conversas), conversas);

    expect(arestas.map((aresta) => aresta.type)).toEqual(["bixinho", "bixinho"]);
  });
});

describe("reaproveitarArestas", () => {
  const conversas = new Map([["o1", doisSubagentes]]);
  const nos = sincronizarBixinhos([terminal], conversas);

  it("devolve o mesmo array quando nenhuma linha mudou (ex.: arrastando o terminal)", () => {
    const anteriores = arestasDosBixinhos(nos, conversas);
    const arrastado = nos.map((no): NoDoCanvas => (no.id === "o1" ? { ...no, position: { x: 900, y: 40 } } : no));

    expect(reaproveitarArestas(anteriores, arestasDosBixinhos(arrastado, conversas))).toBe(anteriores);
  });

  it("troca só a linha cujo Subagente mudou de situação", () => {
    const anteriores = arestasDosBixinhos(nos, conversas);
    const s2Concluiu = aplicarEvento(doisSubagentes, {
      tipo: "subagente_concluido",
      turnoId: "t1",
      subagenteId: "s2",
      situacao: "concluido",
      resumo: "",
      tokens: 1,
      duracaoMs: 1,
      sequencia: 99,
      em: "2026-10-28T12:01:00Z",
    });

    const novas = reaproveitarArestas(anteriores, arestasDosBixinhos(nos, new Map([["o1", s2Concluiu]])));

    expect(novas).not.toBe(anteriores);
    expect(novas[0]).toBe(anteriores[0]);
    expect(novas[1]).not.toBe(anteriores[1]);
    expect(novas[1]).toMatchObject({ animated: false, className: "aresta-concluido" });
  });

  it("um bixinho que sai leva a linha embora", () => {
    const anteriores = arestasDosBixinhos(nos, conversas);
    const semS1 = nos.filter((no) => no.id !== idDoBixinho("o1", "s1"));

    const novas = reaproveitarArestas(anteriores, arestasDosBixinhos(semS1, conversas));

    expect(novas.map((aresta) => aresta.target)).toEqual([idDoBixinho("o1", "s2")]);
    expect(novas[0]).toBe(anteriores[1]);
  });
});

describe("mesmasLigacoes", () => {
  const bixinhos = sincronizarBixinhos([terminal], new Map([["o1", doisSubagentes]])).filter(
    (no): no is NoBixinho => no.type === "bixinho",
  );

  it("arrastar um bixinho não muda as ligações", () => {
    const arrastados = bixinhos.map((bixinho) => ({ ...bixinho, position: { x: 1, y: 2 } }));

    expect(mesmasLigacoes(bixinhos, arrastados)).toBe(bixinhos);
  });

  it("um bixinho a mais ou a menos muda", () => {
    const menos = bixinhos.slice(1);

    expect(mesmasLigacoes(bixinhos, menos)).toBe(menos);
  });
});

describe("limparBixinhos", () => {
  function depois(estado: EstadoDaConversa, evento: EventoDeOrquestracao): EstadoDaConversa {
    return aplicarEvento(estado, { ...evento, sequencia: estado.ultimaSequencia + 1, em: "2026-10-28T12:02:00Z" });
  }

  function idsDosBixinhos(nos: readonly NoDoCanvas[]): string[] {
    return nos.filter((no) => no.type === "bixinho").map((no) => no.id);
  }

  it("limpa os que não estão executando e mantém quem trabalha, sem nó nem linha para os limpos", () => {
    const conversas = new Map([["o1", doisSubagentes]]);
    const limpos = limparBixinhos(doisSubagentes);

    expect(limpos).toEqual({ turnoId: "t1", subagentes: ["s1"] });
    const nos = sincronizarBixinhos(
      sincronizarBixinhos([terminal], conversas),
      conversas,
      new Map([["o1", limpos as BixinhosLimpos]]),
    );
    expect(idsDosBixinhos(nos)).toEqual([idDoBixinho("o1", "s2")]);
    expect(arestasDosBixinhos(nos, conversas).map((aresta) => aresta.target)).toEqual([idDoBixinho("o1", "s2")]);
  });

  it("subagente novo depois da limpeza aparece normalmente", () => {
    const limpezas = new Map([["o1", limparBixinhos(doisSubagentes) as BixinhosLimpos]]);
    const comNovo = depois(doisSubagentes, {
      tipo: "subagente_iniciado",
      turnoId: "t1",
      subagenteId: "s3",
      descricao: "C",
      tarefa: "",
    });

    const nos = sincronizarBixinhos([terminal], new Map([["o1", comNovo]]), limpezas);

    expect(idsDosBixinhos(nos)).toEqual([idDoBixinho("o1", "s2"), idDoBixinho("o1", "s3")]);
  });

  it("limpar de novo soma aos já limpos do mesmo pedido", () => {
    const primeira = limparBixinhos(doisSubagentes) ?? undefined;
    const s2Terminou = depois(doisSubagentes, {
      tipo: "subagente_concluido",
      turnoId: "t1",
      subagenteId: "s2",
      situacao: "falhou",
      resumo: "",
      tokens: 1,
      duracaoMs: 1,
    });

    expect(limparBixinhos(s2Terminou, primeira)).toEqual({ turnoId: "t1", subagentes: ["s1", "s2"] });
  });

  it("não há o que limpar quando todos executam ou já foram limpos", () => {
    const soTrabalhando = conversa([
      { tipo: "turno_iniciado", turnoId: "t1", texto: "analise", configuracao },
      { tipo: "subagente_iniciado", turnoId: "t1", subagenteId: "s1", descricao: "A", tarefa: "" },
    ]);

    expect(bixinhosParaLimpar(soTrabalhando)).toEqual([]);
    expect(limparBixinhos(soTrabalhando)).toBeNull();
    expect(limparBixinhos(doisSubagentes, { turnoId: "t1", subagentes: ["s1"] })).toBeNull();
    expect(limparBixinhos(undefined)).toBeNull();
  });

  it("a limpeza de um pedido anterior não esconde os bixinhos do pedido novo", () => {
    const novoPedido = depois(
      depois(doisSubagentes, { tipo: "turno_iniciado", turnoId: "t2", texto: "e agora?", configuracao }),
      { tipo: "subagente_iniciado", turnoId: "t2", subagenteId: "s1", descricao: "A de novo", tarefa: "" },
    );

    expect(subagentesVisiveis(novoPedido, { turnoId: "t1", subagentes: ["s1"] }).map((subagente) => subagente.id)).toEqual([
      "s1",
    ]);
    // A limpeza nova substitui a antiga: a lista não cresce de pedido em pedido.
    const concluido = depois(novoPedido, {
      tipo: "subagente_concluido",
      turnoId: "t2",
      subagenteId: "s1",
      situacao: "concluido",
      resumo: "",
      tokens: 1,
      duracaoMs: 1,
    });
    expect(limparBixinhos(concluido, { turnoId: "t1", subagentes: ["s1", "s9"] })).toEqual({
      turnoId: "t2",
      subagentes: ["s1"],
    });
  });
});

describe("notas no canvas", () => {
  const centro = () => ({ x: 0, y: 0 });

  it("minimizar deixa só a barra, no mesmo lugar, e restaurar volta à altura de antes", () => {
    const aberta = { ...novaNota("n1", { x: 30, y: 40 }, 320, 300), height: 333 };

    const minimizada = minimizarOuRestaurar(aberta);
    expect(minimizada).toMatchObject({ position: { x: 30, y: 40 }, width: 320, height: ALTURA_DA_NOTA_MINIMIZADA });
    expect(minimizada.data).toEqual({ notaId: "n1", minimizada: true, alturaAberta: 333 });

    expect(minimizarOuRestaurar(minimizada)).toMatchObject({ height: 333, data: { minimizada: false } });
  });

  it("sincronizar com o servidor tira as apagadas, cria as que faltam e mantém as criadas agora", () => {
    const nos: NoDoCanvas[] = [terminal, novaNota("n1", { x: 1, y: 1 }), novaNota("apagada", { x: 2, y: 2 }), novaNota("recem", { x: 3, y: 3 })];

    const sincronizados = sincronizarNotas(nos, ["n1", "n2"], new Set(["recem"]), centro);

    expect(sincronizados.map((no) => no.id)).toEqual(["o1", idDoNoDaNota("n1"), idDoNoDaNota("recem"), idDoNoDaNota("n2")]);
    // A nota sem layout ganha a posição padrão; a que já estava no canvas fica onde estava.
    expect(sincronizados.filter(ehNota).find((no) => no.data.notaId === "n1")?.position).toEqual({ x: 1, y: 1 });
    expect(sincronizados.filter(ehNota).find((no) => no.data.notaId === "n2")?.position).toEqual({ x: 0, y: 0 });
  });

  it("devolve o mesmo array quando o canvas já está igual ao servidor", () => {
    const nos: NoDoCanvas[] = [terminal, novaNota("n1", { x: 1, y: 1 })];

    expect(sincronizarNotas(nos, ["n1"], new Set(), centro)).toBe(nos);
  });

  it("várias notas sem layout não nascem uma exatamente sobre a outra", () => {
    const sincronizados = sincronizarNotas([], ["n1", "n2"], new Set(), (ocupadas) => ({ x: ocupadas.length * 36, y: 0 }));

    expect(sincronizados.map((no) => no.position)).toEqual([
      { x: 0, y: 0 },
      { x: 36, y: 0 },
    ]);
  });
});

describe("semTerminal e layoutDosNos", () => {
  it("fechar o terminal leva os bixinhos junto, e o layout guarda só terminais", () => {
    const nos = sincronizarBixinhos([terminal], new Map([["o1", doisSubagentes]]));

    expect(semTerminal(nos, "o1")).toEqual([]);
    expect(layoutDosNos(nos, null)).toEqual({
      terminais: { o1: { x: 100, y: 100, largura: 600, altura: 500 } },
      notas: {},
      viewport: null,
    });
  });
});
