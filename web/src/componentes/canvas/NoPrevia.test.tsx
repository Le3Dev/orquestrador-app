import { act, fireEvent, render, screen } from "@testing-library/react";
import { type NodeProps, ReactFlowProvider } from "@xyflow/react";

import { type AcoesDoCanvas, ProvedorDoCanvas, type ValorDoCanvas } from "../../shared/canvas/contexto";
import type { DadosDaPrevia, NoPrevia as TipoDoNo } from "../../shared/canvas/nos";
import { ENDERECO_INVALIDO, INTERVALO_DA_VERIFICACAO_MS, NoPrevia, TEMPO_ATE_FECHAR_SEM_SERVIDOR_MS } from "./NoPrevia";

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

/** As props que o React Flow passa ao nó. */
function propsDoNo(dados: Partial<DadosDaPrevia> = {}, alteracoes: Partial<NodeProps<TipoDoNo>> = {}): NodeProps<TipoDoNo> {
  return {
    id: "previa:p1",
    type: "previa",
    data: { previaId: "p1", url: "http://localhost:5173", orquestradorId: "o1", minimizada: false, alturaAberta: 520, ...dados },
    selected: false,
    selectable: true,
    draggable: true,
    deletable: true,
    isConnectable: false,
    dragging: false,
    zIndex: 0,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    width: 720,
    height: 520,
    ...alteracoes,
  };
}

function Previa({ valor, no }: { valor: ValorDoCanvas; no: NodeProps<TipoDoNo> }) {
  return (
    <ReactFlowProvider>
      <ProvedorDoCanvas valor={valor}>
        <NoPrevia {...no} />
      </ProvedorDoCanvas>
    </ReactFlowProvider>
  );
}

function renderizar(dados: Partial<DadosDaPrevia> = {}, alteracoes: Partial<NodeProps<TipoDoNo>> = {}) {
  const acoes = acoesDoCanvas();
  const valor = valorDoCanvas(acoes);
  const tela = render(<Previa valor={valor} no={propsDoNo(dados, alteracoes)} />);
  return { acoes, valor, tela };
}

function quadro(): HTMLIFrameElement {
  const iframe = document.querySelector("iframe");
  if (iframe === null) {
    throw new Error("iframe da prévia não encontrado");
  }
  return iframe;
}

/** Um servidor no ar: o pedido `no-cors` volta com uma resposta opaca. */
function servidorNoAr() {
  return vi.fn(async () => ({}) as Response);
}

/** Nada no endereço: o pedido falha com erro de rede. */
function servidorForaDoAr() {
  return vi.fn(async (): Promise<Response> => {
    throw new TypeError("Failed to fetch");
  });
}

/** Deixa a conferência do servidor terminar (e avança o relógio falso, se pedido). */
async function avancar(ms = 0): Promise<void> {
  await act(() => vi.advanceTimersByTimeAsync(ms));
}

const MENSAGEM_FORA_DO_AR = /Nada respondendo em http:\/\/localhost:5173\. A prévia fecha sozinha se o servidor não subir\./;

