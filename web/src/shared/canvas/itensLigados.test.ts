import type { NodeChange } from "@xyflow/react";

import type { ResumoDoArtefato } from "../api/artefatos";
import type { DadosDaNota } from "../api/tipos";
import {
  ALCA_DE_LIGACAO,
  arestasDasLigacoes,
  CHEGADA_DA_LIGACAO,
  comItensLigadosJunto,
  desligarItem,
  ehLigacaoValida,
  ehTerminal,
  idDaLigacao,
  idDoBixinho,
  itensLigadosParaEnvio,
  lerIdDaLigacao,
  ligarItem,
  MAXIMO_DE_ITENS_LIGADOS,
  type NoBixinho,
  type NoDoCanvas,
  novaNota,
  novaPrevia,
  novoNoDeArtefato,
  novoShell,
  novoTerminal,
  reaproveitarArestas,
  semLigacoesOrfas,
  semTerminal,
  TAMANHO_MAXIMO_DA_NOTA_LIGADA,
  textoDaNotaLigada,
} from "./nos";

function conexao(source: string, target: string, sourceHandle = ALCA_DE_LIGACAO, targetHandle = CHEGADA_DA_LIGACAO) {
  return { source, target, sourceHandle, targetHandle };
}

function ligadosDe(nos: readonly NoDoCanvas[], terminalId: string): readonly string[] | undefined {
  const terminal = nos.find((no) => no.id === terminalId);
  return terminal !== undefined && ehTerminal(terminal) ? terminal.data.ligados : undefined;
}

const bixinho: NoBixinho = {
  id: idDoBixinho("o1", "s1"),
  type: "bixinho",
  parentId: "o1",
  position: { x: 0, y: 560 },
  data: { orquestradorId: "o1", subagenteId: "s1" },
};

function canvas(): NoDoCanvas[] {
  return [
    novoTerminal("o1", { x: 0, y: 0 }, 600, 500),
    novoTerminal("o2", { x: 1600, y: 0 }, 600, 500),
    novaNota("n1", { x: 800, y: 0 }),
    novaPrevia("p1", { x: 0, y: 700 }, { url: "http://localhost:5173/painel", orquestradorId: null }),
    novoNoDeArtefato("a1", { x: -900, y: 0 }),
    novoShell("s1", { x: 800, y: 700 }, { terminalId: "t1", pasta: "/tmp", orquestradorId: null }),
    bixinho,
  ];
}

describe("ehLigacaoValida", () => {
  it.each(["nota:n1", "previa:p1", "artefato:a1"])("liga %s a um terminal", (item) => {
    expect(ehLigacaoValida(conexao(item, "o1"), canvas())).toBe(true);
  });

  it.each([
    ["terminal a terminal", conexao("o2", "o1")],
    ["shell a terminal", conexao("shell:s1", "o1")],
    ["bixinho a terminal", conexao(bixinho.id, "o1")],
    ["nota a nota", conexao("nota:n1", "nota:n1")],
    ["nota a prévia", conexao("nota:n1", "previa:p1")],
    ["nota a um nó que não existe", conexao("nota:n1", "o9")],
    ["outra alça de saída", conexao("nota:n1", "o1", "baixo")],
    ["outra alça de chegada", conexao("nota:n1", "o1", ALCA_DE_LIGACAO, "cima")],
  ])("recusa %s", (_caso, proposta) => {
    expect(ehLigacaoValida(proposta, canvas())).toBe(false);
  });
});

