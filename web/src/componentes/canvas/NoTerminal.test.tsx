import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { type NodeProps, ReactFlowProvider } from "@xyflow/react";
import type { ComponentProps } from "react";

import { api, ErroDaApi } from "../../shared/api/cliente";
import type {
  DadosDaConfiguracao,
  DadosDoPedidoNaFila,
  EventoDeOrquestracao,
  EventoRegistrado,
  ResumoDoOrquestrador,
} from "../../shared/api/tipos";
import { criarLojaDosArtefatos, type AcoesDosArtefatos, ProvedorDosArtefatos } from "../../shared/canvas/artefatos";
import { ContextoDoCanvas, type ValorDoCanvas } from "../../shared/canvas/contexto";
import { DURACAO_DA_ENTREGA_MS, DURACAO_DO_PISCAR_MS } from "../../shared/canvas/entrega";
import { novaPrevia, type NoTerminal as TipoDoNo } from "../../shared/canvas/nos";
import { type AcoesDasNotas, criarLojaDasNotas, ProvedorDasNotas } from "../../shared/canvas/notas";
import { TIPO_DO_PEDIDO_ARRASTADO } from "../../shared/canvas/pedidoArrastado";
import { aplicarEvento, ESTADO_INICIAL, type EstadoDaConversa } from "../../shared/estado/aplicarEvento";
import { NoTerminal, PainelDeConfiguracao } from "./NoTerminal";

const contagem = vi.hoisted(() => ({ analises: 0, transcricoes: 0 }));
// Fora do app desktop do Mac por padrão; os testes das bolinhas ligam.
const ponte = vi.hoisted(() => ({ noMac: false }));

vi.mock("../../shared/ponteDoDesktop", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../shared/ponteDoDesktop")>();
  return { ...original, rodandoNoMac: () => ponte.noMac };
});

// O botão de alterações tem testes próprios; aqui basta saber que ele está na barra, com o id certo.
vi.mock("./BotaoDeAlteracoes", async () => {
  const { createElement } = await import("react");
  return {
    BotaoDeAlteracoes: ({ orquestradorId }: { orquestradorId: string }) =>
      createElement("button", { type: "button", "aria-label": `Alterações de ${orquestradorId}` }, "±"),
  };
});

// Conta as análises de Markdown sem mudar o que o react-markdown produz.
vi.mock("react-markdown", async (importOriginal) => {
  const original = await importOriginal<typeof import("react-markdown")>();
  return {
    ...original,
    default: (opcoes: Parameters<typeof original.default>[0]) => {
      contagem.analises += 1;
      return original.default(opcoes);
    },
  };
});

// Conta as vezes que a transcrição renderiza de fato. O invólucro é memorizado
// como a original: só passa adiante quando o terminal entrega props diferentes.
vi.mock("./TranscricaoDoTerminal", async (importOriginal) => {
  const { createElement, memo } = await import("react");
  const original = await importOriginal<typeof import("./TranscricaoDoTerminal")>();
  const Contada = memo(function TranscricaoContada(props: ComponentProps<typeof original.TranscricaoDoTerminal>) {
    contagem.transcricoes += 1;
    return createElement(original.TranscricaoDoTerminal, props);
  });
  return { ...original, TranscricaoDoTerminal: Contada };
});

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

function orquestrador(alteracoes: Partial<DadosDaConfiguracao> = {}): ResumoDoOrquestrador {
  return {
    id: "o1",
    nome: "Painel de salas",
    pastaDeTrabalho: "C:\\projetos\\painel",
    nomeDaPasta: "painel",
    situacao: "ocioso",
    configuracao: { ...configuracao, ...alteracoes },
    instrucoesAtivas: null,
    criadoEm: "2026-10-28T12:00:00Z",
    totalDeTurnos: 0,
    ultimoTurno: null,
    worktree: null,
  };
}

function renderizar(resumo: ResumoDoOrquestrador, { trabalhando = false, conversaComTurnos = false } = {}) {
  const aoFechar = vi.fn();
  const aoLimparConversa = vi.fn(async () => undefined);
  const canvas: ValorDoCanvas = {
    orquestradores: new Map([[resumo.id, resumo]]),
    conversas: new Map(),
    conexoes: new Map(),
    sinais: new Map(),
    bixinhosLimpos: new Map(),
    servidor: { conectado: true, caiuEm: null, voltouEm: null, reiniciou: false, memoria: null },
    acoes: {
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
    },
  };
  render(
    <ContextoDoCanvas.Provider value={canvas}>
      <PainelDeConfiguracao
        orquestrador={resumo}
        trabalhando={trabalhando}
        conversaComTurnos={conversaComTurnos}
        aoFechar={aoFechar}
        aoLimparConversa={aoLimparConversa}
      />
    </ContextoDoCanvas.Provider>,
  );
  return {
    aoFechar,
    aoLimparConversa,
    acoes: canvas.acoes,
    opcao: screen.getByRole("switch", { name: "Commit e push por feature" }),
  };
}

const menuDoModelo = (dono: "do orquestrador" | "dos subagentes") =>
  screen.getByRole("button", { name: new RegExp(`^Modelo ${dono}:`) });
/** Abre o menu do modelo, entra em "Esforço" e escolhe o nível (o menu continua aberto). */
function escolherEsforco(dono: "do orquestrador" | "dos subagentes", nivel: string): void {
  fireEvent.click(menuDoModelo(dono));
  fireEvent.click(screen.getByRole("menuitem", { name: /^Esforço/ }));
  fireEvent.click(screen.getByRole("menuitemradio", { name: nivel }));
}
const campoDasInstrucoes = () => screen.getByRole("textbox", { name: "Instruções" });

