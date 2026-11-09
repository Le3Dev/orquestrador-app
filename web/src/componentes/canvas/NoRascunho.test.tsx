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
const chipDoEsforco = () => screen.getByRole("button", { name: /^Esforço do orquestrador:/ });
const chipDaQuantidade = () => screen.getByRole("button", { name: /^Subagentes:/ });

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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("mostra tudo de uma vez, com os padrões, e diz por que ainda não começa", async () => {
    abrir();

    expect(await screen.findByRole("option", { name: "todos os projetos (pasta raiz)" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Somente leitura" })).toBeChecked();
    expect(screen.getByRole("combobox", { name: "Orquestrador" })).toHaveValue("opus");
    expect(screen.getByRole("combobox", { name: "Subagentes" })).toHaveValue("opus");
    expect(chipDoEsforco()).toHaveTextContent("esforço automático");
    expect(chipDaQuantidade()).toHaveTextContent("até 3 por vez");
    expect(screen.getByRole("switch", { name: "Commit e push quando eu pedir" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("textbox", { name: "Instruções" })).toBeInTheDocument();
    expect(screen.getAllByRole("switch")).toHaveLength(1);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByText("Escolha uma pasta para começar.")).toBeInTheDocument();
    expect(botaoDeComecar()).toBeDisabled();
    expect(screen.getByText("novo orquestrador")).toBeInTheDocument();
  });

  it("os seletores de modelo têm Fable, Opus, Sonnet e Haiku", async () => {
    abrir();
    await screen.findByRole("option", { name: "app" });

    for (const nome of ["Orquestrador", "Subagentes"]) {
      const seletor = screen.getByRole("combobox", { name: nome });
      expect(within(seletor).getAllByRole("option").map((opcao) => opcao.getAttribute("value"))).toEqual([
        "fable",
        "opus",
        "sonnet",
        "haiku",
      ]);
    }
    fireEvent.change(screen.getByRole("combobox", { name: "Orquestrador" }), { target: { value: "fable" } });
    expect(screen.getByRole("combobox", { name: "Orquestrador" })).toHaveValue("fable");
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

    expect(screen.getByRole("combobox", { name: "Orquestrador" })).toHaveValue("sonnet");
    expect(screen.getByRole("combobox", { name: "Subagentes" })).toHaveValue("haiku");
    expect(chipDoEsforco()).toHaveTextContent("esforço médio");
    expect(chipDaQuantidade()).toHaveTextContent("até 1 por vez");
    fireEvent.change(screen.getByRole("combobox", { name: "Subagentes" }), { target: { value: "opus" } });
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

    fireEvent.click(chipDoEsforco());
    fireEvent.click(screen.getByRole("option", { name: "Alto" }));
    expect(screen.queryByText(/No automático, o Claude Code usa/)).not.toBeInTheDocument();
  });

  it("começar envia o que foi escolhido, sem campos a mais", async () => {
    const criado = { id: "novo" } as ResumoDoOrquestrador;
    const criar = vi.spyOn(api, "criarOrquestrador").mockResolvedValue(criado);
    const acoes = await abrirComPasta();
    fireEvent.change(screen.getByRole("combobox", { name: "Subagentes" }), { target: { value: "haiku" } });
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
      instrucoesPersonalizadas: "Seja breve.",
    });
    await waitFor(() => expect(acoes.orquestradorCriado).toHaveBeenCalledWith("rascunho:1", criado));
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

  it("o chip de esforço muda pelo menu e o × volta ao automático", async () => {
    const criar = espiarCriacao();
    await abrirComPasta();

    fireEvent.click(chipDoEsforco());
    const menu = screen.getByRole("listbox", { name: "Esforço do orquestrador" });
    expect(within(menu).getAllByRole("option")).toHaveLength(7);
    expect(within(menu).getAllByRole("option").at(-1)).toHaveTextContent("Ultracode");
    expect(within(menu).getByRole("option", { name: /Automático/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(within(menu).getByRole("option", { name: "Alto" }));

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(chipDoEsforco()).toHaveTextContent("esforço alto");
    expect(chipDoEsforco()).toHaveFocus();
    expect(screen.getByText("Somente leitura, Opus (esforço alto) com até 3 subagentes Opus.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Voltar o esforço do orquestrador ao automático" }));
    expect(chipDoEsforco()).toHaveTextContent("esforço automático");

    fireEvent.click(screen.getByRole("button", { name: /^Esforço dos subagentes:/ }));
    fireEvent.click(screen.getByRole("option", { name: "Máximo" }));
    expect(await criarEPegarPayload(criar)).toMatchObject({ esforcoDoOrquestrador: "padrao", esforcoDosSubagentes: "maximo" });
  });

  it("Ultracode só existe no esforço do orquestrador e, escolhido, avisa do custo", async () => {
    const criar = espiarCriacao();
    await abrirComPasta();

    fireEvent.click(screen.getByRole("button", { name: /^Esforço dos subagentes:/ }));
    const dosSubagentes = screen.getByRole("listbox", { name: "Esforço dos subagentes" });
    expect(within(dosSubagentes).getAllByRole("option")).toHaveLength(6);
    expect(within(dosSubagentes).queryByRole("option", { name: "Ultracode" })).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByText(/Ultracode dispara workflows/)).not.toBeInTheDocument();
    fireEvent.click(chipDoEsforco());
    fireEvent.click(screen.getByRole("option", { name: "Ultracode" }));

    expect(chipDoEsforco()).toHaveTextContent("esforço ultracode");
    expect(screen.getByText(/Ultracode dispara workflows com vários agentes em paralelo/)).toHaveClass("hint-warning");
    expect(await criarEPegarPayload(criar)).toMatchObject({ esforcoDoOrquestrador: "ultracode", esforcoDosSubagentes: "padrao" });
  });

  it("Esc e clique fora fecham o menu, e só um fica aberto por vez", async () => {
    abrir();
    await screen.findByRole("option", { name: "app" });

    fireEvent.click(chipDoEsforco());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(chipDoEsforco()).toHaveFocus();

    fireEvent.click(chipDoEsforco());
    fireEvent.pointerDown(screen.getByText("novo orquestrador"));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    fireEvent.click(chipDoEsforco());
    fireEvent.click(chipDaQuantidade());
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Quantos subagentes" })).toBeInTheDocument();
  });

  it("quantidade fixa ou automática, com os limites de 1 a 10 e o × que volta ao padrão", async () => {
    const criar = espiarCriacao();
    await abrirComPasta();

    fireEvent.click(chipDaQuantidade());
    fireEvent.click(screen.getByRole("button", { name: "Sempre" }));
    fireEvent.click(screen.getByRole("button", { name: "Mais subagentes" }));
    expect(screen.getByText("Sempre 4 subagentes.")).toBeInTheDocument();
    expect(chipDaQuantidade()).toHaveTextContent("sempre 4");
    for (let i = 0; i < 12; i++) {
      fireEvent.click(screen.getByRole("button", { name: "Mais subagentes" }));
    }
    expect(screen.getByRole("button", { name: "Mais subagentes" })).toBeDisabled();
    expect(await criarEPegarPayload(criar)).toMatchObject({ quantidadeDeSubagentes: { modo: "fixa", limite: 10 } });

    fireEvent.click(screen.getByRole("button", { name: "Voltar a quantidade ao padrão, até 3 por vez" }));
    expect(chipDaQuantidade()).toHaveTextContent("até 3 por vez");
  });

  it("commit e push avisam quando falta a permissão de rodar comandos", async () => {
    const criar = espiarCriacao();
    await abrirComPasta();
    const commit = screen.getByRole("switch", { name: "Commit e push quando eu pedir" });

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
    ["modelo", () => fireEvent.change(screen.getByRole("combobox", { name: "Subagentes" }), { target: { value: "haiku" } })],
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
