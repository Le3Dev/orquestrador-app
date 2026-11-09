import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type NodeProps, ReactFlowProvider } from "@xyflow/react";

import { api } from "../../shared/api/cliente";
import type { DadosDoShell } from "../../shared/api/tipos";
import { type AcoesDoCanvas, ProvedorDoCanvas, type ValorDoCanvas } from "../../shared/canvas/contexto";
import type { DadosDoNoDoShell, NoShell as TipoDoNo } from "../../shared/canvas/nos";
import { limparPromptsDosTerminais, registrarPromptDoTerminal } from "../../shared/canvas/promptsDosTerminais";
import { type AcoesDosShells, ProvedorDosShells } from "../../shared/canvas/shells";
import { NoShell } from "./NoShell";

// O xterm desenha com medidas de fonte e canvas que o jsdom não tem: aqui ele
// é um terminal de mentira que escreve a saída como texto no elemento.
const falsos = vi.hoisted(() => {
  class TerminalFalso {
    static instancias: TerminalFalso[] = [];
    cols = 80;
    rows = 24;
    elemento: HTMLElement | null = null;
    escrito = "";
    selecao = "";
    reinicios = 0;
    aoDigitar: ((dados: string) => void) | null = null;
    aoRedimensionar: ((tamanho: { cols: number; rows: number }) => void) | null = null;

    constructor() {
      TerminalFalso.instancias.push(this);
    }
    loadAddon(): void {}
    open(elemento: HTMLElement): void {
      this.elemento = elemento;
    }
    write(dados: string): void {
      this.escrito += dados;
      if (this.elemento !== null) {
        this.elemento.textContent = this.escrito;
      }
    }
    reset(): void {
      this.reinicios++;
      this.escrito = "";
    }
    onData(ouvinte: (dados: string) => void) {
      this.aoDigitar = ouvinte;
      return { dispose: () => undefined };
    }
    onResize(ouvinte: (tamanho: { cols: number; rows: number }) => void) {
      this.aoRedimensionar = ouvinte;
      return { dispose: () => undefined };
    }
    hasSelection(): boolean {
      return this.selecao !== "";
    }
    getSelection(): string {
      return this.selecao;
    }
    get buffer() {
      const linhas = this.escrito.split(/\r?\n/);
      return {
        active: {
          length: linhas.length,
          getLine: (indice: number) => {
            const texto = linhas[indice];
            return texto === undefined ? undefined : { isWrapped: false, translateToString: () => texto };
          },
        },
      };
    }
    dispose(): void {}
  }

  class WebSocketFalso {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSED = 3;
    static instancias: WebSocketFalso[] = [];
    readyState = WebSocketFalso.CONNECTING;
    enviadas: unknown[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((evento: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;

    constructor(readonly url: string) {
      WebSocketFalso.instancias.push(this);
    }
    send(texto: string): void {
      this.enviadas.push(JSON.parse(texto));
    }
    close(): void {
      this.cair();
    }
    abrir(): void {
      this.readyState = WebSocketFalso.OPEN;
      this.onopen?.();
    }
    receber(mensagem: unknown): void {
      this.onmessage?.({ data: JSON.stringify(mensagem) });
    }
    cair(): void {
      this.readyState = WebSocketFalso.CLOSED;
      this.onclose?.();
    }
  }

  return { TerminalFalso, WebSocketFalso };
});

vi.mock("@xterm/xterm", () => ({ Terminal: falsos.TerminalFalso }));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit(): void {}
  },
}));

const { TerminalFalso, WebSocketFalso } = falsos;

function acoesDoCanvas(): AcoesDoCanvas {
  return {
    abrirTerminal: vi.fn(),
    fecharTerminal: vi.fn(),
    minimizarOuRestaurarTerminal: vi.fn(),
    limparBixinhos: vi.fn(),
    orquestradorCriado: vi.fn(),
    descartarRascunho: vi.fn(),
    mudarEscalaDaLetra: vi.fn(),
    recarregar: vi.fn(async () => undefined),
    abrirPrevia: vi.fn(),
    navegarPrevia: vi.fn(),
    minimizarOuRestaurarPrevia: vi.fn(),
    fecharPrevia: vi.fn(),
  };
}