describe("PainelDeConfiguracao", () => {
  beforeEach(() => {
    // Sem resposta por padrão: os testes que dependem delas trocam o retorno.
    vi.spyOn(api, "listarPredefinicoes").mockReturnValue(new Promise(() => undefined));
    vi.spyOn(api, "lerEsforcoHerdadoDoOrquestrador").mockReturnValue(new Promise(() => undefined));
    vi.spyOn(api, "lerEsforcoHerdado").mockReturnValue(new Promise(() => undefined));
    vi.spyOn(api, "lerPreferencias").mockReturnValue(new Promise(() => undefined));
  });

  afterEach(() => vi.restoreAllMocks());

  it("commit e push começam desligados e, ligados, vão sozinhos no PATCH", async () => {
    const alterar = vi.spyOn(api, "alterarConfiguracao").mockResolvedValue(orquestrador({ permitirCommitEPush: true }));
    const { aoFechar, opcao } = renderizar(orquestrador());

    expect(opcao).not.toBeChecked();
    fireEvent.click(opcao);
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(aoFechar).toHaveBeenCalledTimes(1));
    expect(alterar).toHaveBeenCalledWith("o1", { permitirCommitEPush: true });
  });

  it("carrega a opção já ligada e permite desligar", async () => {
    const alterar = vi.spyOn(api, "alterarConfiguracao").mockResolvedValue(orquestrador());
    const { aoFechar, opcao } = renderizar(orquestrador({ permitirCommitEPush: true }));

    expect(opcao).toBeChecked();
    fireEvent.click(opcao);
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(aoFechar).toHaveBeenCalledTimes(1));
    expect(alterar).toHaveBeenCalledWith("o1", { permitirCommitEPush: false });
  });

  it("carrega o esforço salvo e envia no PATCH só o esforço alterado", async () => {
    const alterar = vi.spyOn(api, "alterarConfiguracao").mockResolvedValue(orquestrador());
    const { aoFechar } = renderizar(orquestrador({ esforcoDoOrquestrador: "alto" }));

    expect(menuDoModelo("do orquestrador")).toHaveTextContent("esforço alto");
    expect(menuDoModelo("dos subagentes")).toHaveTextContent("esforço padrão");
    escolherEsforco("dos subagentes", "Baixo");
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(aoFechar).toHaveBeenCalledTimes(1));
    expect(alterar).toHaveBeenCalledWith("o1", { esforcoDosSubagentes: "baixo" });
  });

  it("a escolha dos subagentes prontos vai sozinha no PATCH; marcar e desmarcar de volta não envia nada", async () => {
    vi.spyOn(api, "lerPreferencias").mockResolvedValue({
      instrucoesPadrao: "",
      subagentesProntos: [
        { nome: "revisor", descricao: "Revisa.", prompt: "x", modelo: "herdar" },
        { nome: "testador", descricao: "Testa.", prompt: "x", modelo: "herdar" },
      ],
    });
    const alterar = vi.spyOn(api, "alterarConfiguracao").mockResolvedValue(orquestrador());
    const { aoFechar } = renderizar(orquestrador({ subagentesProntos: ["revisor"] }));
    const caixa = async (nome: string) =>
      within(await screen.findByRole("group", { name: "Subagentes prontos escolhidos" })).getByRole("checkbox", { name: nome });

    fireEvent.click(await caixa("testador"));
    fireEvent.click(await caixa("testador"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(aoFechar).toHaveBeenCalledTimes(1));
    expect(alterar).not.toHaveBeenCalled();

    fireEvent.click(await caixa("revisor"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(aoFechar).toHaveBeenCalledTimes(2));
    expect(alterar).toHaveBeenCalledWith("o1", { subagentesProntos: [] });

    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Subagentes prontos" })).getByRole("radio", { name: "Nenhum" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(alterar).toHaveBeenLastCalledWith("o1", { subagentesProntos: "nenhum" }));
  });

  it("carrega as instruções salvas e envia no PATCH só as instruções editadas", async () => {
    const alterar = vi.spyOn(api, "alterarConfiguracao").mockResolvedValue(orquestrador());
    const { aoFechar } = renderizar(orquestrador({ instrucoesPersonalizadas: "Use Jest." }));

    expect(campoDasInstrucoes()).toHaveValue("Use Jest.");
    fireEvent.change(campoDasInstrucoes(), { target: { value: "Sempre comece a resposta com a palavra PIRULITO." } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(aoFechar).toHaveBeenCalledTimes(1));
    expect(alterar).toHaveBeenCalledWith("o1", {
      instrucoesPersonalizadas: "Sempre comece a resposta com a palavra PIRULITO.",
    });
  });

  it("aplicar um perfil copia o texto para as instruções e o PATCH envia só elas", async () => {
    vi.spyOn(api, "lerPreferencias").mockResolvedValue({
      instrucoesPadrao: "",
      subagentesProntos: [],
      perfisDeInstrucoes: [{ nome: "Backend", texto: "Use Jest e rode o lint." }],
    });
    const alterar = vi.spyOn(api, "alterarConfiguracao").mockResolvedValue(orquestrador());
    const { aoFechar } = renderizar(orquestrador());

    fireEvent.change(await screen.findByRole("combobox", { name: "Aplicar perfil de instruções" }), {
      target: { value: "0" },
    });
    expect(campoDasInstrucoes()).toHaveValue("Use Jest e rode o lint.");
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(aoFechar).toHaveBeenCalledTimes(1));
    expect(alterar).toHaveBeenCalledWith("o1", { instrucoesPersonalizadas: "Use Jest e rode o lint." });
  });

  describe("instruções apagadas ou muito mudadas com a conversa em andamento", () => {
    const INSTRUCOES = "Use Jest nos testes e escreva as mensagens de commit em português.";
    const sugestao = () => screen.queryByRole("button", { name: "Salvar e começar conversa nova" });

    it("apagadas: o rodapé avisa e oferece salvar e começar conversa nova, depois de confirmar", async () => {
      const alterar = vi.spyOn(api, "alterarConfiguracao").mockResolvedValue(orquestrador());
      const confirmar = vi.spyOn(window, "confirm").mockReturnValue(true);
      const { aoFechar, aoLimparConversa } = renderizar(orquestrador({ instrucoesPersonalizadas: INSTRUCOES }), {
        conversaComTurnos: true,
      });
      expect(sugestao()).not.toBeInTheDocument();

      fireEvent.change(campoDasInstrucoes(), { target: { value: "" } });
      expect(screen.getByText("As instruções antigas seguem no histórico.")).toBeInTheDocument();
      fireEvent.click(sugestao() as HTMLElement);

      await waitFor(() => expect(aoFechar).toHaveBeenCalledTimes(1));
      expect(confirmar).toHaveBeenCalledWith("Salvar e começar uma conversa nova? A conversa atual será arquivada.");
      expect(alterar).toHaveBeenCalledWith("o1", { instrucoesPersonalizadas: "" });
      expect(aoLimparConversa).toHaveBeenCalledTimes(1);
      expect(alterar.mock.invocationCallOrder[0]).toBeLessThan(aoLimparConversa.mock.invocationCallOrder[0] ?? 0);
    });

    it("trocadas por outras: também avisa; recusada a confirmação, nada é salvo", () => {
      const alterar = vi.spyOn(api, "alterarConfiguracao");
      vi.spyOn(window, "confirm").mockReturnValue(false);
      const { aoFechar, aoLimparConversa } = renderizar(orquestrador({ instrucoesPersonalizadas: INSTRUCOES }), {
        conversaComTurnos: true,
      });

      fireEvent.change(campoDasInstrucoes(), { target: { value: "Responda sempre em inglês, sem rodeios." } });
      fireEvent.click(sugestao() as HTMLElement);

      expect(alterar).not.toHaveBeenCalled();
      expect(aoLimparConversa).not.toHaveBeenCalled();
      expect(aoFechar).not.toHaveBeenCalled();
    });

    it("acréscimo ou correção pequena não avisa, e o Salvar continua só salvando", async () => {
      const alterar = vi.spyOn(api, "alterarConfiguracao").mockResolvedValue(orquestrador());
      const { aoFechar, aoLimparConversa } = renderizar(orquestrador({ instrucoesPersonalizadas: INSTRUCOES }), {
        conversaComTurnos: true,
      });

      fireEvent.change(campoDasInstrucoes(), { target: { value: `${INSTRUCOES} Rode o lint antes de entregar.` } });
      expect(sugestao()).not.toBeInTheDocument();
      fireEvent.change(campoDasInstrucoes(), { target: { value: INSTRUCOES.replace("Jest", "Vitest") } });
      expect(sugestao()).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
      await waitFor(() => expect(aoFechar).toHaveBeenCalledTimes(1));
      expect(alterar).toHaveBeenCalledWith("o1", { instrucoesPersonalizadas: INSTRUCOES.replace("Jest", "Vitest") });
      expect(aoLimparConversa).not.toHaveBeenCalled();
    });

    it("sem pedidos na conversa, ou sem instruções antes, não avisa", () => {
      renderizar(orquestrador({ instrucoesPersonalizadas: INSTRUCOES }));
      fireEvent.change(campoDasInstrucoes(), { target: { value: "" } });
      expect(sugestao()).not.toBeInTheDocument();
    });

    it("instruções novas, onde não havia nenhuma, não avisam", () => {
      renderizar(orquestrador(), { conversaComTurnos: true });
      fireEvent.change(campoDasInstrucoes(), { target: { value: INSTRUCOES } });
      expect(sugestao()).not.toBeInTheDocument();
    });

    it("durante um pedido, o botão fica desabilitado", () => {
      renderizar(orquestrador({ instrucoesPersonalizadas: INSTRUCOES }), { conversaComTurnos: true, trabalhando: true });
      fireEvent.change(campoDasInstrucoes(), { target: { value: "" } });
      expect(sugestao()).toBeDisabled();
    });
  });

  it("instruções acima do limite: o Salvar fica desabilitado e o rodapé diz por quê", () => {
    renderizar(orquestrador());

    fireEvent.change(campoDasInstrucoes(), { target: { value: "x".repeat(4_001) } });

    expect(screen.getByRole("button", { name: "Salvar" })).toBeDisabled();
    expect(screen.getByText("Encurte as instruções para salvar.")).toBeInTheDocument();

    fireEvent.change(campoDasInstrucoes(), { target: { value: "curto" } });
    expect(screen.getByRole("button", { name: "Salvar" })).toBeEnabled();
  });

  it("o rodapé resume a configuração e acompanha a edição", () => {
    renderizar(orquestrador());

    expect(
      screen.getByText("Editar e rodar comandos, Opus (esforço automático) com até 3 subagentes Sonnet."),
    ).toBeInTheDocument();
    expect(screen.getByText("configuração · vale a partir do próximo pedido")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Somente leitura" }));
    escolherEsforco("do orquestrador", "Alto");

    expect(screen.getByText("Somente leitura, Opus (esforço alto) com até 3 subagentes Sonnet.")).toBeInTheDocument();
  });

  it("\"Voltar\" descarta a edição das instruções sem PATCH", () => {
    const alterar = vi.spyOn(api, "alterarConfiguracao");
    const { aoFechar } = renderizar(orquestrador());

    fireEvent.change(campoDasInstrucoes(), { target: { value: "rascunho" } });
    fireEvent.click(screen.getByRole("button", { name: "Voltar" }));

    expect(aoFechar).toHaveBeenCalledTimes(1);
    expect(alterar).not.toHaveBeenCalled();
  });

  it("o PATCH leva só o campo alterado: outra aba que mudou outro campo não é desfeita", async () => {
    const alterar = vi.spyOn(api, "alterarConfiguracao").mockResolvedValue(orquestrador());
    const { aoFechar } = renderizar(orquestrador());

    fireEvent.click(screen.getByRole("radio", { name: "Somente leitura" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(aoFechar).toHaveBeenCalledTimes(1));
    expect(alterar).toHaveBeenCalledTimes(1);
    expect(alterar).toHaveBeenCalledWith("o1", { nivelDePermissao: "leitura" });
  });

  it("sem nada alterado, o Salvar só fecha, sem chamar o servidor", () => {
    const alterar = vi.spyOn(api, "alterarConfiguracao");
    const { aoFechar, acoes } = renderizar(orquestrador());

    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(aoFechar).toHaveBeenCalledTimes(1);
    expect(alterar).not.toHaveBeenCalled();
    expect(acoes.recarregar).not.toHaveBeenCalled();
  });

  it("mudar um campo e voltar ao valor salvo conta como sem alteração", () => {
    const alterar = vi.spyOn(api, "alterarConfiguracao");
    const { aoFechar, opcao } = renderizar(orquestrador());

    fireEvent.click(opcao);
    fireEvent.click(opcao);
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(aoFechar).toHaveBeenCalledTimes(1);
    expect(alterar).not.toHaveBeenCalled();
  });

  it("se o servidor recusar, o erro aparece no rodapé no lugar do resumo e o painel continua aberto", async () => {
    vi.spyOn(api, "alterarConfiguracao").mockRejectedValue(new Error("Opção de commit e push inválida."));
    const { aoFechar, opcao } = renderizar(orquestrador());

    fireEvent.click(opcao);
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("✗ Opção de commit e push inválida.");
    expect(screen.queryByText(/com até 3 subagentes/)).not.toBeInTheDocument();
    expect(aoFechar).not.toHaveBeenCalled();
    expect(opcao).toBeChecked();
  });

  describe("Nome", () => {
    const campoDoNome = () => screen.getByRole("textbox", { name: "Nome" });

    it("abre no topo com o nome atual e o limite de 60; mudado, o Salvar renomeia pela rota do nome, sem PATCH", async () => {
      const renomear = vi.spyOn(api, "renomearOrquestrador").mockResolvedValue(orquestrador());
      const alterar = vi.spyOn(api, "alterarConfiguracao");
      const { aoFechar, acoes } = renderizar(orquestrador());

      expect(campoDoNome()).toHaveValue("Painel de salas");
      expect(campoDoNome()).toHaveAttribute("maxLength", "60");
      expect(campoDoNome().closest(".linha-da-criacao")).toBe(document.querySelector(".linha-da-criacao"));
      fireEvent.change(campoDoNome(), { target: { value: "  Backlog do app  " } });
      fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

      await waitFor(() => expect(aoFechar).toHaveBeenCalledTimes(1));
      expect(renomear).toHaveBeenCalledWith("o1", "Backlog do app");
      expect(alterar).not.toHaveBeenCalled();
      expect(acoes.recarregar).toHaveBeenCalled();
    });

    it("nome e configuração mudados: renomeia e manda no PATCH só o campo alterado", async () => {
      const renomear = vi.spyOn(api, "renomearOrquestrador").mockResolvedValue(orquestrador());
      const alterar = vi.spyOn(api, "alterarConfiguracao").mockResolvedValue(orquestrador());
      const { aoFechar, opcao } = renderizar(orquestrador());

      fireEvent.change(campoDoNome(), { target: { value: "Backlog do app" } });
      fireEvent.click(opcao);
      fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

      await waitFor(() => expect(aoFechar).toHaveBeenCalledTimes(1));
      expect(renomear).toHaveBeenCalledWith("o1", "Backlog do app");
      expect(alterar).toHaveBeenCalledWith("o1", { permitirCommitEPush: true });
    });

    it("sem mudança no nome (ou só espaços em volta), a rota do nome não é chamada", async () => {
      const renomear = vi.spyOn(api, "renomearOrquestrador");
      const alterar = vi.spyOn(api, "alterarConfiguracao").mockResolvedValue(orquestrador());
      const { aoFechar, opcao } = renderizar(orquestrador());

      fireEvent.change(campoDoNome(), { target: { value: " Painel de salas " } });
      fireEvent.click(opcao);
      fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

      await waitFor(() => expect(aoFechar).toHaveBeenCalledTimes(1));
      expect(alterar).toHaveBeenCalledWith("o1", { permitirCommitEPush: true });
      expect(renomear).not.toHaveBeenCalled();
    });

    it("em branco ou só espaços: o Salvar fica desabilitado e o rodapé diz por quê", () => {
      const renomear = vi.spyOn(api, "renomearOrquestrador");
      const { aoFechar } = renderizar(orquestrador());

      fireEvent.change(campoDoNome(), { target: { value: "   " } });

      expect(screen.getByText("Dê um nome ao orquestrador para salvar.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Salvar" })).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
      expect(renomear).not.toHaveBeenCalled();
      expect(aoFechar).not.toHaveBeenCalled();

      fireEvent.change(campoDoNome(), { target: { value: "Outro" } });
      expect(screen.getByRole("button", { name: "Salvar" })).toBeEnabled();
      expect(screen.queryByText("Dê um nome ao orquestrador para salvar.")).not.toBeInTheDocument();
    });

    it("nome recusado pelo servidor: o erro aparece no rodapé, a configuração não é salva e o painel fica aberto", async () => {
      vi.spyOn(api, "renomearOrquestrador").mockRejectedValue(new ErroDaApi("O nome deve ter até 60 caracteres.", 400));
      const alterar = vi.spyOn(api, "alterarConfiguracao");
      const { aoFechar, opcao } = renderizar(orquestrador());

      fireEvent.change(campoDoNome(), { target: { value: "Novo" } });
      fireEvent.click(opcao);
      fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "✗ Não foi possível renomear: O nome deve ter até 60 caracteres.",
      );
      expect(alterar).not.toHaveBeenCalled();
      expect(aoFechar).not.toHaveBeenCalled();
      expect(campoDoNome()).toHaveValue("Novo");
    });
  });

  it("excluir fica na linha Conversa, pede confirmação e, confirmado, remove e fecha o terminal", async () => {
    const remover = vi.spyOn(api, "removerOrquestrador").mockResolvedValue(null);
    const confirmar = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    const { acoes } = renderizar(orquestrador());
    const botao = screen.getByRole("button", { name: "Excluir orquestrador" });

    expect(botao.closest(".linha-da-criacao")).toHaveTextContent(/^Conversa/);
    fireEvent.click(botao);
    expect(confirmar).toHaveBeenCalledWith('Excluir "Painel de salas" e todo o histórico desta conversa?');
    expect(remover).not.toHaveBeenCalled();

    fireEvent.click(botao);
    await waitFor(() => expect(acoes.fecharTerminal).toHaveBeenCalledWith("o1"));
    expect(remover).toHaveBeenCalledWith("o1");
    expect(acoes.recarregar).toHaveBeenCalled();
  });

  it("durante um pedido, excluir e nova conversa ficam desabilitados", () => {
    renderizar(orquestrador(), { trabalhando: true });

    expect(screen.getByRole("button", { name: "Excluir orquestrador" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Nova conversa" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Salvar" })).toBeEnabled();
  });

  it("o modo econômico é aplicado no servidor e o formulário mostra a configuração devolvida", async () => {
    vi.spyOn(api, "listarPredefinicoes").mockResolvedValue([
      {
        nome: "economico",
        rotulo: "Modo econômico",
        descricao: "Gasta menos tokens.",
        configuracao: { esforcoDoOrquestrador: "medio", esforcoDosSubagentes: "medio" },
      },
    ]);
    const herdado = vi.spyOn(api, "lerEsforcoHerdadoDoOrquestrador").mockResolvedValue({
      orquestrador: null,
      subagentes: null,
    });
    const aplicarPredefinicao = vi.spyOn(api, "aplicarPredefinicao").mockResolvedValue({
      ...orquestrador({ esforcoDoOrquestrador: "medio", esforcoDosSubagentes: "medio" }),
      predefinicaoCorrespondente: "economico",
    });
    renderizar(orquestrador());

    fireEvent.click(await screen.findByRole("button", { name: "Modo econômico" }));

    await waitFor(() => expect(menuDoModelo("do orquestrador")).toHaveTextContent("esforço médio"));
    expect(aplicarPredefinicao).toHaveBeenCalledWith("o1", "economico");
    expect(herdado).toHaveBeenCalledWith("o1");
    expect(menuDoModelo("dos subagentes")).toHaveTextContent("esforço médio");

    // A predefinição já foi salva no servidor: o Salvar sem outra mudança não manda nada.
    const alterar = vi.spyOn(api, "alterarConfiguracao");
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(alterar).not.toHaveBeenCalled();
  });
});

const USO = { duracaoMs: 1000, tokensDeEntrada: 1, tokensDeSaida: 1, subagentesLancados: 0 };

/** Aplica os eventos em sequência, continuando de onde a conversa parou. */
function aplicar(conversa: EstadoDaConversa, ...eventos: EventoDeOrquestracao[]): EstadoDaConversa {
  return eventos
    .map(
      (evento, indice): EventoRegistrado => ({
        ...evento,
        sequencia: conversa.ultimaSequencia + indice + 1,
        em: "2026-10-28T12:00:00Z",
      }),
    )
    .reduce(aplicarEvento, conversa);
}

/** Um pedido concluído (com resposta em Markdown) e outro em andamento. */
function conversaDoTerminal(): EstadoDaConversa {
  return aplicar(
    ESTADO_INICIAL,
    { tipo: "turno_iniciado", turnoId: "t1", texto: "resuma o projeto", configuracao },
    { tipo: "turno_concluido", turnoId: "t1", resposta: "## Resumo\n\n**primeira** resposta", uso: USO },
    { tipo: "turno_iniciado", turnoId: "t2", texto: "corrija o bug", configuracao },
  );
}

/** Um pedido concluído e nenhum em andamento: dá para limpar a conversa. */
function conversaOciosa(): EstadoDaConversa {
  return aplicar(
    ESTADO_INICIAL,
    { tipo: "turno_iniciado", turnoId: "t1", texto: "resuma o projeto", configuracao },
    { tipo: "turno_concluido", turnoId: "t1", resposta: "Resumo pronto", uso: USO },
  );
}

const CONVERSA_LIMPA: EventoDeOrquestracao = {
  tipo: "conversa_limpa",
  turnosAnteriores: 1,
  planoDescartado: false,
  worktreeComAlteracoes: false,
};

function canvasDoTerminal(conversa: EstadoDaConversa, resumo: ResumoDoOrquestrador = orquestrador()): ValorDoCanvas {
  return {
    orquestradores: new Map([["o1", resumo]]),
    conversas: new Map([["o1", conversa]]),
    conexoes: new Map([["o1", "conectado"]]),
    sinais: new Map(),
    bixinhosLimpos: new Map(),
    servidor: { conectado: true, caiuEm: null, voltouEm: null, reiniciou: false, memoria: null },
    acoes: {
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
    },
  };
}

const DADOS_DO_NO = { orquestradorId: "o1" };

/** As props que o React Flow passa ao nó; no arraste, mudam a posição e o `dragging`. */
function propsDoNo(alteracoes: Partial<NodeProps<TipoDoNo>> = {}): NodeProps<TipoDoNo> {
  return {
    id: "o1",
    type: "terminal",
    data: DADOS_DO_NO,
    selected: false,
    selectable: true,
    draggable: true,
    deletable: true,
    isConnectable: false,
    dragging: false,
    zIndex: 0,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    width: 640,
    height: 460,
    ...alteracoes,
  };
}

function Terminal({ canvas, no }: { canvas: ValorDoCanvas; no: NodeProps<TipoDoNo> }) {
  return (
    <ReactFlowProvider>
      <ContextoDoCanvas.Provider value={canvas}>
        <NoTerminal {...no} />
      </ContextoDoCanvas.Provider>
    </ReactFlowProvider>
  );
}

describe("NoTerminal", () => {
  beforeEach(() => {
    // O girador e o relógio do pedido em andamento não disparam no meio do teste.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T12:00:06Z"));
    contagem.analises = 0;
    contagem.transcricoes = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("arrastar (só posição e dragging mudam) não re-renderiza a transcrição nem perde o prompt", () => {
    const canvas = canvasDoTerminal(conversaDoTerminal());
    const { rerender } = render(<Terminal canvas={canvas} no={propsDoNo()} />);
    expect(contagem.transcricoes).toBe(1);
    expect(contagem.analises).toBe(1);

    const campo = screen.getByRole("textbox", { name: "Mensagem para o orquestrador" });
    fireEvent.change(campo, { target: { value: "próximo pedido" } });
    fireEvent.keyDown(campo, { key: "Tab", shiftKey: true });

    for (const passo of [10, 20, 30]) {
      rerender(
        <Terminal canvas={canvas} no={propsDoNo({ positionAbsoluteX: passo, positionAbsoluteY: passo, dragging: true })} />,
      );
    }
    rerender(<Terminal canvas={canvas} no={propsDoNo({ positionAbsoluteX: 30, positionAbsoluteY: 30 })} />);

    expect(contagem.transcricoes).toBe(1);
    expect(contagem.analises).toBe(1);
    expect(campo).toHaveValue("próximo pedido");
    expect(screen.getByRole("button", { name: /plan mode ligado/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("eventos de outro orquestrador e a consulta periódica da lista não re-renderizam a transcrição", () => {
    const canvas = canvasDoTerminal(conversaDoTerminal());
    const { rerender } = render(<Terminal canvas={canvas} no={propsDoNo()} />);

    const doOutro = aplicar(ESTADO_INICIAL, { tipo: "turno_iniciado", turnoId: "x1", texto: "outro", configuracao });
    const comOutro: ValorDoCanvas = {
      ...canvas,
      conversas: new Map([...canvas.conversas, ["o2", doOutro]]),
      sinais: new Map([["o2", { turnoId: "x1", em: "2026-10-28T12:00:05Z", tokensPensando: 10 }]]),
    };
    rerender(<Terminal canvas={comOutro} no={propsDoNo()} />);

    // A lista chega com objetos novos a cada consulta, mesmo sem mudança no que o terminal mostra.
    const resumo = orquestrador();
    const novaConsulta: ValorDoCanvas = {
      ...comOutro,
      orquestradores: new Map([
        ["o1", { ...resumo, situacao: "trabalhando", totalDeTurnos: 2, configuracao: { ...resumo.configuracao } }],
      ]),
    };
    rerender(<Terminal canvas={novaConsulta} no={propsDoNo()} />);

    expect(contagem.transcricoes).toBe(1);
    expect(contagem.analises).toBe(1);
  });

  it("novidade do próprio orquestrador re-renderiza a transcrição sem re-analisar a resposta antiga", () => {
    const conversa = conversaDoTerminal();
    const canvas = canvasDoTerminal(conversa);
    const { rerender } = render(<Terminal canvas={canvas} no={propsDoNo()} />);

    const comLinhaNova = aplicar(conversa, { tipo: "texto_do_orquestrador", turnoId: "t2", texto: "lendo o código" });
    rerender(<Terminal canvas={{ ...canvas, conversas: new Map([["o1", comLinhaNova]]) }} no={propsDoNo()} />);

    expect(screen.getByText("lendo o código")).toBeInTheDocument();
    expect(contagem.transcricoes).toBe(2);
    expect(contagem.analises).toBe(1);
  });

  it("conversa_limpa do próprio orquestrador esvazia a transcrição e mostra o separador", () => {
    const conversa = conversaOciosa();
    const canvas = canvasDoTerminal(conversa);
    const { rerender } = render(<Terminal canvas={canvas} no={propsDoNo()} />);
    expect(screen.getByText("resuma o projeto")).toBeInTheDocument();

    const limpa = aplicar(conversa, CONVERSA_LIMPA);
    rerender(<Terminal canvas={{ ...canvas, conversas: new Map([["o1", limpa]]) }} no={propsDoNo()} />);

    expect(screen.queryByText("resuma o projeto")).not.toBeInTheDocument();
    expect(screen.getByText(/^— conversa nova iniciada às \d{2}:\d{2} —$/)).toBeInTheDocument();
    expect(contagem.transcricoes).toBe(2);
  });

  it("conversa_limpa de outro orquestrador não re-renderiza a transcrição", () => {
    const canvas = canvasDoTerminal(conversaOciosa());
    const doOutro = conversaOciosa();
    const comOutro: ValorDoCanvas = { ...canvas, conversas: new Map([...canvas.conversas, ["o2", doOutro]]) };
    const { rerender } = render(<Terminal canvas={comOutro} no={propsDoNo()} />);

    const outroLimpo: ValorDoCanvas = {
      ...comOutro,
      conversas: new Map([...comOutro.conversas, ["o2", aplicar(doOutro, CONVERSA_LIMPA)]]),
    };
    rerender(<Terminal canvas={outroLimpo} no={propsDoNo()} />);

    expect(contagem.transcricoes).toBe(1);
    expect(screen.getByText("resuma o projeto")).toBeInTheDocument();
  });

  it("tem uma âncora de saída no meio de cada lado e a chegada das ligações, também enquanto carrega", () => {
    const ancoras = (container: HTMLElement) =>
      [...container.querySelectorAll<HTMLElement>(".react-flow__handle")].map((ancora) => [
        ancora.dataset.handleid,
        ancora.dataset.handlepos,
        ancora.classList.contains("source"),
      ]);
    const esperadas = [
      ["baixo", "bottom", true],
      ["cima", "top", true],
      ["direita", "right", true],
      ["esquerda", "left", true],
      // Onde chega a linha puxada de uma nota, prévia ou artefato (cobre o terminal).
      ["chegada", "left", false],
    ];

    const { container, unmount } = render(<Terminal canvas={canvasDoTerminal(conversaDoTerminal())} no={propsDoNo()} />);
    expect(ancoras(container)).toEqual(esperadas);
    unmount();

    const carregando = render(
      <Terminal canvas={{ ...canvasDoTerminal(conversaDoTerminal()), orquestradores: new Map() }} no={propsDoNo()} />,
    );
    expect(screen.getByText("carregando orquestrador…")).toBeInTheDocument();
    expect(ancoras(carregando.container)).toEqual(esperadas);
  });

  it("'Nova conversa' no ⚙ fica desabilitado durante um pedido", () => {
    render(<Terminal canvas={canvasDoTerminal(conversaDoTerminal())} no={propsDoNo()} />);

    fireEvent.click(screen.getByTitle("Configurar"));

    expect(screen.getByRole("button", { name: "Nova conversa" })).toBeDisabled();
  });

  it("trabalhando, a barra do terminal não mostra RAM nem etiqueta de situação; a borda brilha", () => {
    const canvas: ValorDoCanvas = {
      ...canvasDoTerminal(conversaDoTerminal()),
      servidor: {
        conectado: true,
        caiuEm: null,
        voltouEm: null,
        reiniciou: false,
        memoria: {
          totalBytes: 32 * 1024 ** 3,
          livreBytes: 16 * 1024 ** 3,
          servidorBytes: 0,
          agentesBytes: 224 * 1024 ** 2,
          porOrquestrador: { o1: 224 * 1024 ** 2 },
          lidaEm: "2026-10-28T12:00:05Z",
        },
      },
    };
    const { container } = render(<Terminal canvas={canvas} no={propsDoNo()} />);

    const barra = container.querySelector<HTMLElement>(".barra-do-terminal");
    expect(barra).not.toBeNull();
    expect(barra).not.toHaveTextContent(/RAM/);
    expect(barra).not.toHaveTextContent(/trabalhando|ocioso/i);
    expect(container.querySelector(".janela-terminal")).toHaveClass("janela-terminal-ativa");
  });
});

describe("NoTerminal · conversa nova", () => {
  afterEach(() => vi.restoreAllMocks());

  function renderizarOcioso() {
    const canvas = canvasDoTerminal(conversaOciosa());
    render(<Terminal canvas={canvas} no={propsDoNo()} />);
    return { canvas, campo: screen.getByRole("textbox", { name: "Mensagem para o orquestrador" }) };
  }

  describe("imagens anexadas", () => {
    it("guarda o arquivo com miniatura blob: e libera a URL ao remover", async () => {
      const criar = vi.spyOn(URL, "createObjectURL");
      const revogar = vi.spyOn(URL, "revokeObjectURL");
      const { campo } = renderizarOcioso();

      fireEvent.paste(campo, { clipboardData: { files: [new File(["png"], "tela.png", { type: "image/png" })] } });
      const remover = await screen.findByRole("button", { name: "Remover tela.png" });
      const previa = criar.mock.results[0]?.value as string;
      expect(screen.getByAltText("tela.png")).toHaveAttribute("src", previa);
      expect(revogar).not.toHaveBeenCalled();

      fireEvent.click(remover);
      expect(revogar).toHaveBeenCalledWith(previa);
      expect(screen.queryByAltText("tela.png")).not.toBeInTheDocument();
    });

    it("gera o base64 só no envio, igual ao do arquivo, e libera a URL depois", async () => {
      const enviar = vi.spyOn(api, "enviarMensagem").mockResolvedValue({ turnoId: "t1" });
      const criar = vi.spyOn(URL, "createObjectURL");
      const revogar = vi.spyOn(URL, "revokeObjectURL");
      const { campo } = renderizarOcioso();

      fireEvent.paste(campo, { clipboardData: { files: [new File(["png"], "tela.png", { type: "image/png" })] } });
      await screen.findByAltText("tela.png");
      fireEvent.change(campo, { target: { value: "Veja" } });
      fireEvent.keyDown(campo, { key: "Enter" });

      // "cG5n" é o base64 de "png", como o FileReader gerava antes.
      await waitFor(() =>
        expect(enviar).toHaveBeenCalledWith("o1", "Veja", [{ nome: "tela.png", tipoDeMidia: "image/png", base64: "cG5n" }], "execucao"),
      );
      await waitFor(() => expect(revogar).toHaveBeenCalledWith(criar.mock.results[0]?.value));
      await waitFor(() => expect(screen.queryByAltText("tela.png")).not.toBeInTheDocument());
    });

    it("libera as URLs ao desmontar", async () => {
      const criar = vi.spyOn(URL, "createObjectURL");
      const revogar = vi.spyOn(URL, "revokeObjectURL");
      const canvas = canvasDoTerminal(conversaOciosa());
      const { unmount } = render(<Terminal canvas={canvas} no={propsDoNo()} />);
      const campo = screen.getByRole("textbox", { name: "Mensagem para o orquestrador" });

      fireEvent.paste(campo, { clipboardData: { files: [new File(["png"], "tela.png", { type: "image/png" })] } });
      await screen.findByAltText("tela.png");
      unmount();
      expect(revogar).toHaveBeenCalledWith(criar.mock.results[0]?.value);
    });
  });

  it("/clear no prompt pede a conversa nova ao servidor, recarrega a lista e esvazia o campo", async () => {
    const limpar = vi.spyOn(api, "limparConversa").mockResolvedValue(orquestrador());
    const enviar = vi.spyOn(api, "enviarMensagem");
    const { canvas, campo } = renderizarOcioso();
    const recargasAntes = vi.mocked(canvas.acoes.recarregar).mock.calls.length;

    fireEvent.change(campo, { target: { value: "/clear" } });
    fireEvent.keyDown(campo, { key: "Enter" });

    await waitFor(() => expect(campo).toHaveValue(""));
    expect(limpar).toHaveBeenCalledWith("o1");
    expect(enviar).not.toHaveBeenCalled();
    expect(vi.mocked(canvas.acoes.recarregar).mock.calls.length).toBeGreaterThan(recargasAntes);
  });

  it("se o servidor recusar, mostra o erro no terminal e o /clear fica no campo", async () => {
    vi.spyOn(api, "limparConversa").mockRejectedValue(
      new ErroDaApi('Cancele o pedido em andamento de "Painel de salas" antes de limpar a conversa.', 409),
    );
    const { campo } = renderizarOcioso();

    fireEvent.change(campo, { target: { value: "/clear" } });
    fireEvent.keyDown(campo, { key: "Enter" });

    expect(await screen.findByText(/✗ Cancele o pedido em andamento de "Painel de salas"/)).toBeInTheDocument();
    expect(campo).toHaveValue("/clear");
  });

  it("'Nova conversa' no ⚙ pede confirmação e, confirmada, limpa e fecha o painel", async () => {
    const limpar = vi.spyOn(api, "limparConversa").mockResolvedValue(orquestrador());
    const confirmar = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderizarOcioso();
    fireEvent.click(screen.getByTitle("Configurar"));
    const botao = screen.getByRole("button", { name: "Nova conversa" });
    expect(botao).toBeEnabled();

    fireEvent.click(botao);
    expect(confirmar).toHaveBeenCalledWith("Começar uma conversa nova? A conversa atual será arquivada.");
    expect(limpar).not.toHaveBeenCalled();

    fireEvent.click(botao);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Nova conversa" })).not.toBeInTheDocument());
    expect(limpar).toHaveBeenCalledWith("o1");
  });

  it("se o servidor recusar a conversa nova pelo ⚙, o erro aparece no painel", async () => {
    vi.spyOn(api, "limparConversa").mockRejectedValue(new Error("Orquestrador não encontrado."));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderizarOcioso();
    fireEvent.click(screen.getByTitle("Configurar"));

    fireEvent.click(screen.getByRole("button", { name: "Nova conversa" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("✗ Orquestrador não encontrado.");
    expect(screen.getByRole("button", { name: "Nova conversa" })).toBeInTheDocument();
  });

  it("instruções apagadas no ⚙ com pedidos na conversa: 'Salvar e começar conversa nova' salva e limpa", async () => {
    const alterar = vi.spyOn(api, "alterarConfiguracao").mockResolvedValue(orquestrador());
    const limpar = vi.spyOn(api, "limparConversa").mockResolvedValue(orquestrador());
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const resumo = orquestrador({ instrucoesPersonalizadas: "Responda sempre em tópicos curtos." });
    render(<Terminal canvas={canvasDoTerminal(conversaOciosa(), resumo)} no={propsDoNo()} />);
    fireEvent.click(screen.getByTitle("Configurar"));

    fireEvent.change(screen.getByRole("textbox", { name: "Instruções" }), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar e começar conversa nova" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: "Nova conversa" })).not.toBeInTheDocument());
    expect(alterar).toHaveBeenCalledWith("o1", { instrucoesPersonalizadas: "" });
    expect(limpar).toHaveBeenCalledWith("o1");
  });
});

describe("NoTerminal · renomear pelo nome na barra", () => {
  afterEach(() => vi.restoreAllMocks());

  const nomeNaBarra = (nome: string) => screen.getByTitle(`${nome} · clique duplo para renomear`);
  const campoDoNome = () => screen.getByRole("textbox", { name: "Nome do orquestrador" });

  it("clique duplo abre o campo; Enter salva o nome aparado e recarrega a lista", async () => {
    const renomear = vi.spyOn(api, "renomearOrquestrador").mockResolvedValue(orquestrador());
    const canvas = canvasDoTerminal(conversaOciosa());
    render(<Terminal canvas={canvas} no={propsDoNo()} />);

    fireEvent.doubleClick(nomeNaBarra("Painel de salas"));
    expect(campoDoNome()).toHaveValue("Painel de salas");
    expect(campoDoNome()).toHaveAttribute("maxLength", "60");
    fireEvent.change(campoDoNome(), { target: { value: "  Backlog do app  " } });
    fireEvent.keyDown(campoDoNome(), { key: "Enter" });

    // Enquanto o servidor responde, a barra já mostra o nome novo.
    expect(nomeNaBarra("Backlog do app")).toBeInTheDocument();
    await waitFor(() => expect(canvas.acoes.recarregar).toHaveBeenCalled());
    expect(renomear).toHaveBeenCalledWith("o1", "Backlog do app");
    expect(screen.queryByRole("textbox", { name: "Nome do orquestrador" })).not.toBeInTheDocument();
  });

  it("Esc desiste, e em branco ou sem mudança não chama o servidor", () => {
    const renomear = vi.spyOn(api, "renomearOrquestrador");
    render(<Terminal canvas={canvasDoTerminal(conversaOciosa())} no={propsDoNo()} />);

    fireEvent.doubleClick(nomeNaBarra("Painel de salas"));
    fireEvent.change(campoDoNome(), { target: { value: "Outro nome" } });
    fireEvent.keyDown(campoDoNome(), { key: "Escape" });
    expect(nomeNaBarra("Painel de salas")).toBeInTheDocument();

    for (const valor of ["   ", "Painel de salas"]) {
      fireEvent.doubleClick(nomeNaBarra("Painel de salas"));
      fireEvent.change(campoDoNome(), { target: { value: valor } });
      fireEvent.keyDown(campoDoNome(), { key: "Enter" });
    }

    expect(renomear).not.toHaveBeenCalled();
    expect(nomeNaBarra("Painel de salas")).toBeInTheDocument();
  });

  it("se o servidor recusar, o erro aparece no terminal e volta o nome anterior", async () => {
    vi.spyOn(api, "renomearOrquestrador").mockRejectedValue(
      new ErroDaApi("O nome deve ter até 60 caracteres.", 400),
    );
    render(<Terminal canvas={canvasDoTerminal(conversaOciosa())} no={propsDoNo()} />);

    fireEvent.doubleClick(nomeNaBarra("Painel de salas"));
    fireEvent.change(campoDoNome(), { target: { value: "Novo" } });
    fireEvent.keyDown(campoDoNome(), { key: "Enter" });

    expect(await screen.findByText("✗ Não foi possível renomear: O nome deve ter até 60 caracteres.")).toBeInTheDocument();
    expect(nomeNaBarra("Painel de salas")).toBeInTheDocument();
  });

  it("o evento orquestrador_renomeado troca o nome na hora, antes da próxima consulta da lista", () => {
    const conversa = conversaOciosa();
    const canvas = canvasDoTerminal(conversa);
    const { rerender } = render(<Terminal canvas={canvas} no={propsDoNo()} />);

    const renomeada = aplicar(conversa, { tipo: "orquestrador_renomeado", nome: "Renomeado em outra aba" });
    rerender(<Terminal canvas={{ ...canvas, conversas: new Map([["o1", renomeada]]) }} no={propsDoNo()} />);

    expect(nomeNaBarra("Renomeado em outra aba")).toBeInTheDocument();
    // O ⚙ abre com o nome que a barra mostra, não com o do resumo antigo.
    fireEvent.click(screen.getByTitle("Configurar"));
    expect(screen.getByRole("textbox", { name: "Nome" })).toHaveValue("Renomeado em outra aba");
  });
});

describe("NoTerminal · servidor no ar", () => {
  it("com servidores detectados, a faixa acima do prompt abre a prévia ligada a este terminal", () => {
    const conversa: EstadoDaConversa = {
      ...ESTADO_INICIAL,
      enderecosLocais: ["http://localhost:3001", "http://localhost:5173"],
    };
    const canvas = canvasDoTerminal(conversa);
    render(<Terminal canvas={canvas} no={propsDoNo()} />);

    expect(screen.getByText("servidor no ar")).toBeInTheDocument();
    expect(screen.getByText("localhost:5173")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Abrir prévia de http://localhost:5173" }));

    expect(canvas.acoes.abrirPrevia).toHaveBeenCalledWith("o1", "http://localhost:5173");
  });

  it("sem servidores, não há faixa", () => {
    render(<Terminal canvas={canvasDoTerminal(ESTADO_INICIAL)} no={propsDoNo()} />);

    expect(screen.queryByText("servidor no ar")).not.toBeInTheDocument();
  });
});

/** Deixa terminar as promessas já resolvidas (a API falsa) sem avançar o relógio falso. */
async function concluirPromessas(): Promise<void> {
  await act(async () => {
    for (let passo = 0; passo < 10; passo += 1) {
      await Promise.resolve();
    }
  });
}

const PEDIDO_A: DadosDoPedidoNaFila = {
  id: "pa",
  texto: "rode os testes",
  modo: "execucao",
  enfileiradoEm: "2026-10-28T12:00:01.000Z",
};
const PEDIDO_B: DadosDoPedidoNaFila = {
  id: "pb",
  texto: "atualize o README",
  modo: "planejamento",
  enfileiradoEm: "2026-10-28T12:00:02.000Z",
};
const PEDIDO_C: DadosDoPedidoNaFila = {
  id: "pc",
  texto: "revise o PR",
  modo: "execucao",
  enfileiradoEm: "2026-10-28T12:00:03.000Z",
};

function comFila(...fila: DadosDoPedidoNaFila[]): ResumoDoOrquestrador {
  return { ...orquestrador(), fila };
}

function campoDoPrompt(): HTMLElement {
  return screen.getByRole("textbox", { name: "Mensagem para o orquestrador" });
}

describe("NoTerminal · fila de pedidos", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T12:00:06Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("Enter durante um pedido põe o texto na fila, com o modo escolhido, e não envia", async () => {
    const enfileirar = vi.spyOn(api, "enfileirarPedido").mockResolvedValue({ pedidoId: "p9" });
    const enviar = vi.spyOn(api, "enviarMensagem");
    render(<Terminal canvas={canvasDoTerminal(conversaDoTerminal())} no={propsDoNo()} />);
    const campo = campoDoPrompt();

    fireEvent.keyDown(campo, { key: "Tab", shiftKey: true });
    fireEvent.change(campo, { target: { value: "depois planeje a migração" } });
    fireEvent.keyDown(campo, { key: "Enter" });
    await concluirPromessas();

    expect(enfileirar).toHaveBeenCalledWith("o1", "depois planeje a migração", "planejamento");
    expect(enviar).not.toHaveBeenCalled();
    expect(campo).toHaveValue("");
  });

  it("com a fila cheia, o erro do servidor aparece no terminal e o texto fica no prompt", async () => {
    vi.spyOn(api, "enfileirarPedido").mockRejectedValue(
      new ErroDaApi('A fila de "Painel de salas" está cheia (máximo 10 pedidos).', 409),
    );
    render(<Terminal canvas={canvasDoTerminal(conversaDoTerminal())} no={propsDoNo()} />);
    const campo = campoDoPrompt();

    fireEvent.change(campo, { target: { value: "mais um" } });
    fireEvent.keyDown(campo, { key: "Enter" });
    await concluirPromessas();

    expect(screen.getByText(/✗ A fila de "Painel de salas" está cheia/)).toBeInTheDocument();
    expect(campo).toHaveValue("mais um");
  });

  it("a fila vem do resumo do servidor e os eventos atualizam por cima", () => {
    const conversa = aplicar(
      conversaDoTerminal(),
      { tipo: "pedido_retirado_da_fila", pedidoId: "pa", motivo: "removido" },
      { tipo: "pedido_enfileirado", pedido: PEDIDO_C },
    );
    render(<Terminal canvas={canvasDoTerminal(conversa, comFila(PEDIDO_A, PEDIDO_B))} no={propsDoNo()} />);

    const itens = within(screen.getByRole("region", { name: "Fila de pedidos" })).getAllByRole("listitem");
    expect(itens.map((item) => item.textContent)).toEqual(["1plan modeatualize o README", "2revise o PR"]);
  });

  it("o X tira o pedido da fila no servidor", async () => {
    const remover = vi.spyOn(api, "removerDaFila").mockResolvedValue(null);
    render(<Terminal canvas={canvasDoTerminal(conversaDoTerminal(), comFila(PEDIDO_A, PEDIDO_B))} no={propsDoNo()} />);

    fireEvent.click(screen.getByRole("button", { name: "Remover da fila o pedido 2" }));
    await concluirPromessas();

    expect(remover).toHaveBeenCalledWith("o1", "pb");
  });

  it("durante um pedido a fila anda sozinha; sem pedido rodando, fica pausada e 'enviar agora' manda o primeiro", async () => {
    const enviarDaFila = vi.spyOn(api, "enviarDaFila").mockResolvedValue({ turnoId: "t9" });
    const { unmount } = render(
      <Terminal canvas={canvasDoTerminal(conversaDoTerminal(), comFila(PEDIDO_A, PEDIDO_B))} no={propsDoNo()} />,
    );
    expect(screen.queryByText("fila pausada")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "enviar agora" })).not.toBeInTheDocument();
    unmount();

    render(<Terminal canvas={canvasDoTerminal(conversaOciosa(), comFila(PEDIDO_A, PEDIDO_B))} no={propsDoNo()} />);
    expect(screen.getByText("fila pausada")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "enviar agora" }));
    await concluirPromessas();

    expect(enviarDaFila).toHaveBeenCalledWith("o1", "pa");
  });

  describe("logo depois de um pedido terminar", () => {
    /** Um pedido que terminou com `fim` há 1 s (às 12:00:05; o relógio está em 12:00:06). */
    function terminouHaPouco(fim: EventoDeOrquestracao): EstadoDaConversa {
      const iniciado = aplicar(ESTADO_INICIAL, {
        tipo: "turno_iniciado",
        turnoId: "t1",
        texto: "resuma o projeto",
        configuracao,
      });
      return aplicarEvento(iniciado, { ...fim, sequencia: iniciado.ultimaSequencia + 1, em: "2026-10-28T12:00:05Z" });
    }

    function filaNaTela(conversa: EstadoDaConversa) {
      return render(<Terminal canvas={canvasDoTerminal(conversa, comFila(PEDIDO_A, PEDIDO_B))} no={propsDoNo()} />);
    }

    it("concluído sem plano: mostra 'enviando o próximo…' sem 'enviar agora'; passado o prazo sem turno novo, 'fila pausada'", () => {
      filaNaTela(terminouHaPouco({ tipo: "turno_concluido", turnoId: "t1", resposta: "Resumo pronto", uso: USO }));

      expect(screen.getByText("enviando o próximo…")).toBeInTheDocument();
      expect(screen.queryByText("fila pausada")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "enviar agora" })).not.toBeInTheDocument();

      // O prazo é de 5 s desde o fim (12:00:05): faltam 4 s.
      act(() => {
        vi.advanceTimersByTime(3_999);
      });
      expect(screen.getByText("enviando o próximo…")).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(screen.getByText("fila pausada")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "enviar agora" })).toBeInTheDocument();
    });

    it("o turno do próximo pedido começa: a fila volta a andar sozinha", () => {
      const concluido = terminouHaPouco({ tipo: "turno_concluido", turnoId: "t1", resposta: "Resumo pronto", uso: USO });
      const { rerender } = filaNaTela(concluido);
      const proximo = aplicar(
        concluido,
        { tipo: "pedido_retirado_da_fila", pedidoId: "pa", motivo: "enviado" },
        { tipo: "turno_iniciado", turnoId: "t2", texto: PEDIDO_A.texto, configuracao },
      );

      rerender(<Terminal canvas={canvasDoTerminal(proximo, comFila(PEDIDO_A, PEDIDO_B))} no={propsDoNo()} />);

      expect(screen.getByText("na fila")).toBeInTheDocument();
      expect(screen.queryByText("enviando o próximo…")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "enviar agora" })).not.toBeInTheDocument();
    });

    it.each<[string, EventoDeOrquestracao]>([
      ["cancelado", { tipo: "turno_cancelado", turnoId: "t1" }],
      ["com falha", { tipo: "turno_falhou", turnoId: "t1", motivo: "o processo caiu" }],
      [
        "concluído com plano pendente",
        { tipo: "turno_concluido", turnoId: "t1", resposta: "Plano", uso: USO, planoPendente: true },
      ],
    ])("%s: 'fila pausada' na hora, com 'enviar agora'", (_nome, fim) => {
      filaNaTela(terminouHaPouco(fim));

      expect(screen.getByText("fila pausada")).toBeInTheDocument();
      expect(screen.queryByText("enviando o próximo…")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "enviar agora" })).toBeInTheDocument();
    });

    it("fechar o terminal no meio do prazo cancela o relógio", () => {
      const { unmount } = filaNaTela(
        terminouHaPouco({ tipo: "turno_concluido", turnoId: "t1", resposta: "Resumo pronto", uso: USO }),
      );

      unmount();

      expect(vi.getTimerCount()).toBe(0);
    });
  });

  it("depois de um /clear a fila continua, vinda do resumo", () => {
    const limpa = aplicar(
      conversaOciosa(),
      { tipo: "pedido_enfileirado", pedido: PEDIDO_A },
      { tipo: "conversa_limpa", turnosAnteriores: 1, planoDescartado: false, worktreeComAlteracoes: false },
    );
    render(<Terminal canvas={canvasDoTerminal(limpa, comFila(PEDIDO_A))} no={propsDoNo()} />);

    expect(screen.getByText(/^— conversa nova iniciada às/)).toBeInTheDocument();
    // Sem pedido rodando, a fila está pausada: o primeiro tem o "enviar agora".
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual(["1rode os testesenviar agora"]);
  });
});

