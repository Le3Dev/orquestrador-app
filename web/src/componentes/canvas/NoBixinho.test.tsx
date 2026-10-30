import { render, screen } from "@testing-library/react";
import type { NodeProps } from "@xyflow/react";
import type { ReactNode } from "react";

import type { DadosDaConfiguracao, EventoDeOrquestracao, EventoRegistrado } from "../../shared/api/tipos";
import { ContextoDoCanvas, type ValorDoCanvas } from "../../shared/canvas/contexto";
import { idDoBixinho, type NoBixinho as TipoDoNo } from "../../shared/canvas/nos";
import { aplicarEvento, ESTADO_INICIAL, type EstadoDaConversa } from "../../shared/estado/aplicarEvento";
import { NoBixinho } from "./NoBixinho";

const simulados = vi.hoisted(() => ({
  // Chamado uma vez por renderização do conteúdo do bixinho: serve de contador.
  useRelogio: vi.fn(() => new Date("2026-10-28T12:00:05Z")),
  barraDoNo: vi.fn(),
}));

vi.mock("../../shared/hooks/useRelogio", () => ({ useRelogio: simulados.useRelogio }));

// Fora de um <ReactFlow> de verdade, a âncora e a barra do nó não têm onde se pendurar.
vi.mock("@xyflow/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@xyflow/react")>()),
  Handle: () => null,
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

function progresso(subagenteId: string, atividade: string): EventoDeOrquestracao {
  return {
    tipo: "progresso_do_subagente",
    turnoId: "t1",
    subagenteId,
    atividade,
    ultimaFerramenta: "Read",
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

function valorDoCanvas(conversa: EstadoDaConversa): ValorDoCanvas {
  return {
    orquestradores: new Map(),
    conversas: new Map([["o1", conversa]]),
    conexoes: new Map(),
    sinais: new Map(),
    bixinhosLimpos: new Map(),
    servidor: { conectado: true, caiuEm: null, voltouEm: null, reiniciou: false, memoria: null },
    acoes: {
      abrirTerminal: vi.fn(),
      fecharTerminal: vi.fn(),
      limparBixinhos: vi.fn(),
      orquestradorCriado: vi.fn(),
      descartarRascunho: vi.fn(),
      recarregar: vi.fn(async () => undefined),
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

function tela(conversa: EstadoDaConversa, subagenteId: string, selected = false, x = 0) {
  return (
    <ContextoDoCanvas.Provider value={valorDoCanvas(conversa)}>
      <NoBixinho {...propsDoNo(subagenteId, selected, x)} />
    </ContextoDoCanvas.Provider>
  );
}

describe("NoBixinho", () => {
  beforeEach(() => vi.clearAllMocks());

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

  it("sem o Subagente na conversa, não desenha nada", () => {
    const { container } = render(tela(doisTrabalhando(), "s9"));

    expect(container).toBeEmptyDOMElement();
    expect(simulados.useRelogio).not.toHaveBeenCalled();
  });
});
