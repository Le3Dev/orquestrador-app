import { fireEvent, render, screen } from "@testing-library/react";
import type { HandleProps, NodeProps } from "@xyflow/react";
import type { ReactNode } from "react";

import type { DadosDaConfiguracao, EventoDeOrquestracao, EventoRegistrado } from "../../shared/api/tipos";
import { aparenciaDoBixinho } from "../../shared/canvas/bixinhos";
import { ContextoDoCanvas, type ValorDoCanvas } from "../../shared/canvas/contexto";
import { idDoBixinho, type NoBixinho as TipoDoNo } from "../../shared/canvas/nos";
import { aplicarEvento, ESTADO_INICIAL, type EstadoDaConversa } from "../../shared/estado/aplicarEvento";
import { NoBixinho } from "./NoBixinho";

const simulados = vi.hoisted(() => ({
  // Chamado uma vez por renderização do conteúdo do bixinho: serve de contador.
  useRelogio: vi.fn(() => new Date("2026-10-28T12:00:05Z")),
  barraDoNo: vi.fn(),
  // Chamado uma vez por desenho das células do bixinho.
  pixelsDoCorpo: vi.fn(),
  fecharBixinho: vi.fn(),
}));

vi.mock("../../shared/hooks/useRelogio", () => ({ useRelogio: simulados.useRelogio }));

vi.mock("../../shared/canvas/sprites", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../shared/canvas/sprites")>();
  simulados.pixelsDoCorpo.mockImplementation(original.pixelsDoCorpo);
  return { ...original, pixelsDoCorpo: simulados.pixelsDoCorpo };
});

// Fora de um <ReactFlow> de verdade, as âncoras e a barra do nó não têm onde se
// pendurar: a âncora vira só uma marca com o id, o tipo e o lado.
vi.mock("@xyflow/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@xyflow/react")>()),
  Handle: ({ id, type, position }: HandleProps) => (
    <i data-testid="ancora" data-id={id ?? undefined} data-tipo={type} data-lado={position} />
  ),
  NodeToolbar: ({ children, isVisible }: { children?: ReactNode; isVisible?: boolean }) => {
    simulados.barraDoNo(isVisible);
    return <div data-testid="barra-do-no">{children}</div>;
  },
}));

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

function aplicar(estado: EstadoDaConversa, ...eventos: EventoDeOrquestracao[]): EstadoDaConversa {
  return eventos
    .map(
      (evento, indice): EventoRegistrado => ({
        ...evento,
        sequencia: estado.ultimaSequencia + indice + 1,
        em: "2026-10-28T12:00:00Z",
      }),
    )
    .reduce(aplicarEvento, estado);
}

function progresso(subagenteId: string, atividade: string, ultimaFerramenta = "Read"): EventoDeOrquestracao {
  return {
    tipo: "progresso_do_subagente",
    turnoId: "t1",
    subagenteId,
    atividade,
    ultimaFerramenta,
    tokens: 1200,
    ferramentasUsadas: 2,
    duracaoMs: 5000,
  };
}

function doisTrabalhando(): EstadoDaConversa {
  return aplicar(
    ESTADO_INICIAL,
    { tipo: "turno_iniciado", turnoId: "t1", texto: "analise", configuracao },
    { tipo: "subagente_iniciado", turnoId: "t1", subagenteId: "s1", descricao: "Domínio", tarefa: "Revisar o domínio" },
    { tipo: "subagente_iniciado", turnoId: "t1", subagenteId: "s2", descricao: "Testes", tarefa: "Rodar os testes" },
  );
}

function valorDoCanvas(conversa: EstadoDaConversa, bixinhosSaindo?: ReadonlySet<string>): ValorDoCanvas {
  return {
    orquestradores: new Map(),
    conversas: new Map([["o1", conversa]]),
    conexoes: new Map(),
    sinais: new Map(),
    bixinhosLimpos: new Map(),
    bixinhosSaindo,
    servidor: { conectado: true, caiuEm: null, voltouEm: null, reiniciou: false, memoria: null },
    acoes: {
      abrirTerminal: vi.fn(),
      fecharTerminal: vi.fn(),
      minimizarOuRestaurarTerminal: vi.fn(),
      limparBixinhos: vi.fn(),
      fecharBixinho: simulados.fecharBixinho,
      orquestradorCriado: vi.fn(),
      descartarRascunho: vi.fn(),
      mudarEscalaDaLetra: vi.fn(),
      recarregar: vi.fn(async () => undefined),
      abrirPrevia: vi.fn(),
      navegarPrevia: vi.fn(),
      minimizarOuRestaurarPrevia: vi.fn(),
      fecharPrevia: vi.fn(),
    },
  };
}