/** O que o navegador põe no arraste de uma linha de nota (ver `escreverPedidoArrastado`). */
function arrasteDeNota(texto: string) {
  const dados: Record<string, string> = {
    [TIPO_DO_PEDIDO_ARRASTADO]: JSON.stringify({ texto, notaId: "n1" }),
    "text/plain": texto,
  };
  return { types: Object.keys(dados), getData: (tipo: string) => dados[tipo] ?? "", files: [], dropEffect: "none" };
}

describe("NoTerminal · nota arrastada para o terminal", () => {
  afterEach(() => vi.restoreAllMocks());

  function renderizarTerminal() {
    const { container } = render(<Terminal canvas={canvasDoTerminal(conversaOciosa())} no={propsDoNo()} />);
    const janela = container.querySelector(".janela-terminal");
    if (!(janela instanceof HTMLElement)) {
      throw new Error("janela do terminal não encontrada");
    }
    return janela;
  }

  it("durante o arraste avisa que vai escrever no prompt; ao soltar, o texto entra no prompt e nada é enviado", () => {
    const enviar = vi.spyOn(api, "enviarMensagem");
    const enfileirar = vi.spyOn(api, "enfileirarPedido");
    const janela = renderizarTerminal();
    const campo = campoDoPrompt();
    fireEvent.change(campo, { target: { value: "corrija o bug" } });

    const arraste = arrasteDeNota("revisar o domínio");
    const aceito = !fireEvent.dragOver(janela, { dataTransfer: arraste });
    expect(aceito).toBe(true);
    expect(arraste.dropEffect).toBe("copy");
    expect(screen.getByText(/solte para escrever no prompt/)).toBeInTheDocument();

    fireEvent.drop(janela, { dataTransfer: arrasteDeNota("revisar o domínio") });

    expect(screen.queryByText(/solte para escrever no prompt/)).not.toBeInTheDocument();
    expect(campo).toHaveValue("corrija o bug\nrevisar o domínio");
    expect(campo).toHaveFocus();
    expect(enviar).not.toHaveBeenCalled();
    expect(enfileirar).not.toHaveBeenCalled();
  });

  it("arquivos continuam com o aviso de anexar imagens", () => {
    const janela = renderizarTerminal();

    fireEvent.dragOver(janela, { dataTransfer: { types: ["Files"], files: [] } });

    expect(screen.getByText("solte para anexar as imagens a este orquestrador")).toBeInTheDocument();
    expect(screen.queryByText(/solte para escrever no prompt/)).not.toBeInTheDocument();
  });

  it("o botão de alterações fica na barra do terminal, com o id do orquestrador", () => {
    renderizarTerminal();

    expect(screen.getByRole("button", { name: "Alterações de o1" })).toBeInTheDocument();
  });
});

