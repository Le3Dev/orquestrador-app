import type { DadosDaConfiguracao, EventoDeOrquestracao, EventoRegistrado } from "../api/tipos";
import { aplicarEvento, ESTADO_INICIAL, type EstadoDaConversa } from "../estado/aplicarEvento";
import {
  arestasDasPrevias,
  arestasDosBixinhos,
  bixinhosParaLimpar,
  ehNota,
  idDoBixinho,
  idDoNoDaNota,
  ladoDoBixinho,
  layoutDosNos,
  limparBixinhos,
  mesmasLigacoes,
  minimizarOuRestaurar,
  type NoBixinho,
  type NoDoCanvas,
  novaNota,
  novaPrevia,
  novoTerminal,
  posicaoDaPreviaDoTerminal,
  reacomodarBixinhos,
  reaproveitarArestas,
  semTerminal,
  sincronizarBixinhos,
  sincronizarNotas,
  subagentesVisiveis,
} from "./nos";
import { ALTURA_DA_NOTA_MINIMIZADA, type BixinhosLimpos, type Retangulo, sobrepoe, TAMANHO_DO_BIXINHO } from "./layout";

const configuracao: DadosDaConfiguracao = {
  modeloDoOrquestrador: "opus",
  esforcoDoOrquestrador: "padrao",
  modeloDosSubagentes: "haiku",
  esforcoDosSubagentes: "padrao",
  quantidadeDeSubagentes: { modo: "fixa", limite: 2 },
  nivelDePermissao: "leitura",
  permitirCommitEPush: false,
  instrucoesPersonalizadas: "",
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

/** Onde estão os bixinhos (de um terminal, ou de todos) no canvas, em coordenadas absolutas. */
function bixinhosNoCanvas(nos: readonly NoDoCanvas[], terminalId?: string): Retangulo[] {
  const origens = new Map(nos.filter((no) => no.type !== "bixinho").map((no) => [no.id, no.position]));
  return nos
    .filter((no) => no.type === "bixinho" && (terminalId === undefined || no.parentId === terminalId))
    .map((no) => {
      const origem = origens.get(no.parentId ?? "") ?? { x: 0, y: 0 };
      return { x: origem.x + no.position.x, y: origem.y + no.position.y, ...TAMANHO_DO_BIXINHO };
    });
}

function retanguloDe(no: NoDoCanvas): Retangulo {
  return { x: no.position.x, y: no.position.y, largura: no.width ?? 0, altura: no.height ?? 0 };
}

/** Se algum dos bixinhos está por cima de algum dos retângulos. */
function algumPorCima(bixinhos: readonly Retangulo[], retangulos: readonly Retangulo[]): boolean {
  return bixinhos.some((bixinho) => retangulos.some((retangulo) => sobrepoe(bixinho, retangulo)));
}

/** Um bixinho de o1 na posição dada, relativa ao terminal. */
function bixinhoEm(x: number, y: number, subagenteId = "s1"): NoBixinho {
  return {
    id: idDoBixinho("o1", subagenteId),
    type: "bixinho",
    parentId: "o1",
    position: { x, y },
    width: TAMANHO_DO_BIXINHO.largura,
    height: TAMANHO_DO_BIXINHO.altura,
    data: { orquestradorId: "o1", subagenteId },
  };
}

/** Os mesmos nós, com o bixinho dado em outra posição. */
function comBixinhoEm(nos: readonly NoDoCanvas[], subagenteId: string, x: number, y: number): NoDoCanvas[] {
  return nos.map((no): NoDoCanvas => (no.id === idDoBixinho("o1", subagenteId) ? { ...no, position: { x, y } } : no));
}

/** De que âncora sai e em qual chega cada linha. */
function ancorasDasArestas(arestas: readonly { sourceHandle?: string | null; targetHandle?: string | null }[]) {
  return arestas.map((aresta) => [aresta.sourceHandle, aresta.targetHandle]);
}

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

  // Outro terminal logo abaixo de o1 (onde o grupo nasceria) e uma nota alta à direita.
  const abaixo = novoTerminal("o2", { x: 100, y: 650 }, 600, 500);
  const aDireita = novaNota("n1", { x: 750, y: 100 }, 320, 900);

  it("um grupo novo não nasce em cima de outro terminal nem de uma nota", () => {
    const nos = sincronizarBixinhos([terminal, abaixo, aDireita], new Map([["o1", doisSubagentes]]));
    const bixinhos = bixinhosNoCanvas(nos);

    expect(bixinhos).toHaveLength(2);
    expect(algumPorCima(bixinhos, [abaixo, aDireita].map(retanguloDe))).toBe(false);
    // Nem embaixo nem à direita: à esquerda do terminal.
    expect(bixinhos.every((bixinho) => bixinho.x + bixinho.largura <= terminal.position.x)).toBe(true);
  });

  it("um grupo novo também não nasce em cima dos bixinhos de outro terminal", () => {
    const conversas = new Map([
      ["o1", doisSubagentes],
      ["o2", doisSubagentes],
    ]);
    const longe = novoTerminal("o2", { x: 2000, y: 100 }, 600, 500);
    // Os bixinhos de o2, arrastados para onde o grupo de o1 nasceria.
    const deO2 = sincronizarBixinhos([longe], conversas).map(
      (no, indice): NoDoCanvas => (no.type === "bixinho" ? { ...no, position: { x: -1800 + indice * 170, y: 580 } } : no),
    );

    const nos = sincronizarBixinhos([terminal, ...deO2], conversas);

    expect(algumPorCima(bixinhosNoCanvas(nos, "o1"), bixinhosNoCanvas(nos, "o2"))).toBe(false);
    expect(nos.filter((no) => no.parentId === "o2")).toEqual(deO2.filter((no) => no.parentId === "o2"));
  });

  it("com outras janelas por perto, continua devolvendo o mesmo array quando nada muda", () => {
    const conversas = new Map([["o1", doisSubagentes]]);
    const primeira = sincronizarBixinhos([terminal, abaixo, aDireita], conversas);

    expect(sincronizarBixinhos(primeira, conversas)).toBe(primeira);
  });
});