beforeEach(() => {
  // Fora dos testes da conferência, o pedido nunca termina: nada muda na tela por ele.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise<Response>(() => undefined)),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("NoPrevia", () => {
  it("a barra tem endereço, recarregar, abrir no navegador, dica, minimizar e fechar", () => {
    const { acoes } = renderizar();

    expect(screen.getByRole("textbox", { name: "Endereço da prévia" })).toHaveValue("http://localhost:5173");
    expect(screen.getByRole("button", { name: "Recarregar a página" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "O que é a prévia" })).toBeInTheDocument();
    expect(screen.getByRole("tooltip")).toHaveTextContent("Alguns sites não aceitam abrir dentro de outra página");

    fireEvent.click(screen.getByRole("button", { name: "Minimizar a prévia" }));
    fireEvent.click(screen.getByRole("button", { name: "Fechar a prévia" }));
    expect(acoes.minimizarOuRestaurarPrevia).toHaveBeenCalledWith("p1");
    expect(acoes.fecharPrevia).toHaveBeenCalledWith("p1");
  });

  it("abrir no navegador é um link para o endereço, numa aba nova e sem acesso de volta à tela", () => {
    renderizar();
    const link = screen.getByRole("link", { name: "Abrir no navegador" });

    expect(link).toHaveAttribute("href", "http://localhost:5173");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("o iframe recebe credentialless e sandbox antes do endereço, e deixa rolar e clicar dentro dele", () => {
    const raiz = document.createElement("div");
    document.body.append(raiz);
    const atributos: string[] = [];
    const observador = new MutationObserver((registros) => {
      for (const registro of registros) {
        if (registro.target instanceof HTMLIFrameElement && registro.attributeName !== null) {
          atributos.push(registro.attributeName);
        }
      }
    });
    observador.observe(raiz, { attributes: true, subtree: true });

    const acoes = acoesDoCanvas();
    render(<Previa valor={valorDoCanvas(acoes)} no={propsDoNo()} />, { container: raiz });
    for (const registro of observador.takeRecords()) {
      if (registro.target instanceof HTMLIFrameElement && registro.attributeName !== null) {
        atributos.push(registro.attributeName);
      }
    }
    observador.disconnect();

    const iframe = quadro();
    expect(iframe).toHaveAttribute("credentialless", "");
    expect(iframe).toHaveAttribute("src", "http://localhost:5173");
    expect(atributos.indexOf("credentialless")).toBeGreaterThanOrEqual(0);
    expect(atributos.indexOf("credentialless")).toBeLessThan(atributos.indexOf("src"));
    expect(atributos.indexOf("sandbox")).toBeGreaterThanOrEqual(0);
    expect(atributos.indexOf("sandbox")).toBeLessThan(atributos.indexOf("src"));
    expect(iframe).toHaveClass("nodrag", "nowheel");
    raiz.remove();
  });

  it("o site roda scripts e formulários, mas não navega a janela de cima", () => {
    renderizar();

    const permissoes = (quadro().getAttribute("sandbox") ?? "").split(" ");
    expect(permissoes).toEqual(expect.arrayContaining(["allow-scripts", "allow-same-origin", "allow-forms", "allow-popups"]));
    expect(permissoes.some((permissao) => permissao.startsWith("allow-top-navigation"))).toBe(false);
  });

  it("Enter no endereço normaliza o que foi digitado e navega; endereço que não é http(s) é recusado", () => {
    const { acoes } = renderizar();
    const campo = screen.getByRole("textbox", { name: "Endereço da prévia" });

    fireEvent.change(campo, { target: { value: "localhost:3000/app" } });
    fireEvent.keyDown(campo, { key: "Enter" });
    expect(acoes.navegarPrevia).toHaveBeenCalledWith("p1", "http://localhost:3000/app");
    expect(campo).toHaveValue("http://localhost:3000/app");

    fireEvent.change(campo, { target: { value: "javascript:alert(1)" } });
    fireEvent.keyDown(campo, { key: "Enter" });
    expect(acoes.navegarPrevia).toHaveBeenCalledTimes(1);
    expect(campo).toHaveAttribute("aria-invalid", "true");
    expect(campo).toHaveAttribute("title", ENDERECO_INVALIDO);

    fireEvent.keyDown(campo, { key: "Escape" });
    expect(campo).toHaveValue("http://localhost:5173");
    expect(campo).toHaveAttribute("aria-invalid", "false");
  });

  it("recarregar recria o iframe; mover o nó não recarrega", () => {
    const acoes = acoesDoCanvas();
    const valor = valorDoCanvas(acoes);
    const { rerender } = render(<Previa valor={valor} no={propsDoNo()} />);
    const original = quadro();

    // Arraste: o React Flow re-renderiza o nó com outra posição e `dragging`.
    rerender(<Previa valor={valor} no={propsDoNo({}, { dragging: true, positionAbsoluteX: 40, positionAbsoluteY: 30 })} />);
    rerender(<Previa valor={valor} no={propsDoNo({}, { dragging: false, positionAbsoluteX: 40, positionAbsoluteY: 30, width: 800 })} />);
    expect(quadro()).toBe(original);

    fireEvent.click(screen.getByRole("button", { name: "Recarregar a página" }));
    const recriado = quadro();
    expect(recriado).not.toBe(original);
    expect(recriado).toHaveAttribute("credentialless", "");
    expect(recriado).toHaveAttribute("src", "http://localhost:5173");
  });

  it("Enter no mesmo endereço recarrega a página", () => {
    renderizar();
    const original = quadro();

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Endereço da prévia" }), { key: "Enter" });

    expect(quadro()).not.toBe(original);
  });

  it("navegar por fora troca o endereço do iframe e do campo", () => {
    const acoes = acoesDoCanvas();
    const valor = valorDoCanvas(acoes);
    const { rerender } = render(<Previa valor={valor} no={propsDoNo()} />);

    rerender(<Previa valor={valor} no={propsDoNo({ url: "http://localhost:3000" })} />);

    expect(quadro()).toHaveAttribute("src", "http://localhost:3000");
    expect(screen.getByRole("textbox", { name: "Endereço da prévia" })).toHaveValue("http://localhost:3000");
  });

  it("sem endereço: explica o que fazer, foca o campo e não tem iframe nem link", async () => {
    renderizar({ url: "", orquestradorId: null }, { selected: true });
    await act(async () => undefined);

    expect(screen.getByText(/Digite acima o endereço do servidor de desenvolvimento/)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Endereço da prévia" })).toHaveFocus();
    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.queryByRole("link", { name: "Abrir no navegador" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recarregar a página" })).toBeDisabled();
  });

  it("inativa, uma camada sem nowheel cobre o site, que fica sem pointer-events; um clique ativa e foca o site", () => {
    renderizar();
    const camada = screen.getByRole("button", { name: "Usar a página" });

    expect(quadro()).toHaveStyle({ pointerEvents: "none" });
    expect(camada).toHaveTextContent("clique para usar a página");
    // A roda e a pinça em cima da camada vão ao React Flow: nada nela nem acima tem nowheel ou nodrag.
    expect(camada.closest(".nowheel, .nodrag")).toBeNull();

    fireEvent.click(camada);

    expect(screen.queryByRole("button", { name: "Usar a página" })).not.toBeInTheDocument();
    expect(quadro()).not.toHaveStyle({ pointerEvents: "none" });
    expect(quadro()).toHaveFocus();
  });

  it("ativa, um pointerdown fora do bloco ou Esc desativa; dentro do bloco, não", () => {
    renderizar();
    fireEvent.click(screen.getByRole("button", { name: "Usar a página" }));

    fireEvent.pointerDown(screen.getByRole("textbox", { name: "Endereço da prévia" }));
    expect(screen.queryByRole("button", { name: "Usar a página" })).not.toBeInTheDocument();

    fireEvent.pointerDown(document.body);
    expect(screen.getByRole("button", { name: "Usar a página" })).toBeInTheDocument();
    expect(quadro()).toHaveStyle({ pointerEvents: "none" });

    fireEvent.click(screen.getByRole("button", { name: "Usar a página" }));
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.getByRole("button", { name: "Usar a página" })).toBeInTheDocument();
  });

  it("a camada ativa pelo teclado (Enter e Espaço), mas não depois de um arraste", () => {
    renderizar();

    fireEvent.keyDown(screen.getByRole("button", { name: "Usar a página" }), { key: "Enter" });
    expect(screen.queryByRole("button", { name: "Usar a página" })).not.toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: "Escape" });
    fireEvent.keyDown(screen.getByRole("button", { name: "Usar a página" }), { key: " " });
    expect(screen.queryByRole("button", { name: "Usar a página" })).not.toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: "Escape" });
    const camada = screen.getByRole("button", { name: "Usar a página" });
    fireEvent.mouseDown(camada, { clientX: 10, clientY: 10 });
    fireEvent.click(camada, { clientX: 80, clientY: 60 });
    expect(screen.getByRole("button", { name: "Usar a página" })).toBeInTheDocument();
  });

  it("recarregar com a página ativa recria o site e ele continua usável", () => {
    renderizar();
    fireEvent.click(screen.getByRole("button", { name: "Usar a página" }));
    const original = quadro();

    fireEvent.click(screen.getByRole("button", { name: "Recarregar a página" }));

    expect(quadro()).not.toBe(original);
    expect(quadro()).not.toHaveStyle({ pointerEvents: "none" });
  });

  it("minimizada, o site fica carregado e só some da vista", () => {
    renderizar({ minimizada: true });

    expect(quadro().closest(".corpo-da-previa")).toHaveAttribute("hidden");
    expect(screen.getByRole("button", { name: "Restaurar a prévia" })).toBeInTheDocument();
  });
});