describe("NoTerminal · barra estreita", () => {
  /** Guarda o aviso do observador: o teste diz quando a barra "mudou de tamanho". */
  const avisos: (() => void)[] = [];
  class ObservadorDeTamanhoSimulado {
    constructor(aviso: () => void) {
      avisos.push(aviso);
    }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }

  beforeEach(() => {
    avisos.length = 0;
    vi.stubGlobal("ResizeObserver", ObservadorDeTamanhoSimulado);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const resumoCheio = (): ResumoDoOrquestrador => ({
    ...orquestrador(),
    instrucoesAtivas: "padrao",
    worktree: { branch: "feature/barra-estreita", caminho: "C:\\projetos\\painel-wt", ativo: true },
  });

  /** Renderiza o terminal e simula a barra com `largura` px (o jsdom não tem layout). */
  function renderizarComLargura(largura: number) {
    const { container } = render(<Terminal canvas={canvasDoTerminal(conversaOciosa(), resumoCheio())} no={propsDoNo()} />);
    const barra = container.querySelector(".barra-do-terminal");
    if (!(barra instanceof HTMLElement)) {
      throw new Error("barra do terminal não encontrada");
    }
    Object.defineProperty(barra, "clientWidth", { configurable: true, value: largura });
    act(() => {
      for (const aviso of avisos) {
        aviso();
      }
    });
    return barra;
  }

  const CONTROLES = ["Limpar bixinhos", "Alterações de o1", "Configurar", "Fechar o terminal"];

  it("larga, todos os chips ficam na barra, cada um com o texto inteiro no title, e não há ⋯", () => {
    const barra = renderizarComLargura(1400);

    expect(within(barra).getByTitle("C:\\projetos\\painel")).toHaveTextContent("painel");
    expect(within(barra).getByTitle(/^Branch: feature\/barra-estreita/)).toHaveTextContent("feature/barra-estreita");
    expect(within(barra).getByTitle(/^Instruções gerais ativas/)).toHaveTextContent("instruções gerais");
    // A barra não mostra mais a etiqueta de situação nem a RAM (só a borda que brilha indica o pedido).
    expect(within(barra).queryByTitle(/^Situação/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mais da barra" })).not.toBeInTheDocument();
    for (const controle of CONTROLES) {
      expect(within(barra).getByRole("button", { name: controle })).toBeInTheDocument();
    }
  });

  it("estreita, os controles continuam na barra e os chips que sobram vão para o ⋯", () => {
    const barra = renderizarComLargura(360);

    for (const controle of CONTROLES) {
      expect(within(barra).getByRole("button", { name: controle })).toBeInTheDocument();
    }
    expect(within(barra).queryByText("instruções gerais")).not.toBeInTheDocument();
    expect(within(barra).getByText("Painel de salas")).toBeInTheDocument();

    const mais = screen.getByRole("button", { name: "Mais da barra" });
    expect(mais).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(mais);

    const menu = screen.getByRole("group", { name: "O que não coube na barra" });
    expect(mais).toHaveAttribute("aria-expanded", "true");
    expect(within(menu).getByTitle(/^Instruções gerais ativas/)).toHaveTextContent("instruções gerais");
    // Sem a RAM e a situação, a branch ainda cabe na barra a 360 px.
    expect(within(menu).queryByTitle(/^Branch:/)).not.toBeInTheDocument();
    expect(within(barra).getByTitle(/^Branch: feature\/barra-estreita/)).toBeInTheDocument();
    // Os controles não vão para o menu.
    expect(within(menu).queryByRole("button")).not.toBeInTheDocument();

    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "O que não coube na barra" })).not.toBeInTheDocument();
  });

  it("a janela que volta a crescer traz os chips de volta e tira o ⋯", () => {
    const barra = renderizarComLargura(360);
    expect(screen.getByRole("button", { name: "Mais da barra" })).toBeInTheDocument();

    Object.defineProperty(barra, "clientWidth", { configurable: true, value: 1400 });
    act(() => {
      for (const aviso of avisos) {
        aviso();
      }
    });

    expect(screen.queryByRole("button", { name: "Mais da barra" })).not.toBeInTheDocument();
    expect(within(barra).getByText("instruções gerais")).toBeInTheDocument();
  });

  it("os controles de janela ficam no fim da barra, com o tooltip de que o orquestrador continua salvo", () => {
    const barra = renderizarComLargura(1400);
    const fechar = within(barra).getByRole("button", { name: "Fechar o terminal" });

    expect(fechar).toHaveAttribute("title", "Fechar o terminal (o orquestrador e o histórico continuam salvos)");
    expect(fechar.closest(".controles-do-no")?.previousElementSibling).toHaveAttribute("aria-label", "Configurar");
    expect(fechar.closest(".controles-da-barra")).not.toBeNull();
  });
});

describe("NoTerminal · bolinhas da barra", () => {
  afterEach(() => {
    ponte.noMac = false;
    vi.restoreAllMocks();
  });

  const barraDoTerminal = (container: HTMLElement): HTMLElement => {
    const barra = container.querySelector(".barra-do-terminal");
    if (!(barra instanceof HTMLElement)) {
      throw new Error("barra do terminal não encontrada");
    }
    return barra;
  };
  const campo = () => screen.getByRole("textbox", { name: "Mensagem para o orquestrador" });
  const MINIMIZADO = { orquestradorId: "o1", minimizada: true, alturaAberta: 460 };

  it("no Windows e no navegador, minimizar, ampliar e fechar ficam à direita, sem bolinhas", () => {
    const canvas = canvasDoTerminal(conversaOciosa());
    const { container } = render(<Terminal canvas={canvas} no={propsDoNo()} />);
    const barra = barraDoTerminal(container);
    const controles = within(barra).getByRole("group", { name: "Controles da janela" });

    expect(barra.querySelector(".bolinha-do-no")).toBeNull();
    expect(barra.querySelector(".semaforo")).toBeNull();
    expect(controles.closest(".controles-da-barra")).not.toBeNull();
    expect(within(controles).getAllByRole("button").map((botao) => botao.getAttribute("aria-label"))).toEqual([
      "Minimizar o terminal",
      "Ampliar o terminal",
      "Fechar o terminal",
    ]);
    fireEvent.click(within(controles).getByRole("button", { name: "Fechar o terminal" }));
    expect(canvas.acoes.fecharTerminal).toHaveBeenCalledWith("o1");
  });

  it("no Mac, viram botões (fechar, minimizar, tela cheia) e o ✕ da direita sai", () => {
    ponte.noMac = true;
    const canvas = canvasDoTerminal(conversaOciosa());
    const { container } = render(<Terminal canvas={canvas} no={propsDoNo()} />);
    const barra = barraDoTerminal(container);
    const bolinhas = within(barra).getByRole("group", { name: "Controles da janela" });

    expect(bolinhas.nextElementSibling).toBeInstanceOf(SVGElement);
    expect(within(bolinhas).getAllByRole("button").map((botao) => botao.getAttribute("aria-label"))).toEqual([
      "Fechar o terminal",
      "Minimizar o terminal",
      "Ampliar o terminal",
    ]);
    expect(within(bolinhas).getByRole("button", { name: "Fechar o terminal" })).toHaveAttribute(
      "title",
      "Fechar o terminal (o orquestrador e o histórico continuam salvos)",
    );
    for (const botao of within(bolinhas).getAllByRole("button")) {
      expect(botao).toHaveClass("nodrag");
    }
    // Um só "Fechar o terminal": o das bolinhas. Os botões da direita não existem no Mac.
    expect(within(barra).getAllByRole("button", { name: "Fechar o terminal" })).toHaveLength(1);
    expect(barra.querySelector(".botao-do-no")).toBeNull();
    expect(barra.querySelector(".separador-dos-controles-do-no")).toBeNull();

    fireEvent.click(within(bolinhas).getByRole("button", { name: "Fechar o terminal" }));
    expect(canvas.acoes.fecharTerminal).toHaveBeenCalledWith("o1");
  });

  it("a amarela minimiza; minimizado, fica só a barra, sem perder o prompt, e a amarela ou o duplo clique restauram", () => {
    ponte.noMac = true;
    const canvas = canvasDoTerminal(conversaOciosa());
    const { container, rerender } = render(<Terminal canvas={canvas} no={propsDoNo()} />);
    fireEvent.change(campo(), { target: { value: "rascunho do pedido" } });

    fireEvent.click(screen.getByRole("button", { name: "Minimizar o terminal" }));
    expect(canvas.acoes.minimizarOuRestaurarTerminal).toHaveBeenCalledWith("o1");

    // O canvas troca os dados do nó.
    rerender(<Terminal canvas={canvas} no={propsDoNo({ data: MINIMIZADO })} />);
    const barra = barraDoTerminal(container);
    expect(container.querySelector(".janela-terminal")).toHaveClass("janela-terminal-minimizada");
    expect(container.querySelector(".conteudo-do-cartao")).toHaveAttribute("hidden");
    // Escondido (fora da árvore acessível), mas montado, com o texto.
    expect(screen.queryByRole("textbox", { name: "Mensagem para o orquestrador" })).not.toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "Mensagem para o orquestrador", hidden: true }),
    ).toHaveValue("rascunho do pedido");

    fireEvent.click(within(barra).getByRole("button", { name: "Restaurar o terminal" }));
    expect(canvas.acoes.minimizarOuRestaurarTerminal).toHaveBeenCalledTimes(2);

    // Duplo clique no nome restaura (e não abre o renomear); num botão da barra, não.
    fireEvent.doubleClick(within(barra).getByText("Painel de salas"));
    expect(canvas.acoes.minimizarOuRestaurarTerminal).toHaveBeenCalledTimes(3);
    expect(screen.queryByRole("textbox", { name: "Nome do orquestrador" })).not.toBeInTheDocument();
    fireEvent.doubleClick(within(barra).getByRole("button", { name: "Restaurar o terminal" }));
    expect(canvas.acoes.minimizarOuRestaurarTerminal).toHaveBeenCalledTimes(3);

    rerender(<Terminal canvas={canvas} no={propsDoNo()} />);
    expect(container.querySelector(".conteudo-do-cartao")).not.toHaveAttribute("hidden");
    expect(campo()).toHaveValue("rascunho do pedido");
  });

  it("a verde põe em tela cheia com o mesmo texto no prompt; Esc volta", () => {
    ponte.noMac = true;
    render(<Terminal canvas={canvasDoTerminal(conversaOciosa())} no={propsDoNo()} />);
    fireEvent.change(campo(), { target: { value: "continua aqui" } });

    fireEvent.click(screen.getByRole("button", { name: "Ampliar o terminal" }));

    const tela = screen.getByRole("dialog", { name: "Painel de salas em tela cheia" });
    expect(screen.getByText("em tela cheia · Esc volta")).toBeInTheDocument();
    expect(within(tela).getByRole("textbox", { name: "Mensagem para o orquestrador" })).toHaveValue("continua aqui");
    expect(within(tela).getByText("resuma o projeto")).toBeInTheDocument();
    expect(within(tela).getByRole("button", { name: "Sair da tela cheia" })).toBeInTheDocument();

    fireEvent.keyDown(within(tela).getByRole("textbox", { name: "Mensagem para o orquestrador" }), { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "Painel de salas em tela cheia" })).not.toBeInTheDocument();
    expect(screen.queryByText("em tela cheia · Esc volta")).not.toBeInTheDocument();
    expect(campo()).toHaveValue("continua aqui");
    expect(screen.getByRole("button", { name: "Ampliar o terminal" })).toBeInTheDocument();
  });

  it("em tela cheia, a verde também volta, e o Esc que cancela o pedido no prompt não sai dela", () => {
    ponte.noMac = true;
    const cancelar = vi.spyOn(api, "cancelar").mockResolvedValue({ cancelando: true });
    render(<Terminal canvas={canvasDoTerminal(conversaDoTerminal())} no={propsDoNo()} />);

    fireEvent.click(screen.getByRole("button", { name: "Ampliar o terminal" }));
    const tela = screen.getByRole("dialog", { name: "Painel de salas em tela cheia" });
    fireEvent.keyDown(within(tela).getByRole("textbox", { name: "Mensagem para o orquestrador" }), { key: "Escape" });

    expect(cancelar).toHaveBeenCalledWith("o1");
    expect(screen.getByRole("dialog", { name: "Painel de salas em tela cheia" })).toBeInTheDocument();

    fireEvent.click(within(tela).getByRole("button", { name: "Sair da tela cheia" }));
    expect(screen.queryByRole("dialog", { name: "Painel de salas em tela cheia" })).not.toBeInTheDocument();
  });
});