describe("reacomodarBixinhos", () => {
  const comBixinhos = sincronizarBixinhos([terminal], new Map([["o1", doisSubagentes]]));

  function posicoesDosBixinhos(nos: readonly NoDoCanvas[], terminalId: string) {
    return nos.filter((no) => no.type === "bixinho" && no.parentId === terminalId).map((no) => no.position);
  }

  it("tira de baixo de um terminal solto por cima o grupo inteiro, no mesmo arranjo", () => {
    const solto = novoTerminal("o2", { x: 100, y: 650 }, 600, 500);
    const nos = [...comBixinhos, solto];

    const reacomodados = reacomodarBixinhos(nos);

    expect(reacomodados).not.toBe(nos);
    expect(algumPorCima(bixinhosNoCanvas(reacomodados, "o1"), [retanguloDe(solto)])).toBe(false);
    const [antes1, antes2] = posicoesDosBixinhos(nos, "o1");
    const [depois1, depois2] = posicoesDosBixinhos(reacomodados, "o1");
    expect(depois1).not.toEqual(antes1);
    expect(depois2).not.toEqual(antes2);
    expect((depois2?.x ?? 0) - (depois1?.x ?? 0)).toBe((antes2?.x ?? 0) - (antes1?.x ?? 0));
    // Já reacomodado, não há mais o que mudar.
    expect(reacomodarBixinhos(reacomodados)).toBe(reacomodados);
  });

  it("também sai de baixo de uma nota", () => {
    const nota = novaNota("n1", { x: 300, y: 700 });
    const reacomodados = reacomodarBixinhos([...comBixinhos, nota]);

    expect(algumPorCima(bixinhosNoCanvas(reacomodados, "o1"), [retanguloDe(nota)])).toBe(false);
  });

  it("um grupo sem conflito fica onde está, mesmo arrastado à mão, e o array é o mesmo", () => {
    const arrastado = comBixinhos.map(
      (no): NoDoCanvas => (no.id === idDoBixinho("o1", "s1") ? { ...no, position: { x: -400, y: 20 } } : no),
    );
    const nos = [...arrastado, novaNota("n1", { x: 2000, y: 2000 }), novoTerminal("o2", { x: 1500, y: 100 }, 600, 500)];

    expect(reacomodarBixinhos(nos)).toBe(nos);
    expect(reacomodarBixinhos(comBixinhos)).toBe(comBixinhos);
  });

  it("só o grupo em conflito muda: o do terminal que foi solto fica igual", () => {
    const conversas = new Map([
      ["o1", doisSubagentes],
      ["o2", doisSubagentes],
    ]);
    const doisGrupos = sincronizarBixinhos([terminal, novoTerminal("o2", { x: 1500, y: 100 }, 600, 500)], conversas);
    // o2 (com os bixinhos dele, que o acompanham) solto sobre os bixinhos de o1.
    const soltoPorCima = doisGrupos.map((no): NoDoCanvas => (no.id === "o2" ? { ...no, position: { x: 100, y: 650 } } : no));

    const reacomodados = reacomodarBixinhos(soltoPorCima);

    const o2 = reacomodados.find((no) => no.id === "o2");
    expect(o2 === undefined ? true : algumPorCima(bixinhosNoCanvas(reacomodados, "o1"), [retanguloDe(o2)])).toBe(false);
    expect(algumPorCima(bixinhosNoCanvas(reacomodados, "o1"), bixinhosNoCanvas(reacomodados, "o2"))).toBe(false);
    const deO2 = soltoPorCima.filter((no) => no.parentId === "o2");
    expect(reacomodados.filter((no) => no.parentId === "o2").every((no, indice) => no === deO2[indice])).toBe(true);
  });
});

