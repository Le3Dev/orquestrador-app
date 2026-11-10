import { act, fireEvent, render, screen, within } from "@testing-library/react";

import { api } from "../../shared/api/cliente";
import type { DadosDasPreferencias } from "../../shared/api/tipos";
import type { AjustesDoAplicativo } from "../../shared/hooks/useAjustesDoAplicativo";
import { esquecerAutorrecuperacao } from "../../shared/hooks/useAutorrecuperacao";
import { CHAVE_DAS_PREFERENCIAS_DA_TELA, usePreferenciasDaTela } from "../../shared/hooks/usePreferenciasDaTela";
import type { EstadoDaAtualizacao } from "../../shared/ponteDoDesktop";
import { type AbaDasConfiguracoes, ConfiguracoesDoApp } from "./ConfiguracoesDoApp";

/** Lê as preferências pelo hook, como outro componente da tela faria. */
function Leitor() {
  const { preferencias } = usePreferenciasDaTela();
  return <output data-testid="leitor">{JSON.stringify(preferencias)}</output>;
}

function ajustesFalsos(disponivel = true): AjustesDoAplicativo {
  return { disponivel, abrir: vi.fn().mockResolvedValue(undefined), erro: null, descartarErro: vi.fn() };
}

function preferencias(sobrescrever: Partial<DadosDasPreferencias> = {}): DadosDasPreferencias {
  return { instrucoesPadrao: "Responda curto.", subagentesProntos: [], autorrecuperacao: true, ...sobrescrever };
}

interface OpcoesDoRender {
  ajustes?: AjustesDoAplicativo;
  aberto?: boolean;
  abaInicial?: AbaDasConfiguracoes;
  pedidosEmAndamento?: number;
}

function renderizar({ ajustes = ajustesFalsos(), aberto = true, abaInicial, pedidosEmAndamento }: OpcoesDoRender = {}) {
  const aoFechar = vi.fn();
  const aoSalvarInstrucoes = vi.fn();
  const elemento = (abertoAgora: boolean) => (
    <>
      <button type="button">Quem abriu</button>
      <ConfiguracoesDoApp
        ajustes={ajustes}
        aberto={abertoAgora}
        aoFechar={aoFechar}
        abaInicial={abaInicial}
        pedidosEmAndamento={pedidosEmAndamento}
        aoSalvarInstrucoes={aoSalvarInstrucoes}
        sistema={<div data-testid="status-do-sistema">Memória tranquila</div>}
      />
      <Leitor />
    </>
  );
  const resultado = render(elemento(aberto));
  return {
    ajustes,
    aoFechar,
    aoSalvarInstrucoes,
    reabrir: (abertoAgora: boolean) => resultado.rerender(elemento(abertoAgora)),
  };
}

const aba = (nome: string) => screen.getByRole("tab", { name: nome });
const lerLeitor = () => JSON.parse(screen.getByTestId("leitor").textContent ?? "") as Record<string, unknown>;
const esperar = () => act(async () => undefined);

