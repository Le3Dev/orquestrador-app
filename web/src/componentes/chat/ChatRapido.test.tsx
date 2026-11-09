import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { api } from "../../shared/api/cliente";
import type { MensagemDoChat } from "../../shared/api/tipos";
import type { FaseDoDitado } from "../../shared/ditado/useDitado";
import {
  ESTADO_INICIAL_DO_CHAT,
  type EstadoDoChatNaTela,
  type MensagemDoChatNaTela,
} from "../../shared/estado/aplicarEventoDoChat";
import { ChatRapido, TIPO_DA_RESPOSTA_DO_CHAT } from "./ChatRapido";

/** O ditado sem microfone nem Whisper: o clique alterna a gravação e o teste entrega o texto transcrito. */
const ditadoFalso = vi.hoisted(() => ({ entregar: null as ((texto: string) => void) | null }));
vi.mock("../../shared/ditado/useDitado", async () => {
  const { useState } = await import("react");
  return {
    useDitado: (aoTranscrever: (texto: string) => void) => {
      const [fase, setFase] = useState<FaseDoDitado>("parado");
      ditadoFalso.entregar = aoTranscrever;
      return {
        fase,
        baixando: null,
        erro: null,
        alternar: () => setFase((atual) => (atual === "gravando" ? "parado" : "gravando")),
        descartar: () => setFase("parado"),
        fecharErro: () => undefined,
      };
    },
  };
});

