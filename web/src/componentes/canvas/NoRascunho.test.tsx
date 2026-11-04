import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { type NodeProps, ReactFlowProvider } from "@xyflow/react";

import { api, ErroDaApi } from "../../shared/api/cliente";
import type { ResumoDoOrquestrador } from "../../shared/api/tipos";
import { ProvedorDoCanvas, type ValorDoCanvas } from "../../shared/canvas/contexto";
import type { NoRascunho as TipoDoNo } from "../../shared/canvas/nos";
import { NoRascunho } from "./NoRascunho";

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

function existente(id: string, pastaDeTrabalho: string, criadoEm: string): ResumoDoOrquestrador {
  return { id, pastaDeTrabalho, criadoEm, nomeDaPasta: pastaDeTrabalho.split("/").at(-1) } as ResumoDoOrquestrador;
}

function abrir(orquestradores: ResumoDoOrquestrador[] = [], conectado = true) {
  const acoes = {
    abrirTerminal: vi.fn(),
    fecharTerminal: vi.fn(),
    limparBixinhos: vi.fn(),
    orquestradorCriado: vi.fn(),
    descartarRascunho: vi.fn(),
    recarregar: vi.fn(async () => undefined),
    abrirPrevia: vi.fn(),
    navegarPrevia: vi.fn(),
    minimizarOuRestaurarPrevia: vi.fn(),
    fecharPrevia: vi.fn(),
  };
  const valor: ValorDoCanvas = {
    orquestradores: new Map(orquestradores.map((o) => [o.id, o])),
    conversas: new Map(),
    conexoes: new Map(),
    sinais: new Map(),
    bixinhosLimpos: new Map(),
    servidor: { conectado, caiuEm: null, voltouEm: null, reiniciou: false, memoria: null },
    acoes,
  };
  render(
    <ReactFlowProvider>
      <ProvedorDoCanvas valor={valor}>
        <NoRascunho {...PROPS} />
      </ProvedorDoCanvas>
    </ReactFlowProvider>,
  );
  return acoes;
}

/** Abre com uma recente em /p/app e escolhe ela. */
function abrirComPasta() {
  const acoes = abrir([existente("a", "/p/app", "2026-10-01T00:00:00Z")]);
  fireEvent.click(screen.getByRole("button", { name: /^app$/ }));
  return acoes;
}

const botaoDeComecar = () => screen.getByRole("button", { name: /^Começar/ });
const campoDoNome = () => screen.getByRole("textbox", { name: "Nome do orquestrador" });
const chipDoEsforco = () => screen.getByRole("button", { name: /^Esforço do orquestrador:/ });
const chipDaQuantidade = () => screen.getByRole("button", { name: /^Subagentes:/ });

function espiarCriacao() {
  return vi.spyOn(api, "criarOrquestrador").mockResolvedValue(existente("n", "/p/app", "2026-11-03T00:00:00Z"));
}

/** Cria e devolve o que foi enviado ao servidor. */
async function criarEPegarPayload(criar: ReturnType<typeof espiarCriacao>) {
  fireEvent.click(botaoDeComecar());
  await waitFor(() => expect(criar).toHaveBeenCalled());
  return criar.mock.calls[0]?.[0];
}

