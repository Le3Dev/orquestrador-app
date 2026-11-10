import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { apiDosArtefatos, type EventoDeArtefato, type ResumoDoArtefato } from "../shared/api/artefatos";
import { api } from "../shared/api/cliente";
import type {
  DadosDaConfiguracao,
  DadosDaNota,
  EventoDeOrquestracao,
  EventoRegistrado,
  ResumoDoOrquestrador,
} from "../shared/api/tipos";
import {
  lerLayout,
  organizarComNotas,
  sobrepoe,
  TAMANHO_DA_PREVIA,
  TAMANHO_DO_ARTEFATO,
  TAMANHO_DO_BIXINHO,
  TAMANHO_DO_TERMINAL,
} from "../shared/canvas/layout";
import { AVISO_DO_LIMITE_DE_ORQUESTRADORES, LIMITE_DE_ORQUESTRADORES_ABERTOS } from "../shared/canvas/limiteDeTerminais";
import { idDoBixinho, idDoNoDaPrevia, idDoNoDoArtefato } from "../shared/canvas/nos";
import { aplicarEvento, ESTADO_INICIAL, type EstadoDaConversa } from "../shared/estado/aplicarEvento";
import { ESTADO_INICIAL_DO_CHAT, type EstadoDoChatNaTela } from "../shared/estado/aplicarEventoDoChat";
import type { ArtefatosAoVivo } from "../shared/hooks/useArtefatos";
import type { EstadoDaAtualizacao } from "../shared/ponteDoDesktop";
import { ErroDaApi } from "../shared/api/cliente";
import { avisarSubagentesProntosMudaram } from "../shared/subagentesProntos";
import { TIPO_DA_RESPOSTA_DO_CHAT } from "../componentes/chat/ChatRapido";
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
    chat: null as EstadoDoChatNaTela | null,
    /** As props do último render do <ReactFlow> (o mesmo componente, só observado). */
    propsDoFluxo: null as Record<string, unknown> | null,
  };
});

// O <ReactFlow> de verdade, com as props guardadas para conferir a configuração do canvas.
vi.mock("@xyflow/react", async (importOriginal) => {
  const real = await importOriginal<typeof import("@xyflow/react")>();
  const { createElement } = await import("react");
  const Original = real.ReactFlow as unknown as (props: Record<string, unknown>) => ReturnType<typeof real.ReactFlow>;
  function ReactFlowObservado(props: Record<string, unknown>) {
    simulados.propsDoFluxo = props;
    return createElement(Original, props);
  }
  return { ...real, ReactFlow: ReactFlowObservado };
});

vi.mock("../shared/hooks/useOrquestradores", () => ({ useOrquestradores: () => simulados.orquestradores }));
vi.mock("../shared/hooks/useServidor", () => ({ useServidor: () => simulados.servidor }));
vi.mock("../shared/hooks/useConversas", () => ({ useConversas: () => simulados.conversas }));
vi.mock("../shared/hooks/useArtefatos", () => ({ useArtefatos: () => simulados.artefatos }));
// O bloco "Terminal" usa o xterm, que o jsdom não desenha: aqui, um terminal que não faz nada.
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    loadAddon(): void {}
    open(): void {}
    write(): void {}
    reset(): void {}
    onData() {
      return { dispose: () => undefined };
    }
    onResize() {
      return { dispose: () => undefined };
    }
    dispose(): void {}
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit(): void {}
  },
}));
vi.mock("../shared/hooks/useChat", async () => {
  const { ESTADO_INICIAL_DO_CHAT } = await import("../shared/estado/aplicarEventoDoChat");
  const chat = { ...ESTADO_INICIAL_DO_CHAT, carregado: true };
  const aplicarPreferencias = () => undefined;
  // `simulados.chat` troca a conversa (ex.: uma resposta com o cartão de abrir orquestrador).
  return { useChat: () => ({ chat: simulados.chat ?? chat, conexao: "conectado", erro: null, aplicarPreferencias }) };
});

/** O nome do campo de busca da paleta (Ctrl+K). */
const BUSCA_DA_PALETA = "Buscar ações, orquestradores, notas, artefatos e pedidos";