describe("NoTerminal · borda piscando na entrega do relatório", () => {
  const reduzirMovimento = { ligado: false };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T12:00:06Z"));
    contagem.transcricoes = 0;
    reduzirMovimento.ligado = false;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (consulta: string) => ({
        matches: consulta === "(prefers-reduced-motion: reduce)" && reduzirMovimento.ligado,
        media: consulta,
      }),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(window, "matchMedia");
  });

  const INICIADO: EventoDeOrquestracao = {
    tipo: "subagente_iniciado",
    turnoId: "t2",
    subagenteId: "s1",
    descricao: "Testes",
    tarefa: "rode os testes",
  };
  const CONCLUIDO: Extract<EventoDeOrquestracao, { tipo: "subagente_concluido" }> = {
    tipo: "subagente_concluido",
    turnoId: "t2",
    subagenteId: "s1",
    situacao: "concluido",
    resumo: "ok",
    tokens: 10,
    duracaoMs: 1000,
  };

  function executando(): EstadoDaConversa {
    return aplicar(conversaDoTerminal(), INICIADO);
  }

  function renderizarComSubagente(conversa: EstadoDaConversa, canvas: ValorDoCanvas = canvasDoTerminal(conversa)) {
    const resultado = render(<Terminal canvas={canvas} no={propsDoNo()} />);
    const janela = () => resultado.container.querySelector(".janela-terminal");
    return { ...resultado, janela, canvas };
  }

  function avancar(ms: number): void {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  }

  it("quando o subagente conclui, pisca depois do envelope chegar e para em seguida, sem re-renderizar a transcrição", () => {
    const conversa = executando();
    const { janela, rerender, canvas } = renderizarComSubagente(conversa);

    rerender(<Terminal canvas={{ ...canvas, conversas: new Map([["o1", aplicar(conversa, CONCLUIDO)]]) }} no={propsDoNo()} />);
    const transcricoes = contagem.transcricoes;

    avancar(DURACAO_DA_ENTREGA_MS - 1);
    expect(janela()).not.toHaveClass("janela-terminal-entrega");
    avancar(1);
    expect(janela()).toHaveClass("janela-terminal-entrega");
    avancar(DURACAO_DO_PISCAR_MS);
    expect(janela()).not.toHaveClass("janela-terminal-entrega");
    expect(contagem.transcricoes).toBe(transcricoes);
  });

  it("não pisca ao abrir com o subagente já concluído", () => {
    const { janela } = renderizarComSubagente(aplicar(executando(), CONCLUIDO));

    avancar(DURACAO_DA_ENTREGA_MS + DURACAO_DO_PISCAR_MS);
    expect(janela()).not.toHaveClass("janela-terminal-entrega");
  });

  it("não pisca com o histórico antigo reenviado (ex.: recarregar a página)", () => {
    const conversa = executando();
    const { janela, rerender, canvas } = renderizarComSubagente(conversa);
    const antigo: EventoRegistrado = { ...CONCLUIDO, sequencia: conversa.ultimaSequencia + 1, em: "2026-10-28T11:30:00Z" };

    rerender(
      <Terminal canvas={{ ...canvas, conversas: new Map([["o1", aplicarEvento(conversa, antigo)]]) }} no={propsDoNo()} />,
    );
    avancar(DURACAO_DA_ENTREGA_MS);
    expect(janela()).not.toHaveClass("janela-terminal-entrega");
  });

  it("não pisca se o subagente falhou, com o servidor desconectado nem com o reduzir movimento", () => {
    const conversa = executando();
    const falhou = aplicar(conversa, { ...CONCLUIDO, situacao: "falhou" });
    const concluido = aplicar(conversa, CONCLUIDO);
    const desconectado = (estado: EstadoDaConversa): ValorDoCanvas => ({
      ...canvasDoTerminal(estado),
      servidor: { conectado: false, caiuEm: null, voltouEm: null, reiniciou: false, memoria: null },
    });

    const primeiro = renderizarComSubagente(conversa);
    primeiro.rerender(<Terminal canvas={canvasDoTerminal(falhou)} no={propsDoNo()} />);
    avancar(DURACAO_DA_ENTREGA_MS);
    expect(primeiro.janela()).not.toHaveClass("janela-terminal-entrega");
    primeiro.unmount();

    const segundo = renderizarComSubagente(conversa, desconectado(conversa));
    segundo.rerender(<Terminal canvas={desconectado(concluido)} no={propsDoNo()} />);
    avancar(DURACAO_DA_ENTREGA_MS);
    expect(segundo.janela()).not.toHaveClass("janela-terminal-entrega");
    segundo.unmount();

    reduzirMovimento.ligado = true;
    const terceiro = renderizarComSubagente(conversa);
    terceiro.rerender(<Terminal canvas={canvasDoTerminal(concluido)} no={propsDoNo()} />);
    avancar(DURACAO_DA_ENTREGA_MS);
    expect(terceiro.janela()).not.toHaveClass("janela-terminal-entrega");
  });

  it("fechar o terminal no meio da entrega cancela os relógios", () => {
    const conversa = executando();
    const { rerender, unmount, canvas } = renderizarComSubagente(conversa);
    rerender(<Terminal canvas={{ ...canvas, conversas: new Map([["o1", aplicar(conversa, CONCLUIDO)]]) }} no={propsDoNo()} />);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("NoTerminal · itens ligados", () => {
  afterEach(() => vi.restoreAllMocks());

  const LIGADOS = ["nota:n1", "previa:p1", "artefato:a1"];
  const ITENS_PARA_ENVIO = [
    { tipo: "nota" as const, titulo: "Ideias", conteudo: "comprar café" },
    { tipo: "previa" as const, titulo: "localhost:5173", url: "http://localhost:5173/" },
  ];

  function renderizarLigado(conversa: EstadoDaConversa = conversaOciosa(), ligados: readonly string[] = LIGADOS) {
    const canvas = canvasDoTerminal(conversa);
    const desligarItem = vi.fn();
    const lerItensLigados = vi.fn(() => ITENS_PARA_ENVIO);
    canvas.acoes = { ...canvas.acoes, desligarItem, lerItensLigados };
    const lojaDasNotas = criarLojaDasNotas();
    lojaDasNotas.carregar([
      { id: "n1", titulo: "Ideias", texto: "comprar café", criadaEm: "2026-11-08T12:00:00Z", atualizadaEm: "2026-11-08T12:00:00Z" },
    ]);
    const lojaDosArtefatos = criarLojaDosArtefatos();
    lojaDosArtefatos.publicar({
      lista: [
        {
          id: "a1",
          titulo: "Relatório da semana",
          formato: "html",
          origem: { tipo: "orquestrador", id: "o1" },
          arquivo: "relatorio.html",
          criadoEm: "2026-11-08T12:00:00Z",
          atualizadoEm: "2026-11-08T12:00:00Z",
          versaoAtual: 1,
          versoes: [],
        },
      ],
      carregada: true,
      erro: null,
    });
    const previa = novaPrevia("p1", { x: 0, y: 600 }, { url: "http://localhost:5173/", orquestradorId: null });
    render(
      <ReactFlowProvider initialNodes={[previa]}>
        <ContextoDoCanvas.Provider value={canvas}>
          <ProvedorDasNotas valor={{ loja: lojaDasNotas, acoes: {} as AcoesDasNotas }}>
            <ProvedorDosArtefatos valor={{ loja: lojaDosArtefatos, acoes: {} as AcoesDosArtefatos }}>
              <NoTerminal {...propsDoNo({ data: { orquestradorId: "o1", ligados } })} />
            </ProvedorDosArtefatos>
          </ProvedorDasNotas>
        </ContextoDoCanvas.Provider>
      </ReactFlowProvider>,
    );
    return { desligarItem, lerItensLigados };
  }

  it("mostra um chip por item ligado, acima do prompt, e o × desliga só aquele", () => {
    const { desligarItem } = renderizarLigado();

    const grupo = screen.getByRole("group", { name: "Itens ligados a este orquestrador" });
    expect(within(grupo).getByText("Ideias")).toBeInTheDocument();
    expect(within(grupo).getByText("localhost:5173")).toBeInTheDocument();
    expect(within(grupo).getByText("Relatório da semana")).toBeInTheDocument();

    fireEvent.click(within(grupo).getByRole("button", { name: "Desligar a prévia localhost:5173" }));
    expect(desligarItem).toHaveBeenCalledWith("o1", "previa:p1");
    expect(desligarItem).toHaveBeenCalledTimes(1);
  });

  it("sem itens ligados, não há a faixa dos chips", () => {
    render(<Terminal canvas={canvasDoTerminal(conversaOciosa())} no={propsDoNo()} />);

    expect(screen.queryByRole("group", { name: "Itens ligados a este orquestrador" })).not.toBeInTheDocument();
  });

  it("o próximo pedido leva os itens ligados, lidos na hora do envio", async () => {
    const enviar = vi.spyOn(api, "enviarMensagem").mockResolvedValue({ turnoId: "t2" });
    const { lerItensLigados } = renderizarLigado();
    const campo = campoDoPrompt();

    fireEvent.change(campo, { target: { value: "use a nota" } });
    fireEvent.keyDown(campo, { key: "Enter" });

    await waitFor(() => expect(enviar).toHaveBeenCalledWith("o1", "use a nota", [], "execucao", ITENS_PARA_ENVIO));
    expect(lerItensLigados).toHaveBeenCalledWith("o1");
  });

  it("pôr na fila também leva os itens ligados, como estão agora", async () => {
    const enfileirar = vi.spyOn(api, "enfileirarPedido").mockResolvedValue({ pedidoId: "p9" });
    renderizarLigado(conversaDoTerminal());
    const campo = campoDoPrompt();

    fireEvent.change(campo, { target: { value: "depois veja a prévia" } });
    fireEvent.keyDown(campo, { key: "Enter" });

    await waitFor(() =>
      expect(enfileirar).toHaveBeenCalledWith("o1", "depois veja a prévia", "execucao", ITENS_PARA_ENVIO),
    );
  });
});