describe("NoRascunho", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("mostra tudo de uma vez, com os padrões, e diz por que ainda não começa", () => {
    abrir();

    expect(screen.getByText("Nenhuma pasta escolhida")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Só olhar e responder" })).toBeChecked();
    expect(screen.getByRole("combobox", { name: "Orquestrador" })).toHaveValue("opus");
    expect(screen.getByRole("combobox", { name: "Subagentes" })).toHaveValue("opus");
    expect(chipDoEsforco()).toHaveTextContent("esforço automático");
    expect(chipDaQuantidade()).toHaveTextContent("até 3 por vez");
    expect(screen.getByRole("switch", { name: "Commit e push quando eu pedir" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("textbox", { name: "Instruções" })).toBeInTheDocument();
    // Só o commit é escolha: o trivial e o plano vão sempre ligados.
    expect(screen.getAllByRole("switch")).toHaveLength(1);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByText("Escolha uma pasta para começar.")).toBeInTheDocument();
    expect(botaoDeComecar()).toBeDisabled();
    expect(screen.getByText("novo orquestrador")).toBeInTheDocument();
  });

  it("recentes sem repetir, a mais nova primeiro, no máximo 5", () => {
    abrir([
      existente("a", "/p/velho", "2026-10-01T00:00:00Z"),
      existente("b", "/p/novo", "2026-11-01T00:00:00Z"),
      existente("c", "/p/velho", "2026-10-02T00:00:00Z"),
      ...["d", "e", "f", "g"].map((letra, i) => existente(letra, `/p/${letra}`, `2026-09-0${i + 1}T00:00:00Z`)),
    ]);

    const recentes = screen.getByRole("list", { name: "Pastas recentes" });
    expect(within(recentes).getAllByRole("button").map((botao) => botao.textContent)).toEqual([
      "novo",
      "velho",
      "g",
      "f",
      "e",
    ]);
  });

  it("escolher uma recente dá o nome, o título e o resumo de pronto", () => {
    abrirComPasta();

    expect(campoDoNome()).toHaveValue("app");
    expect(screen.getByText("novo orquestrador · app")).toBeInTheDocument();
    expect(botaoDeComecar()).toHaveTextContent("Começar em app");
    expect(botaoDeComecar()).toBeEnabled();
    expect(screen.getByText("Só olhar e responder, Opus (esforço automático) com até 3 subagentes Opus.")).toBeInTheDocument();
    expect(screen.getByText("/p/app · instruções gerais")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^app$/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("um nome editado à mão não é trocado ao trocar de pasta, e dá para voltar ao nome da pasta", () => {
    abrir([existente("a", "/p/um", "2026-10-01T00:00:00Z"), existente("b", "/p/dois", "2026-10-02T00:00:00Z")]);

    fireEvent.click(screen.getByRole("button", { name: /^dois$/ }));
    expect(screen.queryByRole("button", { name: "usar nome da pasta" })).not.toBeInTheDocument();
    fireEvent.change(campoDoNome(), { target: { value: "API" } });
    fireEvent.click(screen.getByRole("button", { name: /^um$/ }));

    expect(campoDoNome()).toHaveValue("API");
    fireEvent.click(screen.getByRole("button", { name: "usar nome da pasta" }));
    expect(campoDoNome()).toHaveValue("um");
    // Sem edição à mão, o nome segue a pasta.
    fireEvent.click(screen.getByRole("button", { name: /^dois$/ }));
    expect(campoDoNome()).toHaveValue("dois");
  });

  it("um nome editado que volta a ser o da pasta segue a troca de pasta", () => {
    abrir([existente("a", "/p/api", "2026-10-01T00:00:00Z"), existente("b", "/p/web", "2026-10-02T00:00:00Z")]);

    fireEvent.click(screen.getByRole("button", { name: /^api$/ }));
    fireEvent.change(campoDoNome(), { target: { value: "ap" } });
    fireEvent.change(campoDoNome(), { target: { value: "api" } });
    fireEvent.click(screen.getByRole("button", { name: /^web$/ }));

    expect(campoDoNome()).toHaveValue("web");
  });

  it("a janela do sistema escolhe a pasta e dá o nome", async () => {
    vi.spyOn(api, "escolherPastaNoSistema").mockResolvedValue({ caminho: "/u/projetos/api-pagamentos" });
    abrir();

    fireEvent.click(screen.getByRole("button", { name: "Escolher pasta…" }));

    await waitFor(() => expect(campoDoNome()).toHaveValue("api-pagamentos"));
    expect(screen.getByRole("button", { name: "Trocar…" })).toBeInTheDocument();
  });

  it("sem janela no sistema (503), o navegador daqui escolhe a pasta", async () => {
    vi.spyOn(api, "escolherPastaNoSistema").mockRejectedValue(new ErroDaApi("Escolha a pasta aqui mesmo.", 503));
    vi.spyOn(api, "listarPastas").mockResolvedValue({ raiz: "/u", atual: "/u/site", acima: "/u", pastas: [], atalhos: [] });
    abrir();

    fireEvent.click(screen.getByRole("button", { name: "Escolher pasta…" }));
    fireEvent.click(await screen.findByRole("button", { name: "Usar “site”" }));

    expect(campoDoNome()).toHaveValue("site");
    expect(screen.queryByRole("button", { name: "Usar “site”" })).not.toBeInTheDocument();
  });

  it("a permissão muda o payload, e rodar comandos fica em alerta", async () => {
    const criar = espiarCriacao();
    abrirComPasta();

    fireEvent.click(screen.getByRole("radio", { name: "Mudar arquivos e rodar comandos" }));

    expect(screen.getByText("Edita, instala, testa e compila. Use só em pastas que você confia.")).toHaveClass("text-warning");
    expect(screen.getByRole("radio", { name: "Mudar arquivos e rodar comandos" }).closest("label")).toHaveClass(
      "opcao-da-permissao-risco",
    );
    expect(await criarEPegarPayload(criar)).toMatchObject({ nivelDePermissao: "edicao_e_comandos" });
  });

  it("cria com o que foi escolhido, o trivial e o plano sempre ligados", async () => {
    const criado = existente("novo", "/p/app", "2026-11-03T00:00:00Z");
    const criar = vi.spyOn(api, "criarOrquestrador").mockResolvedValue(criado);
    const acoes = abrirComPasta();
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
      permitirTrabalhoDireto: true,
      proporPlanoEmPedidosGrandes: true,
      instrucoesPersonalizadas: "Seja breve.",
    });
    await waitFor(() => expect(acoes.orquestradorCriado).toHaveBeenCalledWith("rascunho:1", criado));
  });

  it("Enter no nome cria", async () => {
    const criar = espiarCriacao();
    abrirComPasta();

    fireEvent.submit(campoDoNome().closest("form") as HTMLFormElement);

    await waitFor(() => expect(criar).toHaveBeenCalledWith(expect.objectContaining({ nome: "app" })));
  });

  it("o chip de esforço muda pelo menu e o × volta ao automático", async () => {
    const criar = espiarCriacao();
    abrirComPasta();

    fireEvent.click(chipDoEsforco());
    expect(chipDoEsforco()).toHaveAttribute("aria-expanded", "true");
    const menu = screen.getByRole("listbox", { name: "Esforço do orquestrador" });
    expect(within(menu).getAllByRole("option")).toHaveLength(6);
    expect(within(menu).getByRole("option", { name: /Automático/ })).toHaveAttribute("aria-selected", "true");
    expect(within(menu).getByText("padrão do Claude Code")).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole("option", { name: "Alto" }));

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(chipDoEsforco()).toHaveTextContent("esforço alto");
    expect(chipDoEsforco()).toHaveFocus();
    expect(screen.getByText("Só olhar e responder, Opus (esforço alto) com até 3 subagentes Opus.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Voltar o esforço do orquestrador ao automático" }));
    expect(chipDoEsforco()).toHaveTextContent("esforço automático");
    expect(screen.queryByRole("button", { name: /ao automático/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Esforço dos subagentes:/ }));
    fireEvent.click(screen.getByRole("option", { name: "Máximo" }));
    expect(await criarEPegarPayload(criar)).toMatchObject({ esforcoDoOrquestrador: "padrao", esforcoDosSubagentes: "maximo" });
  });

  it("Esc e clique fora fecham o menu, e só um fica aberto por vez", () => {
    abrir();

    fireEvent.click(chipDoEsforco());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(chipDoEsforco()).toHaveAttribute("aria-expanded", "false");
    expect(chipDoEsforco()).toHaveFocus();

    fireEvent.click(chipDoEsforco());
    fireEvent.pointerDown(screen.getByText("Nenhuma pasta escolhida"));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    fireEvent.click(chipDoEsforco());
    fireEvent.click(chipDaQuantidade());
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Quantos subagentes" })).toBeInTheDocument();
  });

  it("quantidade fixa ou automática, com os limites de 1 a 10 e o × que volta ao padrão", async () => {
    const criar = espiarCriacao();
    abrirComPasta();

    fireEvent.click(chipDaQuantidade());
    expect(screen.getByText("Usa de 0 a 3 ao mesmo tempo, conforme o pedido.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sempre" }));
    expect(screen.getByRole("button", { name: "Sempre" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Mais subagentes" }));
    expect(screen.getByText("Sempre 4 subagentes.")).toBeInTheDocument();
    expect(chipDaQuantidade()).toHaveTextContent("sempre 4");

    for (let i = 0; i < 10; i++) {
      fireEvent.click(screen.getByRole("button", { name: "Menos subagentes" }));
    }
    expect(screen.getByText("Sempre 1 subagente.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Menos subagentes" })).toBeDisabled();
    for (let i = 0; i < 12; i++) {
      fireEvent.click(screen.getByRole("button", { name: "Mais subagentes" }));
    }
    expect(screen.getByText("Sempre 10 subagentes.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mais subagentes" })).toBeDisabled();
    expect(await criarEPegarPayload(criar)).toMatchObject({ quantidadeDeSubagentes: { modo: "fixa", limite: 10 } });

    fireEvent.click(screen.getByRole("button", { name: "Voltar a quantidade ao padrão, até 3 por vez" }));
    expect(chipDaQuantidade()).toHaveTextContent("até 3 por vez");
  });

  it("commit e push avisam quando falta a permissão de rodar comandos", async () => {
    const criar = espiarCriacao();
    abrirComPasta();
    const commit = screen.getByRole("switch", { name: "Commit e push quando eu pedir" });

    fireEvent.click(commit);
    expect(commit).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Só vale com Mudar arquivos e rodar comandos.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Mudar arquivos e rodar comandos" }));
    expect(screen.queryByText("Só vale com Mudar arquivos e rodar comandos.")).not.toBeInTheDocument();
    expect(screen.getByText("/p/app · commit e push · instruções gerais")).toBeInTheDocument();
    expect(await criarEPegarPayload(criar)).toMatchObject({ permitirCommitEPush: true });
  });

  it("as instruções contam os caracteres", () => {
    abrir();

    fireEvent.change(screen.getByRole("textbox", { name: "Instruções" }), { target: { value: "Rode os testes." } });

    expect(screen.getByText("15 / 4.000")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pré-visualizar prompt final" })).toBeInTheDocument();
  });

  it("instruções acima do limite não começam e dizem por quê", () => {
    abrirComPasta();

    fireEvent.change(screen.getByRole("textbox", { name: "Instruções" }), { target: { value: "x".repeat(4_001) } });

    expect(screen.getByText("Encurte as instruções para começar.")).toBeInTheDocument();
    expect(botaoDeComecar()).toBeDisabled();
  });

  it("sem nome, não começa e diz por quê", () => {
    abrirComPasta();

    fireEvent.change(campoDoNome(), { target: { value: "  " } });

    expect(screen.getByText("Dê um nome ao orquestrador para começar.")).toBeInTheDocument();
    expect(botaoDeComecar()).toBeDisabled();
  });

  it("com o servidor fora, não começa e diz por quê", () => {
    abrir([existente("a", "/p/app", "2026-10-01T00:00:00Z")], false);
    fireEvent.click(screen.getByRole("button", { name: /^app$/ }));

    expect(screen.getByText("Servidor desconectado.")).toBeInTheDocument();
    expect(botaoDeComecar()).toBeDisabled();
  });

  it("o erro da API aparece em vermelho e dá para tentar de novo", async () => {
    vi.spyOn(api, "criarOrquestrador").mockRejectedValue(new ErroDaApi("A pasta não existe.", 400));
    abrirComPasta();

    fireEvent.click(botaoDeComecar());

    expect(await screen.findByRole("alert")).toHaveTextContent("A pasta não existe.");
    expect(botaoDeComecar()).toBeEnabled();
  });

  it("descartar pelo rodapé e pelo ✕", () => {
    const acoes = abrir();

    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));
    fireEvent.click(screen.getByRole("button", { name: "Descartar rascunho" }));
    expect(acoes.descartarRascunho).toHaveBeenCalledTimes(2);
    expect(acoes.descartarRascunho).toHaveBeenCalledWith("rascunho:1");
  });
});