/** O jsdom não mede nada: o React Flow só precisa que o observador exista. */
class ObservadorDeTamanhoFalso {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/** Escolhe um item do menu "+ Novo" da ilha do canto superior esquerdo. */
function escolherNoNovo(item: "Orquestrador" | "Nota" | "Terminal" | "Prévia"): void {
  fireEvent.click(screen.getByRole("button", { name: "Novo" }));
  fireEvent.click(screen.getByRole("menuitem", { name: item === "Orquestrador" ? "Novo orquestrador" : item }));
}

/** Abre o menu Novo e, nele, o submenu Orquestradores (a lista que era a Doca). */
function abrirListaDeOrquestradores(): void {
  fireEvent.click(screen.getByRole("button", { name: "Novo" }));
  fireEvent.click(screen.getByRole("menuitem", { name: /^Orquestradores/ }));
}

/** O orquestrador na lista do submenu (aberto por `abrirListaDeOrquestradores`). */
function itemDaLista(id: string): HTMLElement {
  const item = document.querySelector<HTMLElement>(
    `[role="menu"][aria-label="Orquestradores"] [data-orquestrador="${id}"]`,
  );
  if (item === null) {
    throw new Error(`${id} não está na lista`);
  }
  return item;
}

/** Escolhe um orquestrador pelo submenu: abre o menu, o submenu e clica nele. */
function escolherNaLista(id: string): void {
  abrirListaDeOrquestradores();
  fireEvent.click(itemDaLista(id));
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
    expect(campo).toHaveAttribute("placeholder", "Pergunte ao Claude");
    const painel = campo.closest(".react-flow__panel");
    expect(painel).toHaveClass("bottom", "center", "painel-do-chat");
    expect(screen.getByTestId("chat-rapido")).toHaveClass("nodrag", "nowheel", "nopan");
    expect(screen.getByRole("button", { name: /Modelo: Opus 5\.5, esforço alto/ })).toBeInTheDocument();
  });

  it("o quadro do canvas vazio fica abaixo do chat: dentro do React Flow, na camada 4, antes do painel do chat", async () => {
    render(<CanvasDeOrquestradores />);

    const campo = await screen.findByRole("textbox", { name: "Pergunta para o Claude" });
    const painelDoChat = campo.closest(".react-flow__panel");
    const camada = screen.getByRole("heading", { name: "Seu canvas de agentes" }).closest(".camada-do-canvas-vazio");
    expect(camada).not.toBeNull();
    expect(camada).toHaveClass("pointer-events-none", "z-[4]");
    // No mesmo contexto de empilhamento que os painéis (z-index 5), e não por cima do React Flow.
    expect(camada?.parentElement).toBe(painelDoChat?.parentElement);
    expect(camada?.parentElement).toHaveClass("react-flow");
    expect(camada!.compareDocumentPosition(painelDoChat!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("a lista e a contagem do submenu Subagentes acompanham a biblioteca quando o chat cria um subagente pronto", async () => {
    const pronto = (nome: string) => ({ nome, descricao: "Faz algo", prompt: "Faça.", modelo: "herdar" as const });
    const preferencias = (nomes: string[]) => ({
      instrucoesPadrao: "",
      subagentesProntos: nomes.map(pronto),
      autorrecuperacao: true,
    });
    const ler = vi.spyOn(api, "lerPreferencias").mockResolvedValue(preferencias(["a", "b"]));
    render(<CanvasDeOrquestradores />);
    fireEvent.click(await screen.findByRole("button", { name: "Novo" }));
    const pai = screen.getByRole("menuitem", { name: /^Subagentes/ });
    await waitFor(() => expect(pai).toHaveTextContent("2"));
    fireEvent.click(pai);
    expect(within(screen.getByRole("menu", { name: "Subagentes" })).getByText("2 subagentes prontos")).toBeInTheDocument();

    // O cartão do chat grava a lista nova e avisa; o menu relê sem reabrir nada.
    ler.mockResolvedValue(preferencias(["a", "b", "c"]));
    act(() => avisarSubagentesProntosMudaram());
    expect(await screen.findByText("3 subagentes prontos")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "c: Faz algo" })).toBeInTheDocument();
  });

  it("Gerenciar subagentes abre o painel de subagentes prontos sob a ilha, no lugar do quadro vazio, e fechar o devolve", async () => {
    vi.spyOn(api, "lerPreferencias").mockRejectedValue(new Error("sem servidor"));
    render(<CanvasDeOrquestradores />);
    await screen.findByRole("textbox", { name: "Pergunta para o Claude" });
    expect(screen.getByRole("heading", { name: "Seu canvas de agentes" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Novo" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Subagentes/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Gerenciar subagentes" }));

    const painel = await screen.findByRole("region", { name: "Subagentes prontos" });
    // Flutua logo abaixo da ilha do nome, na mesma coluna.
    expect(painel.parentElement).toHaveClass("coluna-da-ilha-esquerda");
    expect(painel.previousElementSibling).toBe(screen.getByTestId("ilha-do-nome"));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Seu canvas de agentes" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Fechar subagentes" }));
    expect(screen.queryByRole("region", { name: "Subagentes prontos" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Seu canvas de agentes" })).toBeInTheDocument();
  });

  it("\"Modelos de canvas\" do menu abre o painel de modelos sob a ilha", async () => {
    render(<CanvasDeOrquestradores />);
    await screen.findByRole("textbox", { name: "Pergunta para o Claude" });

    fireEvent.click(screen.getByRole("button", { name: "Novo" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Modelos de canvas" }));

    const painel = await screen.findByRole("region", { name: "Modelos de canvas" });
    expect(painel.parentElement).toHaveClass("coluna-da-ilha-esquerda");
  });

  it("com \"Chat fixo à esquerda\", o chat vira uma coluna ao lado do canvas; \"soltar\" o devolve ao pé", async () => {
    localStorage.setItem("orquestrador.preferenciasDaTela", JSON.stringify({ chatFixoNaEsquerda: true }));
    render(<CanvasDeOrquestradores />);

    const lateral = await screen.findByRole("complementary", { name: "Chat rápido" });
    const fluxo = document.querySelector(".react-flow");
    // Fora do React Flow, antes da área do canvas, na mesma linha: empurra, não cobre.
    expect(fluxo).not.toBeNull();
    expect(fluxo).not.toContainElement(lateral);
    expect(document.querySelector(".painel-do-chat")).toBeNull();
    const area = fluxo!.parentElement!;
    expect(area).toHaveClass("flex-1", "min-w-0");
    expect(lateral.nextElementSibling).toBe(area);
    expect(lateral.parentElement).toHaveClass("flex");
    expect(lateral).toContainElement(screen.getByRole("textbox", { name: "Pergunta para o Claude" }));
    expect(JSON.parse(localStorage.getItem("orquestrador.preferenciasDaTela") ?? "null")).toMatchObject({
      chatFixoNaEsquerda: true,
    });

    fireEvent.click(screen.getByRole("button", { name: "Soltar embaixo" }));

    await waitFor(() => expect(screen.queryByRole("complementary", { name: "Chat rápido" })).not.toBeInTheDocument());
    const campo = screen.getByRole("textbox", { name: "Pergunta para o Claude" });
    expect(campo.closest(".react-flow__panel")).toHaveClass("painel-do-chat");
  });

  it("\"ocultar\" na coluna da direita solta o chat embaixo, oculto; \"mostrar conversa\" o reexibe embaixo, como no chat inferior", async () => {
    localStorage.setItem(
      "orquestrador.preferenciasDaTela",
      JSON.stringify({ chatFixoNaEsquerda: true, ladoDoChatFixo: "direita", visualizadorDeCodigo: false, larguraDoChatFixo: 360 }),
    );
    simulados.chat = {
      ...ESTADO_INICIAL_DO_CHAT,
      carregado: true,
      mensagens: [
        {
          id: "c1",
          papel: "claude",
          texto: "Resposta de exemplo.",
          imagens: [],
          criadaEm: "2026-11-08T12:00:00Z",
          situacao: "concluida",
          acoes: [],
          avisos: [],
          uso: null,
          motivoDaFalha: null,
          autorizacaoPendente: null,
          perguntas: [],
        },
      ],
    };
    try {
      render(<CanvasDeOrquestradores />);
      const lateral = await screen.findByRole("complementary", { name: "Chat rápido" });

      fireEvent.click(within(lateral).getByRole("button", { name: "Ocultar o chat" }));

      // Saiu da coluna e a preferência de fixo desligou; embaixo, só o "mostrar conversa".
      await waitFor(() => expect(screen.queryByRole("complementary", { name: "Chat rápido" })).not.toBeInTheDocument());
      expect(JSON.parse(localStorage.getItem("orquestrador.preferenciasDaTela") ?? "null")).toMatchObject({
        chatFixoNaEsquerda: false,
      });
      const painel = document.querySelector(".painel-do-chat");
      expect(painel).not.toBeNull();
      expect(screen.queryByRole("region", { name: "Conversa com o Claude" })).not.toBeInTheDocument();
      fireEvent.click(within(painel as HTMLElement).getByRole("button", { name: /mostrar conversa/ }));

      // Reexibido: o chat inferior, com a conversa à vista (e o ocultar dele de volta).
      expect(screen.getByRole("region", { name: "Conversa com o Claude" })).toBeVisible();
      expect(screen.getByText("Resposta de exemplo.")).toBeVisible();
      expect(within(painel as HTMLElement).getByRole("button", { name: "ocultar" })).toBeInTheDocument();
      expect(screen.queryByRole("complementary", { name: "Chat rápido" })).not.toBeInTheDocument();
    } finally {
      simulados.chat = null;
    }
  });

  it("o chat fixo abre com a largura guardada; a alça da borda muda e grava a preferência", async () => {
    localStorage.setItem(
      "orquestrador.preferenciasDaTela",
      JSON.stringify({ chatFixoNaEsquerda: true, visualizadorDeCodigo: false, larguraDoChatFixo: 420 }),
    );
    render(<CanvasDeOrquestradores />);

    const lateral = await screen.findByRole("complementary", { name: "Chat rápido" });
    expect(lateral).toHaveStyle({ width: "420px" });
    const alca = within(lateral).getByRole("separator", { name: "Largura do chat" });

    fireEvent.keyDown(alca, { key: "ArrowRight" });

    await waitFor(() => expect(lateral).toHaveStyle({ width: "436px" }));
    expect(alca).toHaveAttribute("aria-valuenow", "436");
    expect(JSON.parse(localStorage.getItem("orquestrador.preferenciasDaTela") ?? "null")).toMatchObject({
      chatFixoNaEsquerda: true,
      larguraDoChatFixo: 436,
    });

    fireEvent.doubleClick(alca);
    await waitFor(() => expect(lateral).toHaveStyle({ width: "360px" }));
  });

  it("com o lado direita, a coluna fica depois da área do canvas, com a alça à esquerda e o arraste invertido", async () => {
    localStorage.setItem(
      "orquestrador.preferenciasDaTela",
      JSON.stringify({ chatFixoNaEsquerda: true, ladoDoChatFixo: "direita", visualizadorDeCodigo: false, larguraDoChatFixo: 420 }),
    );
    render(<CanvasDeOrquestradores />);

    const lateral = await screen.findByRole("complementary", { name: "Chat rápido" });
    const area = document.querySelector(".react-flow")!.parentElement!;
    // Na mesma linha, depois da área: o canvas fica à esquerda e é empurrado, não coberto.
    expect(lateral.previousElementSibling).toBe(area);
    expect(lateral.nextElementSibling).toBeNull();
    expect(lateral).toHaveClass("chat-lateral", "chat-lateral-direita");
    const alca = within(lateral).getByRole("separator", { name: "Largura do chat" });
    expect(alca).toHaveClass("alca-do-chat-lateral-direita");

    // A seta para a esquerda leva a borda para o canvas: a coluna alarga.
    fireEvent.keyDown(alca, { key: "ArrowLeft" });
    await waitFor(() => expect(lateral).toHaveStyle({ width: "436px" }));
    expect(JSON.parse(localStorage.getItem("orquestrador.preferenciasDaTela") ?? "null")).toMatchObject({
      ladoDoChatFixo: "direita",
      larguraDoChatFixo: 436,
    });

    // Com a coluna à direita, o canvas e todas as ilhas ficam dentro da área ao lado dela, sem sobrepor.
    expect(area).toContainElement(screen.getByTestId("ilha-do-nome"));
    expect(area).toContainElement(screen.getByRole("group", { name: "Busca, status e configurações" }));
    expect(area).toContainElement(screen.getByTestId("ilha-de-ferramentas"));
    expect(lateral).not.toContainElement(screen.getByTestId("ilha-do-nome"));
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

  describe("arrastar uma resposta do chat para o canvas", () => {
    /** Um arraste (sobre ou soltar) no canvas, com o ponto da tela; o jsdom não tem DragEvent nem DataTransfer. */
    function arrastarNoCanvas(tipo: "dragOver" | "drop", dados: Record<string, string>, clientX = 0, clientY = 0): boolean {
      const fluxo = document.querySelector(".react-flow");
      if (fluxo === null) {
        throw new Error("o canvas não está na tela");
      }
      const evento = createEvent[tipo](fluxo, {
        dataTransfer: { types: Object.keys(dados), getData: (formato: string) => dados[formato] ?? "", dropEffect: "none" },
      });
      Object.defineProperty(evento, "clientX", { value: clientX });
      Object.defineProperty(evento, "clientY", { value: clientY });
      return fireEvent(fluxo, evento);
    }

    it("soltar cria uma nota com o texto da resposta, sem a marcação, no ponto onde foi solta", async () => {
      vi.spyOn(api, "listarNotas").mockResolvedValue([]);
      const resposta = [
        "## Resumo",
        "",
        "Isto é **importante** e _claro_.",
        "",
        "- primeiro",
        "- segundo",
        "",
        "| a | b |",
        "|---|---|",
        "| 1 | 2 |",
        "",
        "```ts",
        "const x = **1**;",
        "```",
      ].join("\n");
      const texto = "Resumo\n\nIsto é importante e claro.\n\n• primeiro\n• segundo\n\na | b\n1 | 2\n\nconst x = **1**;";
      const criar = vi
        .spyOn(api, "criarNota")
        .mockResolvedValue(nota("n1", { titulo: "Resposta do chat", texto }));
      render(<CanvasDeOrquestradores />);
      await screen.findByRole("textbox", { name: "Pergunta para o Claude" });

      // Sobre o canvas, o arraste é aceito (o padrão impedido); depois, solto em (300, 200).
      expect(arrastarNoCanvas("dragOver", { [TIPO_DA_RESPOSTA_DO_CHAT]: resposta })).toBe(false);
      arrastarNoCanvas("drop", { [TIPO_DA_RESPOSTA_DO_CHAT]: resposta, "text/plain": resposta }, 300, 200);

      await waitFor(() => expect(criar).toHaveBeenCalledWith({ titulo: "Resposta do chat", texto }));
      expect(await screen.findByRole("textbox", { name: "Texto da nota" })).toHaveValue(texto);
      // Viewport sem pan e com zoom 1: o ponto da tela é o do canvas.
      await waitFor(() => expect(lerLayout().notas.n1).toMatchObject({ x: 300, y: 200 }));
    });

    it("outro arraste (um arquivo, um texto qualquer) não é aceito nem cria nota", async () => {
      vi.spyOn(api, "listarNotas").mockResolvedValue([]);
      const criar = vi.spyOn(api, "criarNota");
      render(<CanvasDeOrquestradores />);
      await screen.findByRole("textbox", { name: "Pergunta para o Claude" });

      expect(arrastarNoCanvas("dragOver", { "text/plain": "oi" })).toBe(true);
      arrastarNoCanvas("drop", { "text/plain": "oi" });

      expect(criar).not.toHaveBeenCalled();
    });
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
  instrucoesPersonalizadas: "",
};

function orquestrador(id: string): ResumoDoOrquestrador {
  return {
    id,
    nome: `Orquestrador ${id}`,
    pastaDeTrabalho: `C:\\projetos\\${id}`,
    nomeDaPasta: id,
    situacao: "trabalhando",
    configuracao,
    instrucoesAtivas: null,
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

  describe("saída sozinha de quem terminou", () => {
    const AGORA = new Date("2026-11-08T12:00:00Z");
    const CHAVE_DOS_LIMPOS = "orquestrador-agentes:canvas:v1:bixinhos-limpos";

    beforeEach(() => {
      // Só os timers e o relógio: o resto (promessas, quadros) segue de verdade.
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      vi.setSystemTime(AGORA);
      localStorage.setItem(
        "orquestrador-agentes:canvas:v1",
        JSON.stringify({ terminais: { o1: { x: 0, y: 0, largura: 600, altura: 520 } }, notas: {}, viewport: { x: 0, y: 0, zoom: 1 } }),
      );
      simulados.orquestradores.orquestradores = [orquestrador("o1")];
    });

    afterEach(() => vi.useRealTimers());

    /** s1 concluiu em `em`; s2 segue executando. */
    function s1Concluiu(em: string): EstadoDaConversa {
      return aplicarEvento(conversaComDoisSubagentes(), {
        tipo: "subagente_concluido",
        turnoId: "t1",
        subagenteId: "s1",
        situacao: "concluido",
        resumo: "",
        tokens: 1,
        duracaoMs: 1,
        sequencia: 4,
        em,
      });
    }

    async function passar(ms: number): Promise<void> {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    }

    const noOuNulo = (id: string) => document.querySelector(`.react-flow__node[data-id="${id}"]`);

    it("concluído agora: 5 s com a expressão final, sai encolhendo e fica limpo ao recarregar", async () => {
      simulados.conversas.conversas = new Map([["o1", s1Concluiu(AGORA.toISOString())]]);
      const { unmount } = render(<CanvasDeOrquestradores />);
      await passar(0);
      const s1 = idDoBixinho("o1", "s1");
      expect(noOuNulo(s1)).not.toBeNull();

      await passar(4900);
      expect(noOuNulo(s1)?.querySelector(".no-bixinho")).not.toHaveClass("no-bixinho-saindo");

      await passar(100);
      expect(noOuNulo(s1)?.querySelector(".no-bixinho")).toHaveClass("no-bixinho-saindo");
      // A linha (que o jsdom não desenha: sem medida das âncoras) é coberta em nos.test.ts.

      await passar(400);
      expect(noOuNulo(s1)).toBeNull();
      // Quem ainda executa fica.
      expect(noOuNulo(idDoBixinho("o1", "s2"))).not.toBeNull();
      expect(JSON.parse(localStorage.getItem(CHAVE_DOS_LIMPOS) ?? "null")).toEqual({
        o1: { turnoId: "t1", subagentes: ["s1"] },
      });

      // Recarregar: o que saiu não volta.
      unmount();
      render(<CanvasDeOrquestradores />);
      await passar(0);
      expect(noOuNulo(s1)).toBeNull();
      expect(noOuNulo(idDoBixinho("o1", "s2"))).not.toBeNull();
    });

    it("concluído havia tempo ao abrir: sai na hora; com a preferência de manter, fica", async () => {
      simulados.conversas.conversas = new Map([["o1", s1Concluiu("2026-11-08T11:00:00Z")]]);
      localStorage.setItem("orquestrador.preferenciasDaTela", JSON.stringify({ manterBixinhosAteLimpar: true }));
      const { unmount } = render(<CanvasDeOrquestradores />);
      await passar(60_000);
      expect(noOuNulo(idDoBixinho("o1", "s1"))).not.toBeNull();
      unmount();

      localStorage.removeItem("orquestrador.preferenciasDaTela");
      render(<CanvasDeOrquestradores />);
      await passar(0);
      expect(noOuNulo(idDoBixinho("o1", "s1"))).toBeNull();
      expect(noOuNulo(idDoBixinho("o1", "s2"))).not.toBeNull();
    });
  });
});

describe("CanvasDeOrquestradores · abrir orquestrador pelo chat", () => {
  /** O lugar de partida do terminal novo: centralizado na tela simulada (4000 × 3000), zoom 1 e sem pan. */
  const PARTIDA = { x: 2000 - TAMANHO_DO_TERMINAL.largura / 2, y: 1500 - TAMANHO_DO_TERMINAL.altura / 2 };
  const NA_VISTA = { x: PARTIDA.x, y: PARTIDA.y, largura: 600, altura: 520 };
  const PREVIA_AO_LADO = { x: PARTIDA.x + 640, y: PARTIDA.y, ...TAMANHO_DA_PREVIA };

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ObservadorDeTamanhoFalso);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(api, "listarNotas").mockResolvedValue([]);
    const tela = { x: 0, y: 0, left: 0, top: 0, width: 4000, height: 3000, right: 4000, bottom: 3000 };
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ ...tela, toJSON: () => tela });
    // Chat fixo à esquerda: a conversa (com o cartão) fica sempre à vista.
    localStorage.setItem(
      "orquestrador.preferenciasDaTela",
      JSON.stringify({ chatFixoNaEsquerda: true, visualizadorDeCodigo: false, larguraDoChatFixo: 360 }),
    );
    // O terminal de o1 no meio da vista e uma prévia logo à direita dele.
    localStorage.setItem(
      "orquestrador-agentes:canvas:v1",
      JSON.stringify({
        terminais: { o1: NA_VISTA },
        notas: {},
        previas: {
          p1: { ...PREVIA_AO_LADO, minimizada: false, url: "", orquestradorId: null },
        },
        viewport: { x: 0, y: 0, zoom: 1 },
      }),
    );
    const resumos = [orquestrador("o1"), { ...orquestrador("o2"), situacao: "ocioso" as const }];
    simulados.orquestradores.orquestradores = resumos;
    vi.spyOn(api, "listarOrquestradores").mockResolvedValue(resumos);
    simulados.chat = {
      ...ESTADO_INICIAL_DO_CHAT,
      carregado: true,
      mensagens: [
        {
          id: "c1",
          papel: "claude",
          texto: "Sugeri abrir o o2.",
          imagens: [],
          criadaEm: "2026-11-08T12:00:00Z",
          situacao: "concluida",
          acoes: [{ tipo: "abrir_orquestrador", projeto: "o2", pasta: "C:\\projetos\\o2", pedido: null }],
          avisos: [],
          uso: null,
          motivoDaFalha: null,
          autorizacaoPendente: null,
          perguntas: [],
        },
      ],
    };
  });

  afterEach(() => {
    simulados.orquestradores.orquestradores = [];
    simulados.chat = null;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("o cartão abre a tela num lugar livre, sem cobrir o terminal nem a prévia abertos, e selecionada", async () => {
    render(<CanvasDeOrquestradores />);
    await waitFor(() => expect(noNaTela("o1")).toBeInTheDocument());
    expect(posicaoNaTela(idDoNoDaPrevia("p1"))).toEqual({ x: PREVIA_AO_LADO.x, y: PREVIA_AO_LADO.y });

    fireEvent.click(await screen.findByRole("button", { name: "abrir" }));

    await waitFor(() => expect(noNaTela("o2")).toBeInTheDocument());
    const aberta = { ...posicaoNaTela("o2"), ...TAMANHO_DO_TERMINAL };
    expect(sobrepoe(aberta, NA_VISTA)).toBe(false);
    expect(sobrepoe(aberta, PREVIA_AO_LADO)).toBe(false);
    // Na mesma fileira, à direita do que já estava na vista.
    expect(aberta.y).toBe(PARTIDA.y);
    expect(noNaTela("o2")).toHaveClass("selected");
    expect(noNaTela("o1")).not.toHaveClass("selected");
  });

  it("com a tela do orquestrador já no canvas, o cartão só a seleciona: não abre outra nem a move", async () => {
    render(<CanvasDeOrquestradores />);
    await waitFor(() => expect(noNaTela("o1")).toBeInTheDocument());
    fireEvent.click(await screen.findByRole("button", { name: "abrir" }));
    await waitFor(() => expect(noNaTela("o2")).toBeInTheDocument());
    const antes = posicaoNaTela("o2");

    // Seleciona o1 e pede o o2 de novo pelo cartão ("aberto ✓" reabre).
    fireEvent.click(noNaTela("o1"));
    await waitFor(() => expect(noNaTela("o1")).toHaveClass("selected"));
    fireEvent.click(screen.getByRole("button", { name: "aberto ✓" }));

    await waitFor(() => expect(noNaTela("o2")).toHaveClass("selected"));
    expect(noNaTela("o1")).not.toHaveClass("selected");
    expect(posicaoNaTela("o2")).toEqual(antes);
    expect(document.querySelectorAll(".react-flow__node-terminal")).toHaveLength(2);
  });
});

// Vários terminais no jsdom: sob a carga da suíte inteira, passam dos 5 s padrão.
describe("CanvasDeOrquestradores · limite de orquestradores abertos", { timeout: 20_000 }, () => {
  const AVISO = AVISO_DO_LIMITE_DE_ORQUESTRADORES;
  const LIMITE = LIMITE_DE_ORQUESTRADORES_ABERTOS;
  /** Os terminais abertos no começo de cada teste: o canvas cheio. */
  const ABERTOS = Array.from({ length: LIMITE }, (_, indice) => `o${indice + 1}`);
  const ULTIMO = `o${LIMITE}`;
  /** Um Orquestrador a mais, fechado: não cabe. */
  const FORA = `o${LIMITE + 1}`;

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ObservadorDeTamanhoFalso);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(api, "listarNotas").mockResolvedValue([]);
    localStorage.setItem(
      "orquestrador-agentes:canvas:v1",
      JSON.stringify({
        terminais: Object.fromEntries(
          ABERTOS.map((id, indice) => [id, { x: indice * 700, y: 0, largura: 600, altura: 520 }]),
        ),
        notas: {},
        viewport: { x: 0, y: 0, zoom: 1 },
      }),
    );
    simulados.orquestradores.orquestradores = [...ABERTOS, FORA].map(orquestrador);
  });

  afterEach(() => {
    simulados.orquestradores.orquestradores = [];
    simulados.conversas.conversas = new Map();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  const rascunhosNaTela = () => document.querySelectorAll(".react-flow__node-rascunho").length;

  const fecharAviso = () => fireEvent.click(within(screen.getByText(AVISO).parentElement as HTMLElement).getByTitle("Fechar aviso"));

  it("no limite, \"+ Novo ▾\" › Orquestrador mostra o aviso e não abre o formulário", async () => {
    render(<CanvasDeOrquestradores />);
    await waitFor(() => expect(noNaTela(ULTIMO)).toBeInTheDocument());

    escolherNoNovo("Orquestrador");

    expect(await screen.findByText(AVISO)).toBeInTheDocument();
    expect(screen.getByText(AVISO).closest(".alert")).toHaveClass("alert-warning");
    expect(rascunhosNaTela()).toBe(0);

    // Fechável no ✕ do próprio aviso.
    fecharAviso();
    expect(screen.queryByText(AVISO)).not.toBeInTheDocument();
  });

  it("no limite, Ctrl+N também mostra o aviso e não abre o formulário", async () => {
    render(<CanvasDeOrquestradores />);
    await waitFor(() => expect(noNaTela(ULTIMO)).toBeInTheDocument());

    expect(ctrlN(window)).toBe(false);

    expect(await screen.findByText(AVISO)).toBeInTheDocument();
    expect(rascunhosNaTela()).toBe(0);
  });

  it("no limite, reabrir pela lista mostra o aviso; um já aberto só foca; fechar um libera a vaga", async () => {
    render(<CanvasDeOrquestradores />);
    await waitFor(() => expect(noNaTela(ULTIMO)).toBeInTheDocument());

    escolherNaLista(FORA);
    expect(await screen.findByText(AVISO)).toBeInTheDocument();
    expect(document.querySelector(`.react-flow__node[data-id="${FORA}"]`)).toBeNull();

    // Já aberto não conta: não recusa (e não deixa aviso).
    escolherNaLista("o2");
    expect(screen.queryByText(AVISO)).not.toBeInTheDocument();

    // Recusa de novo e fecha o terminal o1 no ✕: o aviso some sozinho e a vaga volta.
    escolherNaLista(FORA);
    expect(await screen.findByText(AVISO)).toBeInTheDocument();
    fireEvent.click(within(noNaTela("o1")).getByTitle("Fechar o terminal (o orquestrador e o histórico continuam salvos)"));
    await waitFor(() => expect(screen.queryByText(AVISO)).not.toBeInTheDocument());
    // O1 continua na lista: nada foi excluído.
    abrirListaDeOrquestradores();
    expect(itemDaLista("o1")).toHaveAttribute("title", "Abrir o terminal no canvas");
    fireEvent.click(screen.getByRole("button", { name: "Novo" }));

    escolherNaLista(FORA);
    await waitFor(() => expect(noNaTela(FORA)).toBeInTheDocument());
    expect(screen.queryByText(AVISO)).not.toBeInTheDocument();
  });

  it("pela paleta (Ctrl+K), abrir um além do limite mostra o aviso e não abre; um pedido de um aberto só leva até ele", async () => {
    simulados.conversas.conversas = new Map([["o2", conversaComDoisSubagentes()]]);
    render(<CanvasDeOrquestradores />);
    await waitFor(() => expect(noNaTela(ULTIMO)).toBeInTheDocument());

    fireEvent.keyDown(window, { key: "k", code: "KeyK", ctrlKey: true });
    const busca = screen.getByRole("combobox", { name: BUSCA_DA_PALETA });
    fireEvent.change(busca, { target: { value: FORA } });
    expect(screen.getAllByRole("option")[0]).toHaveTextContent(`Orquestrador ${FORA}`);
    fireEvent.keyDown(busca, { key: "Enter" });

    expect(await screen.findByText(AVISO)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.querySelector(`.react-flow__node[data-id="${FORA}"]`)).toBeNull();

    // O pedido "analise" é da conversa de o2, que está aberto: não recusa (e o aviso some).
    fireEvent.click(screen.getByRole("button", { name: "Buscar (Ctrl+K)" }));
    fireEvent.change(screen.getByRole("combobox", { name: BUSCA_DA_PALETA }), {
      target: { value: "analise" },
    });
    const pedido = screen.getByRole("option");
    expect(pedido).toHaveTextContent("Orquestrador o2");
    fireEvent.click(pedido);

    expect(screen.queryByText(AVISO)).not.toBeInTheDocument();
    expect(document.querySelectorAll(".react-flow__node-terminal")).toHaveLength(LIMITE);
  });

  it("o rascunho conta: com um a menos que o limite e o formulário aberto, não abre outro", async () => {
    localStorage.setItem(
      "orquestrador-agentes:canvas:v1",
      JSON.stringify({
        terminais: Object.fromEntries(
          ABERTOS.slice(0, -1).map((id, indice) => [id, { x: indice * 700, y: 0, largura: 600, altura: 520 }]),
        ),
        notas: {},
        viewport: { x: 0, y: 0, zoom: 1 },
      }),
    );
    render(<CanvasDeOrquestradores />);
    await waitFor(() => expect(noNaTela(`o${LIMITE - 1}`)).toBeInTheDocument());

    escolherNoNovo("Orquestrador");
    await waitFor(() => expect(rascunhosNaTela()).toBe(1));
    expect(screen.queryByText(AVISO)).not.toBeInTheDocument();

    escolherNaLista(FORA);
    expect(await screen.findByText(AVISO)).toBeInTheDocument();
    expect(document.querySelector(`.react-flow__node[data-id="${FORA}"]`)).toBeNull();
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

  it("vem recolhido; o botão do canto mostra e esconde o minimapa e guarda a escolha", async () => {
    simulados.orquestradores.orquestradores = [orquestrador("o1"), orquestrador("o2")];
    const { unmount } = render(<CanvasDeOrquestradores />);

    const mostrar = await screen.findByRole("button", { name: "Mostrar minimapa" });
    expect(mostrar).toHaveAttribute("aria-pressed", "false");
    expect(mostrar).toHaveAttribute("title", "Mostrar minimapa");
    expect(document.querySelector(".react-flow__minimap")).toBeNull();

    fireEvent.click(mostrar);
    const esconder = await screen.findByRole("button", { name: "Esconder minimapa" });
    expect(esconder).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelector(".react-flow__minimap")).not.toBeNull();
    expect(JSON.parse(localStorage.getItem("orquestrador.preferenciasDaTela") ?? "null")).toMatchObject({
      minimapaVisivel: true,
    });
    // O zoom mora na ilha vertical do canto esquerdo; o botão do minimapa fica nos controles do direito.
    expect(esconder.closest(".react-flow__controls")).toHaveClass("bottom", "right");
    expect(within(screen.getByTestId("ilha-de-ferramentas")).getByRole("button", { name: "Ajustar à tela" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Fit View" })).not.toBeInTheDocument();

    // Ao abrir de novo, volta como foi deixado.
    unmount();
    render(<CanvasDeOrquestradores />);
    fireEvent.click(await screen.findByRole("button", { name: "Esconder minimapa" }));
    expect(screen.getByRole("button", { name: "Mostrar minimapa" })).toHaveAttribute("aria-pressed", "false");
    expect(document.querySelector(".react-flow__minimap")).toBeNull();
  });

  it("só o terminal do Orquestrador trabalhando ganha o brilho no minimapa", async () => {
    localStorage.setItem("orquestrador.preferenciasDaTela", JSON.stringify({ minimapaVisivel: true }));
    simulados.orquestradores.orquestradores = [orquestrador("o1"), { ...orquestrador("o2"), situacao: "ocioso" }];
    render(<CanvasDeOrquestradores />);

    await waitFor(() => expect(document.querySelectorAll(".react-flow__minimap-node.minimapa-terminal")).toHaveLength(2));
    const brilhando = document.querySelectorAll(".react-flow__minimap-node.minimapa-terminal-trabalhando");
    expect(brilhando).toHaveLength(1);
    // o1 está em x = 0; o2, em x = 1500.
    expect(brilhando[0]).toHaveAttribute("x", "0");
  });
});

describe("CanvasDeOrquestradores · Ctrl+N e Organizar na ilha de ferramentas", () => {
  const ORGANIZAR = "Organizar janelas";
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

  it("o \"Organizar\" é o 4º botão da ilha de ferramentas e põe os terminais lado a lado", async () => {
    layoutCom(["o1", "o2"]);
    render(<CanvasDeOrquestradores />);
    await waitFor(() => expect(posicaoNaTela("o2")).toEqual({ x: 1500, y: 0 }));
    const organizar = screen.getByRole("button", { name: ORGANIZAR });

        expect(organizar).toBeEnabled();
    expect(organizar).toHaveAttribute("title", "Organizar: terminais lado a lado; notas e artefatos à direita");
    const ilha = screen.getByTestId("ilha-de-ferramentas");
    expect(ilha).toContainElement(organizar);
    // Depois dele, só o "Desenhar" (5º).
    expect(ilha.querySelectorAll("button")).toHaveLength(5);
    expect(ilha.querySelectorAll("button")[3]).toBe(organizar);
    expect(ilha.querySelectorAll("button")[4]).toBe(screen.getByRole("button", { name: "Desenhar" }));

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

  it("o \"Desenhar\" da ilha abre e fecha a barra de desenho, que abre numa ilha ao lado; Esc fecha", async () => {
    layoutCom(["o1"]);
    render(<CanvasDeOrquestradores />);
    const desenhar = await screen.findByRole("button", { name: "Desenhar" });
    expect(screen.getByTestId("ilha-de-ferramentas")).toContainElement(desenhar);
    expect(screen.queryByRole("toolbar", { name: "Desenho" })).not.toBeInTheDocument();

    fireEvent.click(desenhar);

    expect(desenhar).toHaveAttribute("aria-pressed", "true");
    const barra = screen.getByRole("toolbar", { name: "Desenho" });
    expect(within(barra).getByRole("button", { name: "Caneta" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(desenhar);

    expect(desenhar).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("toolbar", { name: "Desenho" })).not.toBeInTheDocument();

    fireEvent.click(desenhar);
    expect(screen.getByRole("toolbar", { name: "Desenho" }).closest(".painel-da-barra-de-desenho")).not.toBeNull();
    // O primeiro Esc volta da caneta para Selecionar; o segundo fecha a barra.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("toolbar", { name: "Desenho" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("toolbar", { name: "Desenho" })).not.toBeInTheDocument();
    expect(desenhar).toHaveAttribute("aria-pressed", "false");
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
    simulados.orquestradores.orquestradores = [];
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  /** A ponte do app desktop com a atualização no estado dado; `verificar` responde `aposVerificar`. */
  function ponteComAtualizacao(inicial: EstadoDaAtualizacao, aposVerificar: EstadoDaAtualizacao = inicial) {
    const atualizacao = {
      obter: vi.fn(async () => inicial),
      verificar: vi.fn(async () => aposVerificar),
      instalarAgora: vi.fn(async () => undefined),
      aoMudar: vi.fn(() => () => undefined),
    };
    janelaComPonte.electron = {
      desktop: true,
      janela: {
        minimizar: vi.fn(),
        maximizar: vi.fn(),
        fechar: vi.fn(),
        estaMaximizada: vi.fn().mockResolvedValue(false),
        aoMudarMaximizada: vi.fn(() => () => undefined),
      },
      atualizacao,
    };
    return atualizacao;
  }

  function estadoDaAtualizacao(alteracoes: Partial<EstadoDaAtualizacao> = {}): EstadoDaAtualizacao {
    return {
      situacao: "em-dia",
      versaoAtual: "0.2.0",
      versaoNova: null,
      progresso: null,
      mensagemDeErro: null,
      ...alteracoes,
    };
  }

  it("no modo invisível, a tela fica transparente e escondida (só a barra e o chat) e volta ao sair", async () => {
    // Vários componentes ouvem o aviso (canvas, barra de título e chat).
    const ouvintes: Array<(ativo: boolean) => void> = [];
    janelaComPonte.electron = {
      desktop: true,
      janela: {
        minimizar: vi.fn(),
        maximizar: vi.fn(),
        fechar: vi.fn(),
        estaMaximizada: vi.fn().mockResolvedValue(false),
        aoMudarMaximizada: vi.fn(() => () => undefined),
      },
      modoInvisivel: {
        entrar: vi.fn(),
        sair: vi.fn(),
        capturarMouse: vi.fn().mockResolvedValue(undefined),
        capturarTela: vi.fn(),
        capturarAgora: vi.fn(),
        aoCapturarQuadro: vi.fn(() => () => undefined),
        aoMudar: vi.fn((callback: (ativo: boolean) => void) => {
          ouvintes.push(callback);
          return () => undefined;
        }),
      },
    };
    const { container } = render(<CanvasDeOrquestradores />);
    const raiz = container.querySelector(".h-screen");
    const avisar = (ativo: boolean) => act(() => ouvintes.forEach((ouvinte) => ouvinte(ativo)));

    expect(document.documentElement).not.toHaveClass("modo-invisivel");
    expect(raiz).not.toHaveClass("canvas-modo-invisivel");

    avisar(true);
    expect(document.documentElement).toHaveClass("modo-invisivel");
    expect(raiz).toHaveClass("canvas-modo-invisivel");
    // Nada é desmontado: o canvas continua no DOM, só escondido por CSS.
    expect(container.querySelector(".react-flow__renderer")).not.toBeNull();
    expect(screen.getByTestId("chat-rapido")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Modo invisível" })).toHaveAttribute("aria-pressed", "true");

    avisar(false);
    expect(screen.getByRole("button", { name: "Modo invisível" })).toHaveAttribute("aria-pressed", "false");
    expect(document.documentElement).not.toHaveClass("modo-invisivel");
    expect(raiz).not.toHaveClass("canvas-modo-invisivel");
  });

  it("no modo invisível, o CSS esconde as ilhas, o minimapa, os controles e os nós, e mantém só o chat visível", async () => {
    const ouvintes: Array<(ativo: boolean) => void> = [];
    janelaComPonte.electron = {
      desktop: true,
      janela: {
        minimizar: vi.fn(),
        maximizar: vi.fn(),
        fechar: vi.fn(),
        estaMaximizada: vi.fn().mockResolvedValue(false),
        aoMudarMaximizada: vi.fn(() => () => undefined),
      },
      modoInvisivel: {
        entrar: vi.fn(),
        sair: vi.fn(),
        capturarMouse: vi.fn().mockResolvedValue(undefined),
        capturarTela: vi.fn(),
        capturarAgora: vi.fn(),
        aoCapturarQuadro: vi.fn(() => () => undefined),
        aoMudar: vi.fn((callback: (ativo: boolean) => void) => {
          ouvintes.push(callback);
          return () => undefined;
        }),
      },
    };
    // As ilhas trazem o CSS do modo invisível no próprio arquivo (ilhas.css).
    const css = ["index.css", "ilhas.css"].map((arquivo) => readFileSync(resolve(__dirname, "../theme", arquivo), "utf8")).join("\n");
    const estilo = document.createElement("style");
    estilo.textContent = css;
    document.head.appendChild(estilo);
    try {
      const { container } = render(<CanvasDeOrquestradores />);
      const visibilidade = (el: Element | null) => (el ? getComputedStyle(el).visibility : "ausente");
      const paineis = container.querySelector(".ilhas-do-canvas");
      const painelDoChat = container.querySelector(".painel-do-chat");
      expect(paineis).not.toBeNull();
      expect(painelDoChat).not.toBeNull();
      expect(visibilidade(paineis)).not.toBe("hidden");

      act(() => ouvintes.forEach((ouvinte) => ouvinte(true)));

      expect(visibilidade(paineis)).toBe("hidden");
      for (const seletor of [".react-flow__viewport", ".react-flow__minimap", ".react-flow__controls", ".react-flow__background"]) {
        const el = container.querySelector(seletor);
        if (el) expect(visibilidade(el), seletor).toBe("hidden");
      }
      expect(visibilidade(screen.getByTestId("chat-rapido"))).toBe("visible");
      expect(visibilidade(painelDoChat)).toBe("visible");
      // As ilhas (que arrastam a janela) somem de vez, sem mouse; o botão 👁 (que também volta) fica no chat, visível.
      expect(getComputedStyle(paineis as Element).display).toBe("none");
      expect(screen.queryByTestId("faixa-modo-invisivel")).not.toBeInTheDocument();
      const botao = screen.getByRole("button", { name: "Modo invisível" });
      expect(botao).toHaveAttribute("aria-pressed", "true");
      expect(visibilidade(botao)).toBe("visible");
      expect(getComputedStyle(botao).pointerEvents).toBe("auto");
    } finally {
      estilo.remove();
    }
  });

  it("com o chat fixo à esquerda, o modo invisível usa o chat flutuante sem mudar a preferência, e a coluna volta ao sair", async () => {
    localStorage.setItem(
      "orquestrador.preferenciasDaTela",
      JSON.stringify({ chatFixoNaEsquerda: true, visualizadorDeCodigo: false, larguraDoChatFixo: 360 }),
    );
    const ouvintes: Array<(ativo: boolean) => void> = [];
    const capturarMouse = vi.fn().mockResolvedValue(undefined);
    janelaComPonte.electron = {
      desktop: true,
      janela: {
        minimizar: vi.fn(),
        maximizar: vi.fn(),
        fechar: vi.fn(),
        estaMaximizada: vi.fn().mockResolvedValue(false),
        aoMudarMaximizada: vi.fn(() => () => undefined),
      },
      modoInvisivel: {
        entrar: vi.fn(),
        sair: vi.fn(),
        capturarMouse,
        capturarTela: vi.fn(),
        capturarAgora: vi.fn(),
        aoCapturarQuadro: vi.fn(() => () => undefined),
        aoMudar: vi.fn((callback: (ativo: boolean) => void) => {
          ouvintes.push(callback);
          return () => undefined;
        }),
      },
    };
    render(<CanvasDeOrquestradores />);
    await screen.findByRole("complementary", { name: "Chat rápido" });

    act(() => [...ouvintes].forEach((ouvinte) => ouvinte(true)));

    // A coluna da altura toda cobriria os apps de trás: o chat vai para o painel do pé.
    expect(screen.queryByRole("complementary", { name: "Chat rápido" })).not.toBeInTheDocument();
    const chat = screen.getByTestId("chat-rapido");
    expect(chat.closest(".react-flow__panel")).toHaveClass("painel-do-chat");
    // O chat remontado já nasce no modo (sem a faixa, que o upstream removeu) e a janela volta a deixar os cliques passarem.
    expect(within(chat).queryByTestId("faixa-modo-invisivel")).not.toBeInTheDocument();
    await waitFor(() => expect(capturarMouse).toHaveBeenLastCalledWith(false));
    expect(screen.queryByRole("button", { name: "Fixar o chat à esquerda" })).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("orquestrador.preferenciasDaTela") ?? "null")).toMatchObject({
      chatFixoNaEsquerda: true,
    });

    act(() => [...ouvintes].forEach((ouvinte) => ouvinte(false)));

    expect(await screen.findByRole("complementary", { name: "Chat rápido" })).toBeInTheDocument();
    expect(document.querySelector(".painel-do-chat")).toBeNull();
  });

  it("no desktop há uma faixa invisível de 36 px que arrasta a janela; no navegador ela não existe", async () => {
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
    const { unmount } = render(<CanvasDeOrquestradores />);
    await screen.findByTestId("ilha-do-nome");
    const faixa = screen.getByTestId("faixa-de-arrasto");
    expect(faixa).toHaveClass("faixa-de-arrasto");
    // Vem antes de tudo no DOM: o no-drag das ilhas, janelas e menus a recorta.
    expect(faixa.compareDocumentPosition(screen.getByTestId("ilha-do-nome")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Invisível, de 36 px e arrastável (o CSS é lido do arquivo, o jsdom não o aplica).
    const css = readFileSync(resolve(__dirname, "../theme/ilhas.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const regra = /\.faixa-de-arrasto\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(regra).toMatch(/height:\s*36px/);
    expect(regra).toMatch(/-webkit-app-region:\s*drag/);
    expect(regra).toMatch(/background:\s*transparent/);
    expect(regra).toMatch(/border:\s*0/);
    expect(regra).toMatch(/box-shadow:\s*none/);
    unmount();

    delete janelaComPonte.electron;
    render(<CanvasDeOrquestradores />);
    await screen.findByTestId("ilha-do-nome");
    expect(screen.queryByTestId("faixa-de-arrasto")).not.toBeInTheDocument();
  });

  it("o fundo opaco da tela fica no #root, nunca no html nem no body (no macOS ele prende na janela)", () => {
    const css = readFileSync(resolve(__dirname, "../theme/index.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const regras = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, seletores = "", corpo = ""]) => ({
      seletores: seletores.split(",").map((seletor) => seletor.trim()),
      corpo,
    }));
    const daRaiz = regras.filter(({ seletores }) => seletores.some((seletor) => seletor === "html" || seletor === "body"));
    expect(daRaiz.length).toBeGreaterThan(0);
    for (const { seletores, corpo } of daRaiz) {
      expect(corpo, seletores.join(", ")).not.toMatch(/background/);
    }
    const doRoot = regras.find(({ seletores }) => seletores.includes("#root"));
    expect(doRoot?.corpo).toMatch(/background-color:\s*var\(--screen-bg\)/);
  });

  it("a paleta oferece \"Procurar atualizações\" com a versão; escolher verifica e ela, aberta, mostra o resultado", async () => {
    const atualizacao = ponteComAtualizacao(
      estadoDaAtualizacao(),
      estadoDaAtualizacao({ situacao: "erro", mensagemDeErro: "sem internet" }),
    );
    render(<CanvasDeOrquestradores />);

    // Aberta antes da resposta do app: a ação entra assim que ele responde.
    fireEvent.click(screen.getByRole("button", { name: "Buscar (Ctrl+K)" }));
    const opcao = await screen.findByRole("option", { name: /Procurar atualizações/ });
    expect(opcao).toHaveTextContent("Versão 0.2.0 — você está na versão mais recente");

    fireEvent.click(opcao);

    expect(atualizacao.verificar).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog", { name: "Paleta de comandos" })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("option", { name: /Procurar atualizações/ })).toHaveTextContent(
        "Versão 0.2.0 — não foi possível verificar: sem internet",
      ),
    );
    // O erro fica só na paleta: nenhuma notificação.
    expect(screen.queryByRole("region", { name: "Notificações" })).not.toBeInTheDocument();
  });

  it("com a atualização pronta, reiniciar com Orquestradores trabalhando pede confirmação", async () => {
    simulados.orquestradores.orquestradores = [orquestrador("o1"), { ...orquestrador("o2"), situacao: "ocioso" }];
    const atualizacao = ponteComAtualizacao(estadoDaAtualizacao({ situacao: "pronta", versaoNova: "0.2.1" }));
    render(<CanvasDeOrquestradores />);
    // O aviso de atualização entra na pilha de notificações do canto superior direito.
    const pilha = await screen.findByRole("region", { name: "Notificações" });

    fireEvent.click(await within(pilha).findByRole("button", { name: "Atualização pronta (v0.2.1)" }));
    fireEvent.click(within(pilha).getByRole("button", { name: "Reiniciar agora" }));

    expect(within(pilha).getByRole("alert")).toHaveTextContent(
      "Há 1 pedido em andamento; reiniciar agora vai cancelá-lo.",
    );
    expect(atualizacao.instalarAgora).not.toHaveBeenCalled();
    fireEvent.click(within(pilha).getByRole("button", { name: "Reiniciar mesmo assim" }));
    expect(atualizacao.instalarAgora).toHaveBeenCalledTimes(1);
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

  describe("sem faixa de título", () => {
    function ponteDaJanela(plataforma?: string) {
      janelaComPonte.electron = {
        desktop: true,
        ...(plataforma ? { plataforma } : {}),
        janela: {
          minimizar: vi.fn(),
          maximizar: vi.fn(),
          fechar: vi.fn(),
          estaMaximizada: vi.fn().mockResolvedValue(false),
          aoMudarMaximizada: vi.fn(() => () => undefined),
        },
      };
    }
    const controles = () => screen.queryByRole("group", { name: "Controles da janela" });

    it("no navegador, sem controles de janela, sem arraste reservado e com a ilha do nome em esquerda 16", () => {
      render(<CanvasDeOrquestradores />);

      expect(controles()).not.toBeInTheDocument();
      expect(document.querySelector(".barra-de-titulo")).toBeNull();
      expect(screen.getByTestId("ilha-do-nome").parentElement).not.toHaveClass("coluna-da-ilha-esquerda-mac");
      // O status vive na aba Sistema das Configurações (fechadas por padrão).
      expect(screen.queryByTestId("status-do-canvas")).not.toBeInTheDocument();
    });

    it("no Windows, ─ ☐ ✕ ficam no fim da ilha da direita, depois de um divisor; o canvas começa no topo da janela", () => {
      ponteDaJanela("win32");
      const { container } = render(<CanvasDeOrquestradores />);

      const ilha = screen.getByRole("group", { name: "Busca, status e configurações" });
      expect(ilha).toHaveClass("ilha-arrasta");
      const grupo = within(ilha).getByRole("group", { name: "Controles da janela" });
      expect(ilha.lastElementChild).toBe(grupo);
      expect(grupo.previousElementSibling).toHaveClass("divisor-da-ilha");
      expect(document.querySelector(".barra-de-titulo")).toBeNull();
      // A área do canvas é a primeira coisa da tela: nenhuma faixa acima dela.
      expect(container.querySelector(".h-screen")?.firstElementChild?.firstElementChild).toHaveClass("area-do-canvas");
      expect(screen.getByTestId("ilha-do-nome").parentElement).not.toHaveClass("coluna-da-ilha-esquerda-mac");
    });

    it("no Mac desktop, as bolinhas são nativas: sem ─ ☐ ✕ e com a ilha do nome deslocada para a direita", () => {
      ponteDaJanela("darwin");
      render(<CanvasDeOrquestradores />);

      expect(controles()).not.toBeInTheDocument();
      expect(screen.getByTestId("ilha-do-nome")).toHaveClass("ilha-arrasta");
      expect(screen.getByTestId("ilha-do-nome").parentElement).toHaveClass("coluna-da-ilha-esquerda-mac");
    });
  });

  it("a busca e o ⚙ ficam na ilha da direita; a paleta oferece \"Pastas e Claude Code\" só no desktop", () => {
    // Navegador: a ilha tem a busca e a engrenagem; a paleta não tem a ação.
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
    const ilha = screen.getByRole("group", { name: "Busca, status e configurações" });
    expect(within(ilha).getByRole("button", { name: "Configurações" })).toBeInTheDocument();

    fireEvent.click(within(ilha).getByRole("button", { name: "Buscar (Ctrl+K)" }));
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

  it("artefatos não contam no limite de orquestradores abertos", async () => {
    layoutCom(
      Array.from({ length: LIMITE_DE_ORQUESTRADORES_ABERTOS - 1 }, (_, indice) => `o${indice + 1}`),
      ["a1", "a2"],
    );
    comArtefatos([artefato("a1"), artefato("a2")]);
    const { rerender } = render(<CanvasDeOrquestradores />);
    await waitFor(() => expect(noNaTela(idDoNoDoArtefato("a2"))).toBeInTheDocument());

    // Um terminal a menos que o limite + 2 artefatos: ainda cabe o formulário de um orquestrador novo.
    escolherNoNovo("Orquestrador");
    await waitFor(() => expect(document.querySelectorAll(".react-flow__node-rascunho")).toHaveLength(1));
    expect(screen.queryByText(AVISO_DO_LIMITE_DE_ORQUESTRADORES)).not.toBeInTheDocument();

    // Com todas as vagas ocupadas, um artefato novo continua abrindo.
    const novo = artefato("a3", { origem: { tipo: "orquestrador", id: "o2" } });
    comArtefatos([novo, artefato("a1"), artefato("a2")], [{ tipo: "artefato_criado", artefato: novo }]);
    rerender(<CanvasDeOrquestradores />);
    await waitFor(() => expect(noNaTela(idDoNoDoArtefato("a3"))).toBeInTheDocument());
    expect(screen.queryByText(AVISO_DO_LIMITE_DE_ORQUESTRADORES)).not.toBeInTheDocument();
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
    localStorage.setItem("orquestrador.preferenciasDaTela", JSON.stringify({ minimapaVisivel: true }));
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

    fireEvent.click(screen.getByRole("button", { name: "Organizar janelas" }));

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

describe("CanvasDeOrquestradores · prévias", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ObservadorDeTamanhoFalso);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(api, "listarNotas").mockResolvedValue([]);
  });

  afterEach(() => {
    simulados.orquestradores.orquestradores = [];
    simulados.conversas.conversas = new Map();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("\"Prévia\" do \"+ Novo ▾\" abre uma prévia vazia com o endereço focado, e fechar a tira do layout", async () => {
    render(<CanvasDeOrquestradores />);

    escolherNoNovo("Prévia");

    const campo = await screen.findByRole("textbox", { name: "Endereço da prévia" });
    await waitFor(() => expect(campo).toHaveFocus());
    await waitFor(() => expect(Object.values(lerLayout().previas)).toEqual([
      expect.objectContaining({ url: "", orquestradorId: null, minimizada: false }),
    ]));

    fireEvent.change(campo, { target: { value: "localhost:5173" } });
    fireEvent.keyDown(campo, { key: "Enter" });
    await waitFor(() => expect(Object.values(lerLayout().previas)[0]?.url).toBe("http://localhost:5173"));

    fireEvent.click(screen.getByRole("button", { name: "Fechar a prévia" }));
    await waitFor(() => expect(lerLayout().previas).toEqual({}));
  });

  it("\"abrir prévia\" no terminal cria a prévia à direita dele e, de novo, reaproveita a mesma", async () => {
    localStorage.setItem(
      "orquestrador-agentes:canvas:v1",
      JSON.stringify({ terminais: { o1: { x: 0, y: 0, largura: 600, altura: 520 } }, viewport: { x: 0, y: 0, zoom: 1 } }),
    );
    simulados.orquestradores.orquestradores = [orquestrador("o1")];
    simulados.conversas.conversas = new Map([["o1", { ...ESTADO_INICIAL, enderecosLocais: ["http://localhost:5173"] }]]);
    render(<CanvasDeOrquestradores />);

    const abrir = await screen.findByRole("button", { name: "Abrir prévia de http://localhost:5173" });
    fireEvent.click(abrir);
    await screen.findByRole("textbox", { name: "Endereço da prévia" });
    fireEvent.click(abrir);

    await waitFor(() => expect(Object.values(lerLayout().previas)).toHaveLength(1));
    const [previa] = Object.values(lerLayout().previas);
    expect(previa).toMatchObject({ url: "http://localhost:5173", orquestradorId: "o1", y: 0 });
    expect(sobrepoe(previa ?? { x: 0, y: 0, largura: 0, altura: 0 }, { x: 0, y: 0, largura: 600, altura: 520 })).toBe(false);
    expect(previa?.x).toBeGreaterThan(600);
  });
});

/** Um WebSocket que nunca abre: os testes do canvas só olham o bloco e o layout. */
class WebSocketParado {
  static readonly OPEN = 1;
  readyState = 0;
  onopen = null;
  onmessage = null;
  onclose = null;
  send(): void {}
  close(): void {}
}

describe("CanvasDeOrquestradores · terminais (shell)", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ObservadorDeTamanhoFalso);
    vi.stubGlobal("WebSocket", WebSocketParado);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(api, "listarNotas").mockResolvedValue([]);
    vi.spyOn(api, "navegarPastas").mockResolvedValue({ caminho: "/projetos/app", pai: "/projetos", pastas: [] });
  });

  afterEach(() => {
    simulados.orquestradores.orquestradores = [];
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("\"Terminal\" do \"+ Novo ▾\" pede a pasta, cria o shell nela e guarda o bloco no layout; fechar encerra e tira", async () => {
    const criar = vi
      .spyOn(api, "criarShell")
      .mockResolvedValue({ id: "t1", pasta: "/projetos/app", orquestradorId: null, criadoEm: "2026-11-07T10:00:00Z" });
    const encerrar = vi.spyOn(api, "encerrarShell").mockResolvedValue(null);
    render(<CanvasDeOrquestradores />);

    escolherNoNovo("Terminal");
    const dialogo = await screen.findByRole("dialog", { name: "Escolher pasta do computador" });
    expect(await within(dialogo).findByDisplayValue("/projetos/app")).toHaveAccessibleName("Caminho da pasta");
    fireEvent.click(within(dialogo).getByRole("button", { name: /usar esta pasta/ }));

    await screen.findByRole("button", { name: "Fechar este terminal" });
    expect(criar).toHaveBeenCalledWith({ pasta: "/projetos/app", colunas: 80, linhas: 24 });
    await waitFor(() =>
      expect(Object.values(lerLayout().shells)).toEqual([
        expect.objectContaining({ terminalId: "t1", pasta: "/projetos/app", orquestradorId: null }),
      ]),
    );

    fireEvent.click(screen.getByRole("button", { name: "Fechar este terminal" }));
    expect(encerrar).toHaveBeenCalledWith("t1");
    await waitFor(() => expect(lerLayout().shells).toEqual({}));
  });

  it("no limite (409), a mensagem do servidor aparece abaixo da barra do canvas", async () => {
    vi.spyOn(api, "criarShell").mockRejectedValue(new ErroDaApi("Limite de 6 terminais abertos.", 409));
    render(<CanvasDeOrquestradores />);

    escolherNoNovo("Terminal");
    const dialogo = await screen.findByRole("dialog", { name: "Escolher pasta do computador" });
    expect(await within(dialogo).findByDisplayValue("/projetos/app")).toHaveAccessibleName("Caminho da pasta");
    fireEvent.click(within(dialogo).getByRole("button", { name: /usar esta pasta/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Limite de 6 terminais abertos.");
    expect(document.querySelector(".react-flow__node-shell")).toBeNull();
  });

  it("\"abrir terminal\" no cartão do orquestrador cria o shell ligado a ele, ao lado", async () => {
    localStorage.setItem(
      "orquestrador-agentes:canvas:v1",
      JSON.stringify({ terminais: { o1: { x: 0, y: 0, largura: 600, altura: 520 } }, viewport: { x: 0, y: 0, zoom: 1 } }),
    );
    simulados.orquestradores.orquestradores = [orquestrador("o1")];
    const criar = vi
      .spyOn(api, "criarShell")
      .mockResolvedValue({ id: "t9", pasta: "C:\\projetos\\o1", orquestradorId: "o1", criadoEm: "2026-11-07T10:00:00Z" });
    render(<CanvasDeOrquestradores />);

    fireEvent.click(await screen.findByRole("button", { name: "Abrir terminal" }));

    await screen.findByRole("button", { name: "Enviar ao orquestrador" });
    expect(criar).toHaveBeenCalledWith({ orquestradorId: "o1", colunas: 80, linhas: 24 });
    await waitFor(() => expect(Object.values(lerLayout().shells)).toHaveLength(1));
    const [shell] = Object.values(lerLayout().shells);
    expect(shell).toMatchObject({ terminalId: "t9", orquestradorId: "o1" });
    expect(sobrepoe(shell ?? { x: 0, y: 0, largura: 0, altura: 0 }, { x: 0, y: 0, largura: 600, altura: 520 })).toBe(false);
  });
});

describe("CanvasDeOrquestradores · seleção múltipla e barra do grupo", { timeout: 20_000 }, () => {
  const selecionados = () =>
    [...document.querySelectorAll<HTMLElement>(".react-flow__node.selected")].map((no) => no.dataset.id).sort();
  const barraDoGrupo = () => screen.queryByRole("toolbar", { name: "Ações do grupo" });

  /** Ctrl/Cmd + A; devolve false se o padrão foi impedido. */
  function selecionarTudo(alvo: Window | HTMLElement, tecla: "metaKey" | "ctrlKey" = "metaKey"): boolean {
    return fireEvent.keyDown(alvo, { key: "a", code: "KeyA", [tecla]: true });
  }

  function layoutCom(terminais: Record<string, { x: number; y: number }>): void {
    localStorage.setItem(
      "orquestrador-agentes:canvas:v1",
      JSON.stringify({
        terminais: Object.fromEntries(
          Object.entries(terminais).map(([id, { x, y }]) => [id, { x, y, largura: 600, altura: 520 }]),
        ),
        notas: {},
        viewport: { x: 0, y: 0, zoom: 1 },
      }),
    );
    simulados.orquestradores.orquestradores = Object.keys(terminais).map(orquestrador);
  }

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ObservadorDeTamanhoFalso);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(api, "listarNotas").mockResolvedValue([]);
    // Um canvas de tamanho real, como nos testes de arraste dos bixinhos.
    const tela = { x: 0, y: 0, left: 0, top: 0, width: 4000, height: 3000, right: 4000, bottom: 3000 };
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ ...tela, toJSON: () => tela });
  });

  afterEach(() => {
    simulados.orquestradores.orquestradores = [];
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("arrastar no vazio move o canvas (mouse e trackpad); shift + arrastar seleciona (parcial)", async () => {
    layoutCom({ o1: { x: 0, y: 0 } });
    render(<CanvasDeOrquestradores />);
    await waitFor(() => expect(noNaTela("o1")).toBeInTheDocument());

    const props = simulados.propsDoFluxo;
    expect(props?.selectionOnDrag).toBeUndefined();
    expect(props).toMatchObject({
      selectionKeyCode: "Shift",
      selectionMode: "partial",
      panOnDrag: [0, 1],
      panOnScroll: true,
      panActivationKeyCode: "Space",
      zoomActivationKeyCode: "Control",
      multiSelectionKeyCode: ["Shift", "Meta", "Control"],
    });
    // Soltar o grupo (pela tela ou pelo retângulo do React Flow) grava o layout do mesmo jeito.
    expect(props?.onNodeDragStop).toEqual(expect.any(Function));
    expect(props?.onSelectionDragStop).toBe(props?.onNodeDragStop);
    expect(props?.onSelectionDragStart).toBe(props?.onNodeDragStart);
    expect(props?.onSelectionEnd).toEqual(expect.any(Function));
    // O fundo arrasta o canvas com o botão esquerdo; sem o Shift, não desenha a seleção.
    const fundo = document.querySelector(".react-flow__pane");
    expect(fundo).toHaveClass("draggable");
    expect(fundo).not.toHaveClass("selection");
  });

  it("Cmd+A (ou Ctrl+A) seleciona todas as telas e mostra a barra do grupo; num campo de texto, não", async () => {
    layoutCom({ o1: { x: 0, y: 0 }, o2: { x: 1500, y: 0 }, o3: { x: 3000, y: 0 } });
    render(<CanvasDeOrquestradores />);
    await waitFor(() => expect(noNaTela("o3")).toBeInTheDocument());
    const chat = await screen.findByRole("textbox", { name: "Pergunta para o Claude" });

    expect(selecionarTudo(chat)).toBe(true);
    expect(selecionados()).toEqual([]);
    expect(barraDoGrupo()).not.toBeInTheDocument();

    expect(selecionarTudo(window)).toBe(false);
    await waitFor(() => expect(selecionados()).toEqual(["o1", "o2", "o3"]));
    expect(barraDoGrupo()).toHaveTextContent("3 telas");
    expect(barraDoGrupo()?.closest(".react-flow__panel")).toHaveClass("top", "center", "painel-da-barra-do-grupo");

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(selecionados()).toEqual([]));
    expect(selecionarTudo(window, "ctrlKey")).toBe(false);
    await waitFor(() => expect(selecionados()).toEqual(["o1", "o2", "o3"]));
  });

  it("com uma tela só, Cmd+A não mostra a barra do grupo", async () => {
    layoutCom({ o1: { x: 0, y: 0 } });
    render(<CanvasDeOrquestradores />);
    await waitFor(() => expect(noNaTela("o1")).toBeInTheDocument());

    selecionarTudo(window);

    await waitFor(() => expect(selecionados()).toEqual(["o1"]));
    expect(barraDoGrupo()).not.toBeInTheDocument();
  });

  it("Esc limpa a seleção, menos num campo de texto ou quando outro (menu, tela cheia) já usou o Esc", async () => {
    layoutCom({ o1: { x: 0, y: 0 }, o2: { x: 1500, y: 0 } });
    render(<CanvasDeOrquestradores />);
    await waitFor(() => expect(noNaTela("o2")).toBeInTheDocument());
    const chat = await screen.findByRole("textbox", { name: "Pergunta para o Claude" });
    selecionarTudo(window);
    await waitFor(() => expect(selecionados()).toEqual(["o1", "o2"]));

    fireEvent.keyDown(chat, { key: "Escape" });
    // Quem ouve a janela depois do canvas (a tela cheia do terminal) usa o Esc: a seleção fica.
    const usarOEsc = (evento: KeyboardEvent) => evento.preventDefault();
    window.addEventListener("keydown", usarOEsc);
    fireEvent.keyDown(window, { key: "Escape" });
    window.removeEventListener("keydown", usarOEsc);
    await act(async () => {
      await new Promise((resolver) => setTimeout(resolver, 20));
    });
    expect(selecionados()).toEqual(["o1", "o2"]);

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(selecionados()).toEqual([]));
    expect(barraDoGrupo()).not.toBeInTheDocument();
  });

  it("arrastar uma tela selecionada pela barra move o grupo inteiro e grava as posições de todas", async () => {
    layoutCom({ o1: { x: 0, y: 0 }, o2: { x: 1500, y: 0 } });
    render(<CanvasDeOrquestradores />);
    await waitFor(() => expect(noNaTela("o2")).toBeInTheDocument());
    selecionarTudo(window);
    await waitFor(() => expect(selecionados()).toEqual(["o1", "o2"]));

    const alca = noNaTela("o1").querySelector(".alca-do-terminal");
    if (alca === null) {
      throw new Error("barra de título de o1 não encontrada");
    }
    // O primeiro movimento só começa o arraste (passa do limiar, em 101, 102); o
    // segundo leva o grupo 199 para a direita e 98 para baixo a partir dali.
    fireEvent(alca, eventoDoMouse("mousedown", 100, 100));
    fireEvent(window, eventoDoMouse("mousemove", 101, 102));
    fireEvent(window, eventoDoMouse("mousemove", 300, 200));
    fireEvent(window, eventoDoMouse("mouseup", 300, 200));

    await waitFor(() => expect(posicaoNaTela("o1")).toEqual({ x: 199, y: 98 }));
    expect(posicaoNaTela("o2")).toEqual({ x: 1699, y: 98 });
    expect(selecionados()).toEqual(["o1", "o2"]);
    await waitFor(() =>
      expect(lerLayout().terminais).toMatchObject({ o1: { x: 199, y: 98 }, o2: { x: 1699, y: 98 } }),
    );
  });

  it("a barra alinha ao topo e põe lado a lado; Fechar confirma e tira os terminais sem apagar os orquestradores", async () => {
    layoutCom({ o1: { x: 0, y: 300 }, o2: { x: 1500, y: 0 }, o3: { x: 3000, y: 120 } });
    const remover = vi.spyOn(api, "removerOrquestrador");
    const confirmar = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<CanvasDeOrquestradores />);
    await waitFor(() => expect(noNaTela("o3")).toBeInTheDocument());
    selecionarTudo(window);
    const barra = await screen.findByRole("toolbar", { name: "Ações do grupo" });

    fireEvent.click(within(barra).getByRole("button", { name: "Alinhar ao topo" }));
    await waitFor(() => expect(posicaoNaTela("o1")).toEqual({ x: 0, y: 0 }));
    expect(posicaoNaTela("o3")).toEqual({ x: 3000, y: 0 });

    fireEvent.click(within(barra).getByRole("button", { name: "Lado a lado" }));
    await waitFor(() => expect(posicaoNaTela("o2")).toEqual({ x: 640, y: 0 }));
    expect(posicaoNaTela("o3")).toEqual({ x: 1280, y: 0 });

    fireEvent.click(within(barra).getByRole("button", { name: "Fechar" }));
    expect(confirmar).toHaveBeenCalledWith("Fechar 3 telas? Os orquestradores continuam salvos e voltam pela Doca.");
    expect(noNaTela("o1")).toBeInTheDocument();

    confirmar.mockReturnValue(true);
    fireEvent.click(within(barra).getByRole("button", { name: "Fechar" }));
    await waitFor(() => expect(document.querySelectorAll(".react-flow__node-terminal")).toHaveLength(0));
    expect(barraDoGrupo()).not.toBeInTheDocument();
    expect(remover).not.toHaveBeenCalled();
    await waitFor(() => expect(lerLayout().terminais).toEqual({}));
  });

  it("com só algumas telas selecionadas, alinhar não as sobrepõe nem as põe sobre as de fora da seleção", async () => {
    // o1 e o2 empilhadas na mesma coluna; o3, fora da seleção, logo à direita de o1.
    layoutCom({ o1: { x: 0, y: 0 }, o2: { x: 0, y: 700 }, o3: { x: 700, y: 0 } });
    render(<CanvasDeOrquestradores />);
    await waitFor(() => expect(noNaTela("o3")).toBeInTheDocument());
    fireEvent.click(noNaTela("o1"));
    await waitFor(() => expect(selecionados()).toEqual(["o1"]));
    fireEvent.keyDown(document, { key: "Shift" });
    fireEvent.click(noNaTela("o2"), { shiftKey: true });
    fireEvent.keyUp(document, { key: "Shift" });
    await waitFor(() => expect(selecionados()).toEqual(["o1", "o2"]));
    const barra = await screen.findByRole("toolbar", { name: "Ações do grupo" });

    fireEvent.click(within(barra).getByRole("button", { name: "Alinhar ao topo" }));

    // Sem o desvio, o2 subiria para cima de o1; ao lado de o1, cairia sobre o3: o grupo vai para a área livre.
    await waitFor(() => expect(posicaoNaTela("o1")).not.toEqual({ x: 0, y: 0 }));
    const telas = ["o1", "o2", "o3"].map((id) => ({ ...posicaoNaTela(id), largura: 600, altura: 520 }));
    const [o1, o2, o3] = telas;
    expect(o3).toMatchObject({ x: 700, y: 0 });
    expect(o2?.y).toBe(o1?.y);
    for (const [indice, tela] of telas.entries()) {
      expect(telas.filter((outra, outroIndice) => outroIndice !== indice && sobrepoe(tela, outra))).toEqual([]);
    }
    await waitFor(() => expect(lerLayout().terminais.o2).toMatchObject({ x: o2?.x, y: o2?.y }));
  });

  it("minimizar pela barra deixa só a barra de título dos terminais; de novo, restaura", async () => {
    layoutCom({ o1: { x: 0, y: 0 }, o2: { x: 1500, y: 0 } });
    render(<CanvasDeOrquestradores />);
    await waitFor(() => expect(noNaTela("o2")).toBeInTheDocument());
    selecionarTudo(window);
    const barra = await screen.findByRole("toolbar", { name: "Ações do grupo" });

    fireEvent.click(within(barra).getByRole("button", { name: "Minimizar" }));

    await waitFor(() => expect(lerLayout().terminais).toMatchObject({ o1: { minimizada: true }, o2: { minimizada: true } }));
    fireEvent.click(within(barra).getByRole("button", { name: "Restaurar" }));
    await waitFor(() => expect(lerLayout().terminais.o1?.minimizada).toBeUndefined());
    expect(lerLayout().terminais.o2?.minimizada).toBeUndefined();
  });

  it("\"Salvar como modelo\" guarda as telas selecionadas com posições relativas e abre o painel Modelos", async () => {
    layoutCom({ o1: { x: 100, y: 200 }, o2: { x: 900, y: 300 } });
    vi.spyOn(api, "listarModelosDeCanvas").mockResolvedValue([]);
    const criar = vi.spyOn(api, "criarModeloDeCanvas").mockImplementation(async (conteudo) => ({
      ...conteudo,
      id: "m1",
      criadoEm: "2026-11-09T12:00:00Z",
      atualizadoEm: "2026-11-09T12:00:00Z",
    }));
    render(<CanvasDeOrquestradores />);
    await waitFor(() => expect(noNaTela("o2")).toBeInTheDocument());
    selecionarTudo(window);
    const barra = await screen.findByRole("toolbar", { name: "Ações do grupo" });

    fireEvent.click(within(barra).getByRole("button", { name: "Salvar como modelo" }));
    const dialogo = await screen.findByRole("dialog", { name: "Salvar como modelo" });
    expect(dialogo).toHaveTextContent("2 orquestradores");
    fireEvent.change(within(dialogo).getByRole("textbox", { name: "Nome" }), { target: { value: "Dupla" } });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Salvar modelo" }));

    await screen.findByRole("region", { name: "Modelos de canvas" });
    expect(screen.queryByRole("dialog", { name: "Salvar como modelo" })).not.toBeInTheDocument();
    expect(criar).toHaveBeenCalledWith({
      nome: "Dupla",
      icone: "🧩",
      cor: "#d97757",
      itens: [
        {
          tipo: "orquestrador",
          x: 0,
          y: 0,
          largura: 600,
          altura: 520,
          nome: "Orquestrador o1",
          pastaDeTrabalho: "C:\\projetos\\o1",
          configuracao,
        },
        {
          tipo: "orquestrador",
          x: 800,
          y: 100,
          largura: 600,
          altura: 520,
          nome: "Orquestrador o2",
          pastaDeTrabalho: "C:\\projetos\\o2",
          configuracao,
        },
      ],
    });
  });

  it("Recriar cria cada item pela API no mesmo arranjo, com o orquestrador parado e o shell sem comando", async () => {
    vi.spyOn(api, "listarModelosDeCanvas").mockResolvedValue([
      {
        id: "m1",
        nome: "Backend",
        icone: "🧩",
        cor: "#d97757",
        itens: [
          { tipo: "orquestrador", x: 0, y: 0, largura: 600, altura: 520, nome: "API", pastaDeTrabalho: "/projetos/api", configuracao },
          { tipo: "nota", x: 640, y: 0, titulo: "Pendências", texto: "- [ ] revisar" },
          { tipo: "terminal", x: 0, y: 560, pasta: "/projetos/api", comando: "npm run dev" },
          { tipo: "previa", x: 700, y: 600, url: "https://exemplo.com" },
        ],
        criadoEm: "2026-11-09T12:00:00Z",
        atualizadoEm: "2026-11-09T12:00:00Z",
      },
    ]);
    const criarOrquestrador = vi.spyOn(api, "criarOrquestrador").mockResolvedValue(orquestrador("novo"));
    const criarNota = vi
      .spyOn(api, "criarNota")
      .mockResolvedValue(nota("n1", { titulo: "Pendências", texto: "- [ ] revisar" }));
    const criarShell = vi
      .spyOn(api, "criarShell")
      .mockResolvedValue({ id: "t1", pasta: "/projetos/api", orquestradorId: null, criadoEm: "2026-11-09T12:00:00Z" });
    const enviar = vi.spyOn(api, "enviarMensagem");
    // O original continua existindo: o recriado ganha um nome livre.
    simulados.orquestradores.orquestradores = [{ ...orquestrador("o1"), nome: "API" }];
    render(<CanvasDeOrquestradores />);
    await screen.findByRole("textbox", { name: "Pergunta para o Claude" });

    fireEvent.click(screen.getByRole("button", { name: "Novo" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Modelos de canvas" }));
    fireEvent.click(await screen.findByRole("button", { name: "Recriar Backend" }));

    const resultado = await screen.findByRole("status", { name: "Resultado da recriação" });
    expect(resultado).toHaveTextContent('"Backend": 4 de 4 itens recriados, parados (nenhum pedido foi enviado).');
    expect(criarOrquestrador).toHaveBeenCalledWith(
      expect.objectContaining({ ...configuracao, nome: "API 2", pastaDeTrabalho: "/projetos/api" }),
    );
    expect(criarNota).toHaveBeenCalledWith({ titulo: "Pendências", texto: "- [ ] revisar" });
    expect(criarShell).toHaveBeenCalledWith({ pasta: "/projetos/api", colunas: 80, linhas: 24 });
    expect(enviar).not.toHaveBeenCalled();

    // O mesmo arranjo, a partir do canto do orquestrador recriado.
    await waitFor(() => expect(noNaTela("novo")).toBeInTheDocument());
    const origem = posicaoNaTela("novo");
    expect(posicaoNaTela("nota:n1")).toEqual({ x: origem.x + 640, y: origem.y });
    await waitFor(() => expect(Object.values(lerLayout().shells)).toHaveLength(1));
    expect(Object.values(lerLayout().shells)[0]).toMatchObject({ x: origem.x, y: origem.y + 560, terminalId: "t1" });
    expect(Object.values(lerLayout().previas)[0]).toMatchObject({
      x: origem.x + 700,
      y: origem.y + 600,
      url: "https://exemplo.com",
    });
    // Os recriados ficam selecionados juntos.
    await waitFor(() => expect(barraDoGrupo()).toHaveTextContent("4 telas"));
  });
});
