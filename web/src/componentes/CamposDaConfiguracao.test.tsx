import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { type ComponentProps, useState } from "react";

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
  instrucoesPersonalizadas: "",
};

type Extras = Omit<ComponentProps<typeof CamposDaConfiguracao>, "valor" | "aoMudar">;

/** Como na ⚙: o formulário guarda o que muda e mostra de volta. */
function Controlado({ inicial, aoMudar, ...extras }: Extras & { inicial: DadosDaConfiguracao; aoMudar: (c: DadosDaConfiguracao) => void }) {
  const [valor, setValor] = useState(inicial);
  return (
    <div className="corpo-da-criacao">
      <CamposDaConfiguracao
        valor={valor}
        aoMudar={(novo) => {
          aoMudar(novo);
          setValor(novo);
        }}
        {...extras}
      />
    </div>
  );
}

function renderizar(alteracoes: Partial<DadosDaConfiguracao> = {}, extras: Extras = {}) {
  const aoMudar = vi.fn();
  render(<Controlado inicial={{ ...configuracao, ...alteracoes }} aoMudar={aoMudar} {...extras} />);
  return { aoMudar, commit: screen.getByRole("switch", { name: "Commit e push quando eu pedir" }) };
}

const chipDoEsforco = (dono: "do orquestrador" | "dos subagentes") =>
  screen.getByRole("button", { name: new RegExp(`^Esforço ${dono}:`) });
