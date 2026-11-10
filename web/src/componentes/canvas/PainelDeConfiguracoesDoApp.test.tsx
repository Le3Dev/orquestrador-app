import { act, fireEvent, render, screen, within } from "@testing-library/react";

import { api } from "../../shared/api/cliente";
import type { DadosDasPreferencias } from "../../shared/api/tipos";
import type { AjustesDoAplicativo } from "../../shared/hooks/useAjustesDoAplicativo";
import { esquecerAutorrecuperacao } from "../../shared/hooks/useAutorrecuperacao";
import { CHAVE_DAS_PREFERENCIAS_DA_TELA, usePreferenciasDaTela } from "../../shared/hooks/usePreferenciasDaTela";
import { PainelDeConfiguracoesDoApp } from "./PainelDeConfiguracoesDoApp";

/** Lê as preferências pelo hook, como outro componente da tela faria. */
function Leitor() {
  const { preferencias } = usePreferenciasDaTela();
  return <output data-testid="leitor">{JSON.stringify(preferencias)}</output>;
}

function ajustesFalsos(disponivel = true): AjustesDoAplicativo {
  return { disponivel, abrir: vi.fn().mockResolvedValue(undefined), erro: null, descartarErro: vi.fn() };
}

function renderizar(ajustes = ajustesFalsos()) {
  render(
    <>
      <input aria-label="Campo de fora" />
      <PainelDeConfiguracoesDoApp
        ajustes={ajustes}
        alinhamento="esquerda"
        classeDoBotao="btn btn-sm btn-outline"
        conteudoDoBotao="⚙ Configurações"
      />
      <Leitor />
    </>,
  );
  return ajustes;
}

const botao = () => screen.getByRole("button", { name: "Configurações" });
const lerLeitor = () => JSON.parse(screen.getByTestId("leitor").textContent ?? "") as Record<string, unknown>;

const preferencias = (autorrecuperacao: boolean): DadosDasPreferencias => ({
  instrucoesPadrao: "",
  subagentesProntos: [],
  autorrecuperacao,
});

