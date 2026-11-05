import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { api } from "../../shared/api/cliente";
import type { MensagemDoChat } from "../../shared/api/tipos";
import {
  ESTADO_INICIAL_DO_CHAT,
  type EstadoDoChatNaTela,
  type MensagemDoChatNaTela,
} from "../../shared/estado/aplicarEventoDoChat";
import { ChatRapido } from "./ChatRapido";

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
  };
  const resultado = render(<ChatRapido chat={chat} {...props} />);
  return {
    ...props,
    campo: screen.getByRole("textbox", { name: "Pergunta para o Claude" }),
    rerender: (novo: EstadoDoChatNaTela) => resultado.rerender(<ChatRapido chat={novo} {...props} />),
  };
}

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
});
