import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { type NodeProps, ReactFlowProvider } from "@xyflow/react";

import { type AcoesDoCanvas, ProvedorDoCanvas, type ValorDoCanvas } from "../../shared/canvas/contexto";
import type { NoNavegadorDoAgente as TipoDoNo } from "../../shared/canvas/nos";
import type { ApiDoNavegadorDoAgente, EstadoDoNavegadorDoAgente } from "../../shared/canvas/ponteDoNavegador";
import type { ResumoDoOrquestrador } from "../../shared/api/tipos";
import {
  ESPERA_DA_FOTO_MS,
  INTERVALO_DA_COBERTURA_MS,
  MENSAGEM_SEM_NAVEGADOR_ABERTO,
  MENSAGEM_SEM_O_APP_DESKTOP,
  NoNavegadorDoAgente,
} from "./NoNavegadorDoAgente";

const FOTO = "data:image/jpeg;base64,AAAA";

const ESTADO: EstadoDoNavegadorDoAgente = {
  orquestradorId: "o1",
  url: "https://exemplo.com.br/pedidos",
  titulo: "Pedidos · Exemplo",
  carregando: false,
  ultimaAcao: "clicou em Novo pedido",
  emUsoPeloAgente: false,
  pausado: false,
  podeVoltar: true,
  podeAvancar: false,
};

function acoesDoCanvas(): AcoesDoCanvas {
  return {
    abrirTerminal: vi.fn(),
    fecharTerminal: vi.fn(),
    minimizarOuRestaurarTerminal: vi.fn(),
    limparBixinhos: vi.fn(),
    fecharBixinho: vi.fn(),
    orquestradorCriado: vi.fn(),
    descartarRascunho: vi.fn(),
    mudarEscalaDaLetra: vi.fn(),
    recarregar: vi.fn(async () => undefined),
    abrirPrevia: vi.fn(),
    navegarPrevia: vi.fn(),
    minimizarOuRestaurarPrevia: vi.fn(),
    fecharPrevia: vi.fn(),
    abrirNavegador: vi.fn(),
    fecharNavegador: vi.fn(),
  };
}

function valorDoCanvas(acoes: AcoesDoCanvas): ValorDoCanvas {
  return {
    orquestradores: new Map([["o1", { id: "o1", nome: "Painel de salas" } as ResumoDoOrquestrador]]),
    conversas: new Map(),
    conexoes: new Map(),
    sinais: new Map(),
    bixinhosLimpos: new Map(),
    servidor: { conectado: true, caiuEm: null, voltouEm: null, reiniciou: false, memoria: null },
    acoes,
  };
}

/** As props que o React Flow passa ao nó. */
function propsDoNo(alteracoes: Partial<NodeProps<TipoDoNo>> = {}): NodeProps<TipoDoNo> {
  return {
    id: "navegador:o1",
    type: "navegador",
    data: { orquestradorId: "o1" },
    selected: false,
    selectable: true,
    draggable: true,
    deletable: true,
    isConnectable: false,
    dragging: false,
    zIndex: 0,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    width: 760,
    height: 560,
    ...alteracoes,
  };
}

function Navegador({ valor, no }: { valor: ValorDoCanvas; no: NodeProps<TipoDoNo> }) {
  return (
    <ReactFlowProvider>
      <ProvedorDoCanvas valor={valor}>
        <NoNavegadorDoAgente {...no} />
      </ProvedorDoCanvas>
    </ReactFlowProvider>
  );
}

function renderizar(alteracoes: Partial<NodeProps<TipoDoNo>> = {}) {
  const acoes = acoesDoCanvas();
  const valor = valorDoCanvas(acoes);
  const tela = render(<Navegador valor={valor} no={propsDoNo(alteracoes)} />);
  const trocar = (novas: Partial<NodeProps<TipoDoNo>>) => tela.rerender(<Navegador valor={valor} no={propsDoNo(novas)} />);
  return { acoes, tela, trocar };
}

type Ponte = { [K in keyof ApiDoNavegadorDoAgente]-?: ReturnType<typeof vi.fn> };

