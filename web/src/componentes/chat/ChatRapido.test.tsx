import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { api } from "../../shared/api/cliente";
import type { MensagemDoChat } from "../../shared/api/tipos";
import type { FaseDoDitado } from "../../shared/ditado/useDitado";
import type { EscutaNaTela, OpcoesDaEscuta, SituacaoDaEscuta } from "../../shared/escuta/useEscuta";
import {
  ESTADO_INICIAL_DO_CHAT,
  type EstadoDoChatNaTela,
  type MensagemDoChatNaTela,
} from "../../shared/estado/aplicarEventoDoChat";
import { pedirFocoDoChat } from "../../shared/focarChat";
import { CHAVE_DAS_PREFERENCIAS_DA_TELA } from "../../shared/hooks/usePreferenciasDaTela";
import { ChatRapido, TIPO_DA_RESPOSTA_DO_CHAT } from "./ChatRapido";

/** O ditado sem microfone nem Whisper: o clique alterna a gravação e o teste entrega o texto transcrito. */
const ditadoFalso = vi.hoisted(() => ({
  entregar: null as ((texto: string) => void) | null,
  /** Ligado, o clique passa por "pedindo-microfone" (a permissão do navegador) e só `gravar()` chega a "gravando". */
  pedirPermissao: false,
  gravar: null as (() => void) | null,
}));
vi.mock("../../shared/ditado/useDitado", async () => {
  const { useState } = await import("react");
  return {
    useDitado: (aoTranscrever: (texto: string) => void) => {
      const [fase, setFase] = useState<FaseDoDitado>("parado");
      ditadoFalso.entregar = aoTranscrever;
      return {
        fase,
        baixando: null,
        segundosDeAudio: null,
        erro: null,
        lerNivel: () => null,
        alternar: () => {
          if (ditadoFalso.pedirPermissao && fase === "parado") {
            setFase("pedindo-microfone");
            ditadoFalso.gravar = () => setFase("gravando");
            return;
          }
          setFase((atual) => (atual === "gravando" ? "parado" : "gravando"));
        },
        descartar: () => setFase("parado"),
        fecharErro: () => undefined,
      };
    },
  };
});

/**
 * A escuta simulada: guarda as opções que o chat passou (para chamar o `enviar`
 * e o `preencherComposer` como a escuta faria) e devolve a situação pedida
 * enquanto o modo invisível estiver ligado com a escuta disponível.
 */
const escutaSimulada = vi.hoisted(() => ({
  opcoes: null as OpcoesDaEscuta | null,
  situacaoNoModo: "escutando" as SituacaoDaEscuta,
  confirmarAviso: vi.fn(),
  recusarAviso: vi.fn(),
  pausar: vi.fn(),
  linhaProvisoria: null as string | null,
  trechos: [] as readonly { id: string; texto: string; inicioMs: number; fimMs: number }[],
  limparTrechos: vi.fn(),
  automatico: true,
  alternarAutomatico: vi.fn(),
  erro: null as string | null,
  descartarErro: vi.fn(),
  ultimaPergunta: null as string | null,
  legenda: { frases: [], emAndamento: null } as EscutaNaTela["legenda"],
  motor: null as EscutaNaTela["motor"],
  download: null as EscutaNaTela["download"],
  mudarIdioma: vi.fn(),
  mudarPrioridadeDoMotor: vi.fn(),
}));

vi.mock("../../shared/escuta/useEscuta", () => ({
  useEscuta: (opcoes: OpcoesDaEscuta): EscutaNaTela => {
    escutaSimulada.opcoes = opcoes;
    const situacao: SituacaoDaEscuta = !opcoes.escutaDisponivel
      ? "indisponivel"
      : opcoes.modoInvisivelAtivo || opcoes.escutaManualLigada
        ? escutaSimulada.situacaoNoModo
        : "desligada";
    return {
      situacao,
      progressoDoDownload: null,
      linhas: [],
      linhaProvisoria: escutaSimulada.linhaProvisoria,
      trechos: escutaSimulada.trechos,
      limparTrechos: escutaSimulada.limparTrechos,
      automatico: escutaSimulada.automatico,
      alternarAutomatico: escutaSimulada.alternarAutomatico,
      pausar: escutaSimulada.pausar,
      retomar: () => undefined,
      erro: escutaSimulada.erro,
      descartarErro: escutaSimulada.descartarErro,
      precisaDoAviso: situacao === "aguardando-aviso",
      confirmarAviso: escutaSimulada.confirmarAviso,
      recusarAviso: escutaSimulada.recusarAviso,
      ultimaPergunta: escutaSimulada.ultimaPergunta,
      legenda: escutaSimulada.legenda,
      motor: escutaSimulada.motor,
      download: escutaSimulada.download,
      ultimaPerguntaEnviada: null,
      preferenciasDaTela: {
        idioma: "portuguese",
        prioridadeDoMotor: "velocidade",
        aparencia: { tamanhoDaFonte: 14, opacidade: 0.92, compacto: false },
      },
      mudarIdioma: escutaSimulada.mudarIdioma,
      mudarPrioridadeDoMotor: escutaSimulada.mudarPrioridadeDoMotor,
      mudarAparencia: () => undefined,
    };
  },
}));

beforeEach(() => {
  escutaSimulada.opcoes = null;
  escutaSimulada.situacaoNoModo = "escutando";
  escutaSimulada.confirmarAviso = vi.fn();
  escutaSimulada.recusarAviso = vi.fn();
  escutaSimulada.pausar = vi.fn();
  escutaSimulada.linhaProvisoria = null;
  escutaSimulada.trechos = [];
  escutaSimulada.limparTrechos = vi.fn();
  escutaSimulada.automatico = true;
  escutaSimulada.alternarAutomatico = vi.fn();
  escutaSimulada.erro = null;
  escutaSimulada.descartarErro = vi.fn();
  escutaSimulada.ultimaPergunta = null;
  escutaSimulada.legenda = { frases: [], emAndamento: null };
  escutaSimulada.motor = null;
  escutaSimulada.download = null;
  escutaSimulada.mudarIdioma = vi.fn();
  escutaSimulada.mudarPrioridadeDoMotor = vi.fn();
});

/** As opções que o chat passou à escuta no último render. */
function opcoesDaEscuta(): OpcoesDaEscuta {
  if (escutaSimulada.opcoes === null) {
    throw new Error("o chat não chamou o useEscuta");
  }
  return escutaSimulada.opcoes;
}

/** Uma frase fechada da legenda da escuta, começando no horário ISO dado. */
function frase(id: string, texto: string, inicio: string, pergunta = false): EscutaNaTela["legenda"]["frases"][number] {
  const inicioMs = Date.parse(inicio);
  return { id, texto, inicioMs, fimMs: inicioMs + 2_000, pergunta };
}

function mensagem(
  id: string,
  papel: MensagemDoChat["papel"],
  alteracoes: Partial<MensagemDoChatNaTela> = {},
): MensagemDoChatNaTela {
  return {
    id,
    papel,
    texto: "",
    anexos: [],
    criadaEm: "2026-11-04T12:00:00Z",
    situacao: "concluida",
    acoes: [],
    avisos: [],
    uso: null,
    motivoDaFalha: null,
    autorizacaoPendente: null,
    perguntas: [],
    ...alteracoes,
  };
}

const OCIOSO: EstadoDoChatNaTela = { ...ESTADO_INICIAL_DO_CHAT, carregado: true };

const RESPONDENDO: EstadoDoChatNaTela = {
  ...OCIOSO,
  situacao: "respondendo",
  mensagens: [
    mensagem("u1", "usuario", { texto: "Qual o README?" }),
    mensagem("c1", "claude", {
      situacao: "respondendo",
      texto: "Vou abrir o projeto.\n\n```acao-do-app\n{\"tipo\":\"abrir",
    }),
  ],
  atividade: { mensagemId: "c1", ferramenta: "Read", detalhe: "README.md" },
};

/** Abre o menu ⋯ da barra e devolve o item pedido (o "melhorar" e o "fixar" moram nele). */
function itemDoMenu(nome: string): HTMLElement {
  const gatilho = screen.getByRole("button", { name: "Mais ações" });
  if (gatilho.getAttribute("aria-expanded") !== "true") {
    fireEvent.click(gatilho);
  }
  return screen.getByRole("menuitem", { name: nome });
}

function renderizar(chat: EstadoDoChatNaTela = OCIOSO, desconectado = false) {
  const props = {
    desconectado,
    erroAoCarregar: null,
    aoMudarPreferencias: vi.fn(),
    aoAbrirTerminal: vi.fn(),
    temVagaPara: vi.fn().mockReturnValue(true),
    aoAtualizarOrquestradores: vi.fn().mockResolvedValue(undefined),
    orquestradores: [],
  };
  const resultado = render(<ChatRapido chat={chat} {...props} />);
  return {
    ...props,
    campo: screen.getByRole("textbox", { name: "Pergunta para o Claude" }),
    rerender: (novo: EstadoDoChatNaTela) => resultado.rerender(<ChatRapido chat={novo} {...props} />),
  };
}