function mensagem(
  id: string,
  papel: MensagemDoChat["papel"],
  alteracoes: Partial<MensagemDoChatNaTela> = {},
): MensagemDoChatNaTela {
  return {
    id,
    papel,
    texto: "",
    imagens: [],
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

  function ponteAtiva(capturarTela = vi.fn().mockResolvedValue(FOTO)) {
    let ouvinte: ((ativo: boolean) => void) | null = null;
    const modoInvisivel = {
      entrar: vi.fn(),
      sair: vi.fn(),
      capturarMouse: vi.fn().mockResolvedValue(undefined),
      capturarTela,
      aoMudar: vi.fn((callback: (ativo: boolean) => void) => {
        ouvinte = callback;
        return () => undefined;
      }),
    };
    janelaComPonte.electron = { desktop: true, janela: {}, modoInvisivel };
    return { modoInvisivel, ativar: () => act(() => ouvinte?.(true)) };
  }

  it("ativo, fotografa a tela a cada pergunta e a anexa; o composer avisa que a tela vai junto", async () => {
    const perguntar = vi.spyOn(api, "perguntarNoChat").mockResolvedValue({ mensagemId: "m1" });
    const { modoInvisivel, ativar } = ponteAtiva();
    const { campo } = renderizar();

    expect(screen.queryByText(/a tela vai junto/)).not.toBeInTheDocument();
    ativar();
    expect(screen.getByText(/a tela vai junto/)).toBeInTheDocument();
    expect(screen.getByTestId("faixa-modo-invisivel")).toHaveTextContent("Tela sendo vista");

    fireEvent.change(campo, { target: { value: "O que é isso?" } });
    fireEvent.keyDown(campo, { key: "Enter" });
    await waitFor(() => expect(perguntar).toHaveBeenCalledTimes(1));
    expect(perguntar).toHaveBeenCalledWith("O que é isso?", [FOTO]);

    fireEvent.change(campo, { target: { value: "E agora?" } });
    fireEvent.keyDown(campo, { key: "Enter" });
    await waitFor(() => expect(perguntar).toHaveBeenCalledTimes(2));
    expect(modoInvisivel.capturarTela).toHaveBeenCalledTimes(2);
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
    const CAPTURA = { arquivo: "a.jpg", nome: "tela-2026-11-07T10-00-00-000Z.jpg" };
    const MANUAL = { arquivo: "b.png", nome: "foto.png" };
    const chatComImagens = (imagens: unknown[]): EstadoDoChatNaTela => ({
      ...OCIOSO,
      mensagens: [
        mensagem("u1", "usuario", {
          texto: "Veja",
          imagens: imagens as MensagemDoChatNaTela["imagens"],
        }),
      ],
    });

    it("ativo, esconde a captura de tela e mantém a imagem manual", () => {
      const { ativar } = ponteAtiva();
      renderizar(chatComImagens([CAPTURA, MANUAL]));
      expect(screen.getByAltText(CAPTURA.nome)).toBeInTheDocument();
      ativar();
      expect(screen.queryByAltText(CAPTURA.nome)).not.toBeInTheDocument();
      expect(screen.getByAltText(MANUAL.nome)).toBeInTheDocument();
    });

    it("ativo, sem imagens visíveis não renderiza o contêiner", () => {
      const { ativar } = ponteAtiva();
      renderizar(chatComImagens([CAPTURA]));
      ativar();
      expect(document.querySelector(".anexos-do-chat")).toBeNull();
    });

    it("fora do modo, a captura aparece", () => {
      ponteAtiva();
      renderizar(chatComImagens([CAPTURA]));
      expect(screen.getByAltText(CAPTURA.nome)).toBeInTheDocument();
    });
  });

  it("o 👁 fica na linha de baixo do composer, entra no modo e some quando ativo", async () => {
    const { modoInvisivel, ativar } = ponteAtiva();
    renderizar();

    const botao = screen.getByRole("button", { name: "Modo invisível" });
    expect(botao).toHaveAttribute("title", expect.stringContaining("Modo invisível"));
    expect(botao.closest(".linha-do-composer")).not.toBeNull();
    fireEvent.click(botao);
    await waitFor(() => expect(modoInvisivel.entrar).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(modoInvisivel.capturarMouse).toHaveBeenCalledWith(true));

    ativar();
    expect(screen.queryByRole("button", { name: "Modo invisível" })).not.toBeInTheDocument();
  });

  it("sem a ponte do modo invisível (navegador), não desenha o 👁", () => {
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

  it("ativo, o indicador e o botão de voltar ficam dentro do chat; clicar sai do modo", () => {
    const { modoInvisivel, ativar } = ponteAtiva();
    renderizar();
    expect(screen.queryByRole("button", { name: "Voltar ao modo normal" })).not.toBeInTheDocument();
    ativar();

    const chat = screen.getByTestId("chat-rapido");
    expect(within(chat).getByText("Tela sendo vista")).toBeInTheDocument();
    fireEvent.click(within(chat).getByRole("button", { name: "Voltar ao modo normal" }));
    expect(modoInvisivel.sair).toHaveBeenCalledTimes(1);
  });

  it("ativo, se sair falhar, o erro aparece no chat", async () => {
    const { modoInvisivel, ativar } = ponteAtiva();
    modoInvisivel.sair.mockRejectedValue(new Error("janela ocupada"));
    renderizar();
    ativar();

    fireEvent.click(screen.getByRole("button", { name: "Voltar ao modo normal" }));
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
});

describe("ChatRapido", () => {
  afterEach(() => vi.restoreAllMocks());

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
    expect(screen.getByRole("button", { name: "mostrar conversa (2)" })).toBeInTheDocument();

    rerender({
      ...conversa,
      mensagens: [...conversa.mensagens, mensagem("u2", "usuario"), mensagem("c2", "claude", { texto: "Nova" })],
    });
    fireEvent.click(screen.getByRole("button", { name: /resposta nova · mostrar conversa/ }));
    expect(screen.getByText("Nova")).toBeVisible();
  });

  describe("composer compacto e expandido", () => {
    const composer = () => screen.getByTestId("composer-do-chat");

    it("começa compacto, numa linha só: +, campo, modelo e enviar", () => {
      renderizar();
      expect(composer()).toHaveClass("composer-compacto");
      expect(composer()).not.toHaveClass("composer-expandido");
      expect(screen.getByRole("button", { name: "Anexar imagens" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^Modelo:/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "enviar ⏎" })).toBeInTheDocument();
    });

    it("clicar no composer expande e leva o foco ao campo", () => {
      const { campo } = renderizar();
      fireEvent.click(composer());
      expect(campo).toHaveFocus();
      expect(composer()).toHaveClass("composer-expandido");
    });

    it("focar o campo (teclado) expande; perder o foco vazio recolhe", () => {
      const { campo } = renderizar();
      act(() => campo.focus());
      expect(composer()).toHaveClass("composer-expandido");
      act(() => campo.blur());
      expect(composer()).toHaveClass("composer-compacto");
    });

    it("foco indo para um botão do composer não recolhe", () => {
      const { campo } = renderizar();
      act(() => campo.focus());
      act(() => screen.getByRole("button", { name: "Anexar imagens" }).focus());
      expect(composer()).toHaveClass("composer-expandido");
    });

    it("com texto continua expandido mesmo sem foco", () => {
      const { campo } = renderizar();
      act(() => campo.focus());
      fireEvent.change(campo, { target: { value: "Oi" } });
      act(() => campo.blur());
      expect(composer()).toHaveClass("composer-expandido");
    });

    it("com imagem anexada continua expandido mesmo sem foco", async () => {
      const { campo } = renderizar();
      const imagem = new File(["png"], "tela.png", { type: "image/png" });
      fireEvent.paste(campo, { clipboardData: { files: [imagem] } });
      expect(await screen.findByRole("button", { name: "Remover tela.png" })).toBeInTheDocument();
      act(() => campo.blur());
      expect(composer()).toHaveClass("composer-expandido");
    });

    it("menu do modelo aberto não recolhe", () => {
      const { campo } = renderizar();
      fireEvent.click(screen.getByRole("button", { name: /^Modelo:/ }));
      expect(screen.getByRole("menu", { name: "Modelo do chat" })).toBeInTheDocument();
      act(() => campo.blur());
      expect(composer()).toHaveClass("composer-expandido");
    });

    it("Enter envia mesmo no compacto", async () => {
      const perguntar = vi.spyOn(api, "perguntarNoChat").mockResolvedValue({ mensagemId: "m1" });
      const { campo } = renderizar();
      expect(composer()).toHaveClass("composer-compacto");
      fireEvent.change(campo, { target: { value: "Oi" } });
      fireEvent.keyDown(campo, { key: "Enter" });
      expect(perguntar).toHaveBeenCalledWith("Oi", []);
      await waitFor(() => expect(composer()).toHaveClass("composer-compacto"));
    });
  });

  describe("ditado por voz", () => {
    const composer = () => screen.getByTestId("composer-do-chat");
    const microfone = () => screen.getByRole("button", { name: "Ditar a mensagem por voz" });

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

    it("gravando: o foco fica no microfone, o composer não recolhe e o Esc descarta sem ocultar a conversa", () => {
      renderizar({
        ...OCIOSO,
        mensagens: [mensagem("u1", "usuario", { texto: "oi" }), mensagem("c1", "claude", { texto: "Olá!" })],
      });
      expect(composer()).toHaveClass("composer-compacto");

      const botao = microfone();
      act(() => botao.focus());
      fireEvent.click(botao);
      expect(botao).toHaveFocus();
      expect(botao).toHaveAttribute("aria-pressed", "true");
      expect(composer()).toHaveClass("composer-expandido");

      // O foco sai do chat no meio da gravação: o composer continua expandido.
      act(() => botao.blur());
      expect(composer()).toHaveClass("composer-expandido");

      act(() => botao.focus());
      fireEvent.keyDown(botao, { key: "Escape" });
      expect(botao).toHaveAttribute("aria-pressed", "false");
      expect(screen.getByRole("region", { name: "Conversa com o Claude" })).toBeVisible();

      // Sem gravar, perder o foco vazio recolhe como antes.
      act(() => botao.blur());
      expect(composer()).toHaveClass("composer-compacto");
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

    it("o selo aparece com o chat autorizado, explica no title e o ✕ revoga", async () => {
      const revogar = vi.spyOn(api, "autorizarAlteracoesDoChat").mockResolvedValue({ autorizado: false });
      const { rerender } = renderizar({ ...OCIOSO, alteracoesAutorizadas: true });

      const selo = screen.getByText("alterações autorizadas");
      expect(selo).toHaveClass("selo-de-autorizacao");
      expect(selo).toHaveAttribute(
        "title",
        "Até o próximo /clear, o chat edita arquivos e roda comandos sem perguntar",
      );

      fireEvent.click(screen.getByRole("button", { name: "Revogar a autorização de alterações" }));
      await waitFor(() => expect(revogar).toHaveBeenCalledWith(false));

      // O evento `autorizacao_revogada` (ou o `/clear`) zera o estado: o selo some.
      rerender({ ...OCIOSO, alteracoesAutorizadas: false });
      expect(screen.queryByText("alterações autorizadas")).not.toBeInTheDocument();
    });

    it("falha ao revogar aparece no composer e o selo continua", async () => {
      vi.spyOn(api, "autorizarAlteracoesDoChat").mockRejectedValue(new Error("fora do ar"));
      renderizar({ ...OCIOSO, alteracoesAutorizadas: true });

      fireEvent.click(screen.getByRole("button", { name: "Revogar a autorização de alterações" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível revogar a autorização: fora do ar");
      expect(screen.getByText("alterações autorizadas")).toBeInTheDocument();
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

    it("sem autorização não há selo", () => {
      renderizar();
      expect(screen.queryByText("alterações autorizadas")).not.toBeInTheDocument();
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
      const botao = screen.getByRole("button", { name: "Melhorar o pedido" });
      expect(botao).toBeDisabled();
      fireEvent.change(campo, { target: { value: "usememo x usecallback" } });
      expect(botao).toBeEnabled();
    });

    it.each([
      ["respondendo", RESPONDENDO, false],
      ["desconectado", OCIOSO, true],
    ] as const)("%s: o botão fica desabilitado mesmo com texto", (_nome, chat, desconectado) => {
      const { campo } = renderizar(chat, desconectado);
      fireEvent.change(campo, { target: { value: "usememo x usecallback" } });
      expect(screen.getByRole("button", { name: "Melhorar o pedido" })).toBeDisabled();
    });

    it("manda onde \"chat\" sem pasta, troca o texto sem enviar e editar tira o desfazer", async () => {
      const melhorar = vi.spyOn(api, "melhorarPrompt").mockResolvedValue(MELHORADO);
      const perguntar = vi.spyOn(api, "perguntarNoChat");
      const { campo } = renderizar();
      fireEvent.change(campo, { target: { value: "usememo x usecallback" } });

      fireEvent.click(screen.getByRole("button", { name: "Melhorar o pedido" }));

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

      fireEvent.click(screen.getByRole("button", { name: "Melhorar o pedido" }));
      expect(campo).toHaveAttribute("readonly");
      fireEvent.keyDown(campo, { key: "Enter" });
      expect(perguntar).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Cancelar a melhoria do pedido" }));
      expect(sinal?.aborted).toBe(true);
      expect(campo).toHaveValue("usememo x usecallback");
    });
  });

  describe("fixo à esquerda", () => {
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

    function renderizarFixo(chat: EstadoDoChatNaTela = CONVERSA) {
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
      render(<ChatRapido chat={chat} {...props} fixo aoAlternarFixo={aoAlternarFixo} />);
      return { aoAlternarFixo };
    }

    it("vira um aside com as mensagens em bolhas, os cartões e o campo embaixo, sempre expandido", () => {
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
      expect(screen.getByTestId("composer-do-chat")).toHaveClass("composer-expandido");
      expect(screen.getByRole("button", { name: "Anexar imagens" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Modelo:/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "limpar" })).toBeInTheDocument();
    });

    it("sem mensagens, a conversa continua à vista, com o convite", () => {
      renderizarFixo(OCIOSO);

      expect(screen.getByRole("region", { name: "Conversa com o Claude" })).toBeVisible();
      expect(screen.getByText(/a conversa aparece aqui/)).toBeInTheDocument();
    });

    it("não oculta: sem o botão ocultar e o Esc não esconde a conversa; \"soltar\" desliga a preferência", () => {
      const { aoAlternarFixo } = renderizarFixo();

      expect(screen.queryByRole("button", { name: "ocultar" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Fixar o chat à esquerda" })).not.toBeInTheDocument();
      fireEvent.keyDown(screen.getByRole("textbox", { name: "Pergunta para o Claude" }), { key: "Escape" });
      expect(screen.getByRole("region", { name: "Conversa com o Claude" })).toBeVisible();

      fireEvent.click(screen.getByRole("button", { name: "Soltar o chat" }));
      expect(aoAlternarFixo).toHaveBeenCalledWith(false);
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

    it("flutuante, o cabeçalho tem o botão de fixar à esquerda (e o ocultar)", () => {
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
      fireEvent.click(screen.getByRole("button", { name: "Fixar o chat à esquerda" }));
      expect(aoAlternarFixo).toHaveBeenCalledWith(true);
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

      expect(screen.getByRole("button", { name: "Fixar o chat à direita" })).toHaveAttribute(
        "title",
        "Fixar o chat à direita: uma coluna ao lado do canvas, sempre aberta",
      );
    });
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

  it("a imagem anexada aparece como miniatura; o clique a abre maior, e Esc fecha", () => {
    renderizar({
      ...OCIOSO,
      mensagens: [mensagem("u1", "usuario", { texto: "Veja", imagens: [{ arquivo: "b.png", nome: "foto.png", tipoDeMidia: "image/png" }] })],
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
