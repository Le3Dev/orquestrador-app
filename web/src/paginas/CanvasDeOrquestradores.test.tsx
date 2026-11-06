import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { apiDosArtefatos, type EventoDeArtefato, type ResumoDoArtefato } from "../shared/api/artefatos";
import { api } from "../shared/api/cliente";
import type {
  DadosDaConfiguracao,
  DadosDaNota,
  EventoDeOrquestracao,
  EventoRegistrado,
  ResumoDoOrquestrador,
} from "../shared/api/tipos";
import { lerLayout, organizarComNotas, sobrepoe, TAMANHO_DO_ARTEFATO, TAMANHO_DO_BIXINHO } from "../shared/canvas/layout";
import { idDoBixinho, idDoNoDoArtefato } from "../shared/canvas/nos";
import { aplicarEvento, ESTADO_INICIAL, type EstadoDaConversa } from "../shared/estado/aplicarEvento";
import type { ArtefatosAoVivo } from "../shared/hooks/useArtefatos";
import { CanvasDeOrquestradores } from "./CanvasDeOrquestradores";

// O canvas sem servidor: nenhum orquestrador, conectado, sem conversas e sem artefatos.
const simulados = vi.hoisted(() => {
  const semArtefatos: ArtefatosAoVivo = {
    lista: [],
    carregada: true,
    erro: null,
    conexao: "conectado",
    ultimoEvento: null,
    eventosRecentes: [],
    renomear: async () => {
      throw new Error("não usado");
    },
    apagar: async () => undefined,
  };
  return {
    orquestradores: { orquestradores: [] as ResumoDoOrquestrador[], erro: null, recarregar: async () => undefined },
    servidor: { conectado: true, caiuEm: null, voltouEm: null, reiniciou: false, memoria: null },
    conversas: {
      conversas: new Map<string, EstadoDaConversa>(),
      conexoes: new Map<string, string>(),
      sinais: new Map<string, unknown>(),
    },
    semArtefatos,
    artefatos: semArtefatos,
  };
});

vi.mock("../shared/hooks/useOrquestradores", () => ({ useOrquestradores: () => simulados.orquestradores }));
vi.mock("../shared/hooks/useServidor", () => ({ useServidor: () => simulados.servidor }));
vi.mock("../shared/hooks/useConversas", () => ({ useConversas: () => simulados.conversas }));
vi.mock("../shared/hooks/useArtefatos", () => ({ useArtefatos: () => simulados.artefatos }));
vi.mock("../shared/hooks/useChat", async () => {
  const { ESTADO_INICIAL_DO_CHAT } = await import("../shared/estado/aplicarEventoDoChat");
  const chat = { ...ESTADO_INICIAL_DO_CHAT, carregado: true };
  const aplicarPreferencias = () => undefined;
  return { useChat: () => ({ chat, conexao: "conectado", erro: null, aplicarPreferencias }) };
});

/** O nome do campo de busca da paleta (Ctrl+K). */
const BUSCA_DA_PALETA = "Buscar ações, orquestradores, notas, artefatos e pedidos";

/** O jsdom não mede nada: o React Flow só precisa que o observador exista. */
class ObservadorDeTamanhoFalso {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/** Escolhe um item do "+ Novo ▾" da barra do canvas. */
function escolherNoNovo(item: "Orquestrador" | "Nota"): void {
  fireEvent.click(screen.getByRole("button", { name: "Novo" }));
  fireEvent.click(screen.getByRole("menuitem", { name: item }));
}

/** Ctrl+N (novo orquestrador) ou Ctrl+Shift+N (nova nota); devolve false se o padrão foi impedido. */
function ctrlN(alvo: Window | HTMLElement, { comShift = false } = {}): boolean {
  return fireEvent.keyDown(alvo, { key: comShift ? "N" : "n", code: "KeyN", ctrlKey: true, shiftKey: comShift });
}

function nota(id: string, alteracoes: Partial<DadosDaNota> = {}): DadosDaNota {
  return {
    id,
    titulo: "Nova nota",
    texto: "",
    criadaEm: "2026-10-30T12:00:00Z",
    atualizadaEm: "2026-10-30T12:00:00Z",
    ...alteracoes,
  };
}

describe("CanvasDeOrquestradores · chat rápido", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ObservadorDeTamanhoFalso);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(api, "listarNotas").mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("mostra o chat no painel do centro de baixo, sem arrastar nem rolar o canvas", async () => {
    render(<CanvasDeOrquestradores />);

    const campo = await screen.findByRole("textbox", { name: "Pergunta para o Claude" });
    expect(campo).toHaveAttribute("placeholder", "Pergunte qualquer coisa ao Claude · / para comandos");
    const painel = campo.closest(".react-flow__panel");
    expect(painel).toHaveClass("bottom", "center", "painel-do-chat");
    expect(screen.getByTestId("chat-rapido")).toHaveClass("nodrag", "nowheel", "nopan");
    expect(screen.getByRole("button", { name: /Modelo: Opus 5\.5, esforço alto/ })).toBeInTheDocument();
  });
});