describe("ladoDoBixinho", () => {
  // O terminal o1 tem 600 × 500; o bixinho, 150 × 170, em posição relativa ao terminal.
  it("abaixo, acima, à direita e à esquerda do terminal", () => {
    expect(ladoDoBixinho(bixinhoEm(225, 580), terminal)).toBe("abaixo");
    expect(ladoDoBixinho(bixinhoEm(225, -250), terminal)).toBe("acima");
    expect(ladoDoBixinho(bixinhoEm(680, 0), terminal)).toBe("direita");
    expect(ladoDoBixinho(bixinhoEm(-230, 0), terminal)).toBe("esquerda");
  });

  it("encostado conta como do lado; um pixel por cima do terminal já é o padrão (abaixo)", () => {
    expect(ladoDoBixinho(bixinhoEm(225, -170), terminal)).toBe("acima");
    expect(ladoDoBixinho(bixinhoEm(600, 0), terminal)).toBe("direita");
    expect(ladoDoBixinho(bixinhoEm(-150, 0), terminal)).toBe("esquerda");
    expect(ladoDoBixinho(bixinhoEm(225, 500), terminal)).toBe("abaixo");

    expect(ladoDoBixinho(bixinhoEm(225, -169), terminal)).toBe("abaixo");
    expect(ladoDoBixinho(bixinhoEm(599, 0), terminal)).toBe("abaixo");
    expect(ladoDoBixinho(bixinhoEm(-149, 0), terminal)).toBe("abaixo");
  });

  it("na diagonal, acima vem antes dos lados, e os lados antes de abaixo", () => {
    expect(ladoDoBixinho(bixinhoEm(700, -300), terminal)).toBe("acima");
    expect(ladoDoBixinho(bixinhoEm(-300, -300), terminal)).toBe("acima");
    expect(ladoDoBixinho(bixinhoEm(700, 600), terminal)).toBe("direita");
    expect(ladoDoBixinho(bixinhoEm(-300, 600), terminal)).toBe("esquerda");
  });

  it("usa o tamanho medido, e o padrão quando não há nenhum", () => {
    const semTamanho: NoBixinho = { ...bixinhoEm(225, -170), width: undefined, height: undefined };
    expect(ladoDoBixinho(semTamanho, terminal)).toBe("acima");
    expect(ladoDoBixinho({ ...semTamanho, measured: { width: 150, height: 200 } }, terminal)).toBe("abaixo");

    const terminalMedido = { ...terminal, width: undefined, measured: { width: 800, height: 500 } };
    expect(ladoDoBixinho(bixinhoEm(680, 0), terminalMedido)).toBe("abaixo");
    expect(ladoDoBixinho(bixinhoEm(800, 0), terminalMedido)).toBe("direita");
  });
});