const chipDaQuantidade = () => screen.getByRole("button", { name: /^Subagentes:/ });

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

  it("tem as linhas da criação, sem pasta nem nome, e sem caixas de seleção", () => {
    renderizar();

    expect(screen.getByRole("radiogroup", { name: "Permissão" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Orquestrador" })).toHaveValue("opus");
    expect(screen.getByRole("combobox", { name: "Subagentes" })).toHaveValue("sonnet");
    expect(chipDoEsforco("do orquestrador")).toHaveTextContent("esforço automático");
    expect(chipDoEsforco("dos subagentes")).toHaveTextContent("esforço automático");
    expect(chipDaQuantidade()).toHaveTextContent("até 3 por vez");
    expect(screen.getByRole("textbox", { name: "Instruções" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Pasta de trabalho" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Nome" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getAllByRole("switch")).toHaveLength(1);
  });

  describe("permissão", () => {
    it("mostra a salva com a descrição e muda só a permissão", () => {
      const { aoMudar } = renderizar({ nivelDePermissao: "leitura" });
      const grupo = screen.getByRole("radiogroup", { name: "Permissão" });

      expect(within(grupo).getAllByRole("radio").map((opcao) => (opcao as HTMLInputElement).value)).toEqual([
        "leitura",
        "edicao",
        "edicao_e_comandos",
      ]);
      expect(within(grupo).getByRole("radio", { name: "Somente leitura" })).toBeChecked();
      expect(screen.getByText(/Não altera nada/)).toHaveClass("text-secondary");

      fireEvent.click(within(grupo).getByRole("radio", { name: "Ler e editar arquivos" }));
      expect(aoMudar).toHaveBeenLastCalledWith({ ...configuracao, nivelDePermissao: "edicao" });
    });

    it("rodar comandos fica em alerta", () => {
      renderizar({ nivelDePermissao: "edicao_e_comandos" });

      expect(screen.getByText("Edita, instala, testa e compila. Use só em pastas que você confia.")).toHaveClass("text-warning");
      expect(screen.getByRole("radio", { name: "Editar e rodar comandos" }).closest("label")).toHaveClass(
        "opcao-da-permissao-risco",
      );
    });
  });

  describe("modelo", () => {
    it("oferece Fable, Opus, Sonnet e Haiku nos dois seletores, e muda só aquele modelo", () => {
      const { aoMudar } = renderizar();

      for (const nome of ["Orquestrador", "Subagentes"]) {
        expect(
          within(screen.getByRole("combobox", { name: nome }))
            .getAllByRole("option")
            .map((opcao) => opcao.getAttribute("value")),
        ).toEqual(["fable", "opus", "sonnet", "haiku"]);
      }

      fireEvent.change(screen.getByRole("combobox", { name: "Orquestrador" }), { target: { value: "fable" } });
      expect(aoMudar).toHaveBeenLastCalledWith({ ...configuracao, modeloDoOrquestrador: "fable" });

      fireEvent.change(screen.getByRole("combobox", { name: "Subagentes" }), { target: { value: "haiku" } });
      expect(aoMudar).toHaveBeenLastCalledWith({ ...configuracao, modeloDoOrquestrador: "fable", modeloDosSubagentes: "haiku" });
    });
  });

  describe("esforço", () => {
    it("mostra o esforço já escolhido nos chips", () => {
      renderizar({ esforcoDoOrquestrador: "extra_alto", esforcoDosSubagentes: "baixo" });

      expect(chipDoEsforco("do orquestrador")).toHaveTextContent("esforço extra alto");
      expect(chipDoEsforco("dos subagentes")).toHaveTextContent("esforço baixo");
    });

    it("Ultracode só no menu do orquestrador; escolher muda só o esforço correspondente", () => {
      const { aoMudar } = renderizar();

      fireEvent.click(chipDoEsforco("do orquestrador"));
      const doOrquestrador = screen.getByRole("listbox", { name: "Esforço do orquestrador" });
      expect(within(doOrquestrador).getAllByRole("option")).toHaveLength(7);
      expect(within(doOrquestrador).getAllByRole("option").at(-1)).toHaveTextContent("Ultracode");
      fireEvent.click(within(doOrquestrador).getByRole("option", { name: "Máximo" }));
      expect(aoMudar).toHaveBeenLastCalledWith({ ...configuracao, esforcoDoOrquestrador: "maximo" });
      expect(chipDoEsforco("do orquestrador")).toHaveTextContent("esforço máximo");

      fireEvent.click(chipDoEsforco("dos subagentes"));
      const dosSubagentes = screen.getByRole("listbox", { name: "Esforço dos subagentes" });
      expect(within(dosSubagentes).getAllByRole("option")).toHaveLength(6);
      expect(within(dosSubagentes).queryByRole("option", { name: "Ultracode" })).not.toBeInTheDocument();
      fireEvent.click(within(dosSubagentes).getByRole("option", { name: "Médio" }));
      expect(aoMudar).toHaveBeenLastCalledWith({
        ...configuracao,
        esforcoDoOrquestrador: "maximo",
        esforcoDosSubagentes: "medio",
      });
    });

    it("com Ultracode escolhido, avisa do custo; o × volta ao automático", () => {
      const { aoMudar } = renderizar();

      expect(screen.queryByText(/Ultracode dispara workflows/)).not.toBeInTheDocument();
      fireEvent.click(chipDoEsforco("do orquestrador"));
      fireEvent.click(screen.getByRole("option", { name: "Ultracode" }));

      expect(aoMudar).toHaveBeenLastCalledWith({ ...configuracao, esforcoDoOrquestrador: "ultracode" });
      expect(screen.getByText(/Ultracode dispara workflows com vários agentes em paralelo/)).toHaveClass("hint-warning");

      fireEvent.click(screen.getByRole("button", { name: "Voltar o esforço do orquestrador ao automático" }));
      expect(aoMudar).toHaveBeenLastCalledWith(configuracao);
      expect(screen.queryByText(/Ultracode dispara workflows/)).not.toBeInTheDocument();
    });

    it("só um menu fica aberto por vez", () => {
      renderizar();

      fireEvent.click(chipDoEsforco("do orquestrador"));
      fireEvent.click(chipDoEsforco("dos subagentes"));
      expect(screen.getAllByRole("listbox")).toHaveLength(1);
      expect(screen.getByRole("listbox", { name: "Esforço dos subagentes" })).toBeInTheDocument();

      fireEvent.click(chipDaQuantidade());
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      expect(screen.getByRole("dialog", { name: "Quantos subagentes" })).toBeInTheDocument();
    });
  });

  it("quantidade: fixa ou automática, de 1 a 10, e o × volta ao padrão", () => {
    const { aoMudar } = renderizar();

    fireEvent.click(chipDaQuantidade());
    fireEvent.click(screen.getByRole("button", { name: "Sempre" }));
    expect(aoMudar).toHaveBeenLastCalledWith({ ...configuracao, quantidadeDeSubagentes: { modo: "fixa", limite: 3 } });
    fireEvent.click(screen.getByRole("button", { name: "Mais subagentes" }));
    expect(chipDaQuantidade()).toHaveTextContent("sempre 4");
    for (let i = 0; i < 12; i++) {
      fireEvent.click(screen.getByRole("button", { name: "Mais subagentes" }));
    }
    expect(screen.getByRole("button", { name: "Mais subagentes" })).toBeDisabled();
    expect(aoMudar).toHaveBeenLastCalledWith({ ...configuracao, quantidadeDeSubagentes: { modo: "fixa", limite: 10 } });

    fireEvent.click(screen.getByRole("button", { name: "Voltar a quantidade ao padrão, até 3 por vez" }));
    expect(chipDaQuantidade()).toHaveTextContent("até 3 por vez");
  });

  describe("aviso de esforço herdado", () => {
    const aviso = /No automático, o Claude Code usa/;

    it("no automático e com deveAvisar, avisa só na linha correspondente, com a origem", async () => {
      renderizar({}, { buscarEsforcoHerdado: async () => HERDADO_EXTRA_ALTO });

      const texto = await screen.findByText(aviso);
      expect(texto).toHaveTextContent("Extra alto");
      expect(texto).toHaveTextContent("~/.claude/settings.json");
      expect(screen.getAllByText(aviso)).toHaveLength(1);
      // O aviso fica na coluna do orquestrador, junto do chip dele.
      expect(within(texto.parentElement!).getByRole("button", { name: /^Esforço do orquestrador:/ })).toBeInTheDocument();
    });

    it("com um nível escolhido no chip, não avisa", async () => {
      const buscar = vi.fn(async () => HERDADO_EXTRA_ALTO);
      renderizar({ esforcoDoOrquestrador: "medio" }, { buscarEsforcoHerdado: buscar });

      await waitFor(() => expect(buscar).toHaveBeenCalled());
      await act(async () => Promise.resolve());
      expect(screen.queryByText(aviso)).not.toBeInTheDocument();
    });

    it("quando a busca falha, segue sem aviso e sem erro", async () => {
      const buscar = vi.fn(async (): Promise<EsforcosHerdados> => {
        throw new Error("Não foi possível falar com o servidor.");
      });
      renderizar({}, { buscarEsforcoHerdado: buscar });

      await waitFor(() => expect(buscar).toHaveBeenCalled());
      await act(async () => Promise.resolve());
      expect(screen.queryByText(aviso)).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  describe("commit e push", () => {
    it("começa desligado e, ao ligar, muda só essa opção", () => {
      const { aoMudar, commit } = renderizar();

      expect(commit).not.toBeChecked();
      fireEvent.click(commit);
      expect(aoMudar).toHaveBeenCalledWith({ ...configuracao, permitirCommitEPush: true });
      expect(commit).toBeChecked();
    });

    it("ligado sem permissão de rodar comandos, avisa sem bloquear; com ela, não avisa", () => {
      const { commit } = renderizar({ permitirCommitEPush: true, nivelDePermissao: "edicao" });

      expect(commit).toBeChecked();
      expect(screen.getByText("Só vale com Editar e rodar comandos.")).toBeInTheDocument();
      expect(commit).toBeEnabled();

      fireEvent.click(screen.getByRole("radio", { name: "Editar e rodar comandos" }));
      expect(screen.queryByText("Só vale com Editar e rodar comandos.")).not.toBeInTheDocument();
    });
  });

  describe("modo econômico", () => {
    it("sem predefinições do servidor, o botão não aparece", () => {
      renderizar();

      expect(screen.queryByRole("button", { name: "Modo econômico" })).not.toBeInTheDocument();
    });

    it("explica no title o que muda e, sem aplicarPredefinicao, só preenche os campos", async () => {
      vi.spyOn(api, "listarPredefinicoes").mockResolvedValue([ECONOMICO]);
      const { aoMudar } = renderizar({ esforcoDoOrquestrador: "maximo", nivelDePermissao: "leitura" });
      const botao = await screen.findByRole("button", { name: "Modo econômico" });

      expect(botao).toHaveAttribute("title", expect.stringContaining("Gasta menos tokens por pedido."));
      expect(botao).toHaveAttribute("title", expect.stringContaining("• Esforço do orquestrador: Médio"));

      fireEvent.click(botao);
      expect(aoMudar).toHaveBeenCalledWith({
        ...configuracao,
        ...ECONOMICO.configuracao,
        // O que a predefinição não muda fica como estava.
        nivelDePermissao: "leitura",
      });
    });

    it("no ⚙, aplica no servidor (\"Aplicando…\") e mostra a configuração devolvida", async () => {
      vi.spyOn(api, "listarPredefinicoes").mockResolvedValue([ECONOMICO]);
      const devolvida: DadosDaConfiguracao = { ...configuracao, ...ECONOMICO.configuracao };
      let responder: (valor: DadosDaConfiguracao) => void = () => undefined;
      const aplicar = vi.fn(() => new Promise<DadosDaConfiguracao>((resolver) => (responder = resolver)));
      const { aoMudar } = renderizar({}, { aplicarPredefinicao: aplicar });

      fireEvent.click(await screen.findByRole("button", { name: "Modo econômico" }));
      expect(screen.getByRole("button", { name: "Aplicando…" })).toBeDisabled();
      expect(aplicar).toHaveBeenCalledWith("economico");

      await act(async () => responder(devolvida));
      expect(aoMudar).toHaveBeenCalledWith(devolvida);
      expect(chipDoEsforco("do orquestrador")).toHaveTextContent("esforço médio");
      expect(chipDaQuantidade()).toHaveTextContent("até 1 por vez");
      expect(screen.getByRole("button", { name: "Modo econômico" })).toBeEnabled();
    });

    it("no ⚙, mostra o erro do servidor sem mudar os campos", async () => {
      vi.spyOn(api, "listarPredefinicoes").mockResolvedValue([ECONOMICO]);
      const aplicar = vi.fn(async (): Promise<DadosDaConfiguracao> => {
        throw new ErroDaApi("Orquestrador não encontrado.", 404);
      });
      const { aoMudar } = renderizar({}, { aplicarPredefinicao: aplicar });

      fireEvent.click(await screen.findByRole("button", { name: "Modo econômico" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Não foi possível aplicar o modo econômico: Orquestrador não encontrado.",
      );
      expect(aoMudar).not.toHaveBeenCalled();
    });
  });

  describe("tamanho da letra", () => {
    it("sem a prop, a linha não aparece", () => {
      renderizar();

      expect(screen.queryByRole("radiogroup", { name: "Tamanho da letra" })).not.toBeInTheDocument();
    });

    it("com a prop, mostra a escolhida e a troca vale na hora, sem mexer na configuração", () => {
      const aoMudarALetra = vi.fn();
      const { aoMudar } = renderizar({}, { tamanhoDaLetra: { valor: 1.15, aoMudar: aoMudarALetra } });
      const grupo = screen.getByRole("radiogroup", { name: "Tamanho da letra" });

      expect(within(grupo).getAllByRole("radio").map((opcao) => opcao.closest("label")?.textContent)).toEqual([
        "Normal",
        "Grande",
        "Maior",
      ]);
      expect(within(grupo).getByRole("radio", { name: "Grande" })).toBeChecked();

      fireEvent.click(within(grupo).getByRole("radio", { name: "Maior" }));
      expect(aoMudarALetra).toHaveBeenCalledWith(1.3);
      expect(aoMudar).not.toHaveBeenCalled();
    });
  });

  describe("instruções", () => {
    const campo = () => screen.getByRole("textbox", { name: "Instruções" });

    it("começa vazio, com contador, e muda só esse campo ao digitar", () => {
      const { aoMudar } = renderizar();

      expect(campo()).toHaveValue("");
      expect(screen.getByText("0 / 4.000")).toBeInTheDocument();

      fireEvent.change(campo(), { target: { value: "Comece com PIRULITO.\nDepois o resto." } });
      expect(aoMudar).toHaveBeenLastCalledWith({
        ...configuracao,
        instrucoesPersonalizadas: "Comece com PIRULITO.\nDepois o resto.",
      });
    });

    it("o contador ignora espaço sobrando, como o servidor", () => {
      renderizar({ instrucoesPersonalizadas: "  abc  \n\n\n\n" });

      expect(screen.getByText("3 / 4.000")).toBeInTheDocument();
    });

    it("acima do limite, avisa sem cortar o texto", () => {
      const longo = "x".repeat(4_001);
      renderizar({ instrucoesPersonalizadas: longo });

      expect(campo()).toHaveValue(longo);
      expect(campo()).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByRole("alert")).toHaveTextContent(/Passou do limite de 4.000 caracteres/);
    });

    it("tem o link de pré-visualizar o prompt final", () => {
      renderizar();

      expect(screen.getByRole("button", { name: "Pré-visualizar prompt final" })).toHaveAttribute("aria-expanded", "false");
    });
  });
});