describe("CanvasDeOrquestradores · notas", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ObservadorDeTamanhoFalso);
    // O aviso do React Flow sobre o contêiner sem tamanho (o jsdom não tem layout).
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("\"+ Novo ▾\" › Nota chama o POST, cria o nó com o foco no texto e guarda a nota no layout", async () => {
    vi.spyOn(api, "listarNotas").mockResolvedValue([]);
    const criar = vi.spyOn(api, "criarNota").mockResolvedValue(nota("n1"));
    render(<CanvasDeOrquestradores />);

    escolherNoNovo("Nota");

    const campo = await screen.findByRole("textbox", { name: "Texto da nota" });
    expect(criar).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(campo).toHaveFocus());
    await waitFor(() => expect(lerLayout().notas.n1).toMatchObject({ minimizada: false }));
  });

  it("Ctrl+Shift+N cria uma nota (impedindo o padrão); com o foco num campo de texto, não faz nada", async () => {
    vi.spyOn(api, "listarNotas").mockResolvedValue([]);
    const criar = vi.spyOn(api, "criarNota").mockResolvedValue(nota("n1"));
    render(<CanvasDeOrquestradores />);
    const chat = await screen.findByRole("textbox", { name: "Pergunta para o Claude" });

    expect(ctrlN(chat, { comShift: true })).toBe(true);
    expect(criar).not.toHaveBeenCalled();

    expect(ctrlN(window, { comShift: true })).toBe(false);

    expect(await screen.findByRole("textbox", { name: "Texto da nota" })).toBeInTheDocument();
    expect(criar).toHaveBeenCalledTimes(1);
    // Não abre o formulário de orquestrador.
    expect(document.querySelectorAll(".react-flow__node-rascunho")).toHaveLength(0);
  });

  it("ao abrir, mostra as notas do servidor; a que sumiu do servidor sai do layout", async () => {
    localStorage.setItem(
      "orquestrador-agentes:canvas:v1",
      JSON.stringify({
        terminais: {},
        notas: {
          n1: { x: 0, y: 0, largura: 320, altura: 280, minimizada: true },
          apagada: { x: 400, y: 0, largura: 320, altura: 280, minimizada: false },
        },
        viewport: { x: 0, y: 0, zoom: 1 },
      }),
    );
    vi.spyOn(api, "listarNotas").mockResolvedValue([nota("n1", { titulo: "Compras", texto: "pão\nleite" })]);
    render(<CanvasDeOrquestradores />);

    expect(await screen.findByText("Compras")).toBeInTheDocument();
    // Minimizada no layout: só a barra, com a prévia da primeira linha.
    expect(screen.getByTestId("previa-da-nota")).toHaveTextContent("pão");
    expect(screen.queryByRole("textbox", { name: "Texto da nota" })).not.toBeInTheDocument();
    await waitFor(() => expect(Object.keys(lerLayout().notas)).toEqual(["n1"]));
    expect(lerLayout().notas.n1).toMatchObject({ minimizada: true, altura: 280 });
  });
});

const configuracao: DadosDaConfiguracao = {
  modeloDoOrquestrador: "opus",
  esforcoDoOrquestrador: "padrao",
  modeloDosSubagentes: "haiku",
  esforcoDosSubagentes: "padrao",
  quantidadeDeSubagentes: { modo: "fixa", limite: 2 },
  nivelDePermissao: "leitura",
  permitirCommitEPush: false,
};

function orquestrador(id: string): ResumoDoOrquestrador {
  return {
    id,
    nome: `Orquestrador ${id}`,
    pastaDeTrabalho: `C:\\projetos\\${id}`,
    nomeDaPasta: id,
    situacao: "trabalhando",
    configuracao,
    criadoEm: "2026-10-28T12:00:00Z",
    totalDeTurnos: 1,
    ultimoTurno: null,
    worktree: null,
  };
}

function conversaComDoisSubagentes(): EstadoDaConversa {
  const eventos: EventoDeOrquestracao[] = [
    { tipo: "turno_iniciado", turnoId: "t1", texto: "analise", configuracao },
    { tipo: "subagente_iniciado", turnoId: "t1", subagenteId: "s1", descricao: "A", tarefa: "" },
    { tipo: "subagente_iniciado", turnoId: "t1", subagenteId: "s2", descricao: "B", tarefa: "" },
  ];
  return eventos
    .map((evento, indice): EventoRegistrado => ({ ...evento, sequencia: indice + 1, em: "2026-10-28T12:00:00Z" }))
    .reduce(aplicarEvento, ESTADO_INICIAL);
}