function propsDoNo(subagenteId: string, selected: boolean, x: number): NodeProps<TipoDoNo> {
  return {
    id: idDoBixinho("o1", subagenteId),
    type: "bixinho",
    data: { orquestradorId: "o1", subagenteId },
    selected,
    selectable: true,
    draggable: true,
    deletable: true,
    dragging: false,
    zIndex: 0,
    isConnectable: false,
    positionAbsoluteX: x,
    positionAbsoluteY: 0,
  };
}

function tela(
  conversa: EstadoDaConversa,
  subagenteId: string,
  selected = false,
  x = 0,
  bixinhosSaindo?: ReadonlySet<string>,
) {
  return (
    <ContextoDoCanvas.Provider value={valorDoCanvas(conversa, bixinhosSaindo)}>
      <NoBixinho {...propsDoNo(subagenteId, selected, x)} />
    </ContextoDoCanvas.Provider>
  );
}

describe("NoBixinho", () => {
  // `clearAllMocks` limpa as chamadas, mas mantém a implementação original de `pixelsDoCorpo`.
  beforeEach(() => vi.clearAllMocks());

  it("executando, mostra o ícone da última ferramenta; trocar de ferramenta não redesenha o bixinho", () => {
    const inicio = doisTrabalhando();
    const { rerender } = render(tela(inicio, "s1"));
    // Sem ferramenta ainda: sem ícone.
    expect(screen.queryByRole("img")).not.toBeInTheDocument();

    const lendo = aplicar(inicio, progresso("s1", "Reading src/a.ts", "Read"));
    rerender(tela(lendo, "s1"));
    expect(screen.getByRole("img", { name: "lendo" })).toHaveAttribute("title", "lendo");
    const desenhos = simulados.pixelsDoCorpo.mock.calls.length;
    expect(desenhos).toBeGreaterThan(0);

    const rodando = aplicar(lendo, progresso("s1", "npm test", "Bash"));
    rerender(tela(rodando, "s1"));
    expect(screen.getByRole("img", { name: "rodando comando" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "lendo" })).not.toBeInTheDocument();

    const editando = aplicar(rodando, progresso("s1", "Editing src/a.ts", "edit"));
    rerender(tela(editando, "s1"));
    expect(screen.getByRole("img", { name: "editando" })).toBeInTheDocument();

    const pesquisando = aplicar(editando, progresso("s1", "buscando", "WebSearch"));
    rerender(tela(pesquisando, "s1"));
    expect(screen.getByRole("img", { name: "pesquisando na web" })).toBeInTheDocument();
    // As células do bixinho não foram refeitas a cada evento.
    expect(simulados.pixelsDoCorpo.mock.calls.length).toBe(desenhos);
  });

  it("ferramenta desconhecida (ou de MCP): sem ícone", () => {
    const conversa = aplicar(doisTrabalhando(), progresso("s1", "consultando", "mcp__github__get_issue"));
    render(tela(conversa, "s1"));

    expect(screen.getByText("consultando")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("concluído, o ícone some, mesmo com a última ferramenta conhecida", () => {
    const lendo = aplicar(doisTrabalhando(), progresso("s1", "Reading src/a.ts", "Read"));
    const { rerender } = render(tela(lendo, "s1"));
    expect(screen.getByRole("img", { name: "lendo" })).toBeInTheDocument();

    const concluiu = aplicar(lendo, {
      tipo: "subagente_concluido",
      turnoId: "t1",
      subagenteId: "s1",
      situacao: "concluido",
      resumo: "feito",
      tokens: 10,
      duracaoMs: 1000,
    });
    rerender(tela(concluiu, "s1"));

    expect(screen.getByText("pronto!")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("não redesenha o bixinho quando muda outro Subagente, só quando muda o próprio", () => {
    const inicio = doisTrabalhando();
    const { rerender } = render(tela(inicio, "s1"));
    expect(simulados.useRelogio).toHaveBeenCalledTimes(1);

    // O s2 avança: o contexto muda, mas o s1 continua o mesmo objeto.
    const outroMudou = aplicar(inicio, progresso("s2", "rodando os testes"));
    rerender(tela(outroMudou, "s1"));
    expect(simulados.useRelogio).toHaveBeenCalledTimes(1);

    // Arrastar o terminal muda a posição do nó a cada quadro.
    rerender(tela(outroMudou, "s1", false, 240));
    expect(simulados.useRelogio).toHaveBeenCalledTimes(1);

    const proprioMudou = aplicar(outroMudou, progresso("s1", "lendo o domínio"));
    rerender(tela(proprioMudou, "s1", false, 240));
    expect(simulados.useRelogio).toHaveBeenCalledTimes(2);
    expect(screen.getByText("lendo o domínio")).toBeInTheDocument();
  });

  it("monta a ficha (NodeToolbar) só com o bixinho selecionado", () => {
    const conversa = doisTrabalhando();
    const { rerender } = render(tela(conversa, "s1"));

    expect(simulados.barraDoNo).not.toHaveBeenCalled();
    expect(screen.queryByTestId("barra-do-no")).not.toBeInTheDocument();
    expect(screen.queryByText("Revisar o domínio")).not.toBeInTheDocument();

    rerender(tela(conversa, "s1", true));
    expect(simulados.barraDoNo).toHaveBeenLastCalledWith(true);
    expect(screen.getByTestId("barra-do-no")).toHaveTextContent("Revisar o domínio");

    rerender(tela(conversa, "s1", false));
    expect(screen.queryByTestId("barra-do-no")).not.toBeInTheDocument();
  });

  it("tem uma âncora de chegada em cada lado, para a linha vir pelo lado voltado ao terminal", () => {
    render(tela(doisTrabalhando(), "s1"));

    expect(
      screen.getAllByTestId("ancora").map((ancora) => [ancora.dataset.id, ancora.dataset.tipo, ancora.dataset.lado]),
    ).toEqual([
      ["cima", "target", "top"],
      ["baixo", "target", "bottom"],
      ["esquerda", "target", "left"],
      ["direita", "target", "right"],
    ]);
  });

  /** O rótulo do nó, embaixo do desenho: nome (com o papel do workflow) e #id. */
  const rotulo = (container: HTMLElement) => container.querySelector(".no-bixinho > .font-titulo");

  it("subagente pronto: o nome dele é o rótulo, sem o nome do bicho; o bicho fica só como detalhe da ficha", () => {
    const bicho = aparenciaDoBixinho("s3").nome;
    const conversa = aplicar(doisTrabalhando(), {
      tipo: "subagente_iniciado",
      turnoId: "t1",
      subagenteId: "s3",
      descricao: "Revisar",
      tarefa: "Revise o diff",
      papel: "revisor",
    });
    const { container } = render(tela(conversa, "s3", true));

    expect(rotulo(container)?.textContent).toMatch(/^revisor#/);
    expect(rotulo(container)).not.toHaveTextContent(bicho);
    expect(screen.getByTitle(/^revisor · clique para ver a tarefa/)).toBeInTheDocument();
    const ficha = screen.getByTestId("barra-do-no");
    expect(ficha.querySelector(".font-titulo")?.textContent).toMatch(new RegExp(`^revisor ${bicho}#`));
    expect(ficha).not.toHaveTextContent("revisor#");
  });

  it("subagente pronto de nome longo: o nome corta com reticências e o #id continua visível", () => {
    const conversa = aplicar(doisTrabalhando(), {
      tipo: "subagente_iniciado",
      turnoId: "t1",
      subagenteId: "s3",
      descricao: "Roteiro",
      tarefa: "Escreva o roteiro",
      papel: "diretor-de-video-institucional",
    });
    render(tela(conversa, "s3"));

    const nome = screen.getByText("diretor-de-video-institucional");
    expect(nome).toHaveClass("min-w-0", "truncate");
    expect(screen.getByText("#s3")).toHaveClass("shrink-0");
    expect(screen.getByTitle(/^diretor-de-video-institucional · clique para ver a tarefa/)).toBeInTheDocument();
  });

  it("workflow: como antes, o nome do bicho com o papel ao lado", () => {
    const bicho = aparenciaDoBixinho("s3").nome;
    const conversa = aplicar(doisTrabalhando(), {
      tipo: "subagente_iniciado",
      turnoId: "t1",
      subagenteId: "s3",
      descricao: "Fluxo",
      tarefa: "Rode o fluxo",
      papel: "workflow",
    });
    const { container } = render(tela(conversa, "s3", true));

    expect(rotulo(container)?.textContent).toMatch(new RegExp(`^${bicho} · workflow#`));
    expect(screen.getByTestId("barra-do-no")).toHaveTextContent("workflow#");
  });

  it("executor: o papel fica no tooltip e na ficha, não no rótulo", () => {
    const conversa = aplicar(doisTrabalhando(), {
      tipo: "subagente_iniciado",
      turnoId: "t1",
      subagenteId: "s3",
      descricao: "Ler",
      tarefa: "Leia o README",
      papel: "executor",
    });
    const { container } = render(tela(conversa, "s3", true));

    expect(rotulo(container)?.textContent).toMatch(new RegExp(`^${aparenciaDoBixinho("s3").nome}#`));
    expect(screen.queryByText("· executor", { exact: false })).not.toBeInTheDocument();
    expect(screen.getByTitle(/^executor · clique para ver a tarefa/)).toBeInTheDocument();
    expect(screen.getByTestId("barra-do-no")).toHaveTextContent("executor#");
  });

  it("evento antigo, sem papel: como antes (só o nome no rótulo, executor na ficha)", () => {
    render(tela(doisTrabalhando(), "s1", true));

    expect(screen.getByTitle("Clique para ver a tarefa e o relatório")).toBeInTheDocument();
    expect(screen.getByTestId("barra-do-no")).toHaveTextContent("executor#");
  });

  it("saindo sozinho do canvas, ganha a classe da saída (encolhe e some) e mantém a expressão final", () => {
    const concluiu = aplicar(doisTrabalhando(), {
      tipo: "subagente_concluido",
      turnoId: "t1",
      subagenteId: "s1",
      situacao: "concluido",
      resumo: "feito",
      tokens: 10,
      duracaoMs: 1000,
    });
    const { container, rerender } = render(tela(concluiu, "s1"));
    const no = () => container.querySelector(".no-bixinho");
    expect(no()).not.toHaveClass("no-bixinho-saindo");

    rerender(tela(concluiu, "s1", false, 0, new Set([idDoBixinho("o1", "s1")])));

    expect(no()).toHaveClass("no-bixinho", "no-bixinho-concluido", "no-bixinho-saindo");
    expect(screen.getByText("pronto!")).toBeInTheDocument();

    // Só o próprio: outro bixinho saindo não muda este.
    rerender(tela(concluiu, "s1", false, 0, new Set([idDoBixinho("o1", "s2")])));
    expect(no()).not.toHaveClass("no-bixinho-saindo");
  });

  describe("fechar (×)", () => {
    function terminou(estado: EstadoDaConversa, subagenteId: string, situacao: "concluido" | "falhou" | "cancelado") {
      return aplicar(estado, {
        tipo: "subagente_concluido",
        turnoId: "t1",
        subagenteId,
        situacao,
        resumo: "erro ao rodar",
        tokens: 10,
        duracaoMs: 1000,
      });
    }

    it("falhou: mostra o × com o nome do subagente; executando: sem ×", () => {
      const conversa = terminou(doisTrabalhando(), "s1", "falhou");
      const { rerender } = render(tela(conversa, "s1"));
      expect(screen.getByRole("button", { name: `Fechar subagente ${aparenciaDoBixinho("s1").nome}` })).toHaveAttribute(
        "title",
        expect.stringContaining("Fechar subagente"),
      );

      rerender(tela(conversa, "s2"));
      expect(screen.queryByRole("button", { name: /^Fechar subagente/ })).not.toBeInTheDocument();
    });

    it("com papel, o nome no rótulo é o papel", () => {
      const conversa = terminou(
        aplicar(doisTrabalhando(), {
          tipo: "subagente_iniciado",
          turnoId: "t1",
          subagenteId: "s3",
          descricao: "Revisar",
          tarefa: "Revise o diff",
          papel: "revisor",
        }),
        "s3",
        "falhou",
      );
      render(tela(conversa, "s3"));

      expect(screen.getByRole("button", { name: "Fechar subagente revisor" })).toBeInTheDocument();
    });

    it("concluído e cancelado também ganham o ×", () => {
      const concluido = terminou(doisTrabalhando(), "s1", "concluido");
      const { rerender } = render(tela(concluido, "s1"));
      expect(screen.getByRole("button", { name: /^Fechar subagente/ })).toBeInTheDocument();

      rerender(tela(terminou(doisTrabalhando(), "s1", "cancelado"), "s1"));
      expect(screen.getByRole("button", { name: /^Fechar subagente/ })).toBeInTheDocument();
    });

    it("o clique chama a ação com o orquestrador e o subagente certos e não chega ao nó", () => {
      const aoClicarNoNo = vi.fn();
      const conversa = terminou(doisTrabalhando(), "s2", "falhou");
      render(<div onClick={aoClicarNoNo}>{tela(conversa, "s2")}</div>);

      fireEvent.click(screen.getByRole("button", { name: /^Fechar subagente/ }));

      expect(simulados.fecharBixinho).toHaveBeenCalledTimes(1);
      expect(simulados.fecharBixinho).toHaveBeenCalledWith("o1", "s2");
      expect(aoClicarNoNo).not.toHaveBeenCalled();
    });

    it("o × é nodrag, para não arrastar o nó", () => {
      render(tela(terminou(doisTrabalhando(), "s1", "falhou"), "s1"));

      expect(screen.getByRole("button", { name: /^Fechar subagente/ })).toHaveClass("nodrag");
    });
  });

  it("sem o Subagente na conversa, não desenha nada", () => {
    const { container } = render(tela(doisTrabalhando(), "s9"));

    expect(container).toBeEmptyDOMElement();
    expect(simulados.useRelogio).not.toHaveBeenCalled();
  });
});
