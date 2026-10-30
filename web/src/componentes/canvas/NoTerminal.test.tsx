import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type NodeProps, ReactFlowProvider } from "@xyflow/react";
import type { ComponentProps } from "react";

import { api } from "../../shared/api/cliente";
import type {
  DadosDaConfiguracao,
  EventoDeOrquestracao,
  EventoRegistrado,
  ResumoDoOrquestrador,
} from "../../shared/api/tipos";
import { ContextoDoCanvas, type ValorDoCanvas } from "../../shared/canvas/contexto";
import type { NoTerminal as TipoDoNo } from "../../shared/canvas/nos";
import { aplicarEvento, ESTADO_INICIAL, type EstadoDaConversa } from "../../shared/estado/aplicarEvento";
import { NoTerminal, PainelDeConfiguracao } from "./NoTerminal";

const contagem = vi.hoisted(() => ({ analises: 0, transcricoes: 0 }));

// Conta as análises de Markdown sem mudar o que o react-markdown produz.
vi.mock("react-markdown", async (importOriginal) => {
  const original = await importOriginal<typeof import("react-markdown")>();
  return {
    ...original,
    default: (opcoes: Parameters<typeof original.default>[0]) => {
      contagem.analises += 1;
      return original.default(opcoes);
    },
  };
});

// Conta as vezes que a transcrição renderiza de fato. O invólucro é memorizado
// como a original: só passa adiante quando o terminal entrega props diferentes.
vi.mock("./TranscricaoDoTerminal", async (importOriginal) => {
  const { createElement, memo } = await import("react");
  const original = await importOriginal<typeof import("./TranscricaoDoTerminal")>();
  const Contada = memo(function TranscricaoContada(props: ComponentProps<typeof original.TranscricaoDoTerminal>) {
    contagem.transcricoes += 1;
    return createElement(original.TranscricaoDoTerminal, props);
  });
  return { ...original, TranscricaoDoTerminal: Contada };
});

const configuracao: DadosDaConfiguracao = {
  modeloDoOrquestrador: "opus",
  esforcoDoOrquestrador: "padrao",
  modeloDosSubagentes: "sonnet",
  esforcoDosSubagentes: "padrao",
  quantidadeDeSubagentes: { modo: "automatica", limite: 3 },
  nivelDePermissao: "edicao_e_comandos",
  permitirCommitEPush: false,
};

function orquestrador(alteracoes: Partial<DadosDaConfiguracao> = {}): ResumoDoOrquestrador {
  return {
    id: "o1",
    nome: "Painel de salas",
    pastaDeTrabalho: "C:\\projetos\\painel",
    nomeDaPasta: "painel",
    situacao: "ocioso",
    configuracao: { ...configuracao, ...alteracoes },
    criadoEm: "2026-10-28T12:00:00Z",
    totalDeTurnos: 0,
    ultimoTurno: null,
    worktree: null,
  };
}