/** A ponte do app, simulada: cada método é um espião, e os eventos entram por `enviarMudanca` e `ativar`. */
function criarPonte(abertos: EstadoDoNavegadorDoAgente[] = [ESTADO]) {
  let aoMudar: ((estado: EstadoDoNavegadorDoAgente) => void) | null = null;
  let aoAtivar: ((dados: { orquestradorId: string }) => void) | null = null;
  const api: Ponte = {
    posicionar: vi.fn(),
    mostrar: vi.fn(async () => true),
    ocultar: vi.fn(async () => true),
    pausar: vi.fn(async () => true),
    retomar: vi.fn(async () => true),
    fechar: vi.fn(async () => true),
    estados: vi.fn(async () => abertos),
    foto: vi.fn(async () => FOTO),
    aoMudar: vi.fn((retorno: (estado: EstadoDoNavegadorDoAgente) => void) => {
      aoMudar = retorno;
      return () => {
        aoMudar = null;
      };
    }),
    aoAtivar: vi.fn((retorno: (dados: { orquestradorId: string }) => void) => {
      aoAtivar = retorno;
      return () => {
        aoAtivar = null;
      };
    }),
    voltar: vi.fn(async () => true),
    avancar: vi.fn(async () => true),
    recarregar: vi.fn(async () => true),
  };
  return {
    api,
    enviarMudanca: (alteracoes: Partial<EstadoDoNavegadorDoAgente>) =>
      act(() => aoMudar?.({ ...ESTADO, ...alteracoes })),
    ativar: (orquestradorId: string) => act(() => aoAtivar?.({ orquestradorId })),
  };
}

const janela = window as unknown as { electron?: unknown };