describe("ConfiguracoesDoApp", () => {
  const janelaComPonte = window as unknown as { electron?: unknown };

  beforeEach(() => {
    esquecerAutorrecuperacao();
    vi.spyOn(api, "lerPreferencias").mockResolvedValue(preferencias());
  });

  afterEach(() => {
    localStorage.clear();
    delete janelaComPonte.electron;
    vi.restoreAllMocks();
  });

  describe("abertura e abas", () => {
    it("fechado, não renderiza nada", () => {
      renderizar({ aberto: false });
      expect(screen.queryByRole("region", { name: "Configurações" })).not.toBeInTheDocument();
      expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    });

    it("aberto: painel posicionado à direita, abaixo da ilha, e quatro abas (sem Conta, que não tem dado real)", async () => {
      renderizar();
      await esperar();

      const painel = screen.getByRole("region", { name: "Configurações" });
      expect(painel).toHaveClass("configuracoes-do-app");
      expect(painel).toHaveStyle({ top: "72px" });
      const abas = within(screen.getByRole("tablist", { name: "Seções de Configurações" })).getAllByRole("tab");
      expect(abas.map((item) => item.textContent)).toEqual(["Padrões", "Sistema", "Atualização", "Aparência"]);
      expect(screen.queryByRole("tab", { name: "Conta" })).not.toBeInTheDocument();
      expect(aba("Padrões")).toHaveAttribute("aria-selected", "true");
      expect(aba("Padrões")).toHaveAttribute("tabindex", "0");
      expect(aba("Sistema")).toHaveAttribute("tabindex", "-1");
      expect(screen.getByRole("tabpanel", { name: "Padrões" })).toBeInTheDocument();
    });

    it("aceita um topo diferente (notificações empilhadas)", () => {
      render(<ConfiguracoesDoApp ajustes={ajustesFalsos()} aberto aoFechar={() => undefined} topo={180} />);
      expect(screen.getByRole("region", { name: "Configurações" })).toHaveStyle({ top: "180px" });
    });

    it("abaInicial escolhe a aba; Conta (sem dado) e valor desconhecido caem em Padrões", async () => {
      const primeira = renderizar({ abaInicial: "aparencia" });
      expect(aba("Aparência")).toHaveAttribute("aria-selected", "true");
      expect(screen.getByRole("tabpanel", { name: "Aparência" })).toBeInTheDocument();
      expect(aba("Aparência")).toHaveFocus();
      primeira.reabrir(false);
      await esperar();
    });

    it("abaInicial 'conta' vale Padrões", async () => {
      renderizar({ abaInicial: "conta" });
      await esperar();
      expect(aba("Padrões")).toHaveAttribute("aria-selected", "true");
    });

    it("as setas trocam de aba (com volta), Home e End vão às pontas, e o foco acompanha", async () => {
      renderizar();
      await esperar();
      expect(aba("Padrões")).toHaveFocus();

      fireEvent.keyDown(aba("Padrões"), { key: "ArrowRight" });
      expect(aba("Sistema")).toHaveAttribute("aria-selected", "true");
      expect(aba("Sistema")).toHaveFocus();
      fireEvent.keyDown(aba("Sistema"), { key: "ArrowRight" });
      expect(aba("Atualização")).toHaveFocus();
      fireEvent.keyDown(aba("Atualização"), { key: "ArrowRight" });
      expect(aba("Aparência")).toHaveFocus();
      fireEvent.keyDown(aba("Aparência"), { key: "ArrowRight" });
      expect(aba("Padrões")).toHaveFocus();
      expect(aba("Padrões")).toHaveAttribute("aria-selected", "true");
      fireEvent.keyDown(aba("Padrões"), { key: "ArrowLeft" });
      expect(aba("Aparência")).toHaveAttribute("aria-selected", "true");
      fireEvent.keyDown(aba("Aparência"), { key: "Home" });
      expect(aba("Padrões")).toHaveFocus();
      fireEvent.keyDown(aba("Padrões"), { key: "End" });
      expect(aba("Aparência")).toHaveFocus();
    });

    it("clicar numa aba mostra só o painel dela", async () => {
      renderizar();
      await esperar();
      fireEvent.click(aba("Sistema"));

      expect(screen.getByRole("tabpanel", { name: "Sistema" })).toBeInTheDocument();
      expect(screen.queryByRole("tabpanel", { name: "Padrões" })).not.toBeInTheDocument();
      expect(screen.getByRole("tabpanel", { name: "Sistema" })).toHaveAttribute("aria-labelledby", aba("Sistema").id);
    });
  });

  describe("fechar e foco", () => {
    it("o foco vai para a aba ao abrir e volta para quem abriu ao fechar", async () => {
      const { reabrir } = renderizar({ aberto: false });
      screen.getByRole("button", { name: "Quem abriu" }).focus();

      reabrir(true);
      await esperar();
      expect(aba("Padrões")).toHaveFocus();

      reabrir(false);
      expect(screen.getByRole("button", { name: "Quem abriu" })).toHaveFocus();
    });

    it("Esc e o botão fechar chamam aoFechar", async () => {
      const { aoFechar } = renderizar();
      await esperar();

      fireEvent.keyDown(aba("Padrões"), { key: "Escape" });
      expect(aoFechar).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByRole("button", { name: "Fechar Configurações" }));
      expect(aoFechar).toHaveBeenCalledTimes(2);
    });

    it("Esc dado em outro lugar da tela (um campo de fora) não fecha", async () => {
      const aoFechar = vi.fn();
      render(
        <>
          <input aria-label="Campo de fora" />
          <ConfiguracoesDoApp ajustes={ajustesFalsos()} aberto aoFechar={aoFechar} />
        </>,
      );
      await esperar();

      fireEvent.keyDown(screen.getByRole("textbox", { name: "Campo de fora" }), { key: "Escape" });
      expect(aoFechar).not.toHaveBeenCalled();
    });
  });

  describe("aba Padrões", () => {
    const campo = () => screen.getByRole("textbox", { name: "Instruções gerais" });
    const botoesDeAcao = () => screen.getByRole("button", { name: "Salvar", hidden: true }).parentElement;

    it("carrega as instruções com rótulo ⓘ, contador, ditado e a dica das variáveis", async () => {
      renderizar();
      await esperar();

      expect(campo()).toHaveValue("Responda curto.");
      expect(screen.getByRole("button", { name: "O que é Instruções gerais" })).toBeInTheDocument();
      expect(screen.getByText("15 / 4.000")).toBeInTheDocument();
      expect(campo()).toHaveAccessibleDescription(/Use \{\{pasta\}\} e \{\{nome\}\} para a pasta e o nome do orquestrador\./);
    });

    it("Descartar e Salvar só aparecem com mudança, e Descartar volta ao texto salvo", async () => {
      renderizar();
      await esperar();
      // Sem mudança, os botões ficam no lugar (o layout não se mexe), só invisíveis.
      expect(botoesDeAcao()).toHaveAttribute("data-oculto");

      fireEvent.change(campo(), { target: { value: "Outra coisa." } });
      expect(botoesDeAcao()).not.toHaveAttribute("data-oculto");
      expect(screen.getByRole("button", { name: "Salvar" })).toBeEnabled();
      fireEvent.click(screen.getByRole("button", { name: "Descartar" }));

      expect(campo()).toHaveValue("Responda curto.");
      expect(botoesDeAcao()).toHaveAttribute("data-oculto");
    });

    it("Salvar grava só as instruções, avisa a página, mostra a confirmação e mantém o painel aberto", async () => {
      const alterar = vi
        .spyOn(api, "alterarPreferencias")
        .mockResolvedValue(preferencias({ instrucoesPadrao: "Use pt-BR." }));
      const { aoFechar, aoSalvarInstrucoes } = renderizar();
      await esperar();

      fireEvent.change(campo(), { target: { value: "Use pt-BR." } });
      fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
      await esperar();

      expect(alterar).toHaveBeenCalledWith({ instrucoesPadrao: "Use pt-BR." });
      expect(aoSalvarInstrucoes).toHaveBeenCalledTimes(1);
      expect(aoFechar).not.toHaveBeenCalled();
      expect(screen.getByText("Alterações salvas.")).toBeInTheDocument();
      expect(botoesDeAcao()).toHaveAttribute("data-oculto");
    });

    it("mostra o erro do servidor e mantém a edição", async () => {
      vi.spyOn(api, "alterarPreferencias").mockRejectedValue(new Error("O servidor não respondeu."));
      const { aoSalvarInstrucoes } = renderizar();
      await esperar();

      fireEvent.change(campo(), { target: { value: "x" } });
      fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
      await esperar();

      expect(screen.getByText("O servidor não respondeu.")).toBeInTheDocument();
      expect(campo()).toHaveValue("x");
      expect(aoSalvarInstrucoes).not.toHaveBeenCalled();
    });

    it("o texto em edição sobrevive à troca de aba", async () => {
      renderizar();
      await esperar();
      fireEvent.change(campo(), { target: { value: "Rascunho." } });

      fireEvent.click(aba("Aparência"));
      expect(screen.queryByRole("textbox", { name: "Instruções gerais" })).not.toBeInTheDocument();
      fireEvent.click(aba("Padrões"));

      expect(campo()).toHaveValue("Rascunho.");
      expect(screen.getByRole("button", { name: "Salvar" })).toBeEnabled();
    });

    it("perfis de instruções: lista os salvos, exige nome e texto e salva junto", async () => {
      vi.mocked(api.lerPreferencias).mockResolvedValue(
        preferencias({ perfisDeInstrucoes: [{ nome: "Backend", texto: "Use Jest." }] }),
      );
      const alterar = vi.spyOn(api, "alterarPreferencias").mockResolvedValue(
        preferencias({
          perfisDeInstrucoes: [
            { nome: "Backend", texto: "Use Jest." },
            { nome: "Docs", texto: "Escreva curto." },
          ],
        }),
      );
      renderizar();
      await esperar();
      expect(screen.getByRole("textbox", { name: "Nome do perfil" })).toHaveValue("Backend");
      expect(screen.getByText("1 / 20")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "+ Novo perfil" }));
      const nomes = screen.getAllByRole("textbox", { name: "Nome do perfil" });
      expect(nomes[1]).toHaveFocus();
      expect(screen.getByRole("button", { name: "Salvar" })).toBeDisabled();
      expect(screen.getByText(/Para salvar, dê um nome\./)).toBeInTheDocument();

      fireEvent.change(nomes[1] as HTMLElement, { target: { value: "Docs" } });
      fireEvent.change(screen.getAllByRole("textbox", { name: "Texto do perfil" })[1] as HTMLElement, {
        target: { value: "Escreva curto." },
      });
      fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
      await esperar();

      expect(alterar).toHaveBeenCalledWith({
        perfisDeInstrucoes: [
          { nome: "Backend", texto: "Use Jest." },
          { nome: "Docs", texto: "Escreva curto." },
        ],
      });
    });

    it("não oferece modelo nem permissão padrão (não existem como configuração global)", async () => {
      renderizar();
      await esperar();
      expect(screen.queryByText(/Modelo de IA padrão/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Permissão padrão/)).not.toBeInTheDocument();
    });
  });

  describe("aba Sistema", () => {
    it("mostra o que a ilha passa, a Autorrecuperação do servidor e o botão dos Ajustes", async () => {
      const alterar = vi
        .spyOn(api, "alterarPreferencias")
        .mockImplementation(async (alteracao) => preferencias({ autorrecuperacao: alteracao.autorrecuperacao }));
      const { ajustes } = renderizar({ abaInicial: "sistema" });
      await esperar();

      expect(screen.getByTestId("status-do-sistema")).toHaveTextContent("Memória tranquila");
      const chave = screen.getByRole("switch", { name: "Autorrecuperação" });
      expect(chave).toHaveAttribute("aria-checked", "true");
      expect(chave).toHaveAccessibleDescription("Retoma sozinho quando o Claude trava ou a API falha.");

      fireEvent.click(chave);
      await esperar();
      expect(alterar).toHaveBeenCalledWith({ autorrecuperacao: false });
      expect(chave).toHaveAttribute("aria-checked", "false");

      fireEvent.click(screen.getByRole("button", { name: "Pastas e Claude Code…" }));
      expect(ajustes.abrir).toHaveBeenCalledTimes(1);
    });

    it("se a gravação falhar, volta ao valor anterior e mostra o erro no lugar da dica", async () => {
      vi.spyOn(api, "alterarPreferencias").mockRejectedValue(new Error("Sem conexão."));
      renderizar({ abaInicial: "sistema" });
      await esperar();

      fireEvent.click(screen.getByRole("switch", { name: "Autorrecuperação" }));
      await esperar();

      expect(screen.getByRole("switch", { name: "Autorrecuperação" })).toHaveAttribute("aria-checked", "true");
      expect(screen.getByText("Sem conexão.")).toHaveClass("cfgapp-erro");
    });

    it("sem os Ajustes (navegador puro), não há o botão de pastas", async () => {
      renderizar({ abaInicial: "sistema", ajustes: ajustesFalsos(false) });
      await esperar();
      expect(screen.queryByRole("button", { name: "Pastas e Claude Code…" })).not.toBeInTheDocument();
    });
  });

  describe("aba Atualização", () => {
    function estado(alteracoes: Partial<EstadoDaAtualizacao> = {}): EstadoDaAtualizacao {
      return { situacao: "em-dia", versaoAtual: "0.3.0", versaoNova: null, progresso: null, mensagemDeErro: null, ...alteracoes };
    }

    function instalarPonte(inicial: EstadoDaAtualizacao) {
      const atualizacao = {
        obter: vi.fn(async () => inicial),
        verificar: vi.fn(async () => inicial),
        instalarAgora: vi.fn(async () => undefined),
        aoMudar: vi.fn(() => () => undefined),
      };
      janelaComPonte.electron = { desktop: true, atualizacao };
      return atualizacao;
    }

    it("sem a ponte (navegador), explica que só vale no app instalado", async () => {
      renderizar({ abaInicial: "atualizacao" });
      await esperar();
      expect(screen.getByText(/Funcionam só no app instalado/)).toBeInTheDocument();
    });

    it("em dia: mostra a versão e deixa procurar agora", async () => {
      const ponte = instalarPonte(estado());
      renderizar({ abaInicial: "atualizacao" });
      await esperar();

      expect(screen.getByText("Versão 0.3.0")).toBeInTheDocument();
      expect(screen.getByText("Você está na versão mais recente.")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Procurar agora" }));
      expect(ponte.verificar).toHaveBeenCalledTimes(1);
    });

    it("baixando: mostra o percentual numa barra de progresso", async () => {
      instalarPonte(estado({ situacao: "baixando", versaoNova: "0.3.1", progresso: 40 }));
      renderizar({ abaInicial: "atualizacao" });
      await esperar();

      expect(screen.getByRole("progressbar", { name: "Download da atualização" })).toHaveAttribute("aria-valuenow", "40");
      expect(screen.getByText(/A versão 0\.3\.1 está sendo baixada \(40%\)/)).toBeInTheDocument();
    });

    it("pronta: reinicia direto sem pedidos, e com pedidos em andamento pede confirmação", async () => {
      const ponte = instalarPonte(estado({ situacao: "pronta", versaoNova: "v0.3.1" }));
      const { reabrir } = renderizar({ abaInicial: "atualizacao" });
      await esperar();
      fireEvent.click(screen.getByRole("button", { name: "Reiniciar agora" }));
      expect(ponte.instalarAgora).toHaveBeenCalledTimes(1);
      reabrir(false);

      ponte.instalarAgora.mockClear();
      renderizar({ abaInicial: "atualizacao", pedidosEmAndamento: 2 });
      await esperar();
      fireEvent.click(screen.getByRole("button", { name: "Reiniciar agora" }));
      expect(ponte.instalarAgora).not.toHaveBeenCalled();
      expect(screen.getByRole("alert")).toHaveTextContent("Há 2 pedidos em andamento; reiniciar agora vai cancelá-los.");
      fireEvent.click(screen.getByRole("button", { name: "Reiniciar mesmo assim" }));
      expect(ponte.instalarAgora).toHaveBeenCalledTimes(1);
    });
  });

  describe("aba Aparência", () => {
    const posicao = (nome: string) => screen.getByRole("radio", { name: nome });

    it("Posição do chat: Embaixo, Esquerda e Direita mapeiam para chatFixoNaEsquerda e ladoDoChatFixo", async () => {
      renderizar({ abaInicial: "aparencia" });
      await esperar();
      const grupo = screen.getByRole("radiogroup", { name: "Posição do chat" });
      expect(within(grupo).getAllByRole("radio").map((item) => item.textContent)).toEqual(["Embaixo", "Esquerda", "Direita"]);
      expect(posicao("Embaixo")).toHaveAttribute("aria-checked", "true");
      expect(lerLeitor()).toMatchObject({ chatFixoNaEsquerda: false, ladoDoChatFixo: "esquerda" });

      fireEvent.click(posicao("Direita"));
      expect(posicao("Direita")).toHaveAttribute("aria-checked", "true");
      expect(lerLeitor()).toMatchObject({ chatFixoNaEsquerda: true, ladoDoChatFixo: "direita" });
      expect(JSON.parse(localStorage.getItem(CHAVE_DAS_PREFERENCIAS_DA_TELA) ?? "null")).toMatchObject({
        chatFixoNaEsquerda: true,
        ladoDoChatFixo: "direita",
      });

      fireEvent.click(posicao("Esquerda"));
      expect(lerLeitor()).toMatchObject({ chatFixoNaEsquerda: true, ladoDoChatFixo: "esquerda" });

      // Embaixo solta o chat e guarda o último lado.
      fireEvent.click(posicao("Direita"));
      fireEvent.click(posicao("Embaixo"));
      expect(posicao("Embaixo")).toHaveAttribute("aria-checked", "true");
      expect(lerLeitor()).toMatchObject({ chatFixoNaEsquerda: false, ladoDoChatFixo: "direita" });
    });

    it("preferência antiga (chat fixo na direita) abre com a Direita escolhida", async () => {
      localStorage.setItem(
        CHAVE_DAS_PREFERENCIAS_DA_TELA,
        JSON.stringify({ chatFixoNaEsquerda: true, ladoDoChatFixo: "direita" }),
      );
      renderizar({ abaInicial: "aparencia" });
      await esperar();
      expect(posicao("Direita")).toHaveAttribute("aria-checked", "true");
    });

    it("as setas movem e escolhem a posição, com o foco junto", async () => {
      renderizar({ abaInicial: "aparencia" });
      await esperar();
      posicao("Embaixo").focus();

      fireEvent.keyDown(posicao("Embaixo"), { key: "ArrowRight" });
      expect(posicao("Esquerda")).toHaveFocus();
      expect(posicao("Esquerda")).toHaveAttribute("aria-checked", "true");
      expect(posicao("Esquerda")).toHaveAttribute("tabindex", "0");
      expect(posicao("Direita")).toHaveAttribute("tabindex", "-1");
      fireEvent.keyDown(posicao("Esquerda"), { key: "ArrowLeft" });
      fireEvent.keyDown(posicao("Embaixo"), { key: "ArrowLeft" });
      expect(posicao("Direita")).toHaveFocus();
      expect(lerLeitor()).toMatchObject({ chatFixoNaEsquerda: true, ladoDoChatFixo: "direita" });
    });

    it("visualizador de código e manter bixinhos: desligados por padrão, ligar grava e reflete em outro componente", async () => {
      renderizar({ abaInicial: "aparencia" });
      await esperar();
      const visualizador = screen.getByRole("switch", { name: "Visualizador de código" });
      const bixinhos = screen.getByRole("switch", { name: "Manter bixinhos até limpar à mão" });
      expect(visualizador).toHaveAttribute("aria-checked", "false");
      expect(bixinhos).toHaveAttribute("aria-checked", "false");
      expect(bixinhos).toHaveAccessibleDescription("Desligado, os que terminam saem sozinhos do canvas.");

      fireEvent.click(visualizador);
      fireEvent.click(bixinhos);

      expect(visualizador).toHaveAttribute("aria-checked", "true");
      expect(lerLeitor()).toMatchObject({ visualizadorDeCodigo: true, manterBixinhosAteLimpar: true });
    });

    it("Controles das janelas: Automático por padrão; escolher grava e reflete", async () => {
      renderizar({ abaInicial: "aparencia" });
      await esperar();
      const grupo = screen.getByRole("radiogroup", { name: "Controles das janelas" });
      expect(within(grupo).getAllByRole("radio").map((item) => item.textContent)).toEqual([
        "Automático",
        "Estilo Mac",
        "Estilo Windows",
      ]);
      expect(within(grupo).getByRole("radio", { name: "Automático" })).toHaveAttribute("aria-checked", "true");

      fireEvent.click(within(grupo).getByRole("radio", { name: "Estilo Windows" }));
      expect(lerLeitor()).toMatchObject({ controlesDasJanelas: "windows" });
      fireEvent.click(within(grupo).getByRole("radio", { name: "Estilo Mac" }));
      expect(lerLeitor()).toMatchObject({ controlesDasJanelas: "mac" });
    });
  });
});