describe("ligar e desligar itens", () => {
  it("liga na ordem, ignora a ligação repetida e liga o mesmo item a mais de um terminal", () => {
    let nos = ligarItem(canvas(), conexao("nota:n1", "o1"));
    nos = ligarItem(nos, conexao("previa:p1", "o1"));
    nos = ligarItem(nos, conexao("nota:n1", "o2"));

    expect(ligadosDe(nos, "o1")).toEqual(["nota:n1", "previa:p1"]);
    expect(ligadosDe(nos, "o2")).toEqual(["nota:n1"]);
    expect(ligarItem(nos, conexao("nota:n1", "o1"))).toBe(nos);
    // Uma conexão inválida também não muda nada.
    expect(ligarItem(nos, conexao("shell:s1", "o1"))).toBe(nos);
  });

  it(`para em ${MAXIMO_DE_ITENS_LIGADOS} itens por terminal`, () => {
    const notas = Array.from({ length: MAXIMO_DE_ITENS_LIGADOS + 1 }, (_, indice) => novaNota(`n${indice}`, { x: 0, y: 0 }));
    const nos = notas.reduce<NoDoCanvas[]>(
      (atuais, nota) => ligarItem(atuais, conexao(nota.id, "o1")),
      [novoTerminal("o1", { x: 0, y: 0 }, 600, 500), ...notas],
    );

    expect(ligadosDe(nos, "o1")).toHaveLength(MAXIMO_DE_ITENS_LIGADOS);
    expect(ligadosDe(nos, "o1")).not.toContain(`nota:n${MAXIMO_DE_ITENS_LIGADOS}`);
  });

  it("desliga só o item pedido; sem itens, o terminal fica sem o campo; sem a ligação, o mesmo array", () => {
    const ligados = ligarItem(ligarItem(canvas(), conexao("nota:n1", "o1")), conexao("previa:p1", "o1"));

    const semNota = desligarItem(ligados, "o1", "nota:n1");
    expect(ligadosDe(semNota, "o1")).toEqual(["previa:p1"]);
    const semNada = desligarItem(semNota, "o1", "previa:p1");
    expect(semNada.find((no) => no.id === "o1")?.data).toEqual({ orquestradorId: "o1" });
    expect(desligarItem(semNada, "o1", "previa:p1")).toBe(semNada);
    expect(desligarItem(semNada, "o9", "previa:p1")).toBe(semNada);
  });

  it("fechar o item tira a ligação dos terminais; fechar o terminal leva as dele junto", () => {
    const ligados = ligarItem(ligarItem(canvas(), conexao("nota:n1", "o1")), conexao("nota:n1", "o2"));

    expect(semLigacoesOrfas(ligados)).toBe(ligados);
    const semNota = semLigacoesOrfas(ligados.filter((no) => no.id !== "nota:n1"));
    expect(ligadosDe(semNota, "o1")).toBeUndefined();
    expect(ligadosDe(semNota, "o2")).toBeUndefined();

    const semO1 = semTerminal(ligados, "o1");
    expect(arestasDasLigacoes(semO1).map((aresta) => aresta.id)).toEqual([idDaLigacao("o2", "nota:n1")]);
  });
});

describe("arestasDasLigacoes", () => {
  it("uma linha por item ligado, do lado do terminal voltado para ele, selecionável", () => {
    const nos = ligarItem(
      ligarItem(ligarItem(canvas(), conexao("nota:n1", "o1")), conexao("previa:p1", "o1")),
      conexao("artefato:a1", "o1"),
    );

    const arestas = arestasDasLigacoes(nos);
    expect(arestas.map(({ id, source, sourceHandle, target, targetHandle, type, selectable }) => ({
      id,
      source,
      sourceHandle,
      target,
      targetHandle,
      type,
      selectable,
    }))).toEqual([
      { id: "ligacao:o1:nota:n1", source: "o1", sourceHandle: "direita", target: "nota:n1", targetHandle: "esquerda", type: "ligacao", selectable: true },
      { id: "ligacao:o1:previa:p1", source: "o1", sourceHandle: "baixo", target: "previa:p1", targetHandle: "cima", type: "ligacao", selectable: true },
      { id: "ligacao:o1:artefato:a1", source: "o1", sourceHandle: "esquerda", target: "artefato:a1", targetHandle: "direita", type: "ligacao", selectable: true },
    ]);
    expect(arestas.every((aresta) => aresta.className === "aresta-ligacao" && aresta.selected === false)).toBe(true);
  });

  it("marca a selecionada, e selecionar troca a linha reaproveitada", () => {
    const nos = ligarItem(canvas(), conexao("nota:n1", "o1"));
    const antes = arestasDasLigacoes(nos);
    const id = idDaLigacao("o1", "nota:n1");

    expect(reaproveitarArestas(antes, arestasDasLigacoes(nos))).toBe(antes);
    const selecionadas = reaproveitarArestas(antes, arestasDasLigacoes(nos, id));
    expect(selecionadas).not.toBe(antes);
    expect(selecionadas[0]?.selected).toBe(true);
    expect(lerIdDaLigacao(id, nos)).toEqual({ terminalId: "o1", itemId: "nota:n1" });
    expect(lerIdDaLigacao("aresta:previa:p1", nos)).toBeNull();
  });
});