function renderizar(resumo: ResumoDoOrquestrador) {
  const aoFechar = vi.fn();
  const canvas: ValorDoCanvas = {
    orquestradores: new Map([[resumo.id, resumo]]),
    conversas: new Map(),
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
  render(
    <ContextoDoCanvas.Provider value={canvas}>
      <PainelDeConfiguracao orquestrador={resumo} trabalhando={false} aoFechar={aoFechar} />
    </ContextoDoCanvas.Provider>,
  );
  return { aoFechar, opcao: screen.getByRole("checkbox", { name: "Permitir commit e push quando eu pedir" }) };
}

describe("PainelDeConfiguracao", () => {
  afterEach(() => vi.restoreAllMocks());

  it("commit e push começam desligados e, ligados, vão no PATCH junto com o resto da configuração", async () => {
    const alterar = vi.spyOn(api, "alterarConfiguracao").mockResolvedValue(orquestrador({ permitirCommitEPush: true }));
    const { aoFechar, opcao } = renderizar(orquestrador());

    expect(opcao).not.toBeChecked();
    fireEvent.click(opcao);
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(aoFechar).toHaveBeenCalledTimes(1));
    expect(alterar).toHaveBeenCalledWith("o1", { ...configuracao, permitirCommitEPush: true });
  });

  it("carrega a opção já ligada e permite desligar", async () => {
    const alterar = vi.spyOn(api, "alterarConfiguracao").mockResolvedValue(orquestrador());
    const { aoFechar, opcao } = renderizar(orquestrador({ permitirCommitEPush: true }));

    expect(opcao).toBeChecked();
    fireEvent.click(opcao);
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(aoFechar).toHaveBeenCalledTimes(1));
    expect(alterar).toHaveBeenCalledWith("o1", { ...configuracao, permitirCommitEPush: false });
  });

  it("carrega o esforço salvo e envia o escolhido no PATCH junto com o resto da configuração", async () => {
    const alterar = vi.spyOn(api, "alterarConfiguracao").mockResolvedValue(orquestrador());
    const { aoFechar } = renderizar(orquestrador({ esforcoDoOrquestrador: "alto" }));
    const dosSubagentes = screen.getByRole("combobox", { name: "Esforço dos subagentes" });

    expect(screen.getByRole("combobox", { name: "Esforço do orquestrador" })).toHaveValue("alto");
    expect(dosSubagentes).toHaveValue("padrao");
    fireEvent.change(dosSubagentes, { target: { value: "baixo" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(aoFechar).toHaveBeenCalledTimes(1));
    expect(alterar).toHaveBeenCalledWith("o1", {
      ...configuracao,
      esforcoDoOrquestrador: "alto",
      esforcoDosSubagentes: "baixo",
    });
  });

  it("se o servidor recusar, mostra o erro e o painel continua aberto", async () => {
    vi.spyOn(api, "alterarConfiguracao").mockRejectedValue(new Error("Opção de commit e push inválida."));
    const { aoFechar, opcao } = renderizar(orquestrador());

    fireEvent.click(opcao);
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(await screen.findByText("Opção de commit e push inválida.")).toBeInTheDocument();
    expect(aoFechar).not.toHaveBeenCalled();
    expect(opcao).toBeChecked();
  });
});

const USO = { duracaoMs: 1000, tokensDeEntrada: 1, tokensDeSaida: 1, subagentesLancados: 0 };

/** Aplica os eventos em sequência, continuando de onde a conversa parou. */
function aplicar(conversa: EstadoDaConversa, ...eventos: EventoDeOrquestracao[]): EstadoDaConversa {
  return eventos
    .map(
      (evento, indice): EventoRegistrado => ({
        ...evento,
        sequencia: conversa.ultimaSequencia + indice + 1,
        em: "2026-10-28T12:00:00Z",
      }),
    )
    .reduce(aplicarEvento, conversa);
}

/** Um pedido concluído (com resposta em Markdown) e outro em andamento. */
function conversaDoTerminal(): EstadoDaConversa {
  return aplicar(
    ESTADO_INICIAL,
    { tipo: "turno_iniciado", turnoId: "t1", texto: "resuma o projeto", configuracao },
    { tipo: "turno_concluido", turnoId: "t1", resposta: "## Resumo\n\n**primeira** resposta", uso: USO },
    { tipo: "turno_iniciado", turnoId: "t2", texto: "corrija o bug", configuracao },
  );
}

function canvasDoTerminal(conversa: EstadoDaConversa): ValorDoCanvas {
  return {
    orquestradores: new Map([["o1", orquestrador()]]),
    conversas: new Map([["o1", conversa]]),
    conexoes: new Map([["o1", "conectado"]]),
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

const DADOS_DO_NO = { orquestradorId: "o1" };

/** As props que o React Flow passa ao nó; no arraste, mudam a posição e o `dragging`. */
function propsDoNo(alteracoes: Partial<NodeProps<TipoDoNo>> = {}): NodeProps<TipoDoNo> {
  return {
    id: "o1",
    type: "terminal",
    data: DADOS_DO_NO,
    selected: false,
    selectable: true,
    draggable: true,
    deletable: true,
    isConnectable: false,
    dragging: false,
    zIndex: 0,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    width: 640,
    height: 460,
    ...alteracoes,
  };
}

function Terminal({ canvas, no }: { canvas: ValorDoCanvas; no: NodeProps<TipoDoNo> }) {
  return (
    <ReactFlowProvider>
      <ContextoDoCanvas.Provider value={canvas}>
        <NoTerminal {...no} />
      </ContextoDoCanvas.Provider>
    </ReactFlowProvider>
  );
}

describe("NoTerminal", () => {
  beforeEach(() => {
    // O girador e o relógio do pedido em andamento não disparam no meio do teste.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T12:00:06Z"));
    contagem.analises = 0;
    contagem.transcricoes = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("arrastar (só posição e dragging mudam) não re-renderiza a transcrição nem perde o prompt", () => {
    const canvas = canvasDoTerminal(conversaDoTerminal());
    const { rerender } = render(<Terminal canvas={canvas} no={propsDoNo()} />);
    expect(contagem.transcricoes).toBe(1);
    expect(contagem.analises).toBe(1);

    const campo = screen.getByRole("textbox", { name: "Mensagem para o orquestrador" });
    fireEvent.change(campo, { target: { value: "próximo pedido" } });
    fireEvent.keyDown(campo, { key: "Tab", shiftKey: true });

    for (const passo of [10, 20, 30]) {
      rerender(
        <Terminal canvas={canvas} no={propsDoNo({ positionAbsoluteX: passo, positionAbsoluteY: passo, dragging: true })} />,
      );
    }
    rerender(<Terminal canvas={canvas} no={propsDoNo({ positionAbsoluteX: 30, positionAbsoluteY: 30 })} />);

    expect(contagem.transcricoes).toBe(1);
    expect(contagem.analises).toBe(1);
    expect(campo).toHaveValue("próximo pedido");
    expect(screen.getByRole("button", { name: /plan mode ligado/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("eventos de outro orquestrador e a consulta periódica da lista não re-renderizam a transcrição", () => {
    const canvas = canvasDoTerminal(conversaDoTerminal());
    const { rerender } = render(<Terminal canvas={canvas} no={propsDoNo()} />);

    const doOutro = aplicar(ESTADO_INICIAL, { tipo: "turno_iniciado", turnoId: "x1", texto: "outro", configuracao });
    const comOutro: ValorDoCanvas = {
      ...canvas,
      conversas: new Map([...canvas.conversas, ["o2", doOutro]]),
      sinais: new Map([["o2", { turnoId: "x1", em: "2026-10-28T12:00:05Z", tokensPensando: 10 }]]),
    };
    rerender(<Terminal canvas={comOutro} no={propsDoNo()} />);

    // A lista chega com objetos novos a cada consulta, mesmo sem mudança no que o terminal mostra.
    const resumo = orquestrador();
    const novaConsulta: ValorDoCanvas = {
      ...comOutro,
      orquestradores: new Map([
        ["o1", { ...resumo, situacao: "trabalhando", totalDeTurnos: 2, configuracao: { ...resumo.configuracao } }],
      ]),
    };
    rerender(<Terminal canvas={novaConsulta} no={propsDoNo()} />);

    expect(contagem.transcricoes).toBe(1);
    expect(contagem.analises).toBe(1);
  });

  it("novidade do próprio orquestrador re-renderiza a transcrição sem re-analisar a resposta antiga", () => {
    const conversa = conversaDoTerminal();
    const canvas = canvasDoTerminal(conversa);
    const { rerender } = render(<Terminal canvas={canvas} no={propsDoNo()} />);

    const comLinhaNova = aplicar(conversa, { tipo: "texto_do_orquestrador", turnoId: "t2", texto: "lendo o código" });
    rerender(<Terminal canvas={{ ...canvas, conversas: new Map([["o1", comLinhaNova]]) }} no={propsDoNo()} />);

    expect(screen.getByText("lendo o código")).toBeInTheDocument();
    expect(contagem.transcricoes).toBe(2);
    expect(contagem.analises).toBe(1);
  });
});