describe("arestasDosBixinhos", () => {
  const conversas = new Map([["o1", doisSubagentes]]);

  it("no caso padrão (abaixo), sai de baixo do terminal e chega em cima do bixinho", () => {
    const arestas = arestasDosBixinhos(sincronizarBixinhos([terminal], conversas), conversas);

    expect(ancorasDasArestas(arestas)).toEqual([
      ["baixo", "cima"],
      ["baixo", "cima"],
    ]);
  });

  it("liga os lados voltados um para o outro, bixinho a bixinho", () => {
    const nos = comBixinhoEm(comBixinhoEm(sincronizarBixinhos([terminal], conversas), "s1", 225, -250), "s2", 680, 0);

    expect(ancorasDasArestas(arestasDosBixinhos(nos, conversas))).toEqual([
      ["cima", "baixo"],
      ["direita", "esquerda"],
    ]);
    expect(ancorasDasArestas(arestasDosBixinhos(comBixinhoEm(nos, "s1", -230, 0), conversas))[0]).toEqual([
      "esquerda",
      "direita",
    ]);
  });

  it("segue o lugar que a reacomodação escolheu: à direita, à esquerda ou acima", () => {
    const abaixo = novoTerminal("o2", { x: 100, y: 650 }, 600, 500);
    const aDireita = novaNota("n1", { x: 750, y: 100 }, 320, 900);
    const aEsquerda = novaNota("n2", { x: -400, y: 100 }, 420, 900);
    const ancoras = (janelas: NoDoCanvas[]) =>
      ancorasDasArestas(arestasDosBixinhos(sincronizarBixinhos([terminal, ...janelas], conversas), conversas));

    expect(ancoras([abaixo])).toEqual([
      ["direita", "esquerda"],
      ["direita", "esquerda"],
    ]);
    expect(ancoras([abaixo, aDireita])).toEqual([
      ["esquerda", "direita"],
      ["esquerda", "direita"],
    ]);
    const acima = sincronizarBixinhos([terminal, abaixo, aDireita, aEsquerda], conversas);
    expect(bixinhosNoCanvas(acima).every((bixinho) => bixinho.y + bixinho.altura <= terminal.position.y)).toBe(true);
    expect(ancorasDasArestas(arestasDosBixinhos(acima, conversas))).toEqual([
      ["cima", "baixo"],
      ["cima", "baixo"],
    ]);
  });

  it("sem o terminal na lista, fica o padrão (abaixo)", () => {
    const soBixinhos = comBixinhoEm(sincronizarBixinhos([terminal], conversas), "s1", 225, -250).filter(
      (no) => no.type === "bixinho",
    );

    expect(ancorasDasArestas(arestasDosBixinhos(soBixinhos, conversas))[0]).toEqual(["baixo", "cima"]);
  });

  it("liga o terminal a cada bixinho, animando só quem trabalha", () => {
    const conversas = new Map([["o1", doisSubagentes]]);
    const arestas = arestasDosBixinhos(sincronizarBixinhos([terminal], conversas), conversas);

    expect(arestas.map((aresta) => [aresta.source, aresta.target, aresta.animated, aresta.className])).toEqual([
      ["o1", idDoBixinho("o1", "s1"), false, "aresta-concluido"],
      ["o1", idDoBixinho("o1", "s2"), true, "aresta-executando"],
    ]);
  });

  it("leva a situação do Subagente e a hora do fim em data, para a linha notar a entrega do relatório", () => {
    const conversas = new Map([["o1", doisSubagentes]]);
    const arestas = arestasDosBixinhos(sincronizarBixinhos([terminal], conversas), conversas);

    expect(arestas.map((aresta) => aresta.data)).toEqual([
      { situacao: "concluido", encerradoEm: "2026-10-28T12:00:00Z" },
      { situacao: "executando", encerradoEm: null },
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
    expect(novas[1]).toMatchObject({
      animated: false,
      className: "aresta-concluido",
      data: { situacao: "concluido", encerradoEm: "2026-10-28T12:01:00Z" },
    });
  });

  it("a situação em data também conta: a mesma linha com outra situação é trocada", () => {
    const anteriores = arestasDosBixinhos(nos, conversas);
    const iguais = anteriores.map((aresta) => ({ ...aresta, data: aresta.data === undefined ? undefined : { ...aresta.data } }));
    const s1Falhou = anteriores.map((aresta, indice) =>
      indice === 0 ? { ...aresta, data: { situacao: "falhou" as const, encerradoEm: "2026-10-28T12:00:00Z" } } : aresta,
    );

    expect(reaproveitarArestas(anteriores, iguais)).toBe(anteriores);
    const novas = reaproveitarArestas(anteriores, s1Falhou);
    expect(novas).not.toBe(anteriores);
    expect(novas[0]?.data).toEqual({ situacao: "falhou", encerradoEm: "2026-10-28T12:00:00Z" });
    expect(novas[1]).toBe(anteriores[1]);
  });

  it("a hora do fim em data também conta: a mesma linha com outro encerradoEm é trocada", () => {
    const anteriores = arestasDosBixinhos(nos, conversas);
    const outroFim = anteriores.map((aresta, indice) =>
      indice === 0 ? { ...aresta, data: { situacao: "concluido" as const, encerradoEm: "2026-10-28T12:05:00Z" } } : aresta,
    );

    const novas = reaproveitarArestas(anteriores, outroFim);

    expect(novas).not.toBe(anteriores);
    expect(novas[0]?.data).toEqual({ situacao: "concluido", encerradoEm: "2026-10-28T12:05:00Z" });
    expect(novas[1]).toBe(anteriores[1]);
  });

  it("um bixinho que sai leva a linha embora", () => {
    const anteriores = arestasDosBixinhos(nos, conversas);
    const semS1 = nos.filter((no) => no.id !== idDoBixinho("o1", "s1"));

    const novas = reaproveitarArestas(anteriores, arestasDosBixinhos(semS1, conversas));

    expect(novas.map((aresta) => aresta.target)).toEqual([idDoBixinho("o1", "s2")]);
    expect(novas[0]).toBe(anteriores[1]);
  });

  it("recria a linha do bixinho que troca de lado, e mantém tudo quando ele se move sem trocar", () => {
    const anteriores = arestasDosBixinhos(nos, conversas);
    const s1 = nos.find((no) => no.id === idDoBixinho("o1", "s1"));
    const umPoucoAoLado = comBixinhoEm(nos, "s1", (s1?.position.x ?? 0) + 40, (s1?.position.y ?? 0) + 30);

    expect(reaproveitarArestas(anteriores, arestasDosBixinhos(umPoucoAoLado, conversas))).toBe(anteriores);

    const novas = reaproveitarArestas(anteriores, arestasDosBixinhos(comBixinhoEm(nos, "s1", 225, -250), conversas));
    expect(novas).not.toBe(anteriores);
    expect(novas[0]).not.toBe(anteriores[0]);
    expect(novas[0]).toMatchObject({ sourceHandle: "cima", targetHandle: "baixo" });
    expect(novas[1]).toBe(anteriores[1]);
  });
});

describe("mesmasLigacoes", () => {
  const nos = sincronizarBixinhos([terminal], new Map([["o1", doisSubagentes]]));
  const bixinhos = nos.filter((no): no is NoBixinho => no.type === "bixinho");

  it("arrastar um bixinho não muda as ligações", () => {
    const arrastados = bixinhos.map((bixinho) => ({ ...bixinho, position: { x: 1, y: 2 } }));

    expect(mesmasLigacoes(bixinhos, arrastados)).toBe(bixinhos);
  });

  it("um bixinho a mais ou a menos muda", () => {
    const menos = bixinhos.slice(1);

    expect(mesmasLigacoes(bixinhos, menos)).toBe(menos);
  });

  it("com os terminais: arrastar o terminal ou um bixinho sem trocar de lado não muda", () => {
    const terminalArrastado = nos.map((no): NoDoCanvas => (no.id === "o1" ? { ...no, position: { x: 900, y: 40 } } : no));
    const s1 = bixinhos[0];
    const bixinhoArrastado = comBixinhoEm(nos, "s1", (s1?.position.x ?? 0) - 60, (s1?.position.y ?? 0) + 200);

    expect(mesmasLigacoes(nos, terminalArrastado)).toBe(nos);
    expect(mesmasLigacoes(nos, bixinhoArrastado)).toBe(nos);
  });

  it("um bixinho que passa para outro lado do terminal muda", () => {
    const acima = comBixinhoEm(nos, "s2", 225, -250);

    expect(mesmasLigacoes(nos, acima)).toBe(acima);
    // E, já acima, subir mais um pouco não muda de novo.
    expect(mesmasLigacoes(acima, comBixinhoEm(acima, "s2", 225, -400))).toBe(acima);
  });

  it("redimensionar o terminal muda só quando a borda passa do bixinho", () => {
    const aDireita = comBixinhoEm(nos, "s1", 620, 0);
    const redimensionado = (largura: number) =>
      aDireita.map((no): NoDoCanvas => (no.id === "o1" ? { ...no, width: largura } : no));

    const umPoucoMaior = redimensionado(610);
    expect(mesmasLigacoes(aDireita, umPoucoMaior)).toBe(aDireita);
    const largo = redimensionado(700);
    expect(mesmasLigacoes(aDireita, largo)).toBe(largo);
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
      artefatos: {},
      previas: {},
      shells: {},
      viewport: null,
    });
  });
});