describe("NoNavegadorDoAgente", () => {
  afterEach(() => {
    delete janela.electron;
    vi.restoreAllMocks();
  });

  describe("fora do app desktop (sem a ponte)", () => {
    it("diz com clareza que o navegador só funciona no aplicativo desktop, sem botões que fariam algo", () => {
      renderizar();

      expect(screen.getByText(MENSAGEM_SEM_O_APP_DESKTOP)).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("Indisponível fora do aplicativo desktop");
      expect(screen.getByRole("button", { name: "Assumir" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Voltar" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Avançar" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Recarregar a página" })).toBeDisabled();
      expect(screen.queryByRole("img")).not.toBeInTheDocument();
    });

    it("o app desktop antigo, sem a ponte do navegador do agente, cai no mesmo caso", () => {
      janela.electron = { desktop: true, janela: {} };
      renderizar();

      expect(screen.getByText(MENSAGEM_SEM_O_APP_DESKTOP)).toBeInTheDocument();
    });

    it("o ✕ fecha a janela mesmo assim", () => {
      const { acoes } = renderizar();

      fireEvent.click(screen.getByRole("button", { name: "Fechar o navegador do agente" }));

      expect(acoes.fecharNavegador).toHaveBeenCalledWith("o1");
    });
  });

  describe("com a ponte do app desktop", () => {
    const retanguloDoCorpo = { left: 100, top: 200, width: 360, height: 240, right: 460, bottom: 440, x: 100, y: 200 };
    let larguraDoLayout: PropertyDescriptor | undefined;
    let ponte: ReturnType<typeof criarPonte>;

    function ligar(abertos?: EstadoDoNavegadorDoAgente[]) {
      ponte = criarPonte(abertos);
      janela.electron = { desktop: true, navegadorDoAgente: ponte.api };
    }

    beforeEach(() => {
      // O jsdom não calcula layout: o corpo tem 360x240 na tela e 720 de largura sem escala (zoom 0.5).
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(retanguloDoCorpo as DOMRect);
      larguraDoLayout = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
      Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 720 });
      ligar();
    });

    afterEach(() => {
      if (larguraDoLayout) {
        Object.defineProperty(HTMLElement.prototype, "offsetWidth", larguraDoLayout);
      } else {
        delete (HTMLElement.prototype as { offsetWidth?: number }).offsetWidth;
      }
      delete (document as { elementFromPoint?: unknown }).elementFromPoint;
    });

    /** Espera a vista ser mostrada (o estado do app chega pelo `estados()` e o corpo é medido no quadro seguinte). */
    async function esperarAVista(): Promise<void> {
      await waitFor(() => expect(ponte.api.mostrar).toHaveBeenCalled());
    }

    describe("o que a janela mostra", () => {
      it("a barra traz o título e o endereço (só leitura), a faixa e a última ação, vindos do que o app já tinha aberto", async () => {
        renderizar();

        expect(await screen.findByText("Pedidos · Exemplo")).toBeInTheDocument();
        const endereco = screen.getByRole("textbox", { name: "Endereço da página" });
        expect(endereco).toHaveValue("https://exemplo.com.br/pedidos");
        expect(endereco).toHaveAttribute("readonly");
        expect(screen.getByText("clicou em Novo pedido")).toBeInTheDocument();
        expect(screen.getByRole("status")).toHaveTextContent("Agente em espera");
        expect(screen.getByRole("group", { name: "Navegador do agente de Painel de salas" })).toBeInTheDocument();
      });

      it("as mudanças do app chegam na hora: página, carregando e última ação", async () => {
        renderizar();
        await screen.findByText("Pedidos · Exemplo");

        ponte.enviarMudanca({ titulo: "Checkout", url: "https://exemplo.com.br/checkout", carregando: true, ultimaAcao: "abriu o checkout" });

        expect(screen.getByText("Checkout")).toBeInTheDocument();
        expect(screen.getByRole("textbox", { name: "Endereço da página" })).toHaveValue("https://exemplo.com.br/checkout");
        expect(screen.getByText("abriu o checkout")).toBeInTheDocument();
        expect(screen.getByRole("status")).toHaveTextContent("carregando a página");
      });

      it("eventos de outro Orquestrador não mexem nesta janela", async () => {
        renderizar();
        await screen.findByText("Pedidos · Exemplo");

        ponte.enviarMudanca({ orquestradorId: "o2", titulo: "Outro site", ultimaAcao: "fez outra coisa" });

        expect(screen.getByText("Pedidos · Exemplo")).toBeInTheDocument();
        expect(screen.queryByText("Outro site")).not.toBeInTheDocument();
        expect(screen.queryByText("fez outra coisa")).not.toBeInTheDocument();
      });

      it("sem nenhuma ação ainda, o rodapé diz isso", async () => {
        ligar([{ ...ESTADO, ultimaAcao: null }]);
        renderizar();

        expect(await screen.findByText("nenhuma ainda")).toBeInTheDocument();
      });

      it("a faixa 'Agente no controle' aparece enquanto um comando do agente roda, e a borda acende", async () => {
        const { tela } = renderizar();
        await screen.findByText("Pedidos · Exemplo");
        expect(screen.getByRole("status")).not.toHaveTextContent("Agente no controle");

        ponte.enviarMudanca({ emUsoPeloAgente: true });
        expect(screen.getByRole("status")).toHaveTextContent("Agente no controle");
        expect(tela.container.querySelector(".janela-navegador")).toHaveClass("janela-navegador-em-uso");

        ponte.enviarMudanca({ emUsoPeloAgente: false });
        expect(screen.getByRole("status")).toHaveTextContent("Agente em espera");
        expect(tela.container.querySelector(".janela-navegador")).not.toHaveClass("janela-navegador-em-uso");
      });

      it("sem nenhum navegador aberto (o agente ainda não usou), explica e deixa o Assumir desabilitado", async () => {
        ligar([]);
        renderizar();

        expect(await screen.findByText(MENSAGEM_SEM_NAVEGADOR_ABERTO)).toBeInTheDocument();
        expect(screen.getByRole("status")).toHaveTextContent("Aguardando o agente");
        expect(screen.getByRole("button", { name: "Assumir" })).toBeDisabled();
        // E não tenta mostrar uma vista que não existe.
        await act(async () => new Promise((resolver) => setTimeout(resolver, 50)));
        expect(ponte.api.mostrar).not.toHaveBeenCalled();
      });

      it("o navegador abre depois de o nó existir: o primeiro aviso do app já mostra a janela", async () => {
        ligar([]);
        renderizar();
        await screen.findByText(MENSAGEM_SEM_NAVEGADOR_ABERTO);

        ponte.enviarMudanca({ titulo: "Primeira página" });

        expect(await screen.findByText("Primeira página")).toBeInTheDocument();
        await esperarAVista();
      });
    });

    describe("assumir e devolver ao agente", () => {
      it("Assumir pausa o agente; com o aviso do app, a faixa e o botão mudam, e Devolver o retoma", async () => {
        const { tela } = renderizar();
        await screen.findByText("Pedidos · Exemplo");

        fireEvent.click(screen.getByRole("button", { name: "Assumir" }));
        await waitFor(() => expect(ponte.api.pausar).toHaveBeenCalledWith("o1"));

        ponte.enviarMudanca({ pausado: true });
        expect(screen.getByRole("status")).toHaveTextContent("Você assumiu o controle · o agente está pausado");
        expect(tela.container.querySelector(".janela-navegador")).toHaveClass("janela-navegador-pausada");
        expect(screen.queryByRole("button", { name: "Assumir" })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Devolver ao agente" }));
        await waitFor(() => expect(ponte.api.retomar).toHaveBeenCalledWith("o1"));

        ponte.enviarMudanca({ pausado: false });
        expect(screen.getByRole("button", { name: "Assumir" })).toBeInTheDocument();
        expect(tela.container.querySelector(".janela-navegador")).not.toHaveClass("janela-navegador-pausada");
      });

      it("se o app falhar ao pausar, a janela diz o que houve, sem fingir que assumiu", async () => {
        ponte.api.pausar.mockRejectedValue(new Error("o navegador não respondeu"));
        renderizar();
        await screen.findByText("Pedidos · Exemplo");

        fireEvent.click(screen.getByRole("button", { name: "Assumir" }));

        expect(await screen.findByRole("alert")).toHaveTextContent(
          "Não foi possível assumir o navegador: o navegador não respondeu",
        );
        expect(screen.getByRole("button", { name: "Assumir" })).toBeEnabled();
        expect(screen.getByRole("status")).not.toHaveTextContent("Você assumiu");
      });

      it("se o app falhar ao devolver, também avisa", async () => {
        ligar([{ ...ESTADO, pausado: true }]);
        ponte.api.retomar.mockRejectedValue(new Error("sem resposta"));
        renderizar();

        fireEvent.click(await screen.findByRole("button", { name: "Devolver ao agente" }));

        expect(await screen.findByRole("alert")).toHaveTextContent(
          "Não foi possível devolver o navegador ao agente: sem resposta",
        );
      });
    });

    describe("voltar, avançar e recarregar", () => {
      it("com o agente no controle ficam desabilitados, mesmo com histórico: quem navega é o agente", async () => {
        ligar([{ ...ESTADO, podeVoltar: true, podeAvancar: true }]);
        renderizar();
        await screen.findByText("Pedidos · Exemplo");

        expect(screen.getByRole("button", { name: "Voltar" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "Avançar" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "Recarregar a página" })).toBeDisabled();
      });

      it("depois de assumir, valem o histórico da página e cada botão manda o comando para o navegador", async () => {
        ligar([{ ...ESTADO, pausado: true, podeVoltar: true, podeAvancar: false }]);
        renderizar();
        await screen.findByText("Pedidos · Exemplo");

        expect(screen.getByRole("button", { name: "Voltar" })).toBeEnabled();
        expect(screen.getByRole("button", { name: "Avançar" })).toBeDisabled();
        fireEvent.click(screen.getByRole("button", { name: "Voltar" }));
        await waitFor(() => expect(ponte.api.voltar).toHaveBeenCalledWith("o1"));

        ponte.enviarMudanca({ pausado: true, podeVoltar: true, podeAvancar: true });
        fireEvent.click(screen.getByRole("button", { name: "Avançar" }));
        await waitFor(() => expect(ponte.api.avancar).toHaveBeenCalledWith("o1"));

        fireEvent.click(screen.getByRole("button", { name: "Recarregar a página" }));
        await waitFor(() => expect(ponte.api.recarregar).toHaveBeenCalledWith("o1"));
      });

      it("a ponte de hoje não traz esses comandos: ficam desabilitados mesmo com o navegador assumido", async () => {
        ligar([{ ...ESTADO, pausado: true, podeVoltar: true, podeAvancar: true }]);
        const semComandos = Object.fromEntries(
          Object.entries(ponte.api).filter(([nome]) => !["voltar", "avancar", "recarregar"].includes(nome)),
        );
        janela.electron = { desktop: true, navegadorDoAgente: semComandos };
        renderizar();
        await screen.findByText("Pedidos · Exemplo");

        expect(screen.getByRole("button", { name: "Voltar" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "Avançar" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "Recarregar a página" })).toBeDisabled();
        // O Devolver segue valendo.
        expect(screen.getByRole("button", { name: "Devolver ao agente" })).toBeEnabled();
      });

      it("se o comando falhar, a janela avisa", async () => {
        ligar([{ ...ESTADO, pausado: true }]);
        ponte.api.voltar.mockRejectedValue(new Error("a página sumiu"));
        renderizar();
        await screen.findByText("Pedidos · Exemplo");

        fireEvent.click(screen.getByRole("button", { name: "Voltar" }));

        expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível navegar: a página sumiu");
      });
    });

    describe("a vista nativa sobre o corpo", () => {
      it("mostra a vista com o retângulo do corpo e o zoom do canvas; mover o corpo manda o retângulo novo", async () => {
        renderizar();
        await esperarAVista();

        expect(ponte.api.mostrar).toHaveBeenCalledWith("o1", { x: 100, y: 200, largura: 360, altura: 240, zoom: 0.5 });
        expect(ponte.api.mostrar).toHaveBeenCalledTimes(1);

        // Pan e zoom do canvas: o corpo muda de lugar e de escala.
        vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
          ...retanguloDoCorpo,
          left: 180,
          top: 150,
          width: 720,
          height: 480,
        } as DOMRect);
        await waitFor(() =>
          expect(ponte.api.posicionar).toHaveBeenCalledWith("o1", { x: 180, y: 150, largura: 720, altura: 480, zoom: 1 }),
        );
        expect(ponte.api.mostrar).toHaveBeenCalledTimes(1);
      });

      it("parada, não manda retângulo a cada quadro", async () => {
        renderizar();
        await esperarAVista();

        await act(async () => new Promise((resolver) => setTimeout(resolver, 80)));

        expect(ponte.api.posicionar).not.toHaveBeenCalled();
      });

      it("parado, o teste de cobertura (nove pontos na tela) não roda a cada quadro", async () => {
        const consulta = vi.fn(() => document.querySelector(".corpo-do-navegador"));
        document.elementFromPoint = consulta;
        renderizar();
        await esperarAVista();
        consulta.mockClear();

        await act(async () => new Promise((resolver) => setTimeout(resolver, INTERVALO_DA_COBERTURA_MS * 3)));

        // No máximo um teste por intervalo (nove pontos cada), e não um por quadro (cerca de 22 quadros).
        expect(consulta.mock.calls.length).toBeLessThanOrEqual(9 * 5);
      });

      it("fechar a janela (desmontar) devolve a vista para baixo da tela: o agente segue usando", async () => {
        const { tela } = renderizar();
        await esperarAVista();

        tela.unmount();

        expect(ponte.api.ocultar).toHaveBeenCalledWith("o1");
        expect(ponte.api.fechar).not.toHaveBeenCalled();
      });

      it("fechada antes de mostrar a vista, não manda ocultar nada", async () => {
        ligar([]);
        const { tela } = renderizar();
        await screen.findByText(MENSAGEM_SEM_NAVEGADOR_ABERTO);

        tela.unmount();

        expect(ponte.api.ocultar).not.toHaveBeenCalled();
      });

      it("arrastando o nó, a vista desce e o corpo mostra a foto da página; ao soltar, ela volta", async () => {
        const { trocar } = renderizar();
        await esperarAVista();

        trocar({ dragging: true });

        await waitFor(() => expect(ponte.api.ocultar).toHaveBeenCalledWith("o1"));
        const foto = await screen.findByRole("img", { name: "Foto da página Pedidos · Exemplo" });
        expect(foto).toHaveAttribute("src", FOTO);
        expect(ponte.api.foto).toHaveBeenCalledWith("o1");

        trocar({ dragging: false });
        await waitFor(() => expect(ponte.api.mostrar).toHaveBeenCalledTimes(2));
      });

      it("a foto não é pedida com a vista por cima (só com ela por baixo)", async () => {
        renderizar();
        await esperarAVista();

        await act(async () => new Promise((resolver) => setTimeout(resolver, ESPERA_DA_FOTO_MS * 2)));

        expect(ponte.api.foto).not.toHaveBeenCalled();
      });

      it("a foto é refeita quando a página muda com a vista por baixo, e o que o app falha em fotografar não derruba a janela", async () => {
        renderizar({ dragging: true });
        await screen.findByRole("img", { name: /Foto da página/ });
        expect(ponte.api.foto).toHaveBeenCalledTimes(1);

        ponte.api.foto.mockRejectedValueOnce(new Error("sem captura"));
        ponte.enviarMudanca({ ultimaAcao: "rolou a página" });

        await waitFor(() => expect(ponte.api.foto).toHaveBeenCalledTimes(2));
        // A captura que falhou não apaga a foto que já estava.
        expect(screen.getByRole("img", { name: /Foto da página/ })).toHaveAttribute("src", FOTO);
      });

      it("algo da tela por cima do corpo (painel, menu, outra janela) tira a vista; sem nada, ela volta", async () => {
        const painel = document.createElement("div");
        document.body.append(painel);
        document.elementFromPoint = vi.fn(() => painel);
        renderizar();

        // Coberta desde o começo: nem chega a mostrar, e fica a foto.
        expect(await screen.findByText("Pedidos · Exemplo")).toBeInTheDocument();
        await act(async () => new Promise((resolver) => setTimeout(resolver, 50)));
        expect(ponte.api.mostrar).not.toHaveBeenCalled();
        expect(await screen.findByRole("img", { name: /Foto da página/ })).toBeInTheDocument();

        // O painel sai: o corpo é o que está nos pontos de amostra.
        document.elementFromPoint = vi.fn(() => document.querySelector(".corpo-do-navegador"));
        await waitFor(() => expect(ponte.api.mostrar).toHaveBeenCalledTimes(1));

        // E volta a ser coberto: a vista desce.
        document.elementFromPoint = vi.fn(() => painel);
        await waitFor(() => expect(ponte.api.ocultar).toHaveBeenCalledWith("o1"));
        painel.remove();
      });

      it("recusada pelo app (modo invisível, por exemplo), fica a foto e não insiste a cada quadro", async () => {
        ponte.api.mostrar.mockResolvedValue(false);
        renderizar();
        await esperarAVista();

        await act(async () => new Promise((resolver) => setTimeout(resolver, 120)));

        expect(ponte.api.mostrar).toHaveBeenCalledTimes(1);
        expect(await screen.findByRole("img", { name: /Foto da página/ })).toBeInTheDocument();
      });

      it("o app falhando ao mostrar não quebra a janela", async () => {
        ponte.api.mostrar.mockRejectedValue(new Error("sem janela"));
        renderizar();
        await esperarAVista();

        expect(await screen.findByText("Pedidos · Exemplo")).toBeInTheDocument();
        expect(await screen.findByRole("img", { name: /Foto da página/ })).toBeInTheDocument();
      });
    });

    describe("controles da janela", () => {
      it("o ✕ fecha só a janela no canvas, sem fechar o navegador do app", async () => {
        const { acoes } = renderizar();
        await screen.findByText("Pedidos · Exemplo");

        fireEvent.click(screen.getByRole("button", { name: "Fechar o navegador do agente" }));

        expect(acoes.fecharNavegador).toHaveBeenCalledWith("o1");
        expect(ponte.api.fechar).not.toHaveBeenCalled();
      });

      it("a barra é a alça de arrastar, e os botões não arrastam o nó", async () => {
        const { tela } = renderizar();
        await screen.findByText("Pedidos · Exemplo");

        expect(tela.container.querySelector(".barra-do-navegador")).toHaveClass("alca-do-navegador");
        const barra = within(tela.container.querySelector(".barra-do-navegador") as HTMLElement);
        expect(barra.getByRole("button", { name: "Voltar" })).toHaveClass("nodrag");
        expect(barra.getByRole("button", { name: "Assumir" })).toHaveClass("nodrag");
        expect(barra.getByRole("textbox", { name: "Endereço da página" })).toHaveClass("nodrag");
      });
    });

    it("sai da escuta do app ao desmontar: um aviso depois não muda nada", async () => {
      const { tela } = renderizar();
      await screen.findByText("Pedidos · Exemplo");

      tela.unmount();

      expect(ponte.api.aoMudar).toHaveBeenCalledTimes(1);
      ponte.enviarMudanca({ titulo: "Depois de fechar" });
      expect(screen.queryByText("Depois de fechar")).not.toBeInTheDocument();
    });
  });
});