function valorDoCanvas(acoes: AcoesDoCanvas): ValorDoCanvas {
  return {
    orquestradores: new Map(),
    conversas: new Map(),
    conexoes: new Map(),
    sinais: new Map(),
    bixinhosLimpos: new Map(),
    servidor: { conectado: true, caiuEm: null, voltouEm: null, reiniciou: false, memoria: null },
    acoes,
  };
}

function acoesDosShells(): AcoesDosShells {
  return { abrirShell: vi.fn(), fecharShell: vi.fn(), reabrirShell: vi.fn() };
}

/** As props que o React Flow passa ao nó. */
function propsDoNo(dados: Partial<DadosDoNoDoShell> = {}): NodeProps<TipoDoNo> {
  return {
    id: "shell:s1",
    type: "shell",
    data: { shellId: "s1", terminalId: "t1", pasta: "/projetos/meu-app", orquestradorId: "o1", ...dados },
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
    height: 400,
  };
}

function renderizar(dados: Partial<DadosDoNoDoShell> = {}) {
  const canvas = acoesDoCanvas();
  const shells = acoesDosShells();
  const tela = render(
    <ReactFlowProvider>
      <ProvedorDoCanvas valor={valorDoCanvas(canvas)}>
        <ProvedorDosShells valor={shells}>
          <NoShell {...propsDoNo(dados)} />
        </ProvedorDosShells>
      </ProvedorDoCanvas>
    </ReactFlowProvider>,
  );
  return { canvas, shells, tela };
}

function ultimoSocket(): InstanceType<typeof WebSocketFalso> {
  const socket = WebSocketFalso.instancias.at(-1);
  if (socket === undefined) {
    throw new Error("nenhum WebSocket aberto");
  }
  return socket;
}

function ultimoTerminal(): InstanceType<typeof TerminalFalso> {
  const terminal = TerminalFalso.instancias.at(-1);
  if (terminal === undefined) {
    throw new Error("nenhum xterm criado");
  }
  return terminal;
}

const VIVO: DadosDoShell = { id: "t1", pasta: "/projetos/meu-app", orquestradorId: "o1", criadoEm: "2026-11-07T10:00:00Z" };

beforeEach(() => {
  TerminalFalso.instancias = [];
  WebSocketFalso.instancias = [];
  vi.stubGlobal("WebSocket", WebSocketFalso);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  limparPromptsDosTerminais();
});

