import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { type ComponentProps, useState } from "react";

import { api, ErroDaApi } from "../shared/api/cliente";
import type {
  DadosDaConfiguracao,
  DadosDaPredefinicao,
  DadosDasPreferencias,
  DadosDoSubagentePronto,
  EsforcosHerdados,
} from "../shared/api/tipos";
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
  return { aoMudar, commit: screen.getByRole("switch", { name: "Commit e push por feature" }) };
}

type Dono = "do orquestrador" | "dos subagentes";
const menuDoModelo = (dono: Dono) => screen.getByRole("button", { name: new RegExp(`^Modelo ${dono}:`) });
/** Abre o menu do modelo e escolhe o modelo (o menu fecha). */
function escolherModelo(dono: Dono, nome: RegExp): void {
  fireEvent.click(menuDoModelo(dono));
  fireEvent.click(screen.getByRole("menuitemradio", { name: nome }));
}
/** Abre o menu do modelo, entra em "Esforço" e escolhe o nível (o menu continua aberto). */
function escolherEsforco(dono: Dono, nivel: string): void {
  fireEvent.click(menuDoModelo(dono));
  fireEvent.click(screen.getByRole("menuitem", { name: /^Esforço/ }));
  fireEvent.click(screen.getByRole("menuitemradio", { name: nivel }));
  fireEvent.keyDown(document, { key: "Escape" });
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
    // Idem as preferências: sem a biblioteca, a escolha dos subagentes prontos fica sem caixas.
    vi.spyOn(api, "lerPreferencias").mockReturnValue(new Promise<DadosDasPreferencias>(() => undefined));
  });

  afterEach(() => vi.restoreAllMocks());

  it("tem as linhas da criação, sem pasta nem nome, e sem caixas de seleção", () => {
    renderizar();

    expect(screen.getByRole("radiogroup", { name: "Permissão" })).toBeInTheDocument();
    expect(menuDoModelo("do orquestrador")).toHaveTextContent("Opus 5.5");
    expect(menuDoModelo("dos subagentes")).toHaveTextContent("Sonnet 5.5");
    expect(menuDoModelo("do orquestrador")).toHaveTextContent("esforço padrão");
    expect(menuDoModelo("dos subagentes")).toHaveTextContent("esforço padrão");
    expect(screen.getByRole("radiogroup", { name: "Quantidade de subagentes" })).toBeInTheDocument();
    expect(screen.getByLabelText("Máximo")).toHaveValue(3);
    expect(screen.getByRole("textbox", { name: "Instruções" }).closest(".linha-da-criacao")).toHaveClass("linha-instrucoes");
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
    it("oferece Fable, Opus, Sonnet e Haiku nos dois menus, e muda só aquele modelo", () => {
      const { aoMudar } = renderizar();

      for (const dono of ["do orquestrador", "dos subagentes"] as const) {
        fireEvent.click(menuDoModelo(dono));
        expect(screen.getAllByRole("menuitemradio")).toHaveLength(4);
        fireEvent.keyDown(document, { key: "Escape" });
      }

      escolherModelo("do orquestrador", /^Fable/);
      expect(aoMudar).toHaveBeenLastCalledWith({ ...configuracao, modeloDoOrquestrador: "fable" });

      escolherModelo("dos subagentes", /^Haiku/);
      expect(aoMudar).toHaveBeenLastCalledWith({ ...configuracao, modeloDoOrquestrador: "fable", modeloDosSubagentes: "haiku" });
    });
  });

  describe("esforço", () => {
    it("mostra o esforço já escolhido no botão do menu", () => {
      renderizar({ esforcoDoOrquestrador: "extra_alto", esforcoDosSubagentes: "baixo" });

      expect(menuDoModelo("do orquestrador")).toHaveTextContent("esforço extra alto");
      expect(menuDoModelo("dos subagentes")).toHaveTextContent("esforço baixo");
    });

    it("Ultracode só no menu do orquestrador; escolher muda só o esforço correspondente", () => {
      const { aoMudar } = renderizar();

      fireEvent.click(menuDoModelo("do orquestrador"));
      fireEvent.click(screen.getByRole("menuitem", { name: /^Esforço/ }));
      const doOrquestrador = screen.getByRole("menu", { name: "Esforço" });
      expect(within(doOrquestrador).getAllByRole("menuitemradio")).toHaveLength(7);
      expect(within(doOrquestrador).getAllByRole("menuitemradio").at(-1)).toHaveTextContent("Ultracode");
      fireEvent.click(within(doOrquestrador).getByRole("menuitemradio", { name: "Máximo" }));
      expect(aoMudar).toHaveBeenLastCalledWith({ ...configuracao, esforcoDoOrquestrador: "maximo" });
      fireEvent.keyDown(document, { key: "Escape" });
      expect(menuDoModelo("do orquestrador")).toHaveTextContent("esforço máximo");

      fireEvent.click(menuDoModelo("dos subagentes"));
      fireEvent.click(screen.getByRole("menuitem", { name: /^Esforço/ }));
      const dosSubagentes = screen.getByRole("menu", { name: "Esforço" });
      expect(within(dosSubagentes).getAllByRole("menuitemradio")).toHaveLength(6);
      expect(within(dosSubagentes).queryByRole("menuitemradio", { name: "Ultracode" })).not.toBeInTheDocument();
      fireEvent.click(within(dosSubagentes).getByRole("menuitemradio", { name: "Médio" }));
      expect(aoMudar).toHaveBeenLastCalledWith({
        ...configuracao,
        esforcoDoOrquestrador: "maximo",
        esforcoDosSubagentes: "medio",
      });
    });

    it("com Ultracode escolhido, avisa do custo; voltar ao Padrão tira o aviso", () => {
      const { aoMudar } = renderizar();

      expect(screen.queryByText(/Ultracode dispara workflows/)).not.toBeInTheDocument();
      escolherEsforco("do orquestrador", "Ultracode");

      expect(aoMudar).toHaveBeenLastCalledWith({ ...configuracao, esforcoDoOrquestrador: "ultracode" });
      expect(screen.getByText(/Ultracode dispara workflows com vários agentes em paralelo/)).toHaveClass("hint-warning");

      escolherEsforco("do orquestrador", "Padrão");
      expect(aoMudar).toHaveBeenLastCalledWith(configuracao);
      expect(screen.queryByText(/Ultracode dispara workflows/)).not.toBeInTheDocument();
    });
  });

  it("quantidade: automática ou fixa, de 1 a 10", () => {
    const { aoMudar } = renderizar();

    fireEvent.click(screen.getByRole("radio", { name: /Fixa/ }));
    expect(aoMudar).toHaveBeenLastCalledWith({ ...configuracao, quantidadeDeSubagentes: { modo: "fixa", limite: 3 } });
    fireEvent.click(screen.getByRole("button", { name: "Aumentar" }));
    expect(screen.getByLabelText("Quantidade")).toHaveValue(4);
    for (let i = 0; i < 12; i++) {
      fireEvent.click(screen.getByRole("button", { name: "Aumentar" }));
    }
    expect(screen.getByRole("button", { name: "Aumentar" })).toBeDisabled();
    expect(aoMudar).toHaveBeenLastCalledWith({ ...configuracao, quantidadeDeSubagentes: { modo: "fixa", limite: 10 } });

    fireEvent.click(screen.getByRole("radio", { name: /Automática/ }));
    expect(screen.getByLabelText("Máximo")).toHaveValue(10);
  });

  describe("aviso de esforço herdado", () => {
    const aviso = /No automático, o Claude Code usa/;

    it("no automático e com deveAvisar, avisa só na linha correspondente, com a origem", async () => {
      renderizar({}, { buscarEsforcoHerdado: async () => HERDADO_EXTRA_ALTO });

      const texto = await screen.findByText(aviso);
      expect(texto).toHaveTextContent("Extra alto");
      expect(texto).toHaveTextContent("~/.claude/settings.json");
      expect(screen.getAllByText(aviso)).toHaveLength(1);
      // O aviso fica na coluna do orquestrador, junto do menu dele.
      expect(within(texto.parentElement!).getByRole("button", { name: /^Modelo do orquestrador:/ })).toBeInTheDocument();
    });

    it("com um nível escolhido, não avisa", async () => {
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

    it("a explicação diz que cada feature pronta vira um commit com push, e PR e merge só a pedido", () => {
      renderizar();

      const balao = screen.getByRole("button", { name: "O que é Opções" }).getAttribute("aria-describedby");
      const texto = document.getElementById(balao ?? "")?.textContent ?? "";
      expect(texto).toContain("cada feature ou correção pronta (testada, com lint e build ok) vira um commit próprio com push da branch em seguida");
      expect(texto).toContain("feature/, fix/, hotfix/ ou refactor/");
      expect(texto).toContain("PR e merge só quando você pedir");
      expect(texto).toContain("Precisa da permissão de rodar comandos");
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
      expect(menuDoModelo("do orquestrador")).toHaveTextContent("esforço médio");
      expect(screen.getByLabelText("Máximo")).toHaveValue(1);
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

  describe("subagentes prontos", () => {
    const pronto = (nome: string): DadosDoSubagentePronto => ({
      nome,
      descricao: `Faz ${nome}.`,
      prompt: "x",
      modelo: "herdar",
    });
    const grupo = () => screen.getByRole("radiogroup", { name: "Subagentes prontos" });
    const caixas = () => screen.getByRole("group", { name: "Subagentes prontos escolhidos" });

    function comBiblioteca(nomes: string[]) {
      vi.spyOn(api, "lerPreferencias").mockResolvedValue({
        instrucoesPadrao: "",
        subagentesProntos: nomes.map(pronto),
      });
    }

    it("sem a opção salva (orquestrador antigo), marca Todos e não mostra caixas", async () => {
      comBiblioteca(["revisor", "testador"]);
      renderizar();

      expect(within(grupo()).getAllByRole("radio").map((opcao) => opcao.closest("label")?.textContent)).toEqual([
        "Todos",
        "Nenhum",
        "Escolher",
      ]);
      expect(within(grupo()).getByRole("radio", { name: "Todos" })).toBeChecked();
      await act(async () => Promise.resolve());
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    });

    it("Nenhum envia \"nenhum\"", () => {
      const { aoMudar } = renderizar();

      fireEvent.click(within(grupo()).getByRole("radio", { name: "Nenhum" }));
      expect(aoMudar).toHaveBeenLastCalledWith({ ...configuracao, subagentesProntos: "nenhum" });
    });

    it("Escolher começa com todos marcados e envia só os que ficarem", async () => {
      comBiblioteca(["revisor", "testador", "documentador"]);
      const { aoMudar } = renderizar();
      await act(async () => Promise.resolve());

      fireEvent.click(within(grupo()).getByRole("radio", { name: "Escolher" }));
      expect(aoMudar).toHaveBeenLastCalledWith({
        ...configuracao,
        subagentesProntos: ["revisor", "testador", "documentador"],
      });
      expect(within(caixas()).getAllByRole("checkbox")).toHaveLength(3);

      fireEvent.click(within(caixas()).getByRole("checkbox", { name: "testador" }));
      expect(aoMudar).toHaveBeenLastCalledWith({ ...configuracao, subagentesProntos: ["revisor", "documentador"] });
    });

    it("com uma lista salva, marca só os dela; nomes que saíram das preferências somem ao mudar", async () => {
      comBiblioteca(["revisor", "testador"]);
      const { aoMudar } = renderizar({ subagentesProntos: ["testador", "apagado"] });

      expect(within(grupo()).getByRole("radio", { name: "Escolher" })).toBeChecked();
      await screen.findByRole("group", { name: "Subagentes prontos escolhidos" });
      expect(within(caixas()).getByRole("checkbox", { name: "testador" })).toBeChecked();
      expect(within(caixas()).getByRole("checkbox", { name: "revisor" })).not.toBeChecked();

      fireEvent.click(within(caixas()).getByRole("checkbox", { name: "revisor" }));
      expect(aoMudar).toHaveBeenLastCalledWith({ ...configuracao, subagentesProntos: ["revisor", "testador"] });
    });

    it("sem nenhum subagente pronto criado, avisa no lugar das caixas", async () => {
      comBiblioteca([]);
      renderizar({ subagentesProntos: [] });

      expect(await screen.findByText("Nenhum subagente pronto criado ainda.")).toBeInTheDocument();
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
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

    describe("aplicar perfil", () => {
      const seletor = () => screen.getByRole("combobox", { name: "Aplicar perfil de instruções" });
      const PERFIS = [
        { nome: "Backend", texto: "Use Jest." },
        { nome: "Front", texto: "Use Vitest." },
      ];

      function comPerfis(perfisDeInstrucoes: { nome: string; texto: string }[] | undefined) {
        vi.spyOn(api, "lerPreferencias").mockResolvedValue({
          instrucoesPadrao: "",
          subagentesProntos: [],
          ...(perfisDeInstrucoes === undefined ? {} : { perfisDeInstrucoes }),
        });
      }

      it.each([[[]], [undefined]])("sem perfis (%j), o select não aparece", async (perfis) => {
        comPerfis(perfis);
        renderizar();

        await act(async () => Promise.resolve());
        expect(screen.queryByRole("combobox", { name: "Aplicar perfil de instruções" })).not.toBeInTheDocument();
      });

      it("com o campo vazio, copia o texto do perfil sem perguntar e o select volta ao convite", async () => {
        comPerfis(PERFIS);
        const confirmar = vi.spyOn(window, "confirm");
        const { aoMudar } = renderizar();

        await screen.findByRole("combobox", { name: "Aplicar perfil de instruções" });
        expect(within(seletor()).getAllByRole("option").map((opcao) => opcao.textContent)).toEqual([
          "Aplicar perfil…",
          "Backend",
          "Front",
        ]);
        fireEvent.change(seletor(), { target: { value: "1" } });

        expect(confirmar).not.toHaveBeenCalled();
        expect(aoMudar).toHaveBeenLastCalledWith({ ...configuracao, instrucoesPersonalizadas: "Use Vitest." });
        expect(campo()).toHaveValue("Use Vitest.");
        expect(seletor()).toHaveValue("");
      });

      it("com outro texto escrito, pergunta antes; recusar mantém o texto", async () => {
        comPerfis(PERFIS);
        const confirmar = vi.spyOn(window, "confirm").mockReturnValue(false);
        const { aoMudar } = renderizar({ instrucoesPersonalizadas: "Meu texto." });

        fireEvent.change(await screen.findByRole("combobox", { name: "Aplicar perfil de instruções" }), {
          target: { value: "0" },
        });

        expect(confirmar).toHaveBeenCalledWith(expect.stringContaining('pelas do perfil "Backend"'));
        expect(aoMudar).not.toHaveBeenCalled();
        expect(campo()).toHaveValue("Meu texto.");

        confirmar.mockReturnValue(true);
        fireEvent.change(seletor(), { target: { value: "0" } });
        expect(aoMudar).toHaveBeenLastCalledWith({ ...configuracao, instrucoesPersonalizadas: "Use Jest." });
      });

      it("com o mesmo texto do perfil, não pergunta", async () => {
        comPerfis(PERFIS);
        const confirmar = vi.spyOn(window, "confirm");
        renderizar({ instrucoesPersonalizadas: "Use Jest.\n" });

        fireEvent.change(await screen.findByRole("combobox", { name: "Aplicar perfil de instruções" }), {
          target: { value: "0" },
        });

        expect(confirmar).not.toHaveBeenCalled();
        expect(campo()).toHaveValue("Use Jest.");
      });
    });

    it("tem o link de pré-visualizar o prompt final", () => {
      renderizar();

      expect(screen.getByRole("button", { name: "Pré-visualizar prompt final" })).toHaveAttribute("aria-expanded", "false");
    });

    it("dá a dica das variáveis e a prévia leva a pasta e o nome do orquestrador", async () => {
      const previa = vi
        .spyOn(api, "previaDoPrompt")
        .mockResolvedValue({ instrucoesIniciais: "x", mensagem: "y", origemDasInstrucoes: null });
      renderizar({}, { pastaDeTrabalho: "/projetos/painel", nome: "Painel" });

      expect(screen.getByText("Use {{pasta}} e {{nome}} para a pasta e o nome do orquestrador.")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Pré-visualizar prompt final" }));

      await waitFor(() => expect(previa).toHaveBeenCalledWith(configuracao, "/projetos/painel", "execucao", "Painel"));
      previa.mockRestore();
    });
  });
});