describe("ChatRapido · modo invisível", () => {
  const janelaComPonte = window as unknown as { electron?: unknown };
  const FOTO = { nome: "tela.jpg", tipoDeMidia: "image/jpeg" as const, base64: "QUJD" };

  afterEach(() => {
    delete janelaComPonte.electron;
    vi.restoreAllMocks();
  });

  const QUADRO = { nome: "tela-2026-11-08T10-00-00-000Z.jpg", tipoDeMidia: "image/jpeg" as const, base64: "QUJD" };

  function ponteAtiva(capturarTela = vi.fn().mockResolvedValue(FOTO), escutaDisponivel = false) {
    let ouvinte: ((ativo: boolean) => void) | null = null;
    let ouvinteDeQuadro: ((captura: typeof QUADRO) => void) | null = null;
    let ouvinteDeAtalho: ((acao: string) => void) | null = null;
    let ouvinteDeOculto: ((oculto: boolean) => void) | null = null;
    const cancelarQuadro = vi.fn();
    const modoInvisivel = {
      escutaDisponivel,
      entrar: vi.fn(),
      sair: vi.fn(),
      capturarMouse: vi.fn().mockResolvedValue(undefined),
      capturarTela,
      capturarAgora: vi.fn().mockResolvedValue(QUADRO),
      aoCapturarQuadro: vi.fn((callback: (captura: typeof QUADRO) => void) => {
        ouvinteDeQuadro = callback;
        return cancelarQuadro;
      }),
      aoMudar: vi.fn((callback: (ativo: boolean) => void) => {
        ouvinte = callback;
        return () => undefined;
      }),
      definirFocavel: vi.fn().mockResolvedValue(undefined),
      alternar: vi.fn().mockResolvedValue(undefined),
      aoAtalho: vi.fn((callback: (acao: string) => void) => {
        ouvinteDeAtalho = callback;
        return () => undefined;
      }),
      aoMudarOculto: vi.fn((callback: (oculto: boolean) => void) => {
        ouvinteDeOculto = callback;
        return () => undefined;
      }),
    };
    janelaComPonte.electron = { desktop: true, janela: {}, modoInvisivel };
    return {
      modoInvisivel,
      cancelarQuadro,
      ativar: () => act(() => ouvinte?.(true)),
      desativar: () => act(() => ouvinte?.(false)),
      quadroDoAtalho: (captura = QUADRO) => act(() => ouvinteDeQuadro?.(captura)),
      atalho: (acao: string) => act(() => ouvinteDeAtalho?.(acao)),
      mudarOculto: (oculto: boolean) => act(() => ouvinteDeOculto?.(oculto)),
    };
  }

  describe("foco e chat móvel", () => {
    // O jsdom não tem PointerEvent: sem ele, o fireEvent manda um Event sem clientX nem pointerId.
    class EventoDePonteiroFalso extends MouseEvent {
      readonly pointerId: number;
      constructor(tipo: string, inicio: PointerEventInit = {}) {
        super(tipo, inicio);
        this.pointerId = inicio.pointerId ?? 0;
      }
    }
    beforeEach(() => vi.stubGlobal("PointerEvent", EventoDePonteiroFalso));
    afterEach(() => {
      vi.unstubAllGlobals();
      localStorage.clear();
    });

    const areas = () => [...document.querySelectorAll("[data-area-clicavel]")];
    const guardado = () =>
      JSON.parse(localStorage.getItem(CHAVE_DAS_PREFERENCIAS_DA_TELA) ?? "{}") as {
        chatNoModoInvisivel: { x: number; y: number; largura: number; altura: number } | null;
      };
    const gravarGeometria = () =>
      localStorage.setItem(
        CHAVE_DAS_PREFERENCIAS_DA_TELA,
        JSON.stringify({ chatNoModoInvisivel: { x: 100, y: 100, largura: 500, altura: 300 } }),
      );

    it("clicar no campo deixa a janela focável e envio, Esc e perder o foco a devolvem", async () => {
      vi.spyOn(api, "perguntarNoChat").mockResolvedValue({ mensagemId: "m1" });
      const { modoInvisivel, ativar } = ponteAtiva();
      const { campo } = renderizar();
      ativar();

      fireEvent.pointerDown(campo);
      await waitFor(() => expect(modoInvisivel.definirFocavel).toHaveBeenCalledWith(true));
      await waitFor(() => expect(campo).toHaveFocus());

      fireEvent.keyDown(campo, { key: "Escape" });
      expect(modoInvisivel.definirFocavel).toHaveBeenLastCalledWith(false);

      modoInvisivel.definirFocavel.mockClear();
      fireEvent.change(campo, { target: { value: "Oi" } });
      fireEvent.keyDown(campo, { key: "Enter" });
      await waitFor(() => expect(modoInvisivel.definirFocavel).toHaveBeenCalledWith(false));

      modoInvisivel.definirFocavel.mockClear();
      fireEvent.blur(campo, { relatedTarget: document.body });
      expect(modoInvisivel.definirFocavel).toHaveBeenCalledWith(false);
    });

    it("fora do modo invisível o foco nunca mexe na janela", () => {
      const { modoInvisivel } = ponteAtiva();
      const { campo } = renderizar();
      fireEvent.pointerDown(campo);
      fireEvent.keyDown(campo, { key: "Escape" });
      expect(modoInvisivel.definirFocavel).not.toHaveBeenCalled();
    });

    it("a ação focar-campo foca o campo", () => {
      const { ativar, atalho } = ponteAtiva();
      const { campo } = renderizar();
      ativar();
      atalho("focar-campo");
      expect(campo).toHaveFocus();
    });

    it("marca as áreas sólidas como clicáveis: conversa, barra, campo e alças", () => {
      const { ativar } = ponteAtiva();
      renderizar({ ...OCIOSO, mensagens: [mensagem("u1", "usuario", { texto: "Oi" })] });
      ativar();
      const marcadas = areas();
      expect(marcadas).toContain(screen.getByTestId("barra-do-chat-movel"));
      expect(marcadas).toContain(screen.getByRole("button", { name: "Redimensionar o chat" }));
      expect(marcadas).toContain(screen.getByTestId("composer-do-chat").parentElement);
      expect(marcadas).toContain(screen.getByRole("region", { name: "Conversa com o Claude" }));
    });

    it("o controle de opacidade aplica a variável ao chat inteiro e grava; Ctrl+Alt+ + / − ajustam de 0,1 em 0,1", () => {
      const { ativar, atalho } = ponteAtiva();
      renderizar();
      ativar();
      const chat = screen.getByTestId("chat-rapido");
      expect(chat.style.getPropertyValue("--opacidade-do-chat")).toBe("");

      fireEvent.change(screen.getByRole("slider", { name: "Opacidade do chat" }), { target: { value: "0.5" } });
      expect(chat.style.getPropertyValue("--opacidade-do-chat")).toBe("0.5");
      expect(JSON.parse(localStorage.getItem(CHAVE_DAS_PREFERENCIAS_DA_TELA) ?? "{}")).toMatchObject({
        opacidadeDoChat: 0.5,
      });

      atalho("opacidade-mais");
      expect(chat.style.getPropertyValue("--opacidade-do-chat")).toBe("0.6");
      atalho("opacidade-menos");
      atalho("opacidade-menos");
      atalho("opacidade-menos");
      atalho("opacidade-menos");
      atalho("opacidade-menos");
      expect(chat.style.getPropertyValue("--opacidade-do-chat")).toBe("0.2");
      for (let i = 0; i < 10; i += 1) atalho("opacidade-mais");
      // Voltou a 1: sem variável, o chat fica como sempre.
      expect(chat.style.getPropertyValue("--opacidade-do-chat")).toBe("");
    });

    it("o chat flutuante normal também tem o controle (no cabeçalho da conversa) e a coluna fixa não", () => {
      renderizar({ ...OCIOSO, mensagens: [mensagem("u1", "usuario", { texto: "Oi" })] });
      expect(screen.getByRole("slider", { name: "Opacidade do chat" })).toBeInTheDocument();
      cleanup();
      render(
        <ChatRapido
          chat={OCIOSO}
          desconectado={false}
          erroAoCarregar={null}
          aoMudarPreferencias={vi.fn()}
          aoAbrirTerminal={vi.fn()}
          temVagaPara={vi.fn()}
          aoAtualizarOrquestradores={vi.fn()}
          orquestradores={[]}
          fixo
        />,
      );
      expect(screen.queryByRole("slider", { name: "Opacidade do chat" })).not.toBeInTheDocument();
    });

    it("sem o modo, não há alça de mover nem de redimensionar", () => {
      ponteAtiva();
      renderizar();
      expect(screen.queryByRole("button", { name: "Mover o chat" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Redimensionar o chat" })).not.toBeInTheDocument();
    });

    it("Ctrl+Alt+setas movem o chat de 40 em 40 px, o lugar fica gravado e o botão volta ao padrão", () => {
      const { ativar, atalho } = ponteAtiva();
      gravarGeometria();
      renderizar();
      ativar();
      const chat = screen.getByTestId("chat-rapido");

      atalho("mover-direita");
      atalho("mover-direita");
      atalho("mover-cima");
      expect(guardado().chatNoModoInvisivel).toEqual({ x: 180, y: 60, largura: 500, altura: 300 });
      expect(chat.style.left).toBe("180px");
      expect(chat).not.toHaveClass("chat-rapido-movel-padrao");

      fireEvent.click(screen.getByRole("button", { name: "Voltar ao lugar padrão" }));
      expect(chat).toHaveClass("chat-rapido-movel-padrao");
      expect(guardado().chatNoModoInvisivel).toBeNull();
    });

    it("arrastar a alça move o chat dentro da tela e grava ao soltar; ocultar o overlay cancela o arraste", () => {
      const { ativar, mudarOculto } = ponteAtiva();
      gravarGeometria();
      renderizar({ ...OCIOSO, mensagens: [mensagem("u1", "usuario", { texto: "Oi" })] });
      ativar();
      const alca = screen.getByRole("button", { name: "Mover o chat" });
      const chat = screen.getByTestId("chat-rapido");

      fireEvent.pointerDown(alca, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
      fireEvent.pointerMove(alca, { pointerId: 1, clientX: 60, clientY: 40 });
      expect(chat.style.left).toBe("150px");
      fireEvent.pointerUp(alca, { pointerId: 1 });
      expect(guardado().chatNoModoInvisivel).toEqual({ x: 150, y: 130, largura: 500, altura: 300 });

      // Passando da borda, o chat para na tela.
      fireEvent.pointerDown(alca, { button: 0, pointerId: 2, clientX: 0, clientY: 0 });
      fireEvent.pointerMove(alca, { pointerId: 2, clientX: -5000, clientY: -5000 });
      expect(chat.style.left).toBe("0px");
      expect(chat.style.top).toBe("0px");
      // Ocultar o overlay no meio do arraste cancela: o chat volta ao que estava gravado.
      mudarOculto(true);
      expect(chat.style.left).toBe("150px");
      expect(guardado().chatNoModoInvisivel).toEqual({ x: 150, y: 130, largura: 500, altura: 300 });
    });

    it("redimensionar pela alça do canto muda a largura e a altura, respeitando o mínimo", () => {
      const { ativar } = ponteAtiva();
      gravarGeometria();
      renderizar();
      ativar();
      const alca = screen.getByRole("button", { name: "Redimensionar o chat" });
      fireEvent.pointerDown(alca, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
      fireEvent.pointerMove(alca, { pointerId: 1, clientX: 50, clientY: -100 });
      fireEvent.pointerUp(alca, { pointerId: 1 });
      expect(guardado().chatNoModoInvisivel).toEqual({ x: 100, y: 100, largura: 550, altura: 200 });

      fireEvent.pointerDown(alca, { button: 0, pointerId: 2, clientX: 0, clientY: 0 });
      fireEvent.pointerMove(alca, { pointerId: 2, clientX: -900, clientY: -900 });
      fireEvent.pointerUp(alca, { pointerId: 2 });
      expect(guardado().chatNoModoInvisivel).toEqual({ x: 100, y: 100, largura: 320, altura: 160 });
    });

    it("rolar-abaixo e rolar-acima rolam a conversa em 80% da altura visível", () => {
      const { ativar, atalho } = ponteAtiva();
      renderizar({ ...OCIOSO, mensagens: [mensagem("u1", "usuario", { texto: "Oi" })] });
      ativar();
      const lista = document.querySelector(".mensagens-do-chat") as HTMLElement;
      Object.defineProperty(lista, "clientHeight", { configurable: true, value: 100 });
      lista.scrollTop = 0;
      atalho("rolar-abaixo");
      expect(lista.scrollTop).toBe(80);
      atalho("rolar-acima");
      expect(lista.scrollTop).toBe(0);
    });
  });

  describe("capturar agora", () => {
    it("o atalho guarda o quadro como anexo pendente e o envio não tira outro print", async () => {
      const perguntar = vi.spyOn(api, "perguntarNoChat").mockResolvedValue({ mensagemId: "m1" });
      const { modoInvisivel, ativar, quadroDoAtalho } = ponteAtiva();
      const { campo } = renderizar();
      expect(screen.queryByRole("button", { name: /capturar agora/ })).not.toBeInTheDocument();
      ativar();
      expect(screen.queryByRole("button", { name: /capturar agora/ })).not.toBeInTheDocument();

      quadroDoAtalho();
      expect(screen.queryAllByRole("img")).toHaveLength(0);

      fireEvent.change(campo, { target: { value: "Veja" } });
      fireEvent.keyDown(campo, { key: "Enter" });
      await waitFor(() => expect(perguntar).toHaveBeenCalledWith("Veja", [QUADRO]));
      expect(modoInvisivel.capturarTela).not.toHaveBeenCalled();
    });

    it("o atalho global adiciona o quadro aos pendentes e a assinatura é cancelada ao sair do modo", async () => {
      const { cancelarQuadro, ativar, desativar, quadroDoAtalho } = ponteAtiva();
      renderizar();
      ativar();

      quadroDoAtalho();
      quadroDoAtalho({ ...QUADRO, nome: "tela-2.jpg" });
      // Pendentes, mas sem miniatura: a captura nunca aparece.
      expect(screen.queryAllByRole("img")).toHaveLength(0);
      expect(document.querySelector(".miniaturas-do-prompt")).toBeNull();

      desativar();
      expect(cancelarQuadro).toHaveBeenCalled();
    });

    it("respeita o limite de 5 imagens e avisa", async () => {
      const { ativar, quadroDoAtalho } = ponteAtiva();
      renderizar();
      ativar();

      for (let i = 0; i < 6; i += 1) {
        quadroDoAtalho({ ...QUADRO, nome: `tela-${i}.jpg` });
      }
      expect(screen.queryAllByRole("img")).toHaveLength(0);
      expect(screen.getByRole("alert")).toHaveTextContent("até 5 imagens");
    });

    it("o quadro também respeita o limite de 10 anexos, contando os documentos", async () => {
      const { ativar, quadroDoAtalho } = ponteAtiva();
      const { campo } = renderizar();
      ativar();
      const documentos = Array.from({ length: 10 }, (_, i) => new File(["x"], `doc${i}.txt`, { type: "text/plain" }));
      fireEvent.paste(campo, { clipboardData: { files: documentos } });
      await screen.findByRole("button", { name: "Remover doc9.txt" });

      quadroDoAtalho();
      expect(screen.getByRole("alert")).toHaveTextContent("até 10 arquivos");
      expect(screen.getByRole("alert")).toHaveTextContent("O quadro não foi guardado");
    });
  });

  describe("limites com a tela ocupando um lugar entre os anexos", () => {
    it("com 5 imagens anexadas, o envio no modo invisível pede para remover uma imagem", async () => {
      const perguntar = vi.spyOn(api, "perguntarNoChat").mockResolvedValue({ mensagemId: "m1" });
      const { modoInvisivel, ativar } = ponteAtiva();
      const { campo } = renderizar();
      ativar();
      const imagens = Array.from({ length: 5 }, (_, i) => new File(["x"], `foto${i}.png`, { type: "image/png" }));
      fireEvent.paste(campo, { clipboardData: { files: imagens } });
      await screen.findByRole("button", { name: "Remover foto4.png" });

      fireEvent.change(campo, { target: { value: "Veja" } });
      fireEvent.keyDown(campo, { key: "Enter" });
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "No modo invisível a tela ocupa uma das 5 imagens: remova uma imagem anexada.",
      );
      expect(perguntar).not.toHaveBeenCalled();
      expect(modoInvisivel.capturarTela).not.toHaveBeenCalled();
    });

    it("com 10 anexos, o envio no modo invisível pede para remover um arquivo", async () => {
      const perguntar = vi.spyOn(api, "perguntarNoChat").mockResolvedValue({ mensagemId: "m1" });
      const { modoInvisivel, ativar } = ponteAtiva();
      const { campo } = renderizar();
      ativar();
      const documentos = Array.from({ length: 10 }, (_, i) => new File(["x"], `doc${i}.txt`, { type: "text/plain" }));
      fireEvent.paste(campo, { clipboardData: { files: documentos } });
      await screen.findByRole("button", { name: "Remover doc9.txt" });

      fireEvent.change(campo, { target: { value: "Veja" } });
      fireEvent.keyDown(campo, { key: "Enter" });
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "No modo invisível a tela ocupa um dos 10 anexos: remova um arquivo anexado.",
      );
      expect(perguntar).not.toHaveBeenCalled();
      expect(modoInvisivel.capturarTela).not.toHaveBeenCalled();
    });

    it("com documentos e a tela, o envio leva os dois e a tela vai por último", async () => {
      const perguntar = vi.spyOn(api, "perguntarNoChat").mockResolvedValue({ mensagemId: "m1" });
      const { ativar } = ponteAtiva();
      const { campo } = renderizar();
      ativar();
      fireEvent.paste(campo, { clipboardData: { files: [new File(["pdf"], "a.pdf", { type: "application/pdf" })] } });
      await screen.findByRole("button", { name: "Remover a.pdf" });

      fireEvent.change(campo, { target: { value: "Compare" } });
      fireEvent.keyDown(campo, { key: "Enter" });
      await waitFor(() => expect(perguntar).toHaveBeenCalledTimes(1));
      expect(perguntar).toHaveBeenCalledWith("Compare", [
        { nome: "a.pdf", tipoDeMidia: "application/pdf", base64: "cGRm" },
        FOTO,
      ]);
    });
  });

  it("ativo, fotografa a tela a cada pergunta e a anexa; não há mais faixa do modo", async () => {
    const perguntar = vi.spyOn(api, "perguntarNoChat").mockResolvedValue({ mensagemId: "m1" });
    const { modoInvisivel, ativar } = ponteAtiva();
    const { campo } = renderizar();

    expect(screen.getByRole("button", { name: "Modo invisível" })).toHaveAttribute("aria-pressed", "false");
    ativar();
    expect(screen.getByRole("button", { name: "Modo invisível" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByTestId("faixa-modo-invisivel")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Modo invisível" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Voltar ao modo normal" })).not.toBeInTheDocument();

    fireEvent.change(campo, { target: { value: "O que é isso?" } });
    fireEvent.keyDown(campo, { key: "Enter" });
    await waitFor(() => expect(perguntar).toHaveBeenCalledTimes(1));
    expect(perguntar).toHaveBeenCalledWith("O que é isso?", [FOTO]);

    fireEvent.change(campo, { target: { value: "E agora?" } });
    fireEvent.keyDown(campo, { key: "Enter" });
    await waitFor(() => expect(perguntar).toHaveBeenCalledTimes(2));
    expect(modoInvisivel.capturarTela).toHaveBeenCalledTimes(2);
  });

  it("o mesmo botão do olho entra e sai do modo, com aria-pressed refletindo o estado", () => {
    const { modoInvisivel, ativar } = ponteAtiva();
    renderizar();

    const botao = screen.getByRole("button", { name: "Modo invisível" });
    expect(botao).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(botao);
    expect(modoInvisivel.entrar).toHaveBeenCalledTimes(1);

    ativar();
    const ativo = screen.getByRole("button", { name: "Modo invisível" });
    expect(ativo).toHaveAttribute("aria-pressed", "true");
    expect(ativo).toHaveAttribute("title", expect.stringContaining("clique para voltar ao modo normal"));
    expect(screen.queryByTestId("faixa-modo-invisivel")).not.toBeInTheDocument();
    fireEvent.click(ativo);
    expect(modoInvisivel.sair).toHaveBeenCalledTimes(1);
  });

  it("se a captura falhar, mostra o erro, não envia e mantém o texto", async () => {
    const perguntar = vi.spyOn(api, "perguntarNoChat");
    const { ativar } = ponteAtiva(vi.fn().mockRejectedValue(new Error("sem permissão de tela")));
    const { campo } = renderizar();
    ativar();

    fireEvent.change(campo, { target: { value: "Veja" } });
    fireEvent.keyDown(campo, { key: "Enter" });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível capturar a tela: sem permissão de tela. A pergunta não foi enviada.",
    );
    expect(perguntar).not.toHaveBeenCalled();
    expect(campo).toHaveValue("Veja");
  });

  it("sem o modo ativo, não captura nem anexa nada", async () => {
    const perguntar = vi.spyOn(api, "perguntarNoChat").mockResolvedValue({ mensagemId: "m1" });
    const { modoInvisivel } = ponteAtiva();
    const { campo } = renderizar();

    fireEvent.change(campo, { target: { value: "Oi" } });
    fireEvent.keyDown(campo, { key: "Enter" });

    await waitFor(() => expect(perguntar).toHaveBeenCalledWith("Oi", []));
    expect(modoInvisivel.capturarTela).not.toHaveBeenCalled();
  });

  describe("miniaturas das capturas no histórico", () => {
    const CAPTURA = {
      arquivo: "a.jpg",
      nome: "tela-2026-11-07T10-00-00-000Z.jpg",
      tipoDeMidia: "image/jpeg",
      categoria: "imagem" as const,
    };
    const MANUAL = { arquivo: "b.png", nome: "foto.png", tipoDeMidia: "image/png", categoria: "imagem" as const };
    const chatComImagens = (anexos: MensagemDoChatNaTela["anexos"]): EstadoDoChatNaTela => ({
      ...OCIOSO,
      mensagens: [mensagem("u1", "usuario", { texto: "Veja", anexos })],
    });

    it("esconde a captura de tela e mantém a imagem manual, no modo normal e no invisível", () => {
      const { ativar } = ponteAtiva();
      renderizar(chatComImagens([CAPTURA, MANUAL]));
      expect(screen.queryByAltText(CAPTURA.nome)).not.toBeInTheDocument();
      expect(screen.getByAltText(MANUAL.nome)).toBeInTheDocument();
      ativar();
      expect(screen.queryByAltText(CAPTURA.nome)).not.toBeInTheDocument();
      expect(screen.getByAltText(MANUAL.nome)).toBeInTheDocument();
    });

    it("só com captura, não renderiza o contêiner (sem espaço vazio) e o texto continua", () => {
      ponteAtiva();
      renderizar(chatComImagens([CAPTURA]));
      expect(document.querySelector(".anexos-do-chat")).toBeNull();
      expect(screen.getByText("Veja")).toBeInTheDocument();
    });

    it("nos anexos pendentes, a captura não aparece e a imagem comum sim", () => {
      const { quadroDoAtalho, ativar } = ponteAtiva();
      renderizar();
      quadroDoAtalho();
      expect(document.querySelector(".miniaturas-do-prompt")).toBeNull();
      ativar();
      quadroDoAtalho({ ...QUADRO, nome: "tela-9.jpg" });
      expect(document.querySelector(".miniaturas-do-prompt")).toBeNull();
    });
  });

  it("o olho é um ícone de traço (SVG, sem emoji): olho aberto desligado, olho cortado e pressionado quando ativo", () => {
    const { ativar } = ponteAtiva();
    renderizar();

    const desligado = screen.getByRole("button", { name: "Modo invisível" });
    expect(desligado).toHaveAttribute("aria-pressed", "false");
    // O rótulo "Fantasma" fica à vista, ao lado do ícone.
    expect(desligado).toHaveTextContent("Fantasma");
    expect(desligado.querySelector("svg circle")).not.toBeNull();
    expect(desligado.querySelector('svg path[d="m4 4 16 16"]')).toBeNull();
    expect(desligado.querySelector(".ponto-tela-vista")).toBeNull();

    ativar();
    const ligado = screen.getByRole("button", { name: "Modo invisível" });
    expect(ligado).toHaveAttribute("aria-pressed", "true");
    expect(ligado).toHaveTextContent("Fantasma");
    expect(ligado).toHaveAttribute("title", expect.stringContaining("Ctrl+Shift+I"));
    expect(ligado.querySelector("svg circle")).toBeNull();
    expect(ligado.querySelector('svg path[d="m4 4 16 16"]')).not.toBeNull();
    expect(ligado.querySelector(".ponto-tela-vista")).not.toBeNull();
  });

  it("o olho fica na linha do composer, entra no modo e continua (pressionado) quando ativo", async () => {
    const { modoInvisivel, ativar } = ponteAtiva();
    renderizar();

    const botao = screen.getByRole("button", { name: "Modo invisível" });
    expect(botao).toHaveAttribute("title", expect.stringContaining("Modo invisível"));
    expect(botao.closest(".linha-do-composer")).not.toBeNull();
    fireEvent.click(botao);
    await waitFor(() => expect(modoInvisivel.entrar).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(modoInvisivel.capturarMouse).toHaveBeenCalledWith(true));

    ativar();
    expect(screen.getByRole("button", { name: "Modo invisível" })).toHaveAttribute("aria-pressed", "true");
  });

  it("sem a ponte do modo invisível (navegador), não desenha o olho", () => {
    renderizar();
    expect(screen.queryByRole("button", { name: "Modo invisível" })).not.toBeInTheDocument();
  });

  it("se entrar falhar, o erro aparece no chat", async () => {
    const { modoInvisivel } = ponteAtiva();
    modoInvisivel.entrar.mockRejectedValue(new Error("sem janela"));
    renderizar();

    fireEvent.click(screen.getByRole("button", { name: "Modo invisível" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível entrar no modo invisível: sem janela");
  });

  it("ativo, o olho dentro do chat é o indicador e a saída; clicar sai do modo", () => {
    const { modoInvisivel, ativar } = ponteAtiva();
    renderizar();
    ativar();

    const chat = screen.getByTestId("chat-rapido");
    expect(within(chat).queryByText("Tela sendo vista")).not.toBeInTheDocument();
    fireEvent.click(within(chat).getByRole("button", { name: "Modo invisível", pressed: true }));
    expect(modoInvisivel.sair).toHaveBeenCalledTimes(1);
  });

  it("ativo, se sair falhar, o erro aparece no chat", async () => {
    const { modoInvisivel, ativar } = ponteAtiva();
    modoInvisivel.sair.mockRejectedValue(new Error("janela ocupada"));
    renderizar();
    ativar();

    fireEvent.click(screen.getByRole("button", { name: "Modo invisível" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível sair do modo invisível: janela ocupada");
  });

  it("ativo, o mouse sobre o chat captura os cliques e, ao sair, deixa atravessar", () => {
    const { modoInvisivel, ativar } = ponteAtiva();
    renderizar();
    ativar();
    modoInvisivel.capturarMouse.mockClear();

    fireEvent.mouseEnter(screen.getByTestId("chat-rapido"));
    expect(modoInvisivel.capturarMouse).toHaveBeenLastCalledWith(true);
    fireEvent.mouseLeave(screen.getByTestId("chat-rapido"));
    expect(modoInvisivel.capturarMouse).toHaveBeenLastCalledWith(false);
  });

  describe("escuta do áudio", () => {
    const indicador = () => screen.queryByTestId("indicador-da-escuta");

    it("o indicador aparece ao lado do olho com o modo ativo e some ao desligar; não há caixa à parte", () => {
      const { ativar, desativar } = ponteAtiva(undefined, true);
      renderizar();
      expect(indicador()).not.toBeInTheDocument();

      ativar();
      // Ao ligar a escuta, o painel da transcrição abre sozinho e leva o indicador no cabeçalho dele.
      expect(screen.getByRole("region", { name: "Transcrição" })).toContainElement(indicador());
      // Fechado o painel, o indicador volta para a barra, ao lado do olho.
      fireEvent.click(screen.getByRole("button", { name: "Fechar a transcrição" }));
      const olho = screen.getByRole("button", { name: "Modo invisível" });
      expect(olho.nextElementSibling).toBe(indicador());
      expect(indicador()).toHaveTextContent("escutando");
      expect(screen.queryByTestId("painel-da-escuta")).not.toBeInTheDocument();
      expect(screen.queryByTestId("faixa-da-escuta")).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Pausar a escuta" }));
      expect(escutaSimulada.pausar).toHaveBeenCalledTimes(1);

      desativar();
      expect(indicador()).not.toBeInTheDocument();
    });

    it("o botão dos fones (um ícone de traço) liga a escuta fora do modo: avisa a ponte e só depois marca o estado", async () => {
      let resolver: () => void = () => undefined;
      const { modoInvisivel } = ponteAtiva(undefined, true);
      const definirEscutaLigada = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolver = resolve;
          }),
      );
      Object.assign(modoInvisivel, { definirEscutaLigada });
      renderizar();
      const botao = screen.getByRole("button", { name: "Escuta do áudio" });
      expect(botao).toHaveAttribute("aria-pressed", "false");
      expect(botao).toHaveTextContent("");
      expect(botao.querySelector("svg")).not.toBeNull();
      expect(opcoesDaEscuta().escutaManualLigada).toBe(false);
      expect(indicador()).not.toBeInTheDocument();

      fireEvent.click(botao);
      expect(definirEscutaLigada).toHaveBeenCalledWith(true);
      // Ainda não resolveu: a sessão não pode pedir o áudio antes da ponte.
      expect(opcoesDaEscuta().escutaManualLigada).toBe(false);

      await act(async () => resolver());
      expect(opcoesDaEscuta().escutaManualLigada).toBe(true);
      expect(screen.getByRole("button", { name: "Escuta do áudio" })).toHaveAttribute("aria-pressed", "true");
      expect(indicador()).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Escuta do áudio" }));
      await waitFor(() => expect(opcoesDaEscuta().escutaManualLigada).toBe(false));
      await waitFor(() => expect(definirEscutaLigada).toHaveBeenLastCalledWith(false));
      resolver();
    });

    it("sem a escuta disponível, não há botão dos fones", () => {
      ponteAtiva();
      renderizar();
      expect(screen.queryByRole("button", { name: "Escuta do áudio" })).not.toBeInTheDocument();
    });

    it("com frases ouvidas e sem mensagens, só o painel aparece (a conversa não); /clear limpa os trechos", async () => {
      vi.spyOn(api, "limparChat").mockResolvedValue(undefined as never);
      escutaSimulada.legenda = { frases: [frase("f1", "só áudio", "2026-11-04T12:00:00Z")], emAndamento: null };
      const { ativar } = ponteAtiva(undefined, true);
      const { campo } = renderizar();
      ativar();
      expect(screen.getByRole("region", { name: "Transcrição" })).toHaveTextContent("só áudio");
      expect(screen.queryByRole("region", { name: "Conversa com o Claude" })).not.toBeInTheDocument();

      fireEvent.change(campo, { target: { value: "/clear" } });
      fireEvent.keyDown(campo, { key: "Enter" });
      await waitFor(() => expect(escutaSimulada.limparTrechos).toHaveBeenCalled());
    });

    it("sem a escuta disponível, o modo ativo não mostra o indicador", () => {
      const { ativar } = ponteAtiva();
      renderizar();
      ativar();
      expect(opcoesDaEscuta().escutaDisponivel).toBe(false);
      expect(indicador()).not.toBeInTheDocument();
    });

    it("na primeira vez, o aviso aparece dentro do chat e só o botão liga a escuta", () => {
      escutaSimulada.situacaoNoModo = "aguardando-aviso";
      const { ativar } = ponteAtiva(undefined, true);
      renderizar();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      ativar();
      const aviso = screen.getByRole("dialog", { name: "Escutar o áudio do computador?" });
      expect(screen.getByTestId("chat-rapido")).toContainElement(aviso);
      expect(indicador()).not.toBeInTheDocument();

      fireEvent.click(within(aviso).getByRole("button", { name: "Começar a escutar" }));
      expect(escutaSimulada.confirmarAviso).toHaveBeenCalledTimes(1);
      fireEvent.click(within(aviso).getByRole("button", { name: "Agora não" }));
      expect(escutaSimulada.recusarAviso).toHaveBeenCalledTimes(1);
    });

    it("passa ao hook o modo, a escuta disponível, o chat livre e a autorização", () => {
      const { ativar } = ponteAtiva(undefined, true);
      const { rerender } = renderizar({ ...OCIOSO, alteracoesAutorizadas: true });
      expect(opcoesDaEscuta()).toMatchObject({
        modoInvisivelAtivo: false,
        escutaDisponivel: true,
        chatLivre: true,
        autorizacaoAtiva: true,
      });

      ativar();
      expect(opcoesDaEscuta().modoInvisivelAtivo).toBe(true);

      rerender(RESPONDENDO);
      expect(opcoesDaEscuta()).toMatchObject({ chatLivre: false, autorizacaoAtiva: false });
    });

    it("desconectado, o chat não está livre para a escuta", () => {
      ponteAtiva(undefined, true);
      renderizar(OCIOSO, true);
      expect(opcoesDaEscuta().chatLivre).toBe(false);
    });

    it("o enviar da escuta manda a pergunta com o print e a origem \"escuta\"", async () => {
      const perguntar = vi.spyOn(api, "perguntarNoChat").mockResolvedValue({ mensagemId: "m1" });
      const { ativar } = ponteAtiva(undefined, true);
      renderizar();
      ativar();

      await act(() => opcoesDaEscuta().enviar("Qual a complexidade?"));

      expect(perguntar).toHaveBeenCalledWith("Qual a complexidade?", [FOTO], { origem: "escuta" });
    });

    it("o enviar da escuta rejeita com o erro original (ex.: o 409) e não o mostra no composer", async () => {
      const recusa = new Error("Já existe uma resposta em andamento.");
      vi.spyOn(api, "perguntarNoChat").mockRejectedValue(recusa);
      ponteAtiva(undefined, true);
      renderizar();

      await act(async () => {
        await expect(opcoesDaEscuta().enviar("Qual a complexidade?")).rejects.toBe(recusa);
      });
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  describe("escuta na conversa", () => {
    const indicador = () => screen.getByTestId("indicador-da-escuta");
    const conversa = () => screen.getByRole("region", { name: "Conversa com o Claude" });
    const DUAS_MENSAGENS: EstadoDoChatNaTela = {
      ...OCIOSO,
      mensagens: [
        mensagem("u1", "usuario", { texto: "primeira", criadaEm: "2026-11-04T12:00:00Z" }),
        mensagem("c1", "claude", { texto: "resposta", criadaEm: "2026-11-04T12:01:00Z" }),
      ],
    };

    describe("painel da transcrição", () => {
      afterEach(() => localStorage.clear());

      const painel = () => screen.getByRole("region", { name: "Transcrição" });
      const guardado = () =>
        JSON.parse(localStorage.getItem(CHAVE_DAS_PREFERENCIAS_DA_TELA) ?? "{}") as { transcricaoAberta?: boolean };
      /** Uma frase fechada de 5 s atrás: dentro da janela de 2 min do "Responder agora". */
      const fraseRecente = (id: string, texto: string, pergunta = false) =>
        frase(id, texto, new Date(Date.now() - 5_000).toISOString(), pergunta);

      it("as frases ouvidas ficam no painel, com a hora e a pergunta destacada, e não entram na conversa", () => {
        escutaSimulada.legenda = {
          frases: [
            frase("f1", "Bom dia a todos.", "2026-11-04T12:00:00Z"),
            frase("f2", "Qual o prazo do projeto?", "2026-11-04T12:00:05Z", true),
          ],
          emAndamento: null,
        };
        const { ativar } = ponteAtiva(undefined, true);
        renderizar(DUAS_MENSAGENS);
        ativar();

        const falas = within(painel()).getAllByTestId("fala-da-transcricao");
        expect(falas).toHaveLength(2);
        expect(falas[0]).toHaveTextContent("Bom dia a todos.");
        expect(falas[0]?.querySelector("time")).not.toBeNull();
        expect(falas[1]).toHaveClass("painel-transcricao-pergunta");
        expect(falas[1]).toHaveTextContent("pergunta");
        // A conversa fica só com as mensagens: nenhum balão "ouvido".
        expect(conversa()).not.toHaveTextContent("Bom dia a todos.");
        expect(screen.queryByTestId("trecho-ouvido")).not.toBeInTheDocument();
        expect(screen.queryByTestId("trecho-provisorio")).not.toBeInTheDocument();
      });

      it("a frase em andamento aparece na hora: o confirmado em texto normal e o provisório em itálico", () => {
        escutaSimulada.legenda = {
          frases: [],
          emAndamento: { id: "e2", confirmado: "vamos falar do", parcial: "orçamento de", inicioMs: Date.now() },
        };
        const { ativar } = ponteAtiva(undefined, true);
        renderizar();
        ativar();

        const andamento = within(painel()).getByTestId("fala-em-andamento");
        expect(within(andamento).getByText("vamos falar do")).toHaveClass("painel-transcricao-confirmado");
        expect(within(andamento).getByText("orçamento de")).toHaveClass("painel-transcricao-parcial");
      });

      it("abre sozinho ao ligar a escuta; o × fecha, o botão Transcrição reabre, e a escolha fica gravada", () => {
        const { ativar } = ponteAtiva(undefined, true);
        renderizar();
        expect(screen.queryByRole("region", { name: "Transcrição" })).not.toBeInTheDocument();
        const botao = screen.getByRole("button", { name: "Transcrição" });
        expect(botao).toHaveAttribute("aria-pressed", "false");

        ativar();
        expect(painel()).toBeInTheDocument();
        expect(guardado().transcricaoAberta).toBe(true);
        expect(screen.getByRole("button", { name: "Transcrição" })).toHaveAttribute("aria-pressed", "true");

        fireEvent.click(screen.getByRole("button", { name: "Fechar a transcrição" }));
        expect(screen.queryByRole("region", { name: "Transcrição" })).not.toBeInTheDocument();
        expect(guardado().transcricaoAberta).toBe(false);

        fireEvent.click(screen.getByRole("button", { name: "Transcrição" }));
        expect(painel()).toBeInTheDocument();
        expect(guardado().transcricaoAberta).toBe(true);
      });

      it("sem a escuta disponível, não há botão nem painel", () => {
        ponteAtiva();
        renderizar();
        expect(screen.queryByRole("button", { name: "Transcrição" })).not.toBeInTheDocument();
        expect(screen.queryByRole("region", { name: "Transcrição" })).not.toBeInTheDocument();
      });

      it("o painel é uma área clicável do modo invisível", () => {
        const { ativar } = ponteAtiva(undefined, true);
        renderizar();
        ativar();
        expect(painel()).toHaveAttribute("data-area-clicavel");
      });

      it("Responder agora envia as falas recentes como mensagem sua, com o print da tela no modo invisível", async () => {
        const perguntar = vi.spyOn(api, "perguntarNoChat").mockResolvedValue({ mensagemId: "m1" });
        escutaSimulada.legenda = {
          frases: [fraseRecente("f1", "Qual é a capital da França?", true)],
          emAndamento: { id: "e2", confirmado: "e a da", parcial: "Itália", inicioMs: Date.now() },
        };
        const { modoInvisivel, ativar } = ponteAtiva(undefined, true);
        renderizar();
        ativar();

        fireEvent.click(within(painel()).getByRole("button", { name: "Responder agora" }));

        await waitFor(() => expect(perguntar).toHaveBeenCalledTimes(1));
        const [pedido, anexos] = perguntar.mock.calls[0] ?? [];
        expect(pedido).toContain("Transcrição recente:");
        expect(pedido).toContain("Qual é a capital da França?");
        expect(pedido).toContain("e a da Itália");
        expect(anexos).toEqual([FOTO]);
        expect(modoInvisivel.capturarTela).toHaveBeenCalledTimes(1);
      });

      it("sem frases, o Responder agora fica desabilitado, e com o Claude respondendo também", () => {
        const { ativar } = ponteAtiva(undefined, true);
        const { rerender } = renderizar();
        ativar();
        expect(within(painel()).getByRole("button", { name: "Responder agora" })).toBeDisabled();

        escutaSimulada.legenda = { frases: [fraseRecente("f1", "Bom dia a todos.")], emAndamento: null };
        rerender(OCIOSO);
        expect(within(painel()).getByRole("button", { name: "Responder agora" })).toBeEnabled();

        rerender(RESPONDENDO);
        expect(within(painel()).getByRole("button", { name: "Responder agora" })).toBeDisabled();
      });

      it("o atalho responder-agora (Ctrl+Shift+Enter) envia o pedido das falas recentes", async () => {
        const perguntar = vi.spyOn(api, "perguntarNoChat").mockResolvedValue({ mensagemId: "m1" });
        escutaSimulada.legenda = { frases: [fraseRecente("f1", "Como inverter uma lista ligada?", true)], emAndamento: null };
        const { ativar, atalho } = ponteAtiva(undefined, true);
        renderizar();
        ativar();

        atalho("responder-agora");

        await waitFor(() => expect(perguntar).toHaveBeenCalledTimes(1));
        expect(perguntar.mock.calls[0]?.[0]).toContain("Como inverter uma lista ligada?");
        expect(screen.queryByTestId("aviso-curto-do-chat")).not.toBeInTheDocument();
      });

      it("o atalho responder-agora sem nada transcrito avisa e não envia", () => {
        const perguntar = vi.spyOn(api, "perguntarNoChat").mockResolvedValue({ mensagemId: "m1" });
        // Uma frase de 10 min atrás já passou da janela de 2 min.
        escutaSimulada.legenda = {
          frases: [frase("f0", "muito antiga", new Date(Date.now() - 600_000).toISOString())],
          emAndamento: null,
        };
        const { ativar, atalho } = ponteAtiva(undefined, true);
        renderizar();
        ativar();

        atalho("responder-agora");

        expect(screen.getByTestId("aviso-curto-do-chat")).toHaveTextContent("Nada transcrito ainda.");
        expect(perguntar).not.toHaveBeenCalled();
      });

      it("Responder agora com o servidor fora mostra o erro e não envia", () => {
        const perguntar = vi.spyOn(api, "perguntarNoChat").mockResolvedValue({ mensagemId: "m1" });
        escutaSimulada.legenda = { frases: [fraseRecente("f1", "Bom dia a todos.")], emAndamento: null };
        const { ativar } = ponteAtiva(undefined, true);
        renderizar(OCIOSO, true);
        ativar();

        fireEvent.click(within(painel()).getByRole("button", { name: "Responder agora" }));

        expect(screen.getByRole("alert")).toHaveTextContent("Servidor desconectado");
        expect(perguntar).not.toHaveBeenCalled();
      });
    });

    it("sem caixa nem cartão: a resposta à pergunta da escuta aparece só como mensagem do chat", () => {
      escutaSimulada.legenda = {
        frases: [frase("f1", "Qual a complexidade?", "2026-11-04T11:59:58Z", true)],
        emAndamento: null,
      };
      escutaSimulada.ultimaPergunta = "Qual a complexidade?";
      const { ativar } = ponteAtiva(undefined, true);
      renderizar({
        ...OCIOSO,
        mensagens: [
          mensagem("u1", "usuario", { texto: "Qual a complexidade?", origem: "escuta", criadaEm: "2026-11-04T12:00:00Z" }),
          mensagem("c1", "claude", { texto: "O(n log n) no pior caso", criadaEm: "2026-11-04T12:00:05Z" }),
        ],
      });
      ativar();

      expect(screen.queryByTestId("painel-da-escuta")).not.toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "Escuta ao vivo" })).not.toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "Resposta da escuta" })).not.toBeInTheDocument();
      expect(screen.queryByText("última pergunta")).not.toBeInTheDocument();
      expect(screen.getAllByText("O(n log n) no pior caso")).toHaveLength(1);
      // A pergunta enviada já é a mensagem do chat; a transcrição tem o painel dela (aberto ao ligar a escuta).
      expect(screen.getAllByText("Qual a complexidade?")).toHaveLength(2);
      expect(conversa()).toHaveTextContent("Qual a complexidade?");
      expect(screen.queryByTestId("trecho-ouvido")).not.toBeInTheDocument();
    });

    it("a mensagem enviada pela escuta mostra só a pergunta, como se fosse digitada, com o selo", () => {
      const enviada =
        "Pergunta detectada na escuta: Qual o prazo do projeto?\n\n" +
        'Trecho transcrito dos últimos 60 s do áudio do computador.\n"""\nBom dia a todos.\n"""\n\n' +
        "Responda direto e curto, em até 5 tópicos objetivos.";
      renderizar({
        ...OCIOSO,
        mensagens: [mensagem("u1", "usuario", { texto: enviada, origem: "escuta" })],
      });

      const balao = screen.getByText("Qual o prazo do projeto?").closest(".mensagem-do-usuario") as HTMLElement;
      expect(within(balao).getByText("Qual o prazo do projeto?")).toHaveClass("texto-longo");
      expect(within(balao).getByText("escuta")).toHaveClass("selo-da-escuta");
      expect(conversa()).not.toHaveTextContent("Pergunta detectada na escuta");
      expect(conversa()).not.toHaveTextContent("Bom dia a todos.");
      expect(conversa()).not.toHaveTextContent("Responda direto");
    });

    it("a digitada com o mesmo começo aparece inteira: só a da escuta é resumida", () => {
      const digitada = "Pergunta detectada na escuta: teste\n\nresto do texto";
      renderizar({ ...OCIOSO, mensagens: [mensagem("u1", "usuario", { texto: digitada })] });
      expect(conversa()).toHaveTextContent("Pergunta detectada na escuta: teste");
      expect(conversa()).toHaveTextContent("resto do texto");
    });

    it("o menu do indicador tem o Automático, o idioma e a prioridade, e chama a escuta sem levar o foco ao campo", () => {
      escutaSimulada.automatico = false;
      const { ativar } = ponteAtiva(undefined, true);
      const { campo } = renderizar();
      ativar();

      fireEvent.click(within(indicador()).getByRole("button", { name: "Controles da escuta" }));
      const menu = within(screen.getByRole("group", { name: "Controles da escuta" }));
      const chave = menu.getByRole("switch", { name: "Automático" });
      expect(chave).toHaveAttribute("aria-checked", "false");
      fireEvent.click(chave);
      expect(escutaSimulada.alternarAutomatico).toHaveBeenCalledTimes(1);

      expect(menu.getByRole("radio", { name: "Português" })).toBeChecked();
      expect(menu.getByRole("radio", { name: "Velocidade" })).toBeChecked();
      fireEvent.click(menu.getByRole("radio", { name: "Automático" }));
      expect(escutaSimulada.mudarIdioma).toHaveBeenCalledWith("automatico");
      fireEvent.click(menu.getByRole("radio", { name: "Precisão" }));
      expect(escutaSimulada.mudarPrioridadeDoMotor).toHaveBeenCalledWith("precisao");
      expect(campo).not.toHaveFocus();
    });

    it("o erro da escuta aparece numa linha acima do campo e o fechar o descarta", () => {
      escutaSimulada.situacaoNoModo = "erro";
      escutaSimulada.erro = "a captura do áudio parou";
      const { ativar } = ponteAtiva(undefined, true);
      renderizar();
      // Com a escuta desligada, nada dela aparece.
      expect(screen.queryByTestId("erro-da-escuta")).not.toBeInTheDocument();

      ativar();
      const alerta = screen.getByTestId("erro-da-escuta");
      expect(alerta).toHaveAttribute("role", "alert");
      expect(alerta).toHaveTextContent("a captura do áudio parou");
      expect(screen.getByTestId("chat-rapido")).toContainElement(alerta);
      expect(
        alerta.compareDocumentPosition(screen.getByTestId("composer-do-chat")) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      fireEvent.click(within(alerta).getByRole("button", { name: "fechar" }));
      expect(escutaSimulada.descartarErro).toHaveBeenCalledTimes(1);
    });

    it("sem erro, não há aviso da escuta", () => {
      const { ativar } = ponteAtiva(undefined, true);
      renderizar();
      ativar();
      expect(screen.queryByTestId("erro-da-escuta")).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("o indicador mostra o selo do motor e o download com o total real", () => {
      escutaSimulada.situacaoNoModo = "baixando-modelo";
      escutaSimulada.motor = { dispositivo: "webgpu", modelo: "onnx-community/whisper-base", precisao: "q4", nativo: false };
      escutaSimulada.download = { progresso: 45, totalMb: 199 };
      const { ativar } = ponteAtiva(undefined, true);
      renderizar();
      ativar();

      expect(within(indicador()).getByText("baixando o modelo 45% de 199 MB")).toBeInTheDocument();
      expect(within(indicador()).getByTestId("selo-do-motor")).toHaveTextContent("GPU · base · q4");
    });
  });
});

describe("ChatRapido · escuta no composer e selo", () => {
  afterEach(() => vi.restoreAllMocks());

  it("o selo \"escuta\" aparece só nas perguntas enviadas pela escuta", () => {
    renderizar({
      ...OCIOSO,
      mensagens: [
        mensagem("u1", "usuario", { texto: "Qual a complexidade?", origem: "escuta" }),
        mensagem("c1", "claude", { texto: "O(n)." }),
        mensagem("u2", "usuario", { texto: "E o espaço?" }),
      ],
    });

    const daEscuta = screen.getByText("Qual a complexidade?").closest(".mensagem-do-usuario");
    const digitada = screen.getByText("E o espaço?").closest(".mensagem-do-usuario");
    expect(within(daEscuta as HTMLElement).getByText("escuta")).toHaveClass("selo-da-escuta");
    expect(digitada?.querySelector(".selo-da-escuta")).toBeNull();
    expect(document.querySelectorAll(".selo-da-escuta")).toHaveLength(1);
  });

  it("o preencherComposer põe a pergunta no campo com a nota; o Enter envia com a origem e limpa a marca", async () => {
    const perguntar = vi.spyOn(api, "perguntarNoChat").mockResolvedValue({ mensagemId: "m1" });
    const { campo } = renderizar({ ...OCIOSO, alteracoesAutorizadas: true });
    expect(screen.queryByTestId("nota-da-escuta")).not.toBeInTheDocument();

    act(() => opcoesDaEscuta().preencherComposer("Como inverter a lista?"));
    expect(campo).toHaveValue("Como inverter a lista?");
    expect(screen.getByTestId("nota-da-escuta")).toHaveTextContent("Pergunta da escuta: confira e aperte Enter");
    expect(perguntar).not.toHaveBeenCalled();

    fireEvent.keyDown(campo, { key: "Enter" });
    expect(perguntar).toHaveBeenCalledWith("Como inverter a lista?", [], { origem: "escuta" });
    await waitFor(() => expect(campo).toHaveValue(""));
    expect(screen.queryByTestId("nota-da-escuta")).not.toBeInTheDocument();

    // A próxima, digitada, vai sem origem.
    fireEvent.change(campo, { target: { value: "Obrigado" } });
    fireEvent.keyDown(campo, { key: "Enter" });
    expect(perguntar).toHaveBeenLastCalledWith("Obrigado", []);
    await waitFor(() => expect(campo).toHaveValue(""));
  });

  it("apagar o campo tira a marca da escuta: o que for escrito depois vai sem origem", async () => {
    const perguntar = vi.spyOn(api, "perguntarNoChat").mockResolvedValue({ mensagemId: "m1" });
    const { campo } = renderizar({ ...OCIOSO, alteracoesAutorizadas: true });

    act(() => opcoesDaEscuta().preencherComposer("Como inverter a lista?"));
    fireEvent.change(campo, { target: { value: "" } });
    expect(screen.queryByTestId("nota-da-escuta")).not.toBeInTheDocument();

    fireEvent.change(campo, { target: { value: "Outra coisa" } });
    fireEvent.keyDown(campo, { key: "Enter" });
    expect(perguntar).toHaveBeenCalledWith("Outra coisa", []);
    await waitFor(() => expect(campo).toHaveValue(""));
  });

  it("retocar a pergunta da escuta mantém a marca e a origem", async () => {
    const perguntar = vi.spyOn(api, "perguntarNoChat").mockResolvedValue({ mensagemId: "m1" });
    const { campo } = renderizar({ ...OCIOSO, alteracoesAutorizadas: true });

    act(() => opcoesDaEscuta().preencherComposer("Como inverter a lista"));
    fireEvent.change(campo, { target: { value: "Como inverter a lista ligada?" } });
    expect(screen.getByTestId("nota-da-escuta")).toBeInTheDocument();

    fireEvent.keyDown(campo, { key: "Enter" });
    expect(perguntar).toHaveBeenCalledWith("Como inverter a lista ligada?", [], { origem: "escuta" });
    await waitFor(() => expect(campo).toHaveValue(""));
  });

  it("o preencherComposer não apaga um rascunho digitado; troca só a pergunta que a própria escuta pôs", () => {
    const { campo } = renderizar({ ...OCIOSO, alteracoesAutorizadas: true });

    fireEvent.change(campo, { target: { value: "Meu rascunho" } });
    act(() => opcoesDaEscuta().preencherComposer("Como inverter a lista?"));
    expect(campo).toHaveValue("Meu rascunho");
    expect(screen.queryByTestId("nota-da-escuta")).not.toBeInTheDocument();

    // Campo vazio: a pergunta entra; a seguinte, também da escuta, substitui a anterior.
    fireEvent.change(campo, { target: { value: "" } });
    act(() => opcoesDaEscuta().preencherComposer("Como inverter a lista?"));
    expect(campo).toHaveValue("Como inverter a lista?");
    act(() => opcoesDaEscuta().preencherComposer("E a lista dupla?"));
    expect(campo).toHaveValue("E a lista dupla?");
    expect(screen.getByTestId("nota-da-escuta")).toBeInTheDocument();
  });
});

describe("ChatRapido", () => {
  afterEach(() => vi.restoreAllMocks());

  it("desenha só as últimas 100 mensagens e revela mais 100 por clique em \"Mostrar anteriores\"", () => {
    const mensagens = Array.from({ length: 230 }, (_, i) =>
      mensagem(`m${i + 1}`, i % 2 === 0 ? "usuario" : "claude", { texto: `texto da mensagem ${i + 1}.` }),
    );
    renderizar({ ...OCIOSO, mensagens });
    expect(screen.queryByText("texto da mensagem 130.")).not.toBeInTheDocument();
    expect(screen.getByText("texto da mensagem 131.")).toBeInTheDocument();
    expect(screen.getByText("texto da mensagem 230.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Mostrar 100 anteriores" }));
    expect(screen.getByText("texto da mensagem 31.")).toBeInTheDocument();
    expect(screen.queryByText("texto da mensagem 30.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Mostrar 30 anteriores" }));
    expect(screen.getByText("texto da mensagem 1.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /anteriores/ })).not.toBeInTheDocument();
  });

  it("Enter envia a pergunta e limpa o campo; Shift+Enter não envia", async () => {
    const perguntar = vi.spyOn(api, "perguntarNoChat").mockResolvedValue({ mensagemId: "m1" });
    const { campo } = renderizar();

    fireEvent.change(campo, { target: { value: "Oi, Claude" } });
    fireEvent.keyDown(campo, { key: "Enter", shiftKey: true });
    expect(perguntar).not.toHaveBeenCalled();

    fireEvent.keyDown(campo, { key: "Enter" });
    expect(perguntar).toHaveBeenCalledWith("Oi, Claude", []);
    await waitFor(() => expect(campo).toHaveValue(""));
  });

  it("erro do servidor aparece e o texto fica no campo", async () => {
    vi.spyOn(api, "perguntarNoChat").mockRejectedValue(new Error("Já existe uma resposta em andamento."));
    const { campo } = renderizar();

    fireEvent.change(campo, { target: { value: "Oi" } });
    fireEvent.keyDown(campo, { key: "Enter" });

    expect(await screen.findByRole("alert")).toHaveTextContent("Já existe uma resposta em andamento.");
    expect(campo).toHaveValue("Oi");
  });

  it("\"/clear\" limpa a conversa e não vira pergunta; Tab completa o comando", async () => {
    const perguntar = vi.spyOn(api, "perguntarNoChat");
    const limpar = vi.spyOn(api, "limparChat").mockResolvedValue(null);
    const { campo } = renderizar({ ...OCIOSO, mensagens: [mensagem("u1", "usuario", { texto: "oi" })] });

    fireEvent.change(campo, { target: { value: "/cl" } });
    fireEvent.keyDown(campo, { key: "Tab" });
    expect(campo).toHaveValue("/clear");

    fireEvent.keyDown(campo, { key: "Enter" });
    await waitFor(() => expect(limpar).toHaveBeenCalledTimes(1));
    expect(perguntar).not.toHaveBeenCalled();
    await waitFor(() => expect(campo).toHaveValue(""));
  });

  it("durante a resposta: o botão vira cancelar, Esc cancela e as animações ficam ligadas", async () => {
    const cancelar = vi.spyOn(api, "cancelarRespostaDoChat").mockResolvedValue({ cancelando: true });
    const { campo } = renderizar(RESPONDENDO);

    expect(screen.queryByRole("button", { name: /enviar/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "cancelar" })).toHaveClass("btn-danger");
    expect(screen.getByTestId("chat-rapido")).toHaveClass("chat-rapido-respondendo");
    expect(document.querySelector(".composer-do-chat .faixa-de-progresso")).not.toBeNull();
    expect(screen.getAllByText("respondendo…").length).toBeGreaterThan(0);
    // O cursor no fim do texto e a atividade mais recente.
    expect(document.querySelector(".texto-respondendo .markdown")).not.toBeNull();
    expect(screen.getByText(/lendo README\.md…/)).toBeInTheDocument();
    // O bloco de ação não aparece enquanto chega.
    expect(screen.getByText("Vou abrir o projeto.")).toBeInTheDocument();
    expect(screen.queryByText(/acao-do-app/)).not.toBeInTheDocument();

    fireEvent.keyDown(campo, { key: "Escape" });
    expect(cancelar).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", { name: "cancelando…" })).toBeDisabled();
  });

  it("ocioso: botão enviar e sem as animações da resposta", () => {
    renderizar();

    expect(screen.getByRole("button", { name: "enviar ⏎" })).toHaveClass("btn-cta");
    expect(screen.getByTestId("chat-rapido")).not.toHaveClass("chat-rapido-respondendo");
    expect(document.querySelector(".faixa-de-progresso")).toBeNull();
    expect(document.querySelector(".moldura-do-composer")).not.toBeNull();
  });

  it("desconectado: dá para escrever, mas não para enviar", () => {
    const perguntar = vi.spyOn(api, "perguntarNoChat");
    const { campo } = renderizar(OCIOSO, true);

    fireEvent.change(campo, { target: { value: "Oi" } });
    expect(campo).toHaveValue("Oi");
    fireEvent.keyDown(campo, { key: "Enter" });

    expect(perguntar).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "enviar ⏎" })).toBeDisabled();
  });

  it("Esc ociosa oculta a conversa; o indicador avisa quando chega resposta nova", () => {
    const conversa: EstadoDoChatNaTela = {
      ...OCIOSO,
      mensagens: [mensagem("u1", "usuario", { texto: "oi" }), mensagem("c1", "claude", { texto: "Olá!" })],
    };
    const { campo, rerender } = renderizar(conversa);
    expect(screen.getByRole("region", { name: "Conversa com o Claude" })).toBeVisible();

    fireEvent.keyDown(campo, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Conversa com o Claude" })).not.toBeInTheDocument();
    const pilula = screen.getByRole("button", { name: "mostrar conversa (2)" });
    // Uma pílula pequena (sem a caixa do chip antigo).
    expect(pilula).toHaveClass("mostrar-conversa");
    expect(pilula).not.toHaveClass("chip");

    rerender({
      ...conversa,
      mensagens: [...conversa.mensagens, mensagem("u2", "usuario"), mensagem("c2", "claude", { texto: "Nova" })],
    });
    fireEvent.click(screen.getByRole("button", { name: /resposta nova · mostrar conversa/ }));
    expect(screen.getByText("Nova")).toBeVisible();
  });

  describe("a barra do composer", () => {
    const composer = () => screen.getByTestId("composer-do-chat");
    /** `a` vem antes de `b` no documento. */
    const vemAntes = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

    it("é uma linha só, na ordem: +, campo, microfone, modelo, enviar e o menu ⋯", () => {
      const { campo } = renderizar();
      const linha = composer().querySelector(".linha-do-composer");
      expect(linha).not.toBeNull();
      const anexar = screen.getByRole("button", { name: "Anexar arquivos" });
      const microfone = screen.getByRole("button", { name: "Ditar a mensagem por voz" });
      const modelo = screen.getByRole("button", { name: /^Modelo:/ });
      const enviar = screen.getByRole("button", { name: "enviar ⏎" });
      const maisAcoes = screen.getByRole("button", { name: "Mais ações" });
      for (const elemento of [anexar, campo, microfone, modelo, enviar, maisAcoes]) {
        expect(linha).toContainElement(elemento);
      }
      // O "melhorar" saiu da barra: mora no menu ⋯.
      expect(screen.queryByRole("button", { name: "Melhorar o pedido" })).not.toBeInTheDocument();
      expect(vemAntes(anexar, campo)).toBe(true);
      expect(vemAntes(campo, microfone)).toBe(true);
      expect(vemAntes(microfone, modelo)).toBe(true);
      expect(vemAntes(modelo, enviar)).toBe(true);
      expect(vemAntes(enviar, maisAcoes)).toBe(true);
      expect(composer()).not.toHaveClass("composer-compacto", "composer-expandido");
    });

    it("o campo diz \"Pergunte ao Claude\" e os botões de ícone são SVG, sem emoji nem texto", () => {
      const { campo } = renderizar();
      expect(campo).toHaveAttribute("placeholder", "Pergunte ao Claude");
      for (const nome of ["Anexar arquivos", "Mais ações", "Ditar a mensagem por voz"]) {
        const botao = screen.getByRole("button", { name: nome });
        expect(botao).toHaveTextContent("");
        expect(botao.querySelector("svg")).not.toBeNull();
      }
    });

    it("o modelo mostra o nome em cinza, o esforço em destaque e a seta como SVG", () => {
      renderizar();
      const modelo = screen.getByRole("button", { name: /^Modelo:/ });
      expect(modelo.querySelector("b")).toHaveTextContent("Alto");
      expect(modelo.querySelector("svg")).not.toBeNull();
      expect(modelo).not.toHaveTextContent("⌃");
    });

    it("clicar na barra leva o foco ao campo", () => {
      const { campo } = renderizar();
      fireEvent.click(composer());
      expect(campo).toHaveFocus();
    });

    it("o fixar ao lado está no menu ⋯ mesmo sem conversa; sem aoAlternarFixo não há o item", () => {
      const props = {
        chat: OCIOSO,
        desconectado: false,
        erroAoCarregar: null,
        aoMudarPreferencias: vi.fn(),
        aoAbrirTerminal: vi.fn(),
        temVagaPara: vi.fn().mockReturnValue(true),
        aoAtualizarOrquestradores: vi.fn().mockResolvedValue(undefined),
        orquestradores: [],
      };
      const { rerender } = render(<ChatRapido {...props} />);
      itemDoMenu("Melhorar o pedido");
      expect(screen.queryByRole("menuitem", { name: /^Fixar o chat/ })).not.toBeInTheDocument();

      rerender(<ChatRapido {...props} aoAlternarFixo={vi.fn()} />);
      expect(screen.getByRole("menuitem", { name: "Fixar o chat à esquerda" })).toBeInTheDocument();
    });

    it("com imagem anexada, a miniatura aparece acima da linha da barra", async () => {
      const { campo } = renderizar();
      const imagem = new File(["png"], "tela.png", { type: "image/png" });
      fireEvent.paste(campo, { clipboardData: { files: [imagem] } });
      const remover = await screen.findByRole("button", { name: "Remover tela.png" });
      const miniaturas = remover.closest(".miniaturas-do-prompt")!;
      expect(composer()).toContainElement(miniaturas as HTMLElement);
      expect(vemAntes(miniaturas, campo)).toBe(true);
    });

    it("remover a imagem libera a URL da miniatura", async () => {
      const criar = vi.spyOn(URL, "createObjectURL");
      const revogar = vi.spyOn(URL, "revokeObjectURL");
      const { campo } = renderizar();
      fireEvent.paste(campo, { clipboardData: { files: [new File(["png"], "tela.png", { type: "image/png" })] } });
      fireEvent.click(await screen.findByRole("button", { name: "Remover tela.png" }));
      expect(revogar).toHaveBeenCalledWith(criar.mock.results[0]?.value);
      expect(screen.queryByAltText("tela.png")).not.toBeInTheDocument();
    });

    it("o envio gera o base64 igual ao do arquivo e libera a URL depois", async () => {
      const perguntar = vi.spyOn(api, "perguntarNoChat").mockResolvedValue({ mensagemId: "m1" });
      const criar = vi.spyOn(URL, "createObjectURL");
      const revogar = vi.spyOn(URL, "revokeObjectURL");
      const { campo } = renderizar();
      fireEvent.paste(campo, { clipboardData: { files: [new File(["png"], "tela.png", { type: "image/png" })] } });
      await screen.findByAltText("tela.png");
      fireEvent.change(campo, { target: { value: "Veja" } });
      fireEvent.keyDown(campo, { key: "Enter" });

      // "cG5n" é o base64 de "png".
      await waitFor(() =>
        expect(perguntar).toHaveBeenCalledWith("Veja", [{ nome: "tela.png", tipoDeMidia: "image/png", base64: "cG5n" }]),
      );
      await waitFor(() => expect(revogar).toHaveBeenCalledWith(criar.mock.results[0]?.value));
    });

    it("o documento colado vira etiqueta (sem miniatura) e dá para remover", async () => {
      const { campo } = renderizar();
      fireEvent.paste(campo, { clipboardData: { files: [new File(["# notas"], "notas.md", { type: "" })] } });
      const remover = await screen.findByRole("button", { name: "Remover notas.md" });
      const etiqueta = remover.closest(".chip-de-anexo");
      expect(etiqueta).toHaveTextContent("notas.md");
      expect(etiqueta).toHaveTextContent("Markdown");
      expect(screen.queryAllByRole("img")).toHaveLength(0);

      fireEvent.click(remover);
      expect(screen.queryByText("notas.md")).not.toBeInTheDocument();
    });

    it("o formato antigo (.doc) aparece com o selo e o aviso para salvar como .docx", async () => {
      const { campo } = renderizar();
      fireEvent.paste(campo, { clipboardData: { files: [new File(["x"], "contrato.doc", { type: "application/msword" })] } });
      const remover = await screen.findByRole("button", { name: "Remover contrato.doc" });
      const selo = within(remover.closest(".chip-de-anexo") as HTMLElement).getByText("Word (formato antigo)");
      expect(selo).toHaveAttribute("title", expect.stringContaining("Salve como .docx"));
    });

    it("só com documento, sem texto, envia o texto padrão e o conteúdo em base64", async () => {
      const perguntar = vi.spyOn(api, "perguntarNoChat").mockResolvedValue({ mensagemId: "m1" });
      const revogar = vi.spyOn(URL, "revokeObjectURL");
      const { campo } = renderizar();
      fireEvent.paste(campo, { clipboardData: { files: [new File(["pdf"], "contrato.pdf", { type: "application/pdf" })] } });
      await screen.findByRole("button", { name: "Remover contrato.pdf" });

      fireEvent.click(screen.getByRole("button", { name: "enviar ⏎" }));
      // "cGRm" é o base64 de "pdf".
      await waitFor(() =>
        expect(perguntar).toHaveBeenCalledWith("Analise os anexos.", [
          { nome: "contrato.pdf", tipoDeMidia: "application/pdf", base64: "cGRm" },
        ]),
      );
      await waitFor(() => expect(screen.queryByText("contrato.pdf")).not.toBeInTheDocument());
      // Documento não tem miniatura: não há URL para liberar.
      expect(revogar).not.toHaveBeenCalled();
    });

    it("o documento sem tipo (arrastado) segue com o tipo vazio: o servidor decide pela extensão", async () => {
      const perguntar = vi.spyOn(api, "perguntarNoChat").mockResolvedValue({ mensagemId: "m1" });
      const { campo } = renderizar();
      const chat = screen.getByTestId("chat-rapido");
      const arquivo = new File(["a,b"], "dados.CSV", { type: "" });
      fireEvent.dragOver(chat, { dataTransfer: { types: ["Files"], files: [arquivo] } });
      expect(screen.getByText("solte para anexar os arquivos à pergunta")).toBeInTheDocument();
      fireEvent.drop(chat, { dataTransfer: { types: ["Files"], files: [arquivo] } });
      await screen.findByRole("button", { name: "Remover dados.CSV" });

      fireEvent.change(campo, { target: { value: "Some as colunas" } });
      fireEvent.keyDown(campo, { key: "Enter" });
      await waitFor(() =>
        expect(perguntar).toHaveBeenCalledWith("Some as colunas", [{ nome: "dados.CSV", tipoDeMidia: "", base64: "YSxi" }]),
      );
    });

    it("recusa formato não aceito e documento acima de 32 MB, e explica", async () => {
      const { campo } = renderizar();
      fireEvent.paste(campo, { clipboardData: { files: [new File(["x"], "app.exe", { type: "application/x-msdownload" })], getData: () => "" } });
      expect(await screen.findByRole("alert")).toHaveTextContent('"app.exe" tem um formato que não dá para anexar');

      const grande = new File(["x"], "grande.pdf", { type: "application/pdf" });
      Object.defineProperty(grande, "size", { value: 33 * 1024 * 1024 });
      fireEvent.paste(campo, { clipboardData: { files: [grande] } });
      await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent('"grande.pdf" passa de 32 MB'));
      expect(screen.queryByRole("button", { name: /^Remover/ })).not.toBeInTheDocument();
    });

    it("o seletor aceita imagens e as extensões dos documentos", () => {
      renderizar();
      const seletor = document.querySelector<HTMLInputElement>('input[type="file"]');
      expect(seletor?.accept).toContain("image/png");
      expect(seletor?.accept).toContain(".pdf");
      expect(seletor?.accept).toContain(".docx");
      expect(seletor?.accept).toContain(".yml");
    });

    it("o menu do modelo abre ao clicar no botão do modelo", () => {
      renderizar();
      fireEvent.click(screen.getByRole("button", { name: /^Modelo:/ }));
      expect(screen.getByRole("menu", { name: "Modelo do chat" })).toBeInTheDocument();
    });

    it("Enter envia da barra e o campo volta vazio", async () => {
      const perguntar = vi.spyOn(api, "perguntarNoChat").mockResolvedValue({ mensagemId: "m1" });
      const { campo } = renderizar();
      fireEvent.change(campo, { target: { value: "Oi" } });
      fireEvent.keyDown(campo, { key: "Enter" });
      expect(perguntar).toHaveBeenCalledWith("Oi", []);
      await waitFor(() => expect(campo).toHaveValue(""));
    });
  });

  describe("ditado por voz", () => {
    const microfone = () => screen.getByRole("button", { name: "Ditar a mensagem por voz" });

    it("o microfone é um ícone de traço (SVG, sem texto) com o mesmo botão de ícone dos outros da barra", () => {
      renderizar();

      expect(microfone()).toHaveClass("botao-icone");
      expect(microfone()).toHaveTextContent("");
      expect(microfone().querySelector("svg")).not.toBeNull();
      expect(microfone().closest(".linha-do-composer")).not.toBeNull();
      expect(screen.getByRole("button", { name: "Anexar arquivos" })).toHaveClass("botao-icone");
      expect(screen.getByRole("button", { name: "Mais ações" })).toHaveClass("botao-icone");
    });

    it("flutuante: o microfone fica na linha do composer; o ditado entra no campo e dá para enviar", async () => {
      const perguntar = vi.spyOn(api, "perguntarNoChat").mockResolvedValue({ mensagemId: "m1" });
      const { campo } = renderizar();

      expect(microfone().closest(".linha-do-composer")).not.toBeNull();
      fireEvent.change(campo, { target: { value: "Revise" } });
      fireEvent.click(microfone());
      expect(screen.getByRole("button", { name: "Parar e transformar em texto" })).toHaveAttribute("aria-pressed", "true");

      act(() => ditadoFalso.entregar?.("o módulo do chat"));
      expect(campo).toHaveValue("Revise o módulo do chat");
      expect(campo).toHaveFocus();

      fireEvent.keyDown(campo, { key: "Enter" });
      expect(perguntar).toHaveBeenCalledWith("Revise o módulo do chat", []);
      await waitFor(() => expect(campo).toHaveValue(""));
    });

    it("fixo: o microfone também fica no composer da coluna", () => {
      render(
        <ChatRapido
          chat={OCIOSO}
          desconectado={false}
          erroAoCarregar={null}
          aoMudarPreferencias={vi.fn()}
          aoAbrirTerminal={vi.fn()}
          temVagaPara={vi.fn().mockReturnValue(true)}
          aoAtualizarOrquestradores={vi.fn().mockResolvedValue(undefined)}
          orquestradores={[]}
          fixo
        />,
      );

      const lateral = screen.getByRole("complementary", { name: "Chat rápido" });
      expect(lateral).toContainElement(microfone());
      act(() => ditadoFalso.entregar?.("abra o painel"));
      expect(screen.getByRole("textbox", { name: "Pergunta para o Claude" })).toHaveValue("abra o painel");
    });

    it("depois do clique, com a permissão do microfone pendente, o botão não perde o foco e o Esc descarta a gravação", () => {
      ditadoFalso.pedirPermissao = true;
      // Como o Chromium: um botão focado que passa a `disabled` deixa de ter o foco (o Esc iria para o corpo da página).
      const observador = new MutationObserver((registros) => {
        for (const registro of registros) {
          const alvo = registro.target as HTMLButtonElement;
          if (alvo.disabled && alvo === document.activeElement) {
            alvo.blur();
          }
        }
      });
      observador.observe(document.body, { attributes: true, attributeFilter: ["disabled"], subtree: true });
      try {
        renderizar({
          ...OCIOSO,
          mensagens: [mensagem("u1", "usuario", { texto: "oi" }), mensagem("c1", "claude", { texto: "Olá!" })],
        });

        const botao = microfone();
        act(() => botao.focus());
        fireEvent.click(botao);
        // Pedindo a permissão: o botão segue focado (marcado como ocupado, sem `disabled`).
        expect(botao).toHaveAttribute("aria-busy", "true");
        expect(botao).toHaveAttribute("aria-disabled", "true");
        expect(botao).not.toBeDisabled();
        expect(botao).toHaveFocus();

        // Outro clique no meio do pedido não faz nada.
        fireEvent.click(botao);
        expect(botao).toHaveAttribute("aria-busy", "true");

        act(() => ditadoFalso.gravar?.());
        const gravando = screen.getByRole("button", { name: "Parar e transformar em texto" });
        expect(gravando).toHaveAttribute("aria-pressed", "true");
        expect(gravando).toHaveFocus();

        fireEvent.keyDown(gravando, { key: "Escape" });
        expect(gravando).toHaveAttribute("aria-pressed", "false");
        expect(screen.getByRole("region", { name: "Conversa com o Claude" })).toBeVisible();
      } finally {
        observador.disconnect();
        ditadoFalso.pedirPermissao = false;
      }
    });

    it("gravando: o foco fica no microfone (o clique na barra não o tira dali) e o Esc descarta sem ocultar a conversa", () => {
      const { campo } = renderizar({
        ...OCIOSO,
        mensagens: [mensagem("u1", "usuario", { texto: "oi" }), mensagem("c1", "claude", { texto: "Olá!" })],
      });

      const botao = microfone();
      act(() => botao.focus());
      fireEvent.click(botao);
      expect(botao).toHaveFocus();
      expect(botao).toHaveAttribute("aria-pressed", "true");
      expect(campo).not.toHaveFocus();

      fireEvent.keyDown(botao, { key: "Escape" });
      expect(botao).toHaveAttribute("aria-pressed", "false");
      expect(screen.getByRole("region", { name: "Conversa com o Claude" })).toBeVisible();
    });
  });

  it("mostra falha, cancelamento, avisos e os cartões de ação", () => {
    renderizar({
      ...OCIOSO,
      mensagens: [
        mensagem("c1", "claude", { situacao: "falhou", motivoDaFalha: "sem cota" }),
        mensagem("c2", "claude", { situacao: "cancelada", texto: "parcial" }),
        mensagem("c3", "claude", {
          texto: "Pronto.",
          avisos: ["Ação ignorada: pasta fora da raiz."],
          acoes: [{ tipo: "abrir_orquestrador", projeto: "painel", pasta: "C:\\p\\painel", pedido: null }],
        }),
      ],
    });

    expect(screen.getByText("A resposta falhou: sem cota")).toHaveClass("alert-error");
    expect(screen.getByText("resposta cancelada")).toBeInTheDocument();
    expect(screen.getByText("Ação ignorada: pasta fora da raiz.")).toHaveClass("alert-warning");
    expect(screen.getByText("Abrir orquestrador em painel")).toBeInTheDocument();
  });

  it("escolhe o cartão pelo tipo da ação: abrir orquestrador, criar e editar subagente", async () => {
    const ler = vi.spyOn(api, "lerPreferencias").mockResolvedValue({ instrucoesPadrao: "", subagentesProntos: [] });
    renderizar({
      ...OCIOSO,
      mensagens: [
        mensagem("c1", "claude", {
          texto: "Três cartões.",
          acoes: [
            { tipo: "abrir_orquestrador", projeto: "painel", pasta: "C:\\p\\painel", pedido: null },
            { tipo: "criar_subagente", nome: "revisor", descricao: "Revisa o diff", prompt: "Leia o diff.", modelo: "herdar" },
            { tipo: "editar_subagente", nome: "revisor", descricao: null, prompt: null, modelo: "opus" },
          ],
        }),
      ],
    });

    expect(screen.getByText("Abrir orquestrador em painel")).toBeInTheDocument();
    expect(screen.getByText("Novo subagente pronto")).toBeInTheDocument();
    expect(screen.getByText("Editar subagente pronto")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "criar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "aplicar" })).toBeInTheDocument();
    // Só o cartão de editar lê a biblioteca ao aparecer, para mostrar o antes.
    await waitFor(() => expect(ler).toHaveBeenCalledTimes(1));
  });

  describe("autorização de alterações", () => {
    const cartoes = () => screen.queryAllByRole("group", { name: "Pedido de autorização do chat" });
    const AUTORIZAR = "Autorizar até o /clear e continuar";

    /** Duas respostas pedindo autorização: só a última mostra o cartão. */
    const PEDINDO: EstadoDoChatNaTela = {
      ...OCIOSO,
      mensagens: [
        mensagem("u1", "usuario", { texto: "Corrija o x.ts" }),
        mensagem("c1", "claude", {
          texto: "Preciso editar.",
          autorizacaoPendente: { acao: "editar", detalhe: "src/x.ts" },
        }),
        mensagem("u2", "usuario", { texto: "E rode os testes" }),
        mensagem("c2", "claude", {
          texto: "Preciso rodar os testes.",
          autorizacaoPendente: { acao: "rodar_comando", detalhe: "npm test" },
        }),
      ],
    };

    it("o cartão aparece só na última resposta com pedido, e só sem autorização", () => {
      const { rerender } = renderizar(PEDINDO);

      expect(cartoes()).toHaveLength(1);
      expect(cartoes()[0]).toHaveTextContent("O chat quer rodar npm test");

      // A última resposta não pede nada: nenhum cartão, nem o da anterior.
      rerender({ ...PEDINDO, mensagens: [...PEDINDO.mensagens, mensagem("u3", "usuario"), mensagem("c3", "claude")] });
      expect(cartoes()).toHaveLength(0);

      // Já autorizado: nenhum cartão.
      rerender({ ...PEDINDO, alteracoesAutorizadas: true });
      expect(cartoes()).toHaveLength(0);
    });

    it("Autorizar grava a autorização e manda o Claude continuar pelo envio do chat", async () => {
      const autorizar = vi.spyOn(api, "autorizarAlteracoesDoChat").mockResolvedValue({ autorizado: true });
      const perguntar = vi.spyOn(api, "perguntarNoChat").mockResolvedValue({ mensagemId: "c3" });
      renderizar(PEDINDO);

      fireEvent.click(screen.getByRole("button", { name: AUTORIZAR }));

      await waitFor(() => expect(perguntar).toHaveBeenCalledWith("Autorizado. Continue de onde parou.", []));
      expect(autorizar).toHaveBeenCalledWith(true);
      expect(autorizar.mock.invocationCallOrder[0]).toBeLessThan(perguntar.mock.invocationCallOrder[0] ?? 0);
    });

    it("desconectado, o botão de autorizar fica desabilitado", () => {
      renderizar(PEDINDO, true);
      expect(screen.getByRole("button", { name: AUTORIZAR })).toBeDisabled();
    });

    it("durante uma resposta, o botão de autorizar fica desabilitado", () => {
      const { rerender } = renderizar(PEDINDO);
      expect(screen.getByRole("button", { name: AUTORIZAR })).toBeEnabled();

      rerender({ ...PEDINDO, situacao: "respondendo" });
      expect(screen.getByRole("button", { name: AUTORIZAR })).toBeDisabled();
    });

    it("autorizado, um indicador pequeno (só ícone, sem texto) explica no title e o ✕ revoga", async () => {
      const revogar = vi.spyOn(api, "autorizarAlteracoesDoChat").mockResolvedValue({ autorizado: false });
      const { rerender } = renderizar({ ...OCIOSO, alteracoesAutorizadas: true });

      const selo = screen.getByRole("group", { name: "Alterações autorizadas" });
      expect(selo).toHaveClass("selo-de-autorizacao");
      expect(selo.closest(".linha-do-composer")).not.toBeNull();
      expect(selo).toHaveAttribute(
        "title",
        "Alterações autorizadas até o /clear: o chat edita arquivos e roda comandos sem perguntar",
      );
      // Sem o selo de texto em caixa alta: o ícone e o ✕ (que fica acessível pelo foco e pelo mouse).
      expect(selo.querySelector("svg")).not.toBeNull();
      expect(selo).toHaveTextContent(/^✕$/);
      expect(screen.queryByText("alterações autorizadas")).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Revogar a autorização de alterações" }));
      await waitFor(() => expect(revogar).toHaveBeenCalledWith(false));

      // O evento `autorizacao_revogada` (ou o `/clear`) zera o estado: o indicador some.
      rerender({ ...OCIOSO, alteracoesAutorizadas: false });
      expect(screen.queryByRole("group", { name: "Alterações autorizadas" })).not.toBeInTheDocument();
    });

    it("o ✕ do indicador é alcançável pelo teclado", () => {
      renderizar({ ...OCIOSO, alteracoesAutorizadas: true });

      const revogar = screen.getByRole("button", { name: "Revogar a autorização de alterações" });
      expect(revogar).not.toBeDisabled();
      act(() => revogar.focus());
      expect(revogar).toHaveFocus();
    });

    it("falha ao revogar aparece no composer e o indicador continua", async () => {
      vi.spyOn(api, "autorizarAlteracoesDoChat").mockRejectedValue(new Error("fora do ar"));
      renderizar({ ...OCIOSO, alteracoesAutorizadas: true });

      fireEvent.click(screen.getByRole("button", { name: "Revogar a autorização de alterações" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível revogar a autorização: fora do ar");
      expect(screen.getByRole("group", { name: "Alterações autorizadas" })).toBeInTheDocument();
    });

    it("a atividade descreve edições e comandos", () => {
      const { rerender } = renderizar({
        ...RESPONDENDO,
        atividade: { mensagemId: "c1", ferramenta: "Edit", detalhe: "src/x.ts" },
      });
      expect(screen.getByText(/editando src\/x\.ts…/)).toBeInTheDocument();

      rerender({ ...RESPONDENDO, atividade: { mensagemId: "c1", ferramenta: "PowerShell", detalhe: "npm test" } });
      expect(screen.getByText(/rodando: npm test…/)).toBeInTheDocument();
    });

    it("a atividade descreve a chamada de um subagente, com e sem detalhe", () => {
      const { rerender } = renderizar({
        ...RESPONDENDO,
        atividade: { mensagemId: "c1", ferramenta: "Agent", detalhe: "adhd-study-coach" },
      });
      expect(screen.getByText(/chamando o subagente adhd-study-coach…/)).toBeInTheDocument();

      rerender({ ...RESPONDENDO, atividade: { mensagemId: "c1", ferramenta: "Agent", detalhe: "" } });
      expect(screen.getByText(/chamando um subagente…/)).toBeInTheDocument();
      expect(screen.queryByText(/adhd-study-coach/)).not.toBeInTheDocument();
    });

    it("sem autorização não há indicador", () => {
      renderizar();
      expect(screen.queryByRole("group", { name: "Alterações autorizadas" })).not.toBeInTheDocument();
    });
  });

  describe("perguntas com opções", () => {
    const cartao = () => screen.queryByRole("group", { name: "Pergunta do Claude" });
    const PERGUNTANDO: EstadoDoChatNaTela = {
      ...OCIOSO,
      mensagens: [
        mensagem("u1", "usuario", { texto: "Crie o cadastro" }),
        mensagem("c1", "claude", {
          texto: "Antes, uma dúvida.",
          perguntas: [
            {
              pergunta: "Qual banco usar?",
              opcoes: [
                { rotulo: "PostgreSQL", descricao: "Relacional" },
                { rotulo: "SQLite", descricao: null },
              ],
              multipla: false,
            },
          ],
        }),
      ],
    };

    it("o clique numa opção responde pelo envio do chat", async () => {
      const perguntar = vi.spyOn(api, "perguntarNoChat").mockResolvedValue({ mensagemId: "c2" });
      renderizar(PERGUNTANDO);

      expect(cartao()).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "SQLite" }));

      await waitFor(() => expect(perguntar).toHaveBeenCalledWith("Qual banco usar? → SQLite", []));
      await waitFor(() => expect(screen.getByText(/· respondida/)).toBeInTheDocument());
    });

    it("com uma mensagem depois, o cartão fica travado como respondido", () => {
      renderizar({
        ...PERGUNTANDO,
        mensagens: [...PERGUNTANDO.mensagens, mensagem("u2", "usuario", { texto: "Qual banco usar? → SQLite" })],
      });

      expect(screen.getByText(/· respondida/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "SQLite" })).toBeDisabled();
    });

    it("durante uma resposta, as opções ficam desabilitadas", () => {
      const { rerender } = renderizar(PERGUNTANDO);
      expect(screen.getByRole("button", { name: "SQLite" })).toBeEnabled();

      rerender({ ...PERGUNTANDO, situacao: "respondendo" });
      expect(screen.getByRole("button", { name: "SQLite" })).toBeDisabled();
    });

    it("desconectado, as opções ficam desabilitadas", () => {
      renderizar(PERGUNTANDO, true);
      expect(screen.getByRole("button", { name: "SQLite" })).toBeDisabled();
    });

    it("o bloco cru da pergunta não aparece enquanto a resposta chega", () => {
      renderizar({
        ...OCIOSO,
        situacao: "respondendo",
        mensagens: [
          mensagem("u1", "usuario", { texto: "Crie o cadastro" }),
          mensagem("c1", "claude", {
            situacao: "respondendo",
            texto: "Antes, uma dúvida.\n\n```pergunta-do-app\n{\"perguntas\":[{\"pergunta\":\"Qual",
          }),
        ],
      });

      expect(screen.getByText("Antes, uma dúvida.")).toBeInTheDocument();
      expect(screen.queryByText(/pergunta-do-app/)).not.toBeInTheDocument();
      expect(cartao()).not.toBeInTheDocument();
    });
  });

  describe("melhorar o pedido (✨)", () => {
    const MELHORADO = {
      texto: "Qual é a diferença entre useMemo e useCallback no React 19?",
      uso: { entrada: 700, criacaoDeCache: 0, leituraDeCache: 0, saida: 40 },
      indiceDeCusto: 19_800,
      duracaoMs: 1500,
    };

    it("desabilitado com o campo vazio, com o Claude respondendo e com o servidor fora", () => {
      const { campo } = renderizar();
      expect(itemDoMenu("Melhorar o pedido")).toBeDisabled();
      fireEvent.change(campo, { target: { value: "usememo x usecallback" } });
      expect(itemDoMenu("Melhorar o pedido")).toBeEnabled();
    });

    it.each([
      ["respondendo", RESPONDENDO, false],
      ["desconectado", OCIOSO, true],
    ] as const)("%s: o botão fica desabilitado mesmo com texto", (_nome, chat, desconectado) => {
      const { campo } = renderizar(chat, desconectado);
      fireEvent.change(campo, { target: { value: "usememo x usecallback" } });
      expect(itemDoMenu("Melhorar o pedido")).toBeDisabled();
    });

    it("manda onde \"chat\" sem pasta, troca o texto sem enviar e editar tira o desfazer", async () => {
      const melhorar = vi.spyOn(api, "melhorarPrompt").mockResolvedValue(MELHORADO);
      const perguntar = vi.spyOn(api, "perguntarNoChat");
      const { campo } = renderizar();
      fireEvent.change(campo, { target: { value: "usememo x usecallback" } });

      fireEvent.click(itemDoMenu("Melhorar o pedido"));

      expect(melhorar).toHaveBeenCalledWith(
        { texto: "usememo x usecallback", onde: "chat" },
        expect.any(AbortSignal),
      );
      await waitFor(() => expect(campo).toHaveValue(MELHORADO.texto));
      expect(screen.getByRole("status")).toHaveTextContent("melhorado · ≈ índice 19,8 mil · desfazer");
      expect(perguntar).not.toHaveBeenCalled();

      fireEvent.change(campo, { target: { value: `${MELHORADO.texto} Com exemplo.` } });
      expect(screen.queryByRole("button", { name: "desfazer" })).not.toBeInTheDocument();
    });

    it("melhorando: o campo trava, Enter não envia e cancelar aborta", () => {
      let sinal: AbortSignal | undefined;
      vi.spyOn(api, "melhorarPrompt").mockImplementation((_dados, recebido) => {
        sinal = recebido;
        return new Promise(() => undefined);
      });
      const perguntar = vi.spyOn(api, "perguntarNoChat");
      const { campo } = renderizar();
      fireEvent.change(campo, { target: { value: "usememo x usecallback" } });

      fireEvent.click(itemDoMenu("Melhorar o pedido"));
      expect(campo).toHaveAttribute("readonly");
      fireEvent.keyDown(campo, { key: "Enter" });
      expect(perguntar).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Cancelar a melhoria do pedido" }));
      expect(sinal?.aborted).toBe(true);
      expect(campo).toHaveValue("usememo x usecallback");
    });
  });

  describe("fixo à esquerda", () => {
    beforeEach(() => localStorage.removeItem(CHAVE_DAS_PREFERENCIAS_DA_TELA));
    afterEach(() => localStorage.removeItem(CHAVE_DAS_PREFERENCIAS_DA_TELA));

    const CONVERSA: EstadoDoChatNaTela = {
      ...OCIOSO,
      mensagens: [
        mensagem("u1", "usuario", { texto: "Abra o painel" }),
        mensagem("c1", "claude", {
          texto: "Pronto, sugeri abrir.",
          acoes: [{ tipo: "abrir_orquestrador", projeto: "painel", pasta: "C:\\p\\painel", pedido: null }],
          perguntas: [
            { pergunta: "Qual banco usar?", opcoes: [{ rotulo: "SQLite", descricao: null }], multipla: false },
          ],
        }),
      ],
    };

    function renderizarFixo(chat: EstadoDoChatNaTela = CONVERSA, lado: "esquerda" | "direita" = "esquerda") {
      const aoAlternarFixo = vi.fn();
      const props = {
        desconectado: false,
        erroAoCarregar: null,
        aoMudarPreferencias: vi.fn(),
        aoAbrirTerminal: vi.fn(),
        temVagaPara: vi.fn().mockReturnValue(true),
        aoAtualizarOrquestradores: vi.fn().mockResolvedValue(undefined),
        orquestradores: [],
      };
      render(<ChatRapido chat={chat} {...props} fixo lado={lado} aoAlternarFixo={aoAlternarFixo} />);
      return { aoAlternarFixo };
    }

    it("vira um aside com as mensagens em bolhas, os cartões e o campo embaixo", () => {
      renderizarFixo();

      const lateral = screen.getByRole("complementary", { name: "Chat rápido" });
      expect(lateral.tagName).toBe("ASIDE");
      expect(lateral).toHaveClass("chat-rapido", "chat-lateral", "chat-lateral-esquerda");
      expect(screen.getByText("Abra o painel").closest(".mensagem-do-usuario")).not.toBeNull();
      expect(screen.getByText("Pronto, sugeri abrir.").closest(".mensagem-do-claude")).not.toBeNull();
      expect(screen.getByText("Abrir orquestrador em painel")).toBeInTheDocument();
      expect(screen.getByRole("group", { name: "Pergunta do Claude" })).toBeInTheDocument();
      const campo = screen.getByRole("textbox", { name: "Pergunta para o Claude" });
      expect(lateral).toContainElement(campo);
      expect(screen.getByTestId("composer-do-chat")).toContainElement(campo);
      expect(screen.getByRole("button", { name: "Anexar arquivos" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Modelo:/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Limpar conversa" })).toBeInTheDocument();
    });

    it("sem mensagens, a conversa continua à vista, com o convite", () => {
      renderizarFixo(OCIOSO);

      expect(screen.getByRole("region", { name: "Conversa com o Claude" })).toBeVisible();
      expect(screen.getByText(/a conversa aparece aqui/)).toBeInTheDocument();
    });

    it("o Esc não esconde a conversa da coluna; \"soltar embaixo\" desliga a preferência e deixa a conversa à vista", () => {
      const { aoAlternarFixo } = renderizarFixo();

      expect(screen.queryByRole("button", { name: "Fixar o chat à esquerda" })).not.toBeInTheDocument();
      fireEvent.keyDown(screen.getByRole("textbox", { name: "Pergunta para o Claude" }), { key: "Escape" });
      expect(screen.getByRole("region", { name: "Conversa com o Claude" })).toBeVisible();

      const soltar = screen.getByRole("button", { name: "Soltar embaixo" });
      // A dica diz para onde o chat vai; o botão é só o ícone.
      expect(soltar).toHaveTextContent("");
      expect(soltar).toHaveAttribute("title", expect.stringContaining("centro de baixo do canvas"));
      fireEvent.click(soltar);
      expect(aoAlternarFixo).toHaveBeenCalledWith(false);
    });

    it.each(["esquerda", "direita"] as const)(
      "%s: quatro botões de ícone no cabeçalho, na ordem limpar, mover, soltar e ocultar (o ocultar no canto direito)",
      (lado) => {
        renderizarFixo(CONVERSA, lado);

        const cabecalho = screen.getByRole("region", { name: "Conversa com o Claude" }).querySelector("header")!;
        const botoes = within(cabecalho).getAllByRole("button");
        expect(botoes.map((botao) => botao.getAttribute("aria-label"))).toEqual([
          "Limpar conversa",
          `Mover o chat para a ${lado === "esquerda" ? "direita" : "esquerda"}`,
          "Soltar embaixo",
          "Ocultar o chat",
        ]);
        for (const botao of botoes) {
          // No padrão dos botões das janelas, só ícone, com dica.
          expect(botao).toHaveClass("botao-do-no");
          expect(botao).toHaveTextContent("");
          expect(botao.querySelector("svg")).not.toBeNull();
          expect(botao).toHaveAttribute("title");
        }
        expect(botoes.at(-1)).toHaveAttribute("aria-label", "Ocultar o chat");
      },
    );

    it.each(["esquerda", "direita"] as const)("%s: ocultar sai da coluna e pede o chat oculto embaixo", (lado) => {
      const { aoAlternarFixo } = renderizarFixo(CONVERSA, lado);

      fireEvent.click(screen.getByRole("button", { name: "Ocultar o chat" }));
      expect(aoAlternarFixo).toHaveBeenCalledTimes(1);
      expect(aoAlternarFixo).toHaveBeenCalledWith(false, true);
    });

    it.each(["esquerda", "direita"] as const)("%s: soltar embaixo chama aoAlternarFixo(false) sem ocultar", (lado) => {
      const { aoAlternarFixo } = renderizarFixo(CONVERSA, lado);

      fireEvent.click(screen.getByRole("button", { name: "Soltar embaixo" }));
      expect(aoAlternarFixo).toHaveBeenCalledTimes(1);
      expect(aoAlternarFixo).toHaveBeenCalledWith(false);
    });

    it.each(["esquerda", "direita"] as const)("%s: limpar conversa pede ao servidor que limpe o chat", async (lado) => {
      const limpar = vi.spyOn(api, "limparChat").mockResolvedValue(null);
      renderizarFixo(CONVERSA, lado);

      fireEvent.click(screen.getByRole("button", { name: "Limpar conversa" }));
      await waitFor(() => expect(limpar).toHaveBeenCalledTimes(1));
    });

    it("limpar conversa fica desabilitado enquanto o Claude responde, com a dica do motivo", () => {
      const limpar = vi.spyOn(api, "limparChat").mockResolvedValue(null);
      renderizarFixo(RESPONDENDO);

      const botao = screen.getByRole("button", { name: "Limpar conversa" });
      expect(botao).toBeDisabled();
      expect(botao).toHaveAttribute("title", "Cancele a resposta antes de limpar.");
      fireEvent.click(botao);
      expect(limpar).not.toHaveBeenCalled();
    });

    it("mover para o outro lado troca a preferência do lado, nos dois sentidos, sem chamar aoAlternarFixo", () => {
      const esquerda = renderizarFixo(CONVERSA, "esquerda");
      fireEvent.click(screen.getByRole("button", { name: "Mover o chat para a direita" }));
      expect(JSON.parse(localStorage.getItem(CHAVE_DAS_PREFERENCIAS_DA_TELA) ?? "{}")).toMatchObject({
        ladoDoChatFixo: "direita",
      });
      expect(esquerda.aoAlternarFixo).not.toHaveBeenCalled();
      cleanup();

      renderizarFixo(CONVERSA, "direita");
      fireEvent.click(screen.getByRole("button", { name: "Mover o chat para a esquerda" }));
      expect(JSON.parse(localStorage.getItem(CHAVE_DAS_PREFERENCIAS_DA_TELA) ?? "{}")).toMatchObject({
        ladoDoChatFixo: "esquerda",
      });
    });

    it("sem aoAlternarFixo, a coluna só tem limpar e mover (sem soltar nem ocultar)", () => {
      render(
        <ChatRapido
          chat={CONVERSA}
          desconectado={false}
          erroAoCarregar={null}
          aoMudarPreferencias={vi.fn()}
          aoAbrirTerminal={vi.fn()}
          temVagaPara={vi.fn().mockReturnValue(true)}
          aoAtualizarOrquestradores={vi.fn().mockResolvedValue(undefined)}
          orquestradores={[]}
          fixo
        />,
      );

      expect(screen.getByRole("button", { name: "Limpar conversa" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Soltar embaixo" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Ocultar o chat" })).not.toBeInTheDocument();
    });

    it("o chat inferior montado com `comecaOculto` (o ocultar da coluna) mostra só o \"mostrar conversa\", que o reexibe embaixo", () => {
      render(
        <ChatRapido
          chat={CONVERSA}
          desconectado={false}
          erroAoCarregar={null}
          aoMudarPreferencias={vi.fn()}
          aoAbrirTerminal={vi.fn()}
          temVagaPara={vi.fn().mockReturnValue(true)}
          aoAtualizarOrquestradores={vi.fn().mockResolvedValue(undefined)}
          orquestradores={[]}
          aoAlternarFixo={vi.fn()}
          comecaOculto
        />,
      );

      expect(screen.queryByRole("complementary", { name: "Chat rápido" })).not.toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "Conversa com o Claude" })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /mostrar conversa/ }));
      expect(screen.getByRole("region", { name: "Conversa com o Claude" })).toBeVisible();
      expect(screen.getByRole("button", { name: "ocultar" })).toBeInTheDocument();
    });

    describe("alça de largura", () => {
      // O jsdom não tem PointerEvent: sem ele, o fireEvent manda um Event sem clientX nem pointerId.
      class EventoDePonteiroFalso extends MouseEvent {
        readonly pointerId: number;
        constructor(tipo: string, inicio: PointerEventInit = {}) {
          super(tipo, inicio);
          this.pointerId = inicio.pointerId ?? 0;
        }
      }
      beforeEach(() => vi.stubGlobal("PointerEvent", EventoDePonteiroFalso));
      afterEach(() => vi.unstubAllGlobals());

      function renderizarComAlca(largura = 360, lado: "esquerda" | "direita" = "esquerda") {
        const aoMudarLargura = vi.fn();
        const props = {
          desconectado: false,
          erroAoCarregar: null,
          aoMudarPreferencias: vi.fn(),
          aoAbrirTerminal: vi.fn(),
          temVagaPara: vi.fn().mockReturnValue(true),
          aoAtualizarOrquestradores: vi.fn().mockResolvedValue(undefined),
          orquestradores: [],
        };
        const resultado = render(
          <ChatRapido chat={CONVERSA} {...props} fixo lado={lado} largura={largura} aoMudarLargura={aoMudarLargura} />,
        );
        return {
          aoMudarLargura,
          alca: screen.getByRole("separator", { name: "Largura do chat" }),
          lateral: screen.getByRole("complementary", { name: "Chat rápido" }),
          rerender: (nova: number) =>
            resultado.rerender(
              <ChatRapido chat={CONVERSA} {...props} fixo lado={lado} largura={nova} aoMudarLargura={aoMudarLargura} />,
            ),
        };
      }

      it("fica na borda da coluna, com a largura dela e o intervalo no aria", () => {
        const { alca, lateral } = renderizarComAlca(420);

        expect(alca.parentElement).toBe(lateral);
        expect(lateral).toHaveStyle({ width: "420px" });
        expect(alca).toHaveAttribute("aria-orientation", "vertical");
        expect(alca).toHaveAttribute("aria-valuenow", "420");
        expect(alca).toHaveAttribute("aria-valuemin", "280");
        expect(alca).toHaveAttribute("aria-valuemax", "640");
        expect(alca).toHaveAttribute("tabindex", "0");
        expect(alca).toHaveClass("nodrag", "nopan", "nowheel");
      });

      it("sem aoMudarLargura ou flutuante, não há alça", () => {
        renderizarFixo();
        expect(screen.queryByRole("separator")).not.toBeInTheDocument();
      });

      it("teclado: setas mudam 16 px, Home e End vão ao mínimo e ao máximo; cada uma grava", () => {
        const { alca, aoMudarLargura, rerender } = renderizarComAlca(400);

        fireEvent.keyDown(alca, { key: "ArrowRight" });
        expect(aoMudarLargura).toHaveBeenLastCalledWith(416);
        fireEvent.keyDown(alca, { key: "ArrowLeft" });
        expect(aoMudarLargura).toHaveBeenLastCalledWith(384);
        fireEvent.keyDown(alca, { key: "Home" });
        expect(aoMudarLargura).toHaveBeenLastCalledWith(280);
        fireEvent.keyDown(alca, { key: "End" });
        expect(aoMudarLargura).toHaveBeenLastCalledWith(640);

        // No limite, a seta não grava de novo.
        rerender(280);
        aoMudarLargura.mockClear();
        fireEvent.keyDown(alca, { key: "ArrowLeft" });
        expect(aoMudarLargura).not.toHaveBeenCalled();
      });

      it("dois cliques voltam aos 360", () => {
        const { alca, aoMudarLargura } = renderizarComAlca(520);

        fireEvent.doubleClick(alca);

        expect(aoMudarLargura).toHaveBeenCalledWith(360);
      });

      it("arrastar muda a largura ao vivo, limitada ao intervalo, e só grava ao soltar", () => {
        const { alca, lateral, aoMudarLargura } = renderizarComAlca(360);

        fireEvent.pointerDown(alca, { pointerId: 1, button: 0, clientX: 360 });
        expect(document.body).toHaveClass("redimensionando-chat-lateral");
        fireEvent.pointerMove(alca, { pointerId: 1, clientX: 400 });
        fireEvent.pointerMove(alca, { pointerId: 1, clientX: 460 });

        expect(lateral).toHaveStyle({ width: "460px" });
        expect(alca).toHaveAttribute("aria-valuenow", "460");
        expect(alca).toHaveClass("alca-arrastando");
        expect(aoMudarLargura).not.toHaveBeenCalled();

        // Passa do máximo: para nos 640.
        fireEvent.pointerMove(alca, { pointerId: 1, clientX: 2000 });
        expect(lateral).toHaveStyle({ width: "640px" });

        fireEvent.pointerMove(alca, { pointerId: 1, clientX: 500 });
        fireEvent.pointerUp(alca, { pointerId: 1, clientX: 500 });

        expect(aoMudarLargura).toHaveBeenCalledTimes(1);
        expect(aoMudarLargura).toHaveBeenCalledWith(500);
        expect(document.body).not.toHaveClass("redimensionando-chat-lateral");
        expect(alca).not.toHaveClass("alca-arrastando");
      });

      it("não deixa o canvas com menos de 360 px: a linha estreita limita o máximo", () => {
        const { alca, lateral, aoMudarLargura } = renderizarComAlca(360);
        vi.spyOn(lateral.parentElement!, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 900, 600));

        fireEvent.pointerDown(alca, { pointerId: 1, button: 0, clientX: 360 });
        fireEvent.pointerMove(alca, { pointerId: 1, clientX: 800 });
        fireEvent.pointerUp(alca, { pointerId: 1, clientX: 800 });

        expect(aoMudarLargura).toHaveBeenCalledWith(540);
      });

      it("à direita: a coluna e a alça marcam o lado, e o arraste e as setas se invertem (a borda vai para a esquerda e a coluna alarga)", () => {
        const { alca, lateral, aoMudarLargura } = renderizarComAlca(400, "direita");

        expect(lateral).toHaveClass("chat-lateral", "chat-lateral-direita");
        expect(alca).toHaveClass("alca-do-chat-lateral", "alca-do-chat-lateral-direita");

        fireEvent.keyDown(alca, { key: "ArrowLeft" });
        expect(aoMudarLargura).toHaveBeenLastCalledWith(416);
        fireEvent.keyDown(alca, { key: "ArrowRight" });
        expect(aoMudarLargura).toHaveBeenLastCalledWith(384);

        aoMudarLargura.mockClear();
        fireEvent.pointerDown(alca, { pointerId: 1, button: 0, clientX: 900 });
        fireEvent.pointerMove(alca, { pointerId: 1, clientX: 840 });
        expect(lateral).toHaveStyle({ width: "460px" });
        fireEvent.pointerMove(alca, { pointerId: 1, clientX: 950 });
        expect(lateral).toHaveStyle({ width: "350px" });
        fireEvent.pointerUp(alca, { pointerId: 1, clientX: 950 });
        expect(aoMudarLargura).toHaveBeenCalledWith(350);
      });

      it("um clique sem mover não grava; cancelar o arraste devolve a largura de antes", () => {
        const { alca, lateral, aoMudarLargura } = renderizarComAlca(400);

        fireEvent.pointerDown(alca, { pointerId: 1, button: 0, clientX: 400 });
        fireEvent.pointerUp(alca, { pointerId: 1, clientX: 400 });
        expect(aoMudarLargura).not.toHaveBeenCalled();

        fireEvent.pointerDown(alca, { pointerId: 2, button: 0, clientX: 400 });
        fireEvent.pointerMove(alca, { pointerId: 2, clientX: 300 });
        expect(lateral).toHaveStyle({ width: "300px" });
        fireEvent.pointerCancel(alca, { pointerId: 2 });

        expect(lateral).toHaveStyle({ width: "400px" });
        expect(aoMudarLargura).not.toHaveBeenCalled();
      });
    });

    it("flutuante, o fixar fica no menu ⋯ no fim da barra, depois do enviar (e o cabeçalho tem o ocultar)", () => {
      const aoAlternarFixo = vi.fn();
      render(
        <ChatRapido
          chat={CONVERSA}
          desconectado={false}
          erroAoCarregar={null}
          aoMudarPreferencias={vi.fn()}
          aoAbrirTerminal={vi.fn()}
          temVagaPara={vi.fn().mockReturnValue(true)}
          aoAtualizarOrquestradores={vi.fn().mockResolvedValue(undefined)}
          orquestradores={[]}
          aoAlternarFixo={aoAlternarFixo}
        />,
      );

      expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "ocultar" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Soltar embaixo" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Mover o chat para a direita" })).not.toBeInTheDocument();
      const fixar = itemDoMenu("Fixar o chat à esquerda");
      // O menu ⋯ fica no fim da linha da barra (depois do enviar), e não no cabeçalho da conversa.
      const gatilho = screen.getByRole("button", { name: "Mais ações" });
      expect(gatilho.closest(".linha-do-composer")).not.toBeNull();
      expect(gatilho.closest("header")).toBeNull();
      expect(
        Boolean(screen.getByRole("button", { name: "enviar ⏎" }).compareDocumentPosition(gatilho) & Node.DOCUMENT_POSITION_FOLLOWING),
      ).toBe(true);
      fireEvent.click(fixar);
      expect(aoAlternarFixo).toHaveBeenCalledWith(true);
      // Escolher fecha o menu.
      expect(screen.queryByRole("menu", { name: "Mais ações" })).not.toBeInTheDocument();
    });

    it("flutuante com o lado direita, o botão de fixar diz à direita", () => {
      render(
        <ChatRapido
          chat={CONVERSA}
          desconectado={false}
          erroAoCarregar={null}
          aoMudarPreferencias={vi.fn()}
          aoAbrirTerminal={vi.fn()}
          temVagaPara={vi.fn().mockReturnValue(true)}
          aoAtualizarOrquestradores={vi.fn().mockResolvedValue(undefined)}
          orquestradores={[]}
          lado="direita"
          aoAlternarFixo={vi.fn()}
        />,
      );

      expect(itemDoMenu("Fixar o chat à direita")).toHaveAttribute(
        "title",
        "Fixar o chat à direita: uma coluna ao lado do canvas, sempre aberta",
      );
    });
  });
});