describe("NoShell", () => {
  it("a barra mostra Terminal, a pasta curta e o caminho inteiro na dica", () => {
    renderizar();

    expect(screen.getByText("Terminal")).toBeInTheDocument();
    expect(screen.getByText("meu-app")).toBeInTheDocument();
    expect(screen.getByTitle("/projetos/meu-app")).toBeInTheDocument();
    expect(screen.getByText("conectando…")).toBeInTheDocument();
  });

  it("conecta na mesma origem, manda o tamanho ao abrir, mostra a saída e manda a entrada", () => {
    renderizar();
    const socket = ultimoSocket();
    expect(socket.url).toBe(`ws://${window.location.host}/api/terminais/t1/conexao`);

    act(() => socket.abrir());
    expect(socket.enviadas).toContainEqual({ tipo: "tamanho", colunas: 80, linhas: 24 });
    expect(screen.queryByText("conectando…")).not.toBeInTheDocument();

    act(() => socket.receber({ tipo: "saida", dados: "olá do shell" }));
    expect(screen.getByText("olá do shell")).toBeInTheDocument();

    act(() => ultimoTerminal().aoDigitar?.("ls\r"));
    act(() => ultimoTerminal().aoRedimensionar?.({ cols: 100, rows: 30 }));
    expect(socket.enviadas).toContainEqual({ tipo: "entrada", dados: "ls\r" });
    expect(socket.enviadas).toContainEqual({ tipo: "tamanho", colunas: 100, linhas: 30 });
  });

  it("a roda do mouse e o arraste dentro do terminal não mexem no canvas", () => {
    renderizar();

    const quadro = ultimoTerminal().elemento;
    expect(quadro).toHaveClass("nowheel");
    expect(quadro).toHaveClass("nodrag");
  });

  it("depois do fim, mostra encerrado e abre de novo na mesma pasta", () => {
    const { shells } = renderizar();
    const socket = ultimoSocket();
    act(() => socket.abrir());

    act(() => socket.receber({ tipo: "fim", codigo: 0 }));

    expect(screen.getByText("encerrado")).toBeInTheDocument();
    expect(screen.getByText("o shell encerrou (código 0)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "abrir de novo" }));
    expect(shells.reabrirShell).toHaveBeenCalledWith("s1");
  });

  it("a conexão cai com o terminal vivo: religa e limpa a tela antes do histórico reenviado", async () => {
    const listar = vi.spyOn(api, "listarShells").mockResolvedValue([VIVO]);
    renderizar();
    act(() => ultimoSocket().abrir());
    act(() => ultimoSocket().receber({ tipo: "saida", dados: "antes" }));

    act(() => ultimoSocket().cair());
    expect(screen.getByText("reconectando…")).toBeInTheDocument();

    await waitFor(() => expect(WebSocketFalso.instancias).toHaveLength(2));
    expect(listar).toHaveBeenCalled();
    act(() => ultimoSocket().abrir());
    expect(ultimoTerminal().reinicios).toBe(1);
    expect(screen.queryByText("reconectando…")).not.toBeInTheDocument();
  });

  it("a conexão cai e o terminal não está mais no servidor (recarregou a página depois): encerrado", async () => {
    vi.spyOn(api, "listarShells").mockResolvedValue([{ ...VIVO, id: "outro" }]);
    renderizar();

    act(() => ultimoSocket().cair());

    expect(await screen.findByText("o shell encerrou")).toBeInTheDocument();
    expect(WebSocketFalso.instancias).toHaveLength(1);
  });

  it("fechar pede ao canvas para encerrar o shell e tirar o bloco", () => {
    const { shells } = renderizar();

    fireEvent.click(screen.getByRole("button", { name: "Fechar este terminal" }));

    expect(shells.fecharShell).toHaveBeenCalledWith("s1");
  });

  it("solto (aberto pela barra), não oferece enviar ao orquestrador", () => {
    renderizar({ orquestradorId: null });

    expect(screen.queryByRole("button", { name: "Enviar ao orquestrador" })).not.toBeInTheDocument();
  });
});

describe("enviar ao orquestrador", () => {
  it("sem seleção, leva as últimas linhas num bloco de código ao prompt, sem enviar", () => {
    const prompt = { acrescentarTexto: vi.fn() };
    registrarPromptDoTerminal("o1", prompt);
    const { canvas } = renderizar();
    act(() => ultimoSocket().abrir());
    act(() => ultimoSocket().receber({ tipo: "saida", dados: "$ npm test\r\n1 falhou\r\n$ " }));

    fireEvent.click(screen.getByRole("button", { name: "Enviar ao orquestrador" }));

    expect(prompt.acrescentarTexto).toHaveBeenCalledWith("```\n$ npm test\n1 falhou\n$\n```");
    expect(canvas.abrirTerminal).not.toHaveBeenCalled();
  });

  it("com seleção, leva só a seleção", () => {
    const prompt = { acrescentarTexto: vi.fn() };
    registrarPromptDoTerminal("o1", prompt);
    renderizar();
    act(() => ultimoSocket().receber({ tipo: "saida", dados: "linha 1\r\nErro: falhou\r\n" }));
    ultimoTerminal().selecao = "Erro: falhou";

    fireEvent.click(screen.getByRole("button", { name: "Enviar ao orquestrador" }));

    expect(prompt.acrescentarTexto).toHaveBeenCalledWith("```\nErro: falhou\n```");
  });

  it("com o terminal do orquestrador fechado, abre ele e o texto entra no prompt quando ele aparecer", () => {
    const { canvas } = renderizar();
    act(() => ultimoSocket().receber({ tipo: "saida", dados: "pronto" }));

    fireEvent.click(screen.getByRole("button", { name: "Enviar ao orquestrador" }));
    expect(canvas.abrirTerminal).toHaveBeenCalledWith("o1");

    const prompt = { acrescentarTexto: vi.fn() };
    registrarPromptDoTerminal("o1", prompt);
    expect(prompt.acrescentarTexto).toHaveBeenCalledWith("```\npronto\n```");
  });
});