describe("NoPrevia confere se o servidor responde", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("no ar, carrega o site normalmente e confere de novo a cada intervalo", async () => {
    const buscar = servidorNoAr();
    vi.stubGlobal("fetch", buscar);
    const { acoes } = renderizar();
    const original = quadro();

    await avancar();
    expect(buscar).toHaveBeenCalledWith("http://localhost:5173", { mode: "no-cors", cache: "no-store" });
    expect(quadro()).toBe(original);
    expect(screen.queryByText(MENSAGEM_FORA_DO_AR)).not.toBeInTheDocument();

    await avancar(INTERVALO_DA_VERIFICACAO_MS);
    expect(buscar).toHaveBeenCalledTimes(2);
    await avancar(TEMPO_ATE_FECHAR_SEM_SERVIDOR_MS * 2);
    expect(acoes.fecharPrevia).not.toHaveBeenCalled();
    expect(quadro()).toBe(original);
  });

  it("fora do ar, mostra a mensagem no lugar do site", async () => {
    vi.stubGlobal("fetch", servidorForaDoAr());
    renderizar();

    await avancar();

    expect(screen.getByText(MENSAGEM_FORA_DO_AR).closest(".mensagem-da-previa")).not.toBeNull();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("fora do ar, o anel conta os segundos até fechar, um por segundo", async () => {
    vi.stubGlobal("fetch", servidorForaDoAr());
    const { acoes } = renderizar();

    await avancar();
    const total = TEMPO_ATE_FECHAR_SEM_SERVIDOR_MS / 1000;
    expect(screen.getByRole("timer", { name: `A prévia fecha em ${total} segundos` })).toHaveTextContent(String(total));

    await avancar(1000);
    expect(screen.getByRole("timer")).toHaveTextContent(String(total - 1));

    await avancar(5000);
    expect(screen.getByRole("timer")).toHaveTextContent(String(total - 6));
    expect(screen.getByRole("timer")).toHaveAccessibleName(`A prévia fecha em ${total - 6} segundos`);

    await avancar(TEMPO_ATE_FECHAR_SEM_SERVIDOR_MS - 7000);
    expect(screen.getByRole("timer")).toHaveTextContent("1");
    expect(acoes.fecharPrevia).not.toHaveBeenCalled();
  });

  it("manter aberta cancela o fechamento: some o anel e fica o fechar à mão", async () => {
    vi.stubGlobal("fetch", servidorForaDoAr());
    const { acoes } = renderizar();

    await avancar();
    await avancar(10_000);
    fireEvent.click(screen.getByRole("button", { name: "manter aberta" }));

    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
    expect(screen.getByText("Nada respondendo em http://localhost:5173.")).toBeInTheDocument();
    expect(screen.queryByText(MENSAGEM_FORA_DO_AR)).not.toBeInTheDocument();

    await avancar(TEMPO_ATE_FECHAR_SEM_SERVIDOR_MS * 2);
    expect(acoes.fecharPrevia).not.toHaveBeenCalled();
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "fechar" }));
    expect(acoes.fecharPrevia).toHaveBeenCalledWith("p1");
  });

  it("mantida aberta, se o servidor volta e cai de novo, a contagem recomeça do início", async () => {
    let noAr = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (!noAr) {
          throw new TypeError("Failed to fetch");
        }
        return {} as Response;
      }),
    );
    const { acoes } = renderizar();
    const total = TEMPO_ATE_FECHAR_SEM_SERVIDOR_MS / 1000;

    await avancar();
    await avancar(6000);
    fireEvent.click(screen.getByRole("button", { name: "manter aberta" }));

    noAr = true;
    await avancar(INTERVALO_DA_VERIFICACAO_MS);
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
    expect(screen.queryByText(/Nada respondendo/)).not.toBeInTheDocument();

    noAr = false;
    await avancar(INTERVALO_DA_VERIFICACAO_MS);
    expect(screen.getByRole("timer")).toHaveTextContent(String(total));

    await avancar(TEMPO_ATE_FECHAR_SEM_SERVIDOR_MS);
    expect(acoes.fecharPrevia).toHaveBeenCalledWith("p1");
  });

  it("o servidor que volta tira a contagem, e uma queda nova recomeça dos segundos todos", async () => {
    let noAr = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (!noAr) {
          throw new TypeError("Failed to fetch");
        }
        return {} as Response;
      }),
    );
    renderizar();
    const total = TEMPO_ATE_FECHAR_SEM_SERVIDOR_MS / 1000;

    await avancar();
    await avancar(2 * INTERVALO_DA_VERIFICACAO_MS);
    expect(screen.getByRole("timer")).toHaveTextContent(String(total - 6));

    noAr = true;
    await avancar(INTERVALO_DA_VERIFICACAO_MS);
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();

    noAr = false;
    await avancar(INTERVALO_DA_VERIFICACAO_MS);
    expect(screen.getByRole("timer")).toHaveTextContent(String(total));
  });

  it("minimizada, a contagem aparece na barra", async () => {
    vi.stubGlobal("fetch", servidorForaDoAr());
    renderizar({ minimizada: true });
    const total = TEMPO_ATE_FECHAR_SEM_SERVIDOR_MS / 1000;

    await avancar();
    // O anel do corpo está escondido: o único timer à vista é o da barra.
    const contagem = screen.getByRole("timer");
    expect(contagem).toHaveClass("contagem-na-barra");
    expect(contagem.closest(".barra-da-previa")).not.toBeNull();
    expect(contagem).toHaveTextContent(String(total));

    await avancar(3000);
    expect(screen.getByRole("timer")).toHaveTextContent(String(total - 3));
  });

  it("aberta, a barra não mostra a contagem", async () => {
    vi.stubGlobal("fetch", servidorForaDoAr());
    renderizar();

    await avancar();

    expect(document.querySelector(".contagem-na-barra")).toBeNull();
    expect(screen.getByRole("timer")).toHaveClass("anel-da-contagem");
  });

  it("fecha sozinha depois de ficar fora do ar pelo tempo todo, e para de conferir", async () => {
    const buscar = servidorForaDoAr();
    vi.stubGlobal("fetch", buscar);
    const { acoes } = renderizar();

    await avancar();
    await avancar(TEMPO_ATE_FECHAR_SEM_SERVIDOR_MS - INTERVALO_DA_VERIFICACAO_MS);
    expect(acoes.fecharPrevia).not.toHaveBeenCalled();

    await avancar(INTERVALO_DA_VERIFICACAO_MS);
    expect(acoes.fecharPrevia).toHaveBeenCalledTimes(1);
    expect(acoes.fecharPrevia).toHaveBeenCalledWith("p1");

    const pedidos = buscar.mock.calls.length;
    await avancar(TEMPO_ATE_FECHAR_SEM_SERVIDOR_MS);
    expect(buscar).toHaveBeenCalledTimes(pedidos);
    expect(acoes.fecharPrevia).toHaveBeenCalledTimes(1);
  });

  it("minimizada, também fecha sozinha sem servidor", async () => {
    vi.stubGlobal("fetch", servidorForaDoAr());
    const { acoes } = renderizar({ minimizada: true });

    await avancar();
    await avancar(TEMPO_ATE_FECHAR_SEM_SERVIDOR_MS);

    expect(acoes.fecharPrevia).toHaveBeenCalledWith("p1");
  });

  it("não fecha se o servidor responder antes do tempo: a resposta zera a contagem", async () => {
    let noAr = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (!noAr) {
          throw new TypeError("Failed to fetch");
        }
        return {} as Response;
      }),
    );
    const { acoes } = renderizar();

    await avancar();
    await avancar(TEMPO_ATE_FECHAR_SEM_SERVIDOR_MS - 2 * INTERVALO_DA_VERIFICACAO_MS);
    noAr = true;
    await avancar(INTERVALO_DA_VERIFICACAO_MS);
    noAr = false;
    // A contagem recomeça na primeira falha depois da resposta.
    await avancar(TEMPO_ATE_FECHAR_SEM_SERVIDOR_MS);
    expect(acoes.fecharPrevia).not.toHaveBeenCalled();

    await avancar(INTERVALO_DA_VERIFICACAO_MS);
    expect(acoes.fecharPrevia).toHaveBeenCalledTimes(1);
  });

  it("o servidor que sobe depois faz o site recarregar sozinho e esconde a mensagem", async () => {
    let noAr = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (!noAr) {
          throw new TypeError("Failed to fetch");
        }
        return {} as Response;
      }),
    );
    const { acoes } = renderizar();
    const original = quadro();

    await avancar();
    expect(screen.getByText(MENSAGEM_FORA_DO_AR)).toBeInTheDocument();

    noAr = true;
    await avancar(INTERVALO_DA_VERIFICACAO_MS);

    expect(screen.queryByText(MENSAGEM_FORA_DO_AR)).not.toBeInTheDocument();
    const recarregado = quadro();
    expect(recarregado).not.toBe(original);
    expect(recarregado).toHaveAttribute("credentialless", "");
    expect(recarregado).toHaveAttribute("src", "http://localhost:5173");
    expect(acoes.fecharPrevia).not.toHaveBeenCalled();
  });

  it("um servidor que estava no ar e cai mostra a mensagem e fecha depois do tempo", async () => {
    let noAr = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (!noAr) {
          throw new TypeError("Failed to fetch");
        }
        return {} as Response;
      }),
    );
    const { acoes } = renderizar();

    await avancar();
    noAr = false;
    await avancar(INTERVALO_DA_VERIFICACAO_MS);
    expect(screen.getByText(MENSAGEM_FORA_DO_AR)).toBeInTheDocument();

    await avancar(TEMPO_ATE_FECHAR_SEM_SERVIDOR_MS);
    expect(acoes.fecharPrevia).toHaveBeenCalledWith("p1");
  });

  it("para de conferir ao desmontar", async () => {
    const buscar = servidorForaDoAr();
    vi.stubGlobal("fetch", buscar);
    const { acoes, tela } = renderizar();

    await avancar();
    tela.unmount();
    await avancar(TEMPO_ATE_FECHAR_SEM_SERVIDOR_MS * 2);

    expect(buscar).toHaveBeenCalledTimes(1);
    expect(acoes.fecharPrevia).not.toHaveBeenCalled();
  });

  it("sem endereço, não confere nada", async () => {
    const buscar = servidorForaDoAr();
    vi.stubGlobal("fetch", buscar);
    const { acoes } = renderizar({ url: "", orquestradorId: null });

    await avancar(TEMPO_ATE_FECHAR_SEM_SERVIDOR_MS * 2);

    expect(buscar).not.toHaveBeenCalled();
    expect(acoes.fecharPrevia).not.toHaveBeenCalled();
  });
});