describe("ChatRapido · acesso rápido", () => {
  // O jsdom não tem PointerEvent: sem ele, o fireEvent manda um Event sem clientX nem pointerId.
  class EventoDePonteiroFalso extends MouseEvent {
    readonly pointerId: number;
    constructor(tipo: string, inicio: PointerEventInit = {}) {
      super(tipo, inicio);
      this.pointerId = inicio.pointerId ?? 0;
    }
  }
  beforeEach(() => vi.stubGlobal("PointerEvent", EventoDePonteiroFalso));
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  const COM_MENSAGEM: EstadoDoChatNaTela = { ...OCIOSO, mensagens: [mensagem("u1", "usuario", { texto: "Oi" })] };
  const guardado = () => JSON.parse(localStorage.getItem(CHAVE_DAS_PREFERENCIAS_DA_TELA) ?? "{}") as { alturaDaConversaDoChat?: number | null };

  it("o pedido de foco (Ctrl+J, paleta) mostra a conversa oculta e leva o cursor ao campo", () => {
    const { campo } = renderizar(COM_MENSAGEM);
    fireEvent.click(screen.getByRole("button", { name: "ocultar" }));
    expect(screen.getByRole("button", { name: /mostrar conversa/ })).toBeInTheDocument();
    expect(campo).not.toHaveFocus();

    act(() => pedirFocoDoChat());

    expect(campo).toHaveFocus();
    expect(screen.getByRole("region", { name: "Conversa com o Claude" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /mostrar conversa/ })).not.toBeInTheDocument();
  });

  it("o menu ⋯ abre pelo teclado, anda com as setas e o Esc fecha devolvendo o foco ao botão", () => {
    renderizar();
    const gatilho = screen.getByRole("button", { name: "Mais ações" });
    expect(gatilho).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu", { name: "Mais ações" })).not.toBeInTheDocument();

    fireEvent.keyDown(gatilho, { key: "ArrowDown" });
    expect(gatilho).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menu", { name: "Mais ações" })).toBeInTheDocument();

    // O "melhorar" está desabilitado com o campo vazio: o foco vai ao primeiro item habilitado, se houver; sem ele, fica no botão.
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Mais ações" })).not.toBeInTheDocument();
    expect(gatilho).toHaveFocus();
  });

  it("com texto no campo, o foco entra no primeiro item e as setas circulam entre os itens habilitados", () => {
    const aoAlternarFixo = vi.fn();
    render(
      <ChatRapido
        chat={OCIOSO}
        desconectado={false}
        erroAoCarregar={null}
        aoMudarPreferencias={vi.fn()}
        aoAbrirTerminal={vi.fn()}
        temVagaPara={vi.fn()}
        aoAtualizarOrquestradores={vi.fn()}
        orquestradores={[]}
        aoAlternarFixo={aoAlternarFixo}
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Pergunta para o Claude" }), { target: { value: "oi" } });
    fireEvent.click(screen.getByRole("button", { name: "Mais ações" }));
    const melhorar = screen.getByRole("menuitem", { name: "Melhorar o pedido" });
    const fixar = screen.getByRole("menuitem", { name: "Fixar o chat à esquerda" });
    expect(melhorar).toHaveFocus();

    fireEvent.keyDown(melhorar, { key: "ArrowDown" });
    expect(fixar).toHaveFocus();
    fireEvent.keyDown(fixar, { key: "ArrowDown" });
    expect(melhorar).toHaveFocus();
    fireEvent.keyDown(melhorar, { key: "ArrowUp" });
    expect(fixar).toHaveFocus();
  });

  it("clicar fora fecha o menu ⋯", () => {
    renderizar();
    fireEvent.click(screen.getByRole("button", { name: "Mais ações" }));
    expect(screen.getByRole("menu", { name: "Mais ações" })).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu", { name: "Mais ações" })).not.toBeInTheDocument();
  });

  it("a alça do topo da conversa muda a altura (subir alonga), grava ao soltar e dois cliques voltam ao padrão", () => {
    renderizar(COM_MENSAGEM);
    const conversa = screen.getByRole("region", { name: "Conversa com o Claude" });
    const alca = screen.getByRole("separator", { name: "Altura da conversa" });
    // Sem preferência, vale o 36vh do CSS.
    expect(conversa.style.maxHeight).toBe("");

    const inicio = Number(alca.getAttribute("aria-valuenow"));
    fireEvent.pointerDown(alca, { button: 0, pointerId: 1, clientX: 0, clientY: 500 });
    fireEvent.pointerMove(alca, { pointerId: 1, clientX: 0, clientY: 400 });
    expect(conversa.style.maxHeight).toBe(`${inicio + 100}px`);
    // Ainda não gravou: só ao soltar.
    expect(guardado().alturaDaConversaDoChat).toBeUndefined();
    fireEvent.pointerUp(alca, { pointerId: 1 });
    expect(guardado().alturaDaConversaDoChat).toBe(inicio + 100);
    expect(conversa.style.maxHeight).toBe(`${inicio + 100}px`);

    fireEvent.doubleClick(alca);
    expect(guardado().alturaDaConversaDoChat).toBeNull();
    expect(conversa.style.maxHeight).toBe("");
  });

  it("as setas da alça mudam a altura de 24 em 24 px, nunca abaixo de 120 nem acima de 85% da janela", () => {
    renderizar(COM_MENSAGEM);
    const alca = screen.getByRole("separator", { name: "Altura da conversa" });
    const inicio = Number(alca.getAttribute("aria-valuenow"));
    fireEvent.keyDown(alca, { key: "ArrowUp" });
    expect(guardado().alturaDaConversaDoChat).toBe(inicio + 24);
    for (let i = 0; i < 80; i += 1) fireEvent.keyDown(alca, { key: "ArrowDown" });
    expect(guardado().alturaDaConversaDoChat).toBe(120);
    for (let i = 0; i < 80; i += 1) fireEvent.keyDown(alca, { key: "ArrowUp" });
    expect(guardado().alturaDaConversaDoChat).toBeLessThanOrEqual(Math.round(window.innerHeight * 0.85));
  });

  it("a coluna fixa não tem a alça de altura da conversa", () => {
    render(
      <ChatRapido
        chat={COM_MENSAGEM}
        desconectado={false}
        erroAoCarregar={null}
        aoMudarPreferencias={vi.fn()}
        aoAbrirTerminal={vi.fn()}
        temVagaPara={vi.fn()}
        aoAtualizarOrquestradores={vi.fn()}
        orquestradores={[]}
        fixo
      />,
    );
    expect(screen.queryByRole("separator", { name: "Altura da conversa" })).not.toBeInTheDocument();
  });
});

describe("ChatRapido · bolhas", () => {
  afterEach(() => vi.restoreAllMocks());

  it("cada bolha mostra a hora; a data só aparece quando a mensagem não é de hoje", () => {
    const agora = new Date();
    const hoje = agora.toISOString();
    const horaDeHoje = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(agora);
    renderizar({
      ...OCIOSO,
      mensagens: [
        mensagem("u1", "usuario", { texto: "Bom dia", criadaEm: hoje }),
        mensagem("c1", "claude", {
          texto: "Olá!",
          criadaEm: hoje,
          uso: { duracaoMs: 12_000, tokensDeEntrada: 1, tokensDeSaida: 1, modeloUsado: "claude-opus-5-5" },
        }),
        mensagem("u2", "usuario", { texto: "De antes", criadaEm: "2026-11-04T12:00:00Z" }),
      ],
    });

    const horas = Array.from(document.querySelectorAll("time.hora-da-mensagem"));
    expect(horas.map((hora) => hora.textContent)).toEqual([
      horaDeHoje,
      horaDeHoje,
      new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(
        new Date("2026-11-04T12:00:00Z"),
      ),
    ]);
    expect(horas[2]?.textContent).toContain("04/11");
    expect(horas[0]).toHaveAttribute("datetime", hoje);
    expect(horas[0]?.closest(".mensagem-do-usuario")).toHaveTextContent("Bom dia");
    // Na resposta, a hora fica no pé, junto da duração e do modelo.
    const rodape = horas[1]?.closest(".rodape-da-mensagem");
    expect(rodape?.closest(".mensagem-do-claude")).not.toBeNull();
    expect(rodape).toHaveTextContent("12s · claude-opus-5-5");
  });

  it("sem data legível (dado antigo), a bolha fica sem hora, sem quebrar", () => {
    renderizar({ ...OCIOSO, mensagens: [mensagem("u1", "usuario", { texto: "oi", criadaEm: "" })] });

    expect(screen.getByText("oi")).toBeInTheDocument();
    expect(document.querySelector("time.hora-da-mensagem")).toBeNull();
  });

  it("a resposta tem tabela e bloco de código com o botão copiar", () => {
    renderizar({
      ...OCIOSO,
      mensagens: [
        mensagem("c1", "claude", {
          texto: ["| Item | Valor |", "|---|---|", "| a | 1 |", "", "```sh", "npm test", "```"].join("\n"),
        }),
      ],
    });

    const resposta = document.querySelector(".mensagem-do-claude") as HTMLElement;
    expect(within(resposta).getByRole("table")).toBeInTheDocument();
    expect(within(resposta).getAllByRole("columnheader").map((celula) => celula.textContent)).toEqual(["Item", "Valor"]);
    const copiar = within(resposta).getByRole("button", { name: "copiar" });
    expect(copiar.closest(".faixa-do-codigo")).toHaveTextContent("sh");
  });

  it("o documento anexado aparece como etiqueta que baixa o arquivo com o nome original; sem miniatura", () => {
    renderizar({
      ...OCIOSO,
      mensagens: [
        mensagem("u1", "usuario", {
          texto: "Resuma",
          anexos: [
            {
              arquivo: "d1.pdf",
              nome: "Relatório 2026.pdf",
              tipoDeMidia: "application/pdf",
              categoria: "documento",
              tamanhoEmBytes: 2 * 1024 * 1024,
            },
            { arquivo: "d2.xls", nome: "base.xls", tipoDeMidia: "application/vnd.ms-excel", categoria: "documento" },
          ],
        }),
      ],
    });

    const pdf = screen.getByRole("link", { name: /Relatório 2026\.pdf/ });
    expect(pdf).toHaveAttribute("href", "/api/chat/anexos/d1.pdf");
    expect(pdf).toHaveAttribute("download", "Relatório 2026.pdf");
    expect(pdf).toHaveTextContent("PDF · 2 MB");
    // O formato antigo leva o selo de aviso.
    const antigo = screen.getByRole("link", { name: /base\.xls/ });
    expect(antigo).toHaveAttribute("download", "base.xls");
    expect(antigo).toHaveTextContent("Excel (formato antigo)");
    expect(screen.queryByRole("button", { name: /Ampliar/ })).not.toBeInTheDocument();
    expect(screen.queryAllByRole("img")).toHaveLength(0);
  });

  it("anexos de imagem e de documento convivem na mensagem; só a imagem amplia", () => {
    renderizar({
      ...OCIOSO,
      mensagens: [
        mensagem("u1", "usuario", {
          texto: "Veja",
          anexos: [
            { arquivo: "b.png", nome: "foto.png", tipoDeMidia: "image/png", categoria: "imagem" },
            { arquivo: "d1.docx", nome: "ata.docx", tipoDeMidia: "application/octet-stream", categoria: "documento" },
          ],
        }),
      ],
    });

    expect(screen.getByRole("button", { name: "Ampliar foto.png" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /ata\.docx/ })).toHaveAttribute("download", "ata.docx");
  });

  it("a imagem anexada aparece como miniatura; o clique a abre maior, e Esc fecha", () => {
    renderizar({
      ...OCIOSO,
      mensagens: [
        mensagem("u1", "usuario", {
          texto: "Veja",
          anexos: [{ arquivo: "b.png", nome: "foto.png", tipoDeMidia: "image/png", categoria: "imagem" }],
        }),
      ],
    });

    const miniatura = screen.getByRole("button", { name: "Ampliar foto.png" });
    expect(within(miniatura).getByAltText("foto.png")).toHaveAttribute("src", "/api/chat/anexos/b.png");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(miniatura);
    const ampliada = screen.getByRole("dialog", { name: "foto.png" });
    expect(within(ampliada).getByAltText("foto.png")).toHaveAttribute("src", "/api/chat/anexos/b.png");
    expect(within(ampliada).getByRole("button", { name: "Fechar" })).toHaveFocus();

    fireEvent.keyDown(ampliada, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(miniatura);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Fechar" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a resposta pronta se arrasta com o texto dela (sem os blocos do app); a que ainda chega, não", () => {
    const { rerender } = renderizar({
      ...OCIOSO,
      mensagens: [
        mensagem("c1", "claude", {
          texto: "Resumo **pronto**.\n\n```acao-do-app\n{\"tipo\":\"abrir_orquestrador\"}\n```",
        }),
      ],
    });

    const alca = screen.getByTitle(/Arraste para o canvas/);
    expect(alca).toHaveAttribute("draggable", "true");
    const setData = vi.fn();
    const dataTransfer = { setData, effectAllowed: "all" };
    fireEvent.dragStart(alca, { dataTransfer });
    expect(setData).toHaveBeenCalledWith(TIPO_DA_RESPOSTA_DO_CHAT, "Resumo **pronto**.");
    expect(setData).toHaveBeenCalledWith("text/plain", "Resumo **pronto**.");
    expect(dataTransfer.effectAllowed).toBe("copy");

    rerender({ ...RESPONDENDO });
    expect(screen.queryByTitle(/Arraste para o canvas/)).not.toBeInTheDocument();
  });

  it("solta sobre o próprio chat, a resposta arrastada não é aceita nem vira anexo", () => {
    renderizar({ ...OCIOSO, mensagens: [mensagem("c1", "claude", { texto: "Olá" })] });
    const chat = screen.getByTestId("chat-rapido");

    const aceito = !fireEvent.dragOver(chat, { dataTransfer: { types: [TIPO_DA_RESPOSTA_DO_CHAT, "text/plain"] } });

    expect(aceito).toBe(false);
    expect(screen.queryByText(/solte para anexar/)).not.toBeInTheDocument();
  });
});