describe("comItensLigadosJunto", () => {
  const mover = (id: string, x: number, y: number): NodeChange<NoDoCanvas> => ({
    type: "position",
    id,
    position: { x, y },
    dragging: true,
  });

  it("leva junto, com o mesmo deslocamento, os itens ligados só ao terminal movido", () => {
    const nos = ligarItem(ligarItem(canvas(), conexao("nota:n1", "o1")), conexao("previa:p1", "o1"));

    expect(comItensLigadosJunto([mover("o1", 30, -20)], nos)).toEqual([
      mover("o1", 30, -20),
      { type: "position", id: "nota:n1", position: { x: 830, y: -20 } },
      { type: "position", id: "previa:p1", position: { x: 30, y: 680 } },
    ]);
  });

  it("um item ligado a dois terminais fica onde está, e um que já se move junto não anda em dobro", () => {
    let nos = ligarItem(ligarItem(canvas(), conexao("nota:n1", "o1")), conexao("nota:n1", "o2"));
    nos = ligarItem(nos, conexao("previa:p1", "o1"));
    const mudancas = [mover("o1", 30, 0), mover("previa:p1", 30, 700)];

    expect(comItensLigadosJunto(mudancas, nos)).toBe(mudancas);
  });

  it("sem terminal movido (ou sem itens ligados), as mesmas mudanças", () => {
    const nos = ligarItem(canvas(), conexao("nota:n1", "o1"));
    const soANota = [mover("nota:n1", 5, 5)];
    const terminalSemItens = [mover("o2", 1700, 0)];
    const selecao: NodeChange<NoDoCanvas>[] = [{ type: "select", id: "o1", selected: true }];

    expect(comItensLigadosJunto(soANota, nos)).toBe(soANota);
    expect(comItensLigadosJunto(terminalSemItens, nos)).toBe(terminalSemItens);
    expect(comItensLigadosJunto(selecao, nos)).toBe(selecao);
  });
});

describe("itensLigadosParaEnvio", () => {
  const nota = (texto: string): DadosDaNota => ({
    id: "n1",
    titulo: "Ideias",
    texto,
    criadaEm: "2026-11-08T12:00:00Z",
    atualizadaEm: "2026-11-08T12:00:00Z",
  });
  const artefato = (origem: ResumoDoArtefato["origem"]): ResumoDoArtefato => ({
    id: "a1",
    titulo: "Relatório",
    formato: "html",
    origem,
    arquivo: "relatorio.html",
    criadoEm: "2026-11-08T12:00:00Z",
    atualizadoEm: "2026-11-08T12:00:00Z",
    versaoAtual: 1,
    versoes: [],
  });

  function todosLigados(): NoDoCanvas[] {
    return ["nota:n1", "previa:p1", "artefato:a1"].reduce((nos, item) => ligarItem(nos, conexao(item, "o1")), canvas());
  }

  it("monta a nota com o texto, a prévia com o endereço e o artefato com o arquivo, na ordem em que foram ligados", () => {
    const itens = itensLigadosParaEnvio(todosLigados(), "o1", {
      lerNota: () => nota("comprar café"),
      lerArtefato: () => artefato({ tipo: "orquestrador", id: "o7" }),
    });

    expect(itens).toEqual([
      { tipo: "nota", titulo: "Ideias", conteudo: "comprar café" },
      { tipo: "previa", titulo: "localhost:5173", url: "http://localhost:5173/painel" },
      { tipo: "artefato", titulo: "Relatório", caminho: "orquestradores/o7/relatorio.html" },
    ]);
  });

  it("o artefato do chat vem da pasta do chat; itens que ainda não chegaram do servidor ficam de fora", () => {
    const itens = itensLigadosParaEnvio(todosLigados(), "o1", {
      lerNota: () => undefined,
      lerArtefato: () => artefato({ tipo: "chat", id: null }),
    });

    expect(itens.map((item) => item.tipo)).toEqual(["previa", "artefato"]);
    expect(itens[1]?.caminho).toBe("chat/relatorio.html");
  });

  it("a prévia sem endereço não vai; terminal sem itens (ou fora do canvas), nada", () => {
    const nos = ligarItem(
      [novoTerminal("o1", { x: 0, y: 0 }, 600, 500), novaPrevia("p1", { x: 0, y: 700 }, { url: "", orquestradorId: null })],
      conexao("previa:p1", "o1"),
    );
    const leitores = { lerNota: () => undefined, lerArtefato: () => undefined };

    expect(itensLigadosParaEnvio(nos, "o1", leitores)).toEqual([]);
    expect(itensLigadosParaEnvio(canvas(), "o2", leitores)).toEqual([]);
    expect(itensLigadosParaEnvio(canvas(), "o9", leitores)).toEqual([]);
  });

  it(`corta a nota em ${TAMANHO_MAXIMO_DA_NOTA_LIGADA} caracteres, com o aviso do corte`, () => {
    const longa = "a".repeat(9_000);
    const cortada = textoDaNotaLigada(longa);

    expect(cortada).toHaveLength(TAMANHO_MAXIMO_DA_NOTA_LIGADA);
    expect(cortada.endsWith("[… nota cortada aqui: ela tem 9.000 caracteres]")).toBe(true);
    expect(textoDaNotaLigada("curta")).toBe("curta");
    const exata = "b".repeat(TAMANHO_MAXIMO_DA_NOTA_LIGADA);
    expect(textoDaNotaLigada(exata)).toBe(exata);

    const nos = ligarItem(canvas(), conexao("nota:n1", "o1"));
    const [item] = itensLigadosParaEnvio(nos, "o1", { lerNota: () => nota(longa), lerArtefato: () => undefined });
    expect(item?.conteudo).toBe(cortada);
  });
});
