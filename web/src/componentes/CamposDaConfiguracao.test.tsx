import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { api, ErroDaApi } from "../shared/api/cliente";
import type { DadosDaConfiguracao, DadosDaPredefinicao, EsforcosHerdados } from "../shared/api/tipos";
import { CamposDaConfiguracao } from "./CamposDaConfiguracao";

const configuracao: DadosDaConfiguracao = {
  modeloDoOrquestrador: "opus",
  esforcoDoOrquestrador: "padrao",
  modeloDosSubagentes: "sonnet",
  esforcoDosSubagentes: "padrao",
  quantidadeDeSubagentes: { modo: "automatica", limite: 3 },
  nivelDePermissao: "edicao_e_comandos",
  permitirCommitEPush: false,
  permitirTrabalhoDireto: true,
  proporPlanoEmPedidosGrandes: true,
};

function renderizar(alteracoes: Partial<DadosDaConfiguracao> = {}) {
  const aoMudar = vi.fn();
  render(<CamposDaConfiguracao valor={{ ...configuracao, ...alteracoes }} aoMudar={aoMudar} />);
  return { aoMudar, opcao: screen.getByRole("checkbox", { name: "Permitir commit e push quando eu pedir" }) };
}

const ECONOMICO: DadosDaPredefinicao = {
  nome: "economico",
  rotulo: "Modo econômico",
  descricao: "Gasta menos tokens por pedido.",
  configuracao: {
    modeloDoOrquestrador: "opus",
    esforcoDoOrquestrador: "medio",
    modeloDosSubagentes: "sonnet",
    esforcoDosSubagentes: "medio",
    quantidadeDeSubagentes: { modo: "automatica", limite: 1 },
    permitirTrabalhoDireto: true,
    proporPlanoEmPedidosGrandes: false,
  },
};

const HERDADO_EXTRA_ALTO: EsforcosHerdados = {
  orquestrador: { nivel: "extra_alto", origem: "~/.claude/settings.json", modelo: "claude-opus-5-5", deveAvisar: true },
  subagentes: { nivel: "medio", origem: "padrão do modelo", modelo: "claude-sonnet-5-5", deveAvisar: false },
};

