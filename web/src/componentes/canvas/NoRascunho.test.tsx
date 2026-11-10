import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { type NodeProps, ReactFlowProvider } from "@xyflow/react";

import { api, ErroDaApi } from "../../shared/api/cliente";
import type { DadosDaPredefinicao, ResumoDoOrquestrador } from "../../shared/api/tipos";
import { ProvedorDoCanvas, type ValorDoCanvas } from "../../shared/canvas/contexto";
import type { NoRascunho as TipoDoNo } from "../../shared/canvas/nos";
import { CONFIRMACAO_PARA_DESCARTAR_O_RASCUNHO, NoRascunho } from "./NoRascunho";

const PROPS: NodeProps<TipoDoNo> = {
  id: "rascunho:1",
  type: "rascunho",
  data: {},
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
  height: 720,
};

const ECONOMICO: DadosDaPredefinicao = {
  nome: "economico",
  rotulo: "Modo econômico",
  descricao: "Gasta menos tokens por pedido.",
  configuracao: {
    modeloDoOrquestrador: "sonnet",
    esforcoDoOrquestrador: "medio",
    modeloDosSubagentes: "haiku",
    quantidadeDeSubagentes: { modo: "automatica", limite: 1 },
  },
};

function abrir(conectado = true) {
  const acoes = {
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
  const valor = {
    orquestradores: new Map(),
    conversas: new Map(),
    conexoes: new Map(),
    sinais: new Map(),
    bixinhosLimpos: new Map(),
    servidor: { conectado, caiuEm: null, voltouEm: null, reiniciou: false, memoria: null },
    acoes,
  } as unknown as ValorDoCanvas;
  const arvore = (valorAtual: ValorDoCanvas) => (
    <ReactFlowProvider>
      <ProvedorDoCanvas valor={valorAtual}>
        <NoRascunho {...PROPS} />
      </ProvedorDoCanvas>
    </ReactFlowProvider>
  );
  const { rerender } = render(arvore(valor));
  const mudarConexao = (agora: boolean) =>
    rerender(arvore({ ...valor, servidor: { ...valor.servidor, conectado: agora } }));
  /** O servidor volta: mesma tela, agora conectada. */
  const reconectar = () => mudarConexao(true);
  /** O servidor cai com a tela aberta. */
  const desconectar = () => mudarConexao(false);
  return Object.assign(acoes, { reconectar, desconectar });
}

const campoDaPasta = () => screen.getByRole("combobox", { name: "Pasta de trabalho" });
const campoDoNome = () => screen.getByRole("textbox", { name: "Nome" });
const botaoDeComecar = () => screen.getByRole("button", { name: /^Começar/ });
const menuDoModelo = (dono: "do orquestrador" | "dos subagentes") =>
  screen.getByRole("button", { name: new RegExp(`^Modelo ${dono}:`) });
/** Abre o menu do modelo e escolhe o modelo (o menu fecha). */
function escolherModelo(dono: "do orquestrador" | "dos subagentes", nome: RegExp): void {
  fireEvent.click(menuDoModelo(dono));
  fireEvent.click(screen.getByRole("menuitemradio", { name: nome }));
}
/** Abre o menu do modelo, entra em "Esforço" e escolhe o nível (o menu continua aberto). */
function escolherEsforco(dono: "do orquestrador" | "dos subagentes", nivel: string): void {
  fireEvent.click(menuDoModelo(dono));
  fireEvent.click(screen.getByRole("menuitem", { name: /^Esforço/ }));
  fireEvent.click(screen.getByRole("menuitemradio", { name: nivel }));
}

/** Abre e escolhe o projeto /p/app da lista. */
async function abrirComPasta() {
  const acoes = abrir();
  await screen.findByRole("option", { name: "app" });
  fireEvent.change(campoDaPasta(), { target: { value: "/p/app" } });
  return acoes;
}

function espiarCriacao() {
  return vi.spyOn(api, "criarOrquestrador").mockResolvedValue({ id: "novo" } as ResumoDoOrquestrador);
}

/** Cria e devolve o que foi enviado ao servidor. */
async function criarEPegarPayload(criar: ReturnType<typeof espiarCriacao>) {
  fireEvent.click(botaoDeComecar());
  await waitFor(() => expect(criar).toHaveBeenCalled());
  return criar.mock.calls[0]?.[0];
}

describe("NoRascunho", () => {
  beforeEach(() => {
    vi.spyOn(api, "listarPastas").mockResolvedValue({
      raiz: "/p",
      pastas: [
        { nome: "app", caminho: "/p/app" },
        { nome: "site", caminho: "/p/site" },
      ],
    });
    // Sem resposta por padrão: os testes que dependem delas trocam o retorno.
    vi.spyOn(api, "listarPredefinicoes").mockReturnValue(new Promise(() => undefined));
    vi.spyOn(api, "lerEsforcoHerdado").mockReturnValue(new Promise(() => undefined));
    vi.spyOn(api, "lerPreferencias").mockReturnValue(new Promise(() => undefined));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("mostra tudo de uma vez, com os padrões, e diz por que ainda não começa", async () => {
    abrir();

    expect(await screen.findByRole("option", { name: "todos os projetos (pasta raiz)" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Somente leitura" })).toBeChecked();
    expect(menuDoModelo("do orquestrador")).toHaveTextContent("Opus 5.5");
    expect(menuDoModelo("dos subagentes")).toHaveTextContent("Opus 5.5");
    expect(menuDoModelo("do orquestrador")).toHaveTextContent("esforço padrão");
    expect(screen.getByRole("radio", { name: /Automática/ })).toBeChecked();
    expect(screen.getByLabelText("Máximo")).toHaveValue(3);
    expect(screen.getByRole("switch", { name: "Commit e push por feature" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("switch", { name: "Publicar artefatos no claude.ai" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("textbox", { name: "Instruções" })).toBeInTheDocument();
    expect(screen.getAllByRole("switch")).toHaveLength(2);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByText("Escolha uma pasta para começar.")).toBeInTheDocument();
    expect(botaoDeComecar()).toBeDisabled();
    expect(screen.getByText("novo orquestrador")).toBeInTheDocument();
  });

  it("os menus de modelo têm Fable, Opus, Sonnet e Haiku", async () => {
    abrir();
    await screen.findByRole("option", { name: "app" });

    for (const dono of ["do orquestrador", "dos subagentes"] as const) {
      fireEvent.click(menuDoModelo(dono));
      const itens = screen.getAllByRole("menuitemradio");
      expect(itens.map((item) => item.textContent)).toEqual([
        expect.stringMatching(/^Fable 5\.2/),
        expect.stringMatching(/^Opus 5\.5/),
        expect.stringMatching(/^Sonnet 5\.5/),
        expect.stringMatching(/^Haiku 5\.5/),
      ]);
      fireEvent.keyDown(document, { key: "Escape" });
    }
    escolherModelo("do orquestrador", /^Fable/);
    expect(menuDoModelo("do orquestrador")).toHaveTextContent("Fable 5.2");
  });

  it("escolher a pasta da lista dá o nome, o título e o resumo de pronto", async () => {
    await abrirComPasta();

    expect(campoDoNome()).toHaveValue("app");
    expect(screen.getByText("novo orquestrador · app")).toBeInTheDocument();
    expect(botaoDeComecar()).toHaveTextContent("Começar em app");
    expect(botaoDeComecar()).toBeEnabled();
    expect(screen.getByText("Somente leitura, Opus (esforço automático) com até 3 subagentes Opus.")).toBeInTheDocument();
    expect(screen.getByText("/p/app · instruções gerais")).toBeInTheDocument();
  });

  it("um nome digitado não é trocado ao mudar de pasta; o sugerido segue a pasta", async () => {
    await abrirComPasta();

    fireEvent.change(campoDaPasta(), { target: { value: "/p/site" } });
    expect(campoDoNome()).toHaveValue("site");

    fireEvent.change(campoDoNome(), { target: { value: "API" } });
    fireEvent.change(campoDaPasta(), { target: { value: "/p/app" } });
    expect(campoDoNome()).toHaveValue("API");
  });

  it("\"procurar…\" escolhe uma pasta do computador, que entra na lista e dá o nome", async () => {
    vi.spyOn(api, "navegarPastas").mockResolvedValue({ caminho: "/u/api-pagamentos", pai: "/u", pastas: [] });
    abrir();

    fireEvent.click(screen.getByRole("button", { name: "procurar…" }));
    const janela = await screen.findByRole("dialog", { name: "Escolher pasta do computador" });
    const usar = within(janela).getByRole("button", { name: /usar esta pasta/ });
    await waitFor(() => expect(usar).toBeEnabled());
    fireEvent.click(usar);

    expect(screen.queryByRole("dialog", { name: "Escolher pasta do computador" })).not.toBeInTheDocument();
    expect(campoDaPasta()).toHaveValue("/u/api-pagamentos");
    expect(screen.getByRole("option", { name: "api-pagamentos (pasta do computador)" })).toBeInTheDocument();
    expect(campoDoNome()).toHaveValue("api-pagamentos");
  });

  it("com o servidor fora, espera; quando ele volta, carrega as pastas e deixa começar", async () => {
    const listar = vi.spyOn(api, "listarPastas");
    const { reconectar } = abrir(false);

    expect(screen.getByRole("option", { name: "carregando pastas…" })).toBeInTheDocument();
    expect(listar).not.toHaveBeenCalled();

    reconectar();
    await screen.findByRole("option", { name: "app" });
    fireEvent.change(campoDaPasta(), { target: { value: "/p/app" } });
    expect(botaoDeComecar()).toBeEnabled();
  });

  it("se o servidor cai depois de escolher a pasta, não começa e diz por quê", async () => {
    const { desconectar } = await abrirComPasta();
    expect(botaoDeComecar()).toBeEnabled();

    desconectar();

    expect(screen.getByText("Servidor desconectado.")).toBeInTheDocument();
    expect(botaoDeComecar()).toBeDisabled();
  });

  it("trocar de pasta limpa o erro da criação", async () => {
    vi.spyOn(api, "criarOrquestrador").mockRejectedValue(new ErroDaApi("A pasta não existe.", 400));
    await abrirComPasta();
    fireEvent.click(botaoDeComecar());
    expect(await screen.findByRole("alert")).toHaveTextContent("A pasta não existe.");

    fireEvent.change(campoDaPasta(), { target: { value: "/p/site" } });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("/p/site · instruções gerais")).toBeInTheDocument();
  });

  it("a falha ao carregar as pastas aparece no rodapé", async () => {
    vi.spyOn(api, "listarPastas").mockRejectedValueOnce(new ErroDaApi("Sem resposta.", 500));
    abrir();

    expect(await screen.findByRole("alert")).toHaveTextContent("Sem resposta.");
    expect(botaoDeComecar()).toBeDisabled();
  });

  it("o Modo econômico preenche os campos, que continuam editáveis", async () => {
    vi.spyOn(api, "listarPredefinicoes").mockResolvedValue([ECONOMICO]);
    const criar = espiarCriacao();
    await abrirComPasta();

    const botao = await screen.findByRole("button", { name: "Modo econômico" });
    expect(botao).toHaveAttribute("title", expect.stringContaining("Gasta menos tokens por pedido."));
    fireEvent.click(botao);

    expect(menuDoModelo("do orquestrador")).toHaveTextContent("Sonnet");
    expect(menuDoModelo("dos subagentes")).toHaveTextContent("Haiku");
    expect(menuDoModelo("do orquestrador")).toHaveTextContent("esforço médio");
    expect(screen.getByLabelText("Máximo")).toHaveValue(1);
    escolherModelo("dos subagentes", /^Opus/);
    expect(await criarEPegarPayload(criar)).toMatchObject({
      modeloDoOrquestrador: "sonnet",
      esforcoDoOrquestrador: "medio",
      modeloDosSubagentes: "opus",
      quantidadeDeSubagentes: { modo: "automatica", limite: 1 },
    });
  });

  it("avisa do esforço herdado no automático, e some ao escolher um nível", async () => {
    const ler = vi.spyOn(api, "lerEsforcoHerdado").mockResolvedValue({
      orquestrador: { nivel: "maximo", origem: "~/.claude/settings.json", modelo: "opus", deveAvisar: true },
      subagentes: { nivel: "baixo", origem: "padrão do modelo", modelo: "opus", deveAvisar: false },
    } as Awaited<ReturnType<typeof api.lerEsforcoHerdado>>);
    abrir();
    await screen.findByRole("option", { name: "app" });
    // A troca de pasta busca o esforço de novo: a resposta chega dentro do act.
    await act(async () => {
      fireEvent.change(campoDaPasta(), { target: { value: "/p/app" } });
      await Promise.resolve();
    });

    const aviso = await screen.findByText(/No automático, o Claude Code usa/);
    expect(aviso).toHaveTextContent("Máximo");
    expect(aviso).toHaveTextContent("~/.claude/settings.json");
    expect(screen.getAllByText(/No automático, o Claude Code usa/)).toHaveLength(1);
    expect(ler).toHaveBeenLastCalledWith("opus", "opus", "/p/app");

    escolherEsforco("do orquestrador", "Alto");
    expect(screen.queryByText(/No automático, o Claude Code usa/)).not.toBeInTheDocument();
  });

  it("começar envia o que foi escolhido, sem campos a mais", async () => {
    const criado = { id: "novo" } as ResumoDoOrquestrador;
    const criar = vi.spyOn(api, "criarOrquestrador").mockResolvedValue(criado);
    const acoes = await abrirComPasta();
    escolherModelo("dos subagentes", /^Haiku/);
    fireEvent.change(screen.getByRole("textbox", { name: "Instruções" }), { target: { value: "Seja breve." } });

    const payload = await criarEPegarPayload(criar);

    expect(payload).toEqual({
      nome: "app",
      pastaDeTrabalho: "/p/app",
      modeloDoOrquestrador: "opus",
      esforcoDoOrquestrador: "padrao",
      modeloDosSubagentes: "haiku",
      esforcoDosSubagentes: "padrao",
      quantidadeDeSubagentes: { modo: "automatica", limite: 3 },
      nivelDePermissao: "leitura",
      permitirCommitEPush: false,
      permitirArtefatosOnline: false,
      instrucoesPersonalizadas: "Seja breve.",
    });
    await waitFor(() => expect(acoes.orquestradorCriado).toHaveBeenCalledWith("rascunho:1", criado));
  });

  it("o interruptor de artefatos online liga, aparece no resumo e vai no pedido de criação", async () => {
    const criar = espiarCriacao();
    await abrirComPasta();

    fireEvent.click(screen.getByRole("switch", { name: "Publicar artefatos no claude.ai" }));

    expect(screen.getByRole("switch", { name: "Publicar artefatos no claude.ai" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("/p/app · artefatos online · instruções gerais")).toBeInTheDocument();
    expect(await criarEPegarPayload(criar)).toMatchObject({ permitirArtefatosOnline: true });
  });

  describe("aplicar perfil de instruções", () => {
    const seletor = () => screen.getByRole("combobox", { name: "Aplicar perfil de instruções" });
    const campoDasInstrucoes = () => screen.getByRole("textbox", { name: "Instruções" });

    function comPerfis() {
      vi.spyOn(api, "lerPreferencias").mockResolvedValue({
        instrucoesPadrao: "",
        subagentesProntos: [],
        perfisDeInstrucoes: [
          { nome: "Backend", texto: "Use Jest." },
          { nome: "Front", texto: "Use Vitest." },
        ],
      });
    }

    it("sem perfis, o select não aparece", async () => {
      vi.spyOn(api, "lerPreferencias").mockResolvedValue({ instrucoesPadrao: "", subagentesProntos: [] });
      abrir();
      await screen.findByRole("option", { name: "app" });

      await act(async () => Promise.resolve());
      expect(screen.queryByRole("combobox", { name: "Aplicar perfil de instruções" })).not.toBeInTheDocument();
    });

    it("copia o texto do perfil para as instruções, que vão no começar", async () => {
      comPerfis();
      const criar = espiarCriacao();
      await abrirComPasta();

      fireEvent.change(await screen.findByRole("combobox", { name: "Aplicar perfil de instruções" }), {
        target: { value: "0" },
      });
      expect(campoDasInstrucoes()).toHaveValue("Use Jest.");
      expect(seletor()).toHaveValue("");

      const payload = await criarEPegarPayload(criar);
      expect(payload).toMatchObject({ instrucoesPersonalizadas: "Use Jest." });
    });

    it("com outro texto escrito, confirma antes de trocar", async () => {
      comPerfis();
      const confirmar = vi.spyOn(window, "confirm").mockReturnValue(false);
      abrir();
      fireEvent.change(campoDasInstrucoes(), { target: { value: "Meu texto." } });

      fireEvent.change(await screen.findByRole("combobox", { name: "Aplicar perfil de instruções" }), {
        target: { value: "1" },
      });
      expect(confirmar).toHaveBeenCalledWith(expect.stringContaining('pelas do perfil "Front"'));
      expect(campoDasInstrucoes()).toHaveValue("Meu texto.");

      confirmar.mockReturnValue(true);
      fireEvent.change(seletor(), { target: { value: "1" } });
      expect(campoDasInstrucoes()).toHaveValue("Use Vitest.");
    });
  });

  it("o tamanho da letra começa no Normal e a troca vai para o nó, não para o servidor", async () => {
    const acoes = abrir();
    await screen.findByRole("option", { name: "app" });
    const grupo = screen.getByRole("radiogroup", { name: "Tamanho da letra" });

    expect(within(grupo).getAllByRole("radio")).toHaveLength(3);
    expect(within(grupo).getByRole("radio", { name: "Normal" })).toBeChecked();

    fireEvent.click(within(grupo).getByRole("radio", { name: "Maior" }));
    expect(acoes.mudarEscalaDaLetra).toHaveBeenCalledWith("rascunho:1", 1.3);
  });

  it("Enter no nome cria", async () => {
    const criar = espiarCriacao();
    await abrirComPasta();

    fireEvent.submit(campoDoNome().closest("form") as HTMLFormElement);

    await waitFor(() => expect(criar).toHaveBeenCalledWith(expect.objectContaining({ nome: "app" })));
  });

  it("a permissão muda o payload, e rodar comandos fica em alerta", async () => {
    const criar = espiarCriacao();
    await abrirComPasta();

    fireEvent.click(screen.getByRole("radio", { name: "Editar e rodar comandos" }));

    expect(screen.getByText("Edita, instala, testa e compila. Use só em pastas que você confia.")).toHaveClass("text-warning");
    expect(screen.getByRole("radio", { name: "Editar e rodar comandos" }).closest("label")).toHaveClass(
      "opcao-da-permissao-risco",
    );
    expect(await criarEPegarPayload(criar)).toMatchObject({ nivelDePermissao: "edicao_e_comandos" });
  });

  it("o esforço muda pelo menu do modelo, que continua aberto até escolher o modelo ou apertar Esc", async () => {
    const criar = espiarCriacao();
    await abrirComPasta();

    fireEvent.click(menuDoModelo("do orquestrador"));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Esforço/ }));
    const menu = screen.getByRole("menu", { name: "Esforço" });
    expect(within(menu).getAllByRole("menuitemradio")).toHaveLength(7);
    expect(within(menu).getAllByRole("menuitemradio").at(-1)).toHaveTextContent("Ultracode");
    expect(within(menu).getByRole("menuitemradio", { name: "Padrão" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: "Alto" }));

    // Voltou para a vista raiz, ainda aberto.
    expect(screen.getByRole("menuitem", { name: /^Esforço/ })).toHaveTextContent("Alto");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(menuDoModelo("do orquestrador")).toHaveFocus();
    expect(menuDoModelo("do orquestrador")).toHaveTextContent("esforço alto");
    expect(screen.getByText("Somente leitura, Opus (esforço alto) com até 3 subagentes Opus.")).toBeInTheDocument();

    escolherEsforco("dos subagentes", "Máximo");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(await criarEPegarPayload(criar)).toMatchObject({ esforcoDoOrquestrador: "alto", esforcoDosSubagentes: "maximo" });
  });

  it("Ultracode só existe no esforço do orquestrador e, escolhido, avisa do custo", async () => {
    const criar = espiarCriacao();
    await abrirComPasta();

    fireEvent.click(menuDoModelo("dos subagentes"));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Esforço/ }));
    const dosSubagentes = screen.getByRole("menu", { name: "Esforço" });
    expect(within(dosSubagentes).getAllByRole("menuitemradio")).toHaveLength(6);
    expect(within(dosSubagentes).queryByRole("menuitemradio", { name: "Ultracode" })).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByText(/Ultracode dispara workflows/)).not.toBeInTheDocument();
    escolherEsforco("do orquestrador", "Ultracode");

    expect(menuDoModelo("do orquestrador")).toHaveTextContent("esforço ultracode");
    expect(screen.getByText(/Ultracode dispara workflows com vários agentes em paralelo/)).toHaveClass("hint-warning");
    expect(await criarEPegarPayload(criar)).toMatchObject({ esforcoDoOrquestrador: "ultracode", esforcoDosSubagentes: "padrao" });
  });

  it("Esc e clique fora fecham o menu, e escolher o modelo também", async () => {
    abrir();
    await screen.findByRole("option", { name: "app" });

    fireEvent.click(menuDoModelo("do orquestrador"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(menuDoModelo("do orquestrador")).toHaveFocus();

    fireEvent.click(menuDoModelo("do orquestrador"));
    fireEvent.pointerDown(screen.getByText("novo orquestrador"));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.click(menuDoModelo("do orquestrador"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /^Fable/ }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(menuDoModelo("do orquestrador")).toHaveTextContent("Fable 5.2");
  });

  it("quantidade fixa ou automática, com os limites de 1 a 10", async () => {
    const criar = espiarCriacao();
    await abrirComPasta();
    const grupo = screen.getByRole("radiogroup", { name: "Quantidade de subagentes" });

    expect(within(grupo).getByRole("radio", { name: /Automática/ })).toBeChecked();
    expect(screen.getByLabelText("Máximo")).toHaveValue(3);
    fireEvent.click(within(grupo).getByRole("radio", { name: /Fixa/ }));
    fireEvent.click(screen.getByRole("button", { name: "Aumentar" }));
    expect(screen.getByLabelText("Quantidade")).toHaveValue(4);
    for (let i = 0; i < 12; i++) {
      fireEvent.click(screen.getByRole("button", { name: "Aumentar" }));
    }
    expect(screen.getByRole("button", { name: "Aumentar" })).toBeDisabled();
    expect(await criarEPegarPayload(criar)).toMatchObject({ quantidadeDeSubagentes: { modo: "fixa", limite: 10 } });
  });

  it("commit e push avisam quando falta a permissão de rodar comandos", async () => {
    const criar = espiarCriacao();
    await abrirComPasta();
    const commit = screen.getByRole("switch", { name: "Commit e push por feature" });

    fireEvent.click(commit);
    expect(commit).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Só vale com Editar e rodar comandos.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Editar e rodar comandos" }));
    expect(screen.queryByText("Só vale com Editar e rodar comandos.")).not.toBeInTheDocument();
    expect(screen.getByText("/p/app · commit e push · instruções gerais")).toBeInTheDocument();
    expect(await criarEPegarPayload(criar)).toMatchObject({ permitirCommitEPush: true });
  });

  it("as instruções contam os caracteres e acima do limite não começam", async () => {
    await abrirComPasta();

    fireEvent.change(screen.getByRole("textbox", { name: "Instruções" }), { target: { value: "Rode os testes." } });
    expect(screen.getByText("15 / 4.000")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pré-visualizar prompt final" })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Instruções" }), { target: { value: "x".repeat(4_001) } });
    expect(screen.getByText("Encurte as instruções para começar.")).toBeInTheDocument();
    expect(botaoDeComecar()).toBeDisabled();
  });

  it("as instruções dão a dica das variáveis e a prévia leva a pasta e o nome escolhidos", async () => {
    const previa = vi
      .spyOn(api, "previaDoPrompt")
      .mockResolvedValue({ instrucoesIniciais: "x", mensagem: "y", origemDasInstrucoes: null });
    await abrirComPasta();

    expect(screen.getByText("Use {{pasta}} e {{nome}} para a pasta e o nome do orquestrador.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pré-visualizar prompt final" }));

    await waitFor(() =>
      expect(previa).toHaveBeenCalledWith(expect.any(Object), "/p/app", "execucao", "app"),
    );
  });

  it("sem nome, não começa e diz por quê", async () => {
    await abrirComPasta();

    fireEvent.change(campoDoNome(), { target: { value: "  " } });

    expect(screen.getByText("Dê um nome ao orquestrador para começar.")).toBeInTheDocument();
    expect(botaoDeComecar()).toBeDisabled();
  });

  it("o erro da API aparece em vermelho e dá para tentar de novo", async () => {
    vi.spyOn(api, "criarOrquestrador").mockRejectedValue(new ErroDaApi("A pasta não existe.", 400));
    await abrirComPasta();

    fireEvent.click(botaoDeComecar());

    expect(await screen.findByRole("alert")).toHaveTextContent("A pasta não existe.");
    expect(botaoDeComecar()).toBeEnabled();
  });

  it("descartar pelo rodapé e pelo ✕", async () => {
    const confirmar = vi.spyOn(window, "confirm");
    const acoes = abrir();
    await screen.findByRole("option", { name: "app" });

    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));
    fireEvent.click(screen.getByRole("button", { name: "Descartar rascunho" }));
    expect(acoes.descartarRascunho).toHaveBeenCalledTimes(2);
    expect(acoes.descartarRascunho).toHaveBeenCalledWith("rascunho:1");
    expect(confirmar).not.toHaveBeenCalled();
  });

  it("só a pasta da lista e o nome sugerido por ela descartam sem perguntar", async () => {
    const confirmar = vi.spyOn(window, "confirm");
    const acoes = await abrirComPasta();
    expect(campoDoNome()).toHaveValue("app");

    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));

    expect(confirmar).not.toHaveBeenCalled();
    expect(acoes.descartarRascunho).toHaveBeenCalledWith("rascunho:1");
  });

  it.each([
    ["nome digitado", () => fireEvent.change(campoDoNome(), { target: { value: "API" } })],
    ["instruções", () => fireEvent.change(screen.getByRole("textbox", { name: "Instruções" }), { target: { value: "Seja breve." } })],
    ["permissão", () => fireEvent.click(screen.getByRole("radio", { name: "Editar e rodar comandos" }))],
    ["modelo", () => escolherModelo("dos subagentes", /^Haiku/)],
  ])("com %s alterado, pergunta antes de descartar e recusar mantém o rascunho", async (_campo, alterar) => {
    const confirmar = vi.spyOn(window, "confirm").mockReturnValue(false);
    const acoes = await abrirComPasta();
    alterar();

    fireEvent.click(screen.getByRole("button", { name: "Descartar rascunho" }));
    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));

    expect(confirmar).toHaveBeenCalledTimes(2);
    expect(confirmar).toHaveBeenCalledWith(CONFIRMACAO_PARA_DESCARTAR_O_RASCUNHO);
    expect(acoes.descartarRascunho).not.toHaveBeenCalled();

    confirmar.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));
    expect(acoes.descartarRascunho).toHaveBeenCalledWith("rascunho:1");
  });

  it("voltar a configuração ao padrão deixa descartar sem perguntar de novo", async () => {
    const confirmar = vi.spyOn(window, "confirm");
    const acoes = await abrirComPasta();
    fireEvent.click(screen.getByRole("radio", { name: "Editar e rodar comandos" }));
    fireEvent.click(screen.getByRole("radio", { name: "Somente leitura" }));

    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));

    expect(confirmar).not.toHaveBeenCalled();
    expect(acoes.descartarRascunho).toHaveBeenCalledTimes(1);
  });
});