describe("prévias no canvas", () => {
  const terminal = novoTerminal("o1", { x: 0, y: 0 }, 600, 500);
  const doTerminal = novaPrevia("p1", { x: 700, y: 0 }, { url: "http://localhost:5173", orquestradorId: "o1" });

  it("uma linha tracejada do terminal até a prévia que saiu dele, do lado voltado para ela", () => {
    const solta = novaPrevia("p2", { x: 0, y: 900 }, { url: "", orquestradorId: null });

    expect(arestasDasPrevias([terminal, doTerminal, solta])).toEqual([
      expect.objectContaining({
        id: "aresta:previa:p1",
        type: "default",
        source: "o1",
        sourceHandle: "direita",
        target: "previa:p1",
        targetHandle: "esquerda",
        className: "aresta-previa",
      }),
    ]);
  });

  it("com o terminal fechado, a prévia continua, sem linha", () => {
    expect(arestasDasPrevias([doTerminal])).toEqual([]);
  });

  it("as linhas só mudam quando a prévia troca de lado do terminal", () => {
    const anteriores = [terminal, doTerminal];
    const navegou = [terminal, { ...doTerminal, data: { ...doTerminal.data, url: "http://localhost:3000" } }];
    const foiParaBaixo = [terminal, { ...doTerminal, position: { x: 0, y: 700 } }];

    expect(mesmasLigacoes(anteriores, navegou)).toBe(anteriores);
    expect(mesmasLigacoes(anteriores, foiParaBaixo)).toBe(foiParaBaixo);
  });

  it("a prévia do terminal abre ao lado dele, sem cobrir outra janela", () => {
    const vizinho = novoTerminal("o2", { x: 660, y: 0 }, 600, 500);

    const posicao = posicaoDaPreviaDoTerminal([terminal, vizinho], "o1", { largura: 720, altura: 520 });
    expect(posicao).not.toBeNull();
    expect(
      sobrepoe({ ...(posicao ?? { x: 0, y: 0 }), largura: 720, altura: 520 }, { x: 660, y: 0, largura: 600, altura: 500 }),
    ).toBe(false);
    expect(posicaoDaPreviaDoTerminal([vizinho], "o1", { largura: 720, altura: 520 })).toBeNull();
  });
});