describe("PainelDeConfiguracoesDoApp", () => {
  beforeEach(() => {
    esquecerAutorrecuperacao();
    // Por padrão a leitura feita ao abrir não termina (os testes da Tela não esperam por ela);
    // os da Autorrecuperação dizem o que o servidor responde.
    vi.spyOn(api, "lerPreferencias").mockReturnValue(new Promise<DadosDasPreferencias>(() => undefined));
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("abre ancorado no botão: seção Tela com os dois interruptores desligados, a dica do Visualizador e o foco no primeiro", () => {
    renderizar();
    expect(botao()).toHaveAttribute("aria-haspopup", "menu");
    expect(botao()).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(botao());

    const painel = screen.getByRole("menu", { name: "Configurações" });
    expect(botao()).toHaveAttribute("aria-expanded", "true");
    expect(botao()).toHaveAttribute("aria-controls", painel.id);
    expect(botao().parentElement).toContainElement(painel);
    expect(painel).toHaveClass("menu-do-novo", "painel-de-configuracoes", "painel-flutuante", "surgir", "surgir-do-topo");
    const tela = within(painel).getByRole("group", { name: "Tela" });
    const chat = within(tela).getByRole("menuitemcheckbox", { name: "Chat fixo" });
    const visualizador = within(tela).getByRole("menuitemcheckbox", { name: /Visualizador de código/ });
    expect(chat).toHaveAttribute("aria-checked", "false");
    expect(chat).toHaveAttribute("title", "O chat rápido vira uma coluna ao lado do canvas, sempre aberta");
    // Logo abaixo, o lado: esquerda escolhida por padrão.
    const lado = within(tela).getByRole("group", { name: "Lado" });
    expect(within(lado).getAllByRole("menuitemradio").map((item) => item.textContent)).toEqual(["esquerda", "direita"]);
    expect(within(lado).getByRole("menuitemradio", { name: "esquerda" })).toHaveAttribute("aria-checked", "true");
    expect(within(lado).getByRole("menuitemradio", { name: "direita" })).toHaveAttribute("aria-checked", "false");
    expect(visualizador).toHaveAttribute("aria-checked", "false");
    expect(visualizador).toHaveTextContent("mostra o botão Arquivos nos terminais");
    expect(chat).toHaveClass("item-do-menu", "interruptor");
    expect(chat.querySelector(".interruptor-trilho")).not.toBeNull();
    expect(chat).toHaveFocus();
    // Embaixo, separado da seção Tela.
    expect(within(painel).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Pastas e Claude Code…"]);
  });

  it("clicar liga o interruptor, grava a preferência e reflete em outro componente, sem fechar o painel", () => {
    renderizar();
    fireEvent.click(botao());

    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /Visualizador de código/ }));

    expect(screen.getByRole("menuitemcheckbox", { name: /Visualizador de código/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("menu", { name: "Configurações" })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(CHAVE_DAS_PREFERENCIAS_DA_TELA) ?? "null")).toMatchObject({
      chatFixoNaEsquerda: false,
      visualizadorDeCodigo: true,
    });
    expect(lerLeitor()).toMatchObject({ chatFixoNaEsquerda: false, visualizadorDeCodigo: true });

    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Chat fixo" }));
    expect(lerLeitor()).toMatchObject({ chatFixoNaEsquerda: true, visualizadorDeCodigo: true });
  });

  it("o lado do chat fixo: clicar escolhe, grava junto das outras e não fecha o painel; solto, fica apagado", () => {
    renderizar();
    fireEvent.click(botao());
    const grupo = () => screen.getByRole("group", { name: "Lado" });
    expect(grupo()).toHaveClass("lado-do-chat-solto");

    fireEvent.click(screen.getByRole("menuitemradio", { name: "direita" }));

    expect(screen.getByRole("menuitemradio", { name: "direita" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemradio", { name: "esquerda" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("menu", { name: "Configurações" })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(CHAVE_DAS_PREFERENCIAS_DA_TELA) ?? "null")).toEqual({
      chatFixoNaEsquerda: false,
      ladoDoChatFixo: "direita",
      visualizadorDeCodigo: false,
      larguraDoChatFixo: 360,
      manterBixinhosAteLimpar: false,
      minimapaVisivel: false,
      controlesDasJanelas: "automatico",
    });

    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Chat fixo" }));
    expect(grupo()).not.toHaveClass("lado-do-chat-solto");
    expect(lerLeitor()).toMatchObject({ chatFixoNaEsquerda: true, ladoDoChatFixo: "direita" });
  });

  it("\"Manter bixinhos até limpar à mão\": desligado por padrão, com a dica à vista; ligar grava a preferência", () => {
    renderizar();
    fireEvent.click(botao());
    const tela = within(screen.getByRole("menu", { name: "Configurações" })).getByRole("group", { name: "Tela" });
    const manter = within(tela).getByRole("menuitemcheckbox", { name: /Manter bixinhos até limpar à mão/ });
    expect(manter).toHaveAttribute("aria-checked", "false");
    expect(manter).toHaveTextContent("desligado, os que terminam saem sozinhos do canvas");

    fireEvent.click(manter);

    expect(manter).toHaveAttribute("aria-checked", "true");
    expect(lerLeitor()).toMatchObject({ manterBixinhosAteLimpar: true });
  });

  it("\"Controles das janelas\": três opções, Automático por padrão; escolher grava, reflete em outro componente e não fecha o painel", () => {
    renderizar();
    fireEvent.click(botao());
    const grupo = within(screen.getByRole("menu", { name: "Configurações" })).getByRole("group", { name: "Controles das janelas" });
    expect(within(grupo).getAllByRole("menuitemradio").map((item) => item.textContent)).toEqual([
      "Automático",
      "Estilo Mac",
      "Estilo Windows",
    ]);
    expect(within(grupo).getByRole("menuitemradio", { name: "Automático" })).toHaveAttribute("aria-checked", "true");
    expect(within(grupo).getByRole("menuitemradio", { name: "Estilo Mac" })).toHaveAttribute("aria-checked", "false");

    fireEvent.click(within(grupo).getByRole("menuitemradio", { name: "Estilo Windows" }));

    expect(within(grupo).getByRole("menuitemradio", { name: "Estilo Windows" })).toHaveAttribute("aria-checked", "true");
    expect(within(grupo).getByRole("menuitemradio", { name: "Automático" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("menu", { name: "Configurações" })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(CHAVE_DAS_PREFERENCIAS_DA_TELA) ?? "null")).toMatchObject({
      controlesDasJanelas: "windows",
    });
    expect(lerLeitor()).toMatchObject({ controlesDasJanelas: "windows" });

    fireEvent.click(within(grupo).getByRole("menuitemradio", { name: "Estilo Mac" }));
    expect(lerLeitor()).toMatchObject({ controlesDasJanelas: "mac" });
  });

  it("\"Pastas e Claude Code…\" fecha o painel e abre os Ajustes", () => {
    const ajustes = renderizar();
    fireEvent.click(botao());

    fireEvent.click(screen.getByRole("menuitem", { name: "Pastas e Claude Code…" }));

    expect(ajustes.abrir).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(botao()).toHaveFocus();
  });

  it("sem os Ajustes (navegador puro), só a seção Tela", () => {
    renderizar(ajustesFalsos(false));
    fireEvent.click(botao());

    expect(screen.getAllByRole("menuitemcheckbox")).toHaveLength(4);
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(5);
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
  });

  it("teclado como no \"+ Novo ▾\": ↓ abre e navega (com volta), Espaço/Enter alternam ou abrem os Ajustes; Esc fecha", () => {
    const ajustes = renderizar();
    fireEvent.keyDown(botao(), { key: "ArrowDown" });
    const chat = () => screen.getByRole("menuitemcheckbox", { name: "Chat fixo" });
    const visualizador = () => screen.getByRole("menuitemcheckbox", { name: /Visualizador de código/ });
    const autorrecuperacao = () => screen.getByRole("menuitemcheckbox", { name: /Autorrecuperação/ });
    const bixinhos = () => screen.getByRole("menuitemcheckbox", { name: /Manter bixinhos até limpar à mão/ });
    const pastas = () => screen.getByRole("menuitem", { name: "Pastas e Claude Code…" });
    const automatico = () => screen.getByRole("menuitemradio", { name: "Automático" });
    const estiloMac = () => screen.getByRole("menuitemradio", { name: "Estilo Mac" });
    const estiloWindows = () => screen.getByRole("menuitemradio", { name: "Estilo Windows" });
    const esquerda = () => screen.getByRole("menuitemradio", { name: "esquerda" });
    const direita = () => screen.getByRole("menuitemradio", { name: "direita" });
    expect(chat()).toHaveFocus();

    // Depois do "Chat fixo", os dois lados; Enter escolhe o focado.
    fireEvent.keyDown(chat(), { key: "ArrowDown" });
    expect(esquerda()).toHaveFocus();
    fireEvent.keyDown(esquerda(), { key: "ArrowDown" });
    expect(direita()).toHaveFocus();
    fireEvent.keyDown(direita(), { key: "Enter" });
    expect(direita()).toHaveAttribute("aria-checked", "true");
    expect(lerLeitor()).toMatchObject({ ladoDoChatFixo: "direita" });
    fireEvent.keyDown(direita(), { key: "ArrowUp" });
    fireEvent.keyDown(esquerda(), { key: " " });
    expect(esquerda()).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(esquerda(), { key: "ArrowDown" });
    fireEvent.keyDown(direita(), { key: "ArrowDown" });
    expect(visualizador()).toHaveFocus();
    fireEvent.keyDown(visualizador(), { key: " " });
    expect(visualizador()).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(visualizador(), { key: "Enter" });
    expect(visualizador()).toHaveAttribute("aria-checked", "false");
    fireEvent.keyDown(visualizador(), { key: "ArrowDown" });
    expect(bixinhos()).toHaveFocus();
    fireEvent.keyDown(bixinhos(), { key: "ArrowDown" });
    // Depois dos interruptores, os três estilos dos controles das janelas; Enter escolhe o focado.
    expect(automatico()).toHaveFocus();
    fireEvent.keyDown(automatico(), { key: "ArrowDown" });
    expect(estiloMac()).toHaveFocus();
    fireEvent.keyDown(estiloMac(), { key: "Enter" });
    expect(estiloMac()).toHaveAttribute("aria-checked", "true");
    expect(lerLeitor()).toMatchObject({ controlesDasJanelas: "mac" });
    fireEvent.keyDown(estiloMac(), { key: "ArrowDown" });
    fireEvent.keyDown(estiloWindows(), { key: " " });
    expect(estiloWindows()).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(estiloWindows(), { key: "ArrowDown" });
    expect(autorrecuperacao()).toHaveFocus();
    fireEvent.keyDown(autorrecuperacao(), { key: "ArrowDown" });
    expect(pastas()).toHaveFocus();
    fireEvent.keyDown(pastas(), { key: "ArrowDown" });
    expect(chat()).toHaveFocus();
    fireEvent.keyDown(chat(), { key: "End" });
    expect(pastas()).toHaveFocus();

    fireEvent.keyDown(pastas(), { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(botao()).toHaveFocus();
    expect(ajustes.abrir).not.toHaveBeenCalled();

    fireEvent.keyDown(botao(), { key: "ArrowUp" });
    expect(pastas()).toHaveFocus();
    fireEvent.keyDown(pastas(), { key: "Enter" });
    expect(ajustes.abrir).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  describe("seção Orquestradores: Autorrecuperação (preferência do servidor)", () => {
    const interruptor = () => screen.getByRole("menuitemcheckbox", { name: /Autorrecuperação/ });

    it("lê do servidor ao abrir: carregando, depois o valor e a dica", async () => {
      vi.mocked(api.lerPreferencias).mockResolvedValue(preferencias(false));
      renderizar();
      fireEvent.click(botao());

      const grupo = screen.getByRole("group", { name: "Orquestradores" });
      expect(within(grupo).getByRole("menuitemcheckbox", { name: /Autorrecuperação/ })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
      expect(interruptor()).toHaveTextContent("carregando…");
      await act(async () => undefined);

      expect(api.lerPreferencias).toHaveBeenCalledTimes(1);
      expect(interruptor()).toHaveAttribute("aria-checked", "false");
      expect(interruptor()).toHaveAttribute("aria-disabled", "false");
      expect(interruptor()).toHaveTextContent("retoma sozinho quando o Claude trava ou a API falha");
      // Não é preferência da tela: nada no navegador.
      expect(localStorage.getItem(CHAVE_DAS_PREFERENCIAS_DA_TELA)).toBeNull();
    });

    it("clicar grava só o campo pelo PATCH, sem fechar o painel; o teclado também alterna", async () => {
      vi.mocked(api.lerPreferencias).mockResolvedValue(preferencias(true));
      const alterar = vi
        .spyOn(api, "alterarPreferencias")
        .mockImplementation(async (alteracao) => preferencias(alteracao.autorrecuperacao ?? true));
      renderizar();
      fireEvent.click(botao());
      await act(async () => undefined);
      expect(interruptor()).toHaveAttribute("aria-checked", "true");

      fireEvent.click(interruptor());
      expect(interruptor()).toHaveAttribute("aria-checked", "false");
      await act(async () => undefined);

      expect(alterar).toHaveBeenCalledWith({ autorrecuperacao: false });
      expect(interruptor()).toHaveAttribute("aria-checked", "false");
      expect(screen.getByRole("menu", { name: "Configurações" })).toBeInTheDocument();

      interruptor().focus();
      fireEvent.keyDown(interruptor(), { key: " " });
      await act(async () => undefined);
      expect(alterar).toHaveBeenLastCalledWith({ autorrecuperacao: true });
      expect(interruptor()).toHaveAttribute("aria-checked", "true");
    });

    it("se a gravação falhar, volta ao valor anterior e mostra o erro no lugar da dica", async () => {
      vi.mocked(api.lerPreferencias).mockResolvedValue(preferencias(true));
      vi.spyOn(api, "alterarPreferencias").mockRejectedValue(new Error("O servidor não respondeu."));
      renderizar();
      fireEvent.click(botao());
      await act(async () => undefined);

      fireEvent.click(interruptor());
      await act(async () => undefined);

      expect(interruptor()).toHaveAttribute("aria-checked", "true");
      expect(within(interruptor()).getByText("O servidor não respondeu.")).toHaveClass("text-error");
    });

    it("se a leitura falhar, o interruptor fica indisponível com o erro", async () => {
      vi.mocked(api.lerPreferencias).mockRejectedValue(new Error("Sem conexão."));
      renderizar();
      fireEvent.click(botao());
      await act(async () => undefined);

      expect(interruptor()).toHaveAttribute("aria-disabled", "true");
      expect(interruptor()).toHaveTextContent("Sem conexão.");
    });
  });

  it("clique fora fecha; a preferência mudada em outro lugar aparece no interruptor", () => {
    renderizar();
    fireEvent.click(botao());
    fireEvent.mouseDown(screen.getByRole("textbox", { name: "Campo de fora" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    // Outra aba gravou: o evento storage faz a tela reler.
    act(() => {
      localStorage.setItem(CHAVE_DAS_PREFERENCIAS_DA_TELA, JSON.stringify({ visualizadorDeCodigo: true }));
      window.dispatchEvent(new StorageEvent("storage", { key: CHAVE_DAS_PREFERENCIAS_DA_TELA }));
    });
    fireEvent.click(botao());

    expect(screen.getByRole("menuitemcheckbox", { name: /Visualizador de código/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("menuitemcheckbox", { name: "Chat fixo" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });
});