/** O elemento do nó no React Flow. */
function noNaTela(id: string): HTMLElement {
  const elemento = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`);
  if (elemento === null) {
    throw new Error(`nó ${id} não está na tela`);
  }
  return elemento;
}

/** Onde o React Flow desenhou o nó (posição absoluta no canvas, com zoom 1 e sem pan). */
function posicaoNaTela(id: string): { x: number; y: number } {
  const [, x, y] = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(noNaTela(id).style.transform) ?? [];
  return { x: Number(x), y: Number(y) };
}

/**
 * Um evento de mouse com a janela em `view`: o d3-drag do React Flow ouve o
 * movimento e o soltar nela. O jsdom recusa `view` no construtor sob o
 * vitest, então ela entra depois.
 */
function eventoDoMouse(tipo: "mousedown" | "mousemove" | "mouseup", clientX: number, clientY: number): MouseEvent {
  const evento = new MouseEvent(tipo, { bubbles: true, cancelable: true, button: 0, clientX, clientY });
  Object.defineProperty(evento, "view", { value: window });
  return evento;
}

describe("CanvasDeOrquestradores · bixinhos", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ObservadorDeTamanhoFalso);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(api, "listarNotas").mockResolvedValue([]);
    // Um canvas de tamanho real: sem ele (o jsdom mede tudo como zero), o React
    // Flow acharia o mouse sempre na borda e rolaria o canvas durante o arraste.
    const tela = { x: 0, y: 0, left: 0, top: 0, width: 4000, height: 3000, right: 4000, bottom: 3000 };
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ ...tela, toJSON: () => tela });
  });

  afterEach(() => {
    simulados.orquestradores.orquestradores = [];
    simulados.conversas.conversas = new Map();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("soltar um terminal em cima dos bixinhos de outro tira esses bixinhos de baixo dele", async () => {
    localStorage.setItem(
      "orquestrador-agentes:canvas:v1",
      JSON.stringify({
        terminais: {
          o1: { x: 0, y: 0, largura: 600, altura: 520 },
          o2: { x: 1500, y: 0, largura: 600, altura: 520 },
        },
        notas: {},
        viewport: { x: 0, y: 0, zoom: 1 },
      }),
    );
    simulados.orquestradores.orquestradores = [orquestrador("o1"), orquestrador("o2")];
    simulados.conversas.conversas = new Map([["o1", conversaComDoisSubagentes()]]);
    render(<CanvasDeOrquestradores />);

    const bixinho = idDoBixinho("o1", "s1");
    await waitFor(() => expect(noNaTela(bixinho)).toBeInTheDocument());
    const antes = posicaoNaTela(bixinho);
    expect(antes.y).toBeGreaterThan(520);

    // Arrasta o2 pela barra de título até (0, 560): bem em cima dos bixinhos de o1.
    // O primeiro movimento só começa o arraste (passa do limiar); o segundo leva o
    // terminal até lá — o ponto de pega fica a (101, 102) do canto de o2.
    const alca = noNaTela("o2").querySelector(".alca-do-terminal");
    if (alca === null) {
      throw new Error("barra de título de o2 não encontrada");
    }
    fireEvent(alca, eventoDoMouse("mousedown", 1600, 100));
    fireEvent(window, eventoDoMouse("mousemove", 1601, 102));
    fireEvent(window, eventoDoMouse("mousemove", 101, 662));
    fireEvent(window, eventoDoMouse("mouseup", 101, 662));

    await waitFor(() => expect(posicaoNaTela("o2")).toEqual({ x: 0, y: 560 }));
    await waitFor(() => expect(posicaoNaTela(bixinho)).not.toEqual(antes));
    const terminalSolto = { x: 0, y: 560, largura: 600, altura: 520 };
    for (const id of [bixinho, idDoBixinho("o1", "s2")]) {
      expect(sobrepoe({ ...posicaoNaTela(id), ...TAMANHO_DO_BIXINHO }, terminalSolto)).toBe(false);
    }
  });
});

// Vários terminais no jsdom: sob a carga da suíte inteira, passam dos 5 s padrão.
describe("CanvasDeOrquestradores · limite de orquestradores abertos", { timeout: 20_000 }, () => {
  const AVISO =
    "Limite de 4 orquestradores abertos. Feche um dos orquestradores (✕ na barra do terminal) antes de iniciar outro.";

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ObservadorDeTamanhoFalso);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(api, "listarNotas").mockResolvedValue([]);
    localStorage.setItem(
      "orquestrador-agentes:canvas:v1",
      JSON.stringify({
        terminais: Object.fromEntries(
          ["o1", "o2", "o3", "o4"].map((id, indice) => [id, { x: indice * 700, y: 0, largura: 600, altura: 520 }]),
        ),
        notas: {},
        viewport: { x: 0, y: 0, zoom: 1 },
      }),
    );
    simulados.orquestradores.orquestradores = ["o1", "o2", "o3", "o4", "o5"].map(orquestrador);
  });

  afterEach(() => {
    simulados.orquestradores.orquestradores = [];
    simulados.conversas.conversas = new Map();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  const rascunhosNaTela = () => document.querySelectorAll(".react-flow__node-rascunho").length;

  /** O item do Orquestrador na lista da esquerda (Doca). */
  function itemDaDoca(id: string): HTMLElement {
    const item = screen
      .getAllByRole("button")
      .find(
        (botao) =>
          ["Ir até o terminal", "Abrir o terminal no canvas"].includes(botao.title) &&
          botao.textContent?.startsWith(`Orquestrador ${id}`) === true,
      );
    if (item === undefined) {
      throw new Error(`${id} não está na lista`);
    }
    return item;
  }

  const fecharAviso = () => fireEvent.click(within(screen.getByText(AVISO).parentElement as HTMLElement).getByTitle("Fechar aviso"));

  it("com 4 abertos, \"+ Novo ▾\" › Orquestrador mostra o aviso e não abre o formulário", async () => {
    render(<CanvasDeOrquestradores />);
    await waitFor(() => expect(noNaTela("o4")).toBeInTheDocument());

    escolherNoNovo("Orquestrador");

    expect(await screen.findByText(AVISO)).toBeInTheDocument();
    expect(screen.getByText(AVISO).closest(".alert")).toHaveClass("alert-warning");
    expect(rascunhosNaTela()).toBe(0);

    // Fechável no ✕ do próprio aviso.
    fecharAviso();
    expect(screen.queryByText(AVISO)).not.toBeInTheDocument();
  });

  it("com 4 abertos, Ctrl+N também mostra o aviso e não abre o formulário", async () => {
    render(<CanvasDeOrquestradores />);
    await waitFor(() => expect(noNaTela("o4")).toBeInTheDocument());

    expect(ctrlN(window)).toBe(false);

    expect(await screen.findByText(AVISO)).toBeInTheDocument();
    expect(rascunhosNaTela()).toBe(0);
  });

  it("com 4 abertos, reabrir pela lista mostra o aviso; um já aberto só foca; fechar um libera a vaga", async () => {
    render(<CanvasDeOrquestradores />);
    await waitFor(() => expect(noNaTela("o4")).toBeInTheDocument());

    fireEvent.click(itemDaDoca("o5"));
    expect(await screen.findByText(AVISO)).toBeInTheDocument();
    expect(document.querySelector('.react-flow__node[data-id="o5"]')).toBeNull();

    // Já aberto não conta: não recusa (e não deixa aviso).
    fireEvent.click(itemDaDoca("o2"));
    expect(screen.queryByText(AVISO)).not.toBeInTheDocument();

    // Recusa de novo e fecha o terminal o1 no ✕: o aviso some sozinho e a vaga volta.
    fireEvent.click(itemDaDoca("o5"));
    expect(await screen.findByText(AVISO)).toBeInTheDocument();
    fireEvent.click(within(noNaTela("o1")).getByTitle("Fechar o terminal (o orquestrador e o histórico continuam salvos)"));
    await waitFor(() => expect(screen.queryByText(AVISO)).not.toBeInTheDocument());
    // O1 continua na lista: nada foi excluído.
    expect(itemDaDoca("o1")).toHaveAttribute("title", "Abrir o terminal no canvas");

    fireEvent.click(itemDaDoca("o5"));
    await waitFor(() => expect(noNaTela("o5")).toBeInTheDocument());
    expect(screen.queryByText(AVISO)).not.toBeInTheDocument();
  });

  it("pela paleta (Ctrl+K), abrir um quinto mostra o aviso e não abre; um pedido de um aberto só leva até ele", async () => {
    simulados.conversas.conversas = new Map([["o2", conversaComDoisSubagentes()]]);
    render(<CanvasDeOrquestradores />);
    await waitFor(() => expect(noNaTela("o4")).toBeInTheDocument());

    fireEvent.keyDown(window, { key: "k", code: "KeyK", ctrlKey: true });
    const busca = screen.getByRole("combobox", { name: BUSCA_DA_PALETA });
    fireEvent.change(busca, { target: { value: "o5" } });
    expect(screen.getAllByRole("option")[0]).toHaveTextContent("Orquestrador o5");
    fireEvent.keyDown(busca, { key: "Enter" });

    expect(await screen.findByText(AVISO)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.querySelector('.react-flow__node[data-id="o5"]')).toBeNull();

    // O pedido "analise" é da conversa de o2, que está aberto: não recusa (e o aviso some).
    fireEvent.click(screen.getByRole("button", { name: "Buscar (Ctrl+K)" }));
    fireEvent.change(screen.getByRole("combobox", { name: BUSCA_DA_PALETA }), {
      target: { value: "analise" },
    });
    const pedido = screen.getByRole("option");
    expect(pedido).toHaveTextContent("Orquestrador o2");
    fireEvent.click(pedido);

    expect(screen.queryByText(AVISO)).not.toBeInTheDocument();
    expect(document.querySelectorAll(".react-flow__node-terminal")).toHaveLength(4);
  });

  it("o rascunho conta: com 3 abertos e o formulário aberto, não abre outro", async () => {
    localStorage.setItem(
      "orquestrador-agentes:canvas:v1",
      JSON.stringify({
        terminais: { o1: { x: 0, y: 0, largura: 600, altura: 520 }, o2: { x: 700, y: 0, largura: 600, altura: 520 }, o3: { x: 1400, y: 0, largura: 600, altura: 520 } },
        notas: {},
        viewport: { x: 0, y: 0, zoom: 1 },
      }),
    );
    render(<CanvasDeOrquestradores />);
    await waitFor(() => expect(noNaTela("o3")).toBeInTheDocument());

    escolherNoNovo("Orquestrador");
    await waitFor(() => expect(rascunhosNaTela()).toBe(1));
    expect(screen.queryByText(AVISO)).not.toBeInTheDocument();

    fireEvent.click(itemDaDoca("o5"));
    expect(await screen.findByText(AVISO)).toBeInTheDocument();
    expect(document.querySelector('.react-flow__node[data-id="o5"]')).toBeNull();
  });
});

describe("CanvasDeOrquestradores · minimapa", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ObservadorDeTamanhoFalso);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(api, "listarNotas").mockResolvedValue([]);
    localStorage.setItem(
      "orquestrador-agentes:canvas:v1",
      JSON.stringify({
        terminais: {
          o1: { x: 0, y: 0, largura: 600, altura: 520 },
          o2: { x: 1500, y: 0, largura: 600, altura: 520 },
        },
        notas: {},
        viewport: { x: 0, y: 0, zoom: 1 },
      }),
    );
  });

  afterEach(() => {
    simulados.orquestradores.orquestradores = [];
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("só o terminal do Orquestrador trabalhando ganha o brilho no minimapa", async () => {
    simulados.orquestradores.orquestradores = [orquestrador("o1"), { ...orquestrador("o2"), situacao: "ocioso" }];
    render(<CanvasDeOrquestradores />);

    await waitFor(() => expect(document.querySelectorAll(".react-flow__minimap-node.minimapa-terminal")).toHaveLength(2));
    const brilhando = document.querySelectorAll(".react-flow__minimap-node.minimapa-terminal-trabalhando");
    expect(brilhando).toHaveLength(1);
    // o1 está em x = 0; o2, em x = 1500.
    expect(brilhando[0]).toHaveAttribute("x", "0");
  });
});

describe("CanvasDeOrquestradores · Ctrl+N e Organizar nos controles", () => {
  const ORGANIZAR = "Organizar: terminais lado a lado; notas e artefatos à direita";
  const rascunhosNaTela = () => document.querySelectorAll(".react-flow__node-rascunho").length;

  function layoutCom(ids: string[]): void {
    localStorage.setItem(
      "orquestrador-agentes:canvas:v1",
      JSON.stringify({
        terminais: Object.fromEntries(
          ids.map((id, indice) => [id, { x: indice * 1500, y: 0, largura: 600, altura: 520 }]),
        ),
        notas: {},
        viewport: { x: 0, y: 0, zoom: 1 },
      }),
    );
    simulados.orquestradores.orquestradores = ids.map(orquestrador);
  }

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ObservadorDeTamanhoFalso);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(api, "listarNotas").mockResolvedValue([]);
  });

  afterEach(() => {
    simulados.orquestradores.orquestradores = [];
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("Ctrl+N abre o formulário de novo orquestrador (impedindo o padrão); com o foco num campo de texto, não", async () => {
    layoutCom(["o1"]);
    render(<CanvasDeOrquestradores />);
    await waitFor(() => expect(noNaTela("o1")).toBeInTheDocument());
    const chat = await screen.findByRole("textbox", { name: "Pergunta para o Claude" });

    expect(ctrlN(chat)).toBe(true);
    expect(rascunhosNaTela()).toBe(0);

    expect(ctrlN(window)).toBe(false);

    await waitFor(() => expect(rascunhosNaTela()).toBe(1));
  });

  it("o \"Organizar\" é o 4º botão dos controles e põe os terminais lado a lado", async () => {
    layoutCom(["o1", "o2"]);
    render(<CanvasDeOrquestradores />);
    await waitFor(() => expect(posicaoNaTela("o2")).toEqual({ x: 1500, y: 0 }));
    const organizar = screen.getByRole("button", { name: ORGANIZAR });

    expect(organizar).toHaveAttribute("title", ORGANIZAR);
    expect(organizar).toBeEnabled();
    expect(organizar.closest(".react-flow__controls")).not.toBeNull();
    expect(organizar.parentElement?.children).toHaveLength(4);
    expect(organizar.parentElement?.lastElementChild).toBe(organizar);
    // Saiu da barra do canvas.
    expect(organizar.closest(".barra-do-canvas")).toBeNull();

    fireEvent.click(organizar);

    const esperado = organizarComNotas(
      [
        { id: "o1", largura: 600, altura: 520 },
        { id: "o2", largura: 600, altura: 520 },
      ],
      [],
    );
    await waitFor(() => expect(posicaoNaTela("o2")).toEqual(esperado.o2));
    expect(posicaoNaTela("o1")).toEqual(esperado.o1);
    expect(esperado.o2).not.toEqual({ x: 1500, y: 0 });
  });

  it("com uma janela só, o \"Organizar\" fica desabilitado", async () => {
    layoutCom(["o1"]);
    render(<CanvasDeOrquestradores />);
    await waitFor(() => expect(noNaTela("o1")).toBeInTheDocument());

    expect(screen.getByRole("button", { name: ORGANIZAR })).toBeDisabled();
  });
});

describe("CanvasDeOrquestradores · zoom e barra de título", () => {
  const janelaComPonte = window as unknown as { electron?: unknown };
  const transformacao = () => document.querySelector<HTMLElement>(".react-flow__viewport")?.style.transform;

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ObservadorDeTamanhoFalso);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(api, "listarNotas").mockResolvedValue([]);
    localStorage.setItem(
      "orquestrador-agentes:canvas:v1",
      JSON.stringify({ terminais: {}, notas: {}, viewport: { x: 100, y: 50, zoom: 0.5 } }),
    );
  });

  afterEach(() => {
    delete janelaComPonte.electron;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("restaura o zoom e a posição salvos; Ctrl+0 volta a 100% mantendo o centro", async () => {
    render(<CanvasDeOrquestradores />);
    await waitFor(() => expect(transformacao()).toBe("translate(100px,50px) scale(0.5)"));

    // O jsdom não mede: a área tem 0 × 0 e o centro é a origem (0, 0) da tela.
    fireEvent.keyDown(window, { key: "0", code: "Digit0", ctrlKey: true });

    await waitFor(() => expect(transformacao()).toBe("translate(200px,100px) scale(1)"));
  });

  it("Ctrl+0 com o foco num campo de texto não mexe no zoom", async () => {
    render(<CanvasDeOrquestradores />);
    const campo = await screen.findByRole("textbox", { name: "Pergunta para o Claude" });
    await waitFor(() => expect(transformacao()).toBe("translate(100px,50px) scale(0.5)"));

    fireEvent.keyDown(campo, { key: "0", code: "Digit0", ctrlKey: true });

    expect(transformacao()).toBe("translate(100px,50px) scale(0.5)");
  });

  it("no navegador o status fica no painel do topo; no desktop, na barra de título", () => {
    const { unmount } = render(<CanvasDeOrquestradores />);
    expect(screen.queryByTestId("barra-de-titulo")).not.toBeInTheDocument();
    expect(screen.getByTestId("status-do-canvas").closest(".paineis-do-topo")).not.toBeNull();
    unmount();

    janelaComPonte.electron = {
      desktop: true,
      janela: {
        minimizar: vi.fn(),
        maximizar: vi.fn(),
        fechar: vi.fn(),
        estaMaximizada: vi.fn().mockResolvedValue(false),
        aoMudarMaximizada: vi.fn(() => () => undefined),
      },
    };
    render(<CanvasDeOrquestradores />);
    const barra = screen.getByTestId("barra-de-titulo");
    expect(within(barra).getByTestId("status-do-canvas")).toHaveTextContent("todos ociosos");
    expect(within(barra).getByRole("group", { name: "Controles da janela" })).toBeInTheDocument();
    expect(screen.getAllByTestId("status-do-canvas")).toHaveLength(1);
    // A barra fica fora do canvas, acima dele.
    expect(barra.nextElementSibling?.querySelector(".react-flow")).not.toBeNull();
  });

  it("no desktop, a busca e o ⚙ ficam na barra de título; a paleta oferece \"Pastas e Claude Code\" só nele", () => {
    // Navegador: busca e ⚙ (sem a ponte, não há ⚙) na barra do canvas; a paleta não tem a ação.
    const { unmount } = render(<CanvasDeOrquestradores />);
    fireEvent.click(screen.getByRole("button", { name: "Buscar (Ctrl+K)" }));
    expect(screen.getByRole("dialog", { name: "Paleta de comandos" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Pastas e Claude Code/ })).not.toBeInTheDocument();
    unmount();

    const abrirAjustes = vi.fn().mockResolvedValue(undefined);
    janelaComPonte.electron = {
      desktop: true,
      janela: {
        minimizar: vi.fn(),
        maximizar: vi.fn(),
        fechar: vi.fn(),
        estaMaximizada: vi.fn().mockResolvedValue(false),
        aoMudarMaximizada: vi.fn(() => () => undefined),
      },
      configuracao: { obter: vi.fn(), abrirAjustes },
    };
    render(<CanvasDeOrquestradores />);
    const barra = screen.getByTestId("barra-de-titulo");
    const barraDoCanvas = document.querySelector<HTMLElement>(".barra-do-canvas");
    if (barraDoCanvas === null) {
      throw new Error("barra do canvas não encontrada");
    }

    // A barra do canvas fica só com o "+ Novo ▾".
    expect(within(barraDoCanvas).getAllByRole("button").map((botao) => botao.getAttribute("aria-label"))).toEqual([
      "Novo",
    ]);
    expect(within(barra).getByRole("button", { name: "Pastas e Claude Code" })).toBeInTheDocument();

    fireEvent.click(within(barra).getByRole("button", { name: "Buscar ou executar (Ctrl+K)" }));
    fireEvent.click(screen.getByRole("option", { name: /Pastas e Claude Code/ }));

    expect(abrirAjustes).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

function artefato(id: string, alteracoes: Partial<ResumoDoArtefato> = {}): ResumoDoArtefato {
  return {
    id,
    titulo: `Artefato ${id}`,
    formato: "html",
    origem: { tipo: "orquestrador", id: "o1" },
    arquivo: `${id}.html`,
    criadoEm: "2026-11-05T12:00:00Z",
    atualizadoEm: "2026-11-05T12:00:00Z",
    versaoAtual: 1,
    versoes: [{ numero: 1, criadaEm: "2026-11-05T12:00:00Z", tamanho: 120 }],
    ...alteracoes,
  };
}

/** O hook dos artefatos com esta lista e estes eventos (numerados na ordem). */
function comArtefatos(lista: ResumoDoArtefato[], eventos: EventoDeArtefato[] = []): void {
  const eventosRecentes = eventos.map((evento, indice) => ({ numero: indice + 1, evento }));
  simulados.artefatos = {
    ...simulados.semArtefatos,
    lista,
    eventosRecentes,
    ultimoEvento: eventosRecentes.at(-1) ?? null,
  };
}

// Vários terminais no jsdom: sob a carga da suíte inteira, passam dos 5 s padrão.
describe("CanvasDeOrquestradores · artefatos", { timeout: 20_000 }, () => {
  function layoutCom(terminais: string[], artefatos: string[] = []): void {
    localStorage.setItem(
      "orquestrador-agentes:canvas:v1",
      JSON.stringify({
        terminais: Object.fromEntries(
          terminais.map((id, indice) => [id, { x: indice * 1500, y: 0, largura: 600, altura: 520 }]),
        ),
        notas: {},
        artefatos: Object.fromEntries(
          artefatos.map((id, indice) => [id, { x: indice * 800, y: 2000, largura: 640, altura: 480 }]),
        ),
        viewport: { x: 0, y: 0, zoom: 1 },
      }),
    );
    simulados.orquestradores.orquestradores = terminais.map(orquestrador);
  }

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ObservadorDeTamanhoFalso);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(api, "listarNotas").mockResolvedValue([]);
    vi.spyOn(apiDosArtefatos, "lerVersao").mockResolvedValue("<h1>Olá</h1>");
    const tela = { x: 0, y: 0, left: 0, top: 0, width: 4000, height: 3000, right: 4000, bottom: 3000 };
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ ...tela, toJSON: () => tela });
  });

  afterEach(() => {
    simulados.orquestradores.orquestradores = [];
    simulados.artefatos = simulados.semArtefatos;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("artefato_criado por um orquestrador aberto abre a janela ao lado do terminal, sem cobri-lo", async () => {
    layoutCom(["o1"]);
    const { rerender } = render(<CanvasDeOrquestradores />);
    await waitFor(() => expect(noNaTela("o1")).toBeInTheDocument());

    const criado = artefato("a1", { titulo: "Relatório de vendas" });
    comArtefatos([criado], [{ tipo: "artefato_criado", artefato: criado }]);
    rerender(<CanvasDeOrquestradores />);

    const id = idDoNoDoArtefato("a1");
    await waitFor(() => expect(noNaTela(id)).toBeInTheDocument());
    // À direita do terminal (600 de largura + 40 de espaço), com o topo alinhado.
    expect(posicaoNaTela(id)).toEqual({ x: 640, y: 0 });
    expect(sobrepoe({ ...posicaoNaTela(id), ...TAMANHO_DO_ARTEFATO }, { x: 0, y: 0, largura: 600, altura: 520 })).toBe(
      false,
    );
    expect(within(noNaTela(id)).getByText("Relatório de vendas")).toBeInTheDocument();
    expect(await within(noNaTela(id)).findByTitle("Conteúdo do artefato: Relatório de vendas")).toBeInTheDocument();
    await waitFor(() => expect(lerLayout().artefatos.a1).toEqual({ x: 640, y: 0, largura: 640, altura: 480 }));
  });

  it("artefato_criado pelo chat abre no centro da vista; versao_adicionada com a janela fechada não abre", async () => {
    layoutCom(["o1"]);
    const { rerender } = render(<CanvasDeOrquestradores />);
    await waitFor(() => expect(noNaTela("o1")).toBeInTheDocument());

    const fechado = artefato("a1", {
      versaoAtual: 2,
      versoes: [
        { numero: 1, criadaEm: "2026-11-05T12:00:00Z", tamanho: 120 },
        { numero: 2, criadaEm: "2026-11-05T12:05:00Z", tamanho: 140 },
      ],
    });
    const doChat = artefato("a2", { origem: { tipo: "chat", id: null }, formato: "markdown", arquivo: "a2.md" });
    // Os dois eventos chegam juntos: nenhum se perde.
    comArtefatos(
      [doChat, fechado],
      [
        { tipo: "versao_adicionada", artefato: fechado },
        { tipo: "artefato_criado", artefato: doChat },
      ],
    );
    rerender(<CanvasDeOrquestradores />);

    await waitFor(() => expect(noNaTela(idDoNoDoArtefato("a2"))).toBeInTheDocument());
    expect(document.querySelector(`.react-flow__node[data-id="${idDoNoDoArtefato("a1")}"]`)).toBeNull();
    // Fora do terminal: o centro da vista (acima do chat) estava livre.
    expect(
      sobrepoe(
        { ...posicaoNaTela(idDoNoDoArtefato("a2")), ...TAMANHO_DO_ARTEFATO },
        { x: 0, y: 0, largura: 600, altura: 520 },
      ),
    ).toBe(false);
  });

  it("artefatos não contam no limite de 4 orquestradores abertos", async () => {
    layoutCom(["o1", "o2", "o3"], ["a1", "a2"]);
    comArtefatos([artefato("a1"), artefato("a2")]);
    const { rerender } = render(<CanvasDeOrquestradores />);
    await waitFor(() => expect(noNaTela(idDoNoDoArtefato("a2"))).toBeInTheDocument());

    // 3 terminais + 2 artefatos: ainda cabe o formulário de um orquestrador novo.
    escolherNoNovo("Orquestrador");
    await waitFor(() => expect(document.querySelectorAll(".react-flow__node-rascunho")).toHaveLength(1));
    expect(screen.queryByText(/Limite de 4 orquestradores abertos/)).not.toBeInTheDocument();

    // Com as 4 vagas ocupadas, um artefato novo continua abrindo.
    const novo = artefato("a3", { origem: { tipo: "orquestrador", id: "o2" } });
    comArtefatos([novo, artefato("a1"), artefato("a2")], [{ tipo: "artefato_criado", artefato: novo }]);
    rerender(<CanvasDeOrquestradores />);
    await waitFor(() => expect(noNaTela(idDoNoDoArtefato("a3"))).toBeInTheDocument());
    expect(screen.queryByText(/Limite de 4 orquestradores abertos/)).not.toBeInTheDocument();
  });

  it("a paleta (Ctrl+K) lista os artefatos; escolher um fechado abre a janela", async () => {
    layoutCom(["o1"]);
    comArtefatos([artefato("a1", { titulo: "Relatório de vendas", origem: { tipo: "chat", id: null } })]);
    render(<CanvasDeOrquestradores />);
    await waitFor(() => expect(noNaTela("o1")).toBeInTheDocument());

    fireEvent.keyDown(window, { key: "k", code: "KeyK", ctrlKey: true });
    fireEvent.change(screen.getByRole("combobox", { name: BUSCA_DA_PALETA }), { target: { value: "relatorio" } });
    const opcao = screen.getByRole("option", { name: /Relatório de vendas/ });
    expect(opcao).toHaveTextContent("HTML · do chat rápido · abrir");
    expect(within(screen.getByRole("listbox")).getByText("Artefatos")).toBeInTheDocument();
    fireEvent.click(opcao);

    await waitFor(() => expect(noNaTela(idDoNoDoArtefato("a1"))).toBeInTheDocument());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("ao carregar, o artefato que sumiu do servidor sai do canvas e do layout; o minimapa tem cor própria", async () => {
    layoutCom(["o1"], ["a1", "apagado"]);
    comArtefatos([artefato("a1")]);
    render(<CanvasDeOrquestradores />);

    await waitFor(() => expect(Object.keys(lerLayout().artefatos)).toEqual(["a1"]));
    expect(document.querySelector(`.react-flow__node[data-id="${idDoNoDoArtefato("apagado")}"]`)).toBeNull();
    await waitFor(() => expect(document.querySelectorAll(".react-flow__minimap-node.minimapa-artefato")).toHaveLength(1));
  });

  it("o \"Organizar\" põe os artefatos em colunas à direita dos terminais (e das notas)", async () => {
    layoutCom(["o1", "o2"], ["a1"]);
    comArtefatos([artefato("a1")]);
    render(<CanvasDeOrquestradores />);
    const id = idDoNoDoArtefato("a1");
    await waitFor(() => expect(noNaTela(id)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Organizar: terminais lado a lado; notas e artefatos à direita" }));

    const esperado = organizarComNotas(
      [
        { id: "o1", largura: 600, altura: 520 },
        { id: "o2", largura: 600, altura: 520 },
      ],
      [],
      [{ id, largura: 640, altura: 480 }],
    );
    await waitFor(() => expect(posicaoNaTela(id)).toEqual(esperado[id]));
    expect(esperado[id]?.x).toBeGreaterThan((esperado.o2?.x ?? 0) + 600);
  });
});