describe("CamposDaConfiguracao", () => {
  beforeEach(() => {
    // Por padrão as predefinições nunca chegam: os testes que não tratam delas ficam sem o botão.
    vi.spyOn(api, "listarPredefinicoes").mockReturnValue(new Promise<DadosDaPredefinicao[]>(() => undefined));
  });

  afterEach(() => vi.restoreAllMocks());

  describe("modo econômico", () => {
    it("sem predefinições do servidor, o botão não aparece", () => {
      renderizar();

      expect(screen.queryByRole("button", { name: "Modo econômico" })).not.toBeInTheDocument();
    });

    it("explica no title o que muda e, na criação, só preenche os campos", async () => {
      vi.spyOn(api, "listarPredefinicoes").mockResolvedValue([ECONOMICO]);
      const { aoMudar } = renderizar({ esforcoDoOrquestrador: "maximo", nivelDePermissao: "leitura" });
      const botao = await screen.findByRole("button", { name: "Modo econômico" });

      expect(botao).toHaveAttribute("title", expect.stringContaining("Gasta menos tokens por pedido."));
      expect(botao).toHaveAttribute("title", expect.stringContaining("• Esforço do orquestrador: Médio"));
      expect(botao).toHaveAttribute("title", expect.stringContaining("• Propor plano antes de mudanças grandes: desligado"));

      fireEvent.click(botao);
      expect(aoMudar).toHaveBeenCalledWith({
        ...configuracao,
        ...ECONOMICO.configuracao,
        // O que a predefinição não muda fica como estava.
        nivelDePermissao: "leitura",
      });
    });

    it("no ⚙, aplica no servidor e mostra a configuração devolvida", async () => {
      vi.spyOn(api, "listarPredefinicoes").mockResolvedValue([ECONOMICO]);
      const devolvida: DadosDaConfiguracao = { ...configuracao, ...ECONOMICO.configuracao };
      const aplicar = vi.fn(async () => devolvida);
      const aoMudar = vi.fn();
      render(<CamposDaConfiguracao valor={configuracao} aoMudar={aoMudar} aplicarPredefinicao={aplicar} />);

      fireEvent.click(await screen.findByRole("button", { name: "Modo econômico" }));

      await waitFor(() => expect(aoMudar).toHaveBeenCalledWith(devolvida));
      expect(aplicar).toHaveBeenCalledWith("economico");
      expect(screen.getByRole("button", { name: "Modo econômico" })).toBeEnabled();
    });

    it("no ⚙, mostra o erro do servidor sem mudar os campos", async () => {
      vi.spyOn(api, "listarPredefinicoes").mockResolvedValue([ECONOMICO]);
      const aplicar = vi.fn(async (): Promise<DadosDaConfiguracao> => {
        throw new ErroDaApi("Orquestrador não encontrado.", 404);
      });
      const aoMudar = vi.fn();
      render(<CamposDaConfiguracao valor={configuracao} aoMudar={aoMudar} aplicarPredefinicao={aplicar} />);

      fireEvent.click(await screen.findByRole("button", { name: "Modo econômico" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Não foi possível aplicar o modo econômico: Orquestrador não encontrado.",
      );
      expect(aoMudar).not.toHaveBeenCalled();
    });
  });

  describe("aviso de esforço herdado", () => {
    const aviso = /Em Padrão, o Claude Code usa Extra alto para este modelo/;

    function renderizarComHerdado(
      buscar: () => Promise<EsforcosHerdados>,
      alteracoes: Partial<DadosDaConfiguracao> = {},
    ) {
      render(
        <CamposDaConfiguracao
          valor={{ ...configuracao, ...alteracoes }}
          aoMudar={vi.fn()}
          buscarEsforcoHerdado={buscar}
        />,
      );
    }

    it("em Padrão e com deveAvisar, avisa só no papel correspondente, com a origem", async () => {
      renderizarComHerdado(async () => HERDADO_EXTRA_ALTO);
      const doOrquestrador = screen.getByRole("combobox", { name: "Esforço do orquestrador" });

      await waitFor(() => expect(doOrquestrador).toHaveAccessibleDescription(aviso));
      expect(doOrquestrador).toHaveAccessibleDescription(/\(definido em ~\/\.claude\/settings\.json\s?\)/);
      expect(doOrquestrador).toHaveAccessibleDescription(/Isso gasta mais tokens; escolha um nível aqui para controlar\./);
      expect(screen.getByText("Extra alto", { selector: "strong" })).toBeInTheDocument();
      expect(screen.getByRole("combobox", { name: "Esforço dos subagentes" })).not.toHaveAccessibleDescription(aviso);
    });

    it("com um nível escolhido no seletor, não avisa", async () => {
      const buscar = vi.fn(async () => HERDADO_EXTRA_ALTO);
      renderizarComHerdado(buscar, { esforcoDoOrquestrador: "medio" });

      await waitFor(() => expect(buscar).toHaveBeenCalled());
      await Promise.resolve();
      expect(screen.queryByText(/Em Padrão, o Claude Code usa/)).not.toBeInTheDocument();
    });

    it("sem deveAvisar, não avisa", async () => {
      const buscar = vi.fn(async (): Promise<EsforcosHerdados> => ({
        orquestrador: { ...HERDADO_EXTRA_ALTO.orquestrador!, deveAvisar: false },
        subagentes: null,
      }));
      renderizarComHerdado(buscar);

      await waitFor(() => expect(buscar).toHaveBeenCalled());
      await Promise.resolve();
      expect(screen.queryByText(/Em Padrão, o Claude Code usa/)).not.toBeInTheDocument();
    });

    it("quando a busca falha, segue sem aviso e sem erro", async () => {
      const buscar = vi.fn(async (): Promise<EsforcosHerdados> => {
        throw new Error("Não foi possível falar com o servidor.");
      });
      renderizarComHerdado(buscar);

      await waitFor(() => expect(buscar).toHaveBeenCalled());
      await Promise.resolve();
      expect(screen.queryByText(/Em Padrão, o Claude Code usa/)).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.getByRole("combobox", { name: "Esforço do orquestrador" })).toBeEnabled();
    });
  });

  it("commit e push começam desligados e, ao ligar, mudam só essa opção", () => {
    const { aoMudar, opcao } = renderizar();

    expect(opcao).not.toBeChecked();
    expect(opcao).toHaveAccessibleDescription(/só quando você pedir explicitamente/);

    fireEvent.click(opcao);
    expect(aoMudar).toHaveBeenCalledWith({ ...configuracao, permitirCommitEPush: true });
  });

  it("reflete a opção já ligada", () => {
    expect(renderizar({ permitirCommitEPush: true }).opcao).toBeChecked();
  });

  it("ligada sem permissão de rodar comandos, avisa sem bloquear a opção", () => {
    const { opcao } = renderizar({ permitirCommitEPush: true, nivelDePermissao: "edicao" });

    expect(screen.getByText(/exigem a permissão de rodar comandos/)).toBeInTheDocument();
    expect(opcao).toBeEnabled();
  });

  it("com permissão de rodar comandos, não avisa", () => {
    renderizar({ permitirCommitEPush: true });

    expect(screen.queryByText(/exigem a permissão de rodar comandos/)).not.toBeInTheDocument();
  });

  describe("trabalho direto e plano automático", () => {
    function opcoes() {
      return {
        trabalhoDireto: screen.getByRole("checkbox", { name: "Deixar o orquestrador fazer o trivial sozinho" }),
        plano: screen.getByRole("checkbox", { name: "Propor plano antes de mudanças grandes" }),
      };
    }

    it("começam ligadas, com a ajuda de cada uma", () => {
      renderizar();
      const { trabalhoDireto, plano } = opcoes();

      expect(trabalhoDireto).toBeChecked();
      expect(trabalhoDireto).toHaveAccessibleDescription(
        "Leituras rápidas, uma checagem ou um comando curto, sem subagente. Alterações continuam delegadas.",
      );
      expect(plano).toBeChecked();
      expect(plano).toHaveAccessibleDescription(
        "Em pedidos grandes, o orquestrador responde com um plano para você aprovar antes de alterar.",
      );
    });

    it("refletem as opções desligadas", () => {
      renderizar({ permitirTrabalhoDireto: false, proporPlanoEmPedidosGrandes: false });
      const { trabalhoDireto, plano } = opcoes();

      expect(trabalhoDireto).not.toBeChecked();
      expect(plano).not.toBeChecked();
    });

    it("ao desligar, mudam só a opção correspondente", () => {
      const { aoMudar } = renderizar();
      const { trabalhoDireto, plano } = opcoes();

      fireEvent.click(trabalhoDireto);
      expect(aoMudar).toHaveBeenLastCalledWith({ ...configuracao, permitirTrabalhoDireto: false });

      fireEvent.click(plano);
      expect(aoMudar).toHaveBeenLastCalledWith({ ...configuracao, proporPlanoEmPedidosGrandes: false });
    });
  });

  describe("modelo", () => {
    it("oferece Fable, Opus, Sonnet e Haiku nos dois seletores, e escolher Fable muda só aquele modelo", () => {
      const { aoMudar } = renderizar();
      const grupos = [
        screen.getByRole("group", { name: "Modelo do orquestrador" }),
        screen.getByRole("group", { name: "Modelo dos subagentes" }),
      ];

      for (const grupo of grupos) {
        expect(
          within(grupo)
            .getAllByRole("radio")
            .map((opcao) => (opcao as HTMLInputElement).value),
        ).toEqual(["fable", "opus", "sonnet", "haiku"]);
      }

      fireEvent.click(within(grupos[0]!).getByRole("radio", { name: /Fable/ }));
      expect(aoMudar).toHaveBeenLastCalledWith({ ...configuracao, modeloDoOrquestrador: "fable" });

      fireEvent.click(within(grupos[1]!).getByRole("radio", { name: /Fable/ }));
      expect(aoMudar).toHaveBeenLastCalledWith({ ...configuracao, modeloDosSubagentes: "fable" });
    });

    it("mostra Fable já escolhido", () => {
      renderizar({ modeloDoOrquestrador: "fable" });

      expect(
        within(screen.getByRole("group", { name: "Modelo do orquestrador" })).getByRole("radio", { name: /Fable/ }),
      ).toBeChecked();
    });
  });

  describe("esforço", () => {
    function seletores() {
      return {
        doOrquestrador: screen.getByRole("combobox", { name: "Esforço do orquestrador" }),
        dosSubagentes: screen.getByRole("combobox", { name: "Esforço dos subagentes" }),
      };
    }

    it("começa no padrão do Claude Code, com todas as opções e a ajuda", () => {
      renderizar();
      const { doOrquestrador, dosSubagentes } = seletores();

      expect(doOrquestrador).toHaveValue("padrao");
      expect(dosSubagentes).toHaveValue("padrao");
      expect(screen.getAllByRole("option", { name: "Padrão (Claude Code)", selected: true })).toHaveLength(2);
      expect(within(doOrquestrador).getAllByRole("option").map((opcao) => opcao.textContent)).toEqual([
        "Padrão (Claude Code)",
        "Baixo",
        "Médio",
        "Alto",
        "Extra alto",
        "Máximo",
      ]);
      for (const seletor of [doOrquestrador, dosSubagentes]) {
        expect(seletor).toHaveAccessibleDescription(
          /Padrão: o app não força nada — vale o settings\.json do Claude Code desta máquina ou, sem ele, o padrão do modelo\./,
        );
        expect(seletor).toHaveAccessibleDescription(/Mais esforço = respostas mais cuidadosas/);
      }
    });

    it("mostra o esforço já escolhido", () => {
      renderizar({ esforcoDoOrquestrador: "extra_alto", esforcoDosSubagentes: "baixo" });
      const { doOrquestrador, dosSubagentes } = seletores();

      expect(doOrquestrador).toHaveValue("extra_alto");
      expect(dosSubagentes).toHaveValue("baixo");
    });

    it("ao escolher, muda só o esforço correspondente", () => {
      const { aoMudar } = renderizar();
      const { doOrquestrador, dosSubagentes } = seletores();

      fireEvent.change(doOrquestrador, { target: { value: "maximo" } });
      expect(aoMudar).toHaveBeenLastCalledWith({ ...configuracao, esforcoDoOrquestrador: "maximo" });

      fireEvent.change(dosSubagentes, { target: { value: "medio" } });
      expect(aoMudar).toHaveBeenLastCalledWith({ ...configuracao, esforcoDosSubagentes: "medio" });
    });
  });
});
