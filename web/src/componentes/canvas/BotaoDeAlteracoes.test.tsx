import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import {
  type AlteracoesDoWorktree,
  apiDeAlteracoes,
  TEXTO_SEM_ALTERACOES,
  TEXTO_SEM_GIT,
} from "../../shared/api/alteracoes";
import { ErroDaApi } from "../../shared/api/cliente";
import type { DadosDaConfiguracao, EventoDeOrquestracao, EventoRegistrado } from "../../shared/api/tipos";
import { ContextoDoCanvas, type ValorDoCanvas } from "../../shared/canvas/contexto";
import { aplicarEvento, ESTADO_INICIAL, type EstadoDaConversa } from "../../shared/estado/aplicarEvento";
import { BotaoDeAlteracoes } from "./BotaoDeAlteracoes";

const configuracao: DadosDaConfiguracao = {
  modeloDoOrquestrador: "opus",
  esforcoDoOrquestrador: "padrao",
  modeloDosSubagentes: "haiku",
  esforcoDosSubagentes: "padrao",
  quantidadeDeSubagentes: { modo: "fixa", limite: 2 },
  nivelDePermissao: "leitura",
  permitirCommitEPush: false,
  instrucoesPersonalizadas: "",
};

function conversa(eventos: EventoDeOrquestracao[]): EstadoDaConversa {
  return eventos
    .map((evento, indice): EventoRegistrado => ({ ...evento, sequencia: indice + 1, em: "2026-11-05T12:00:00Z" }))
    .reduce(aplicarEvento, ESTADO_INICIAL);
}

const INICIO: EventoDeOrquestracao = { tipo: "turno_iniciado", turnoId: "t1", texto: "corrija o bug", configuracao };
const trabalhando = conversa([INICIO]);
const trabalhandoComSubagente = conversa([
  INICIO,
  { tipo: "subagente_iniciado", turnoId: "t1", subagenteId: "s1", descricao: "A", tarefa: "" },
]);
const ocioso = conversa([
  INICIO,
  {
    tipo: "turno_concluido",
    turnoId: "t1",
    resposta: "pronto",
    uso: { duracaoMs: 1, tokensDeEntrada: 1, tokensDeSaida: 1, subagentesLancados: 0 },
  },
]);

function alteracoes(parcial: Partial<AlteracoesDoWorktree> = {}): AlteracoesDoWorktree {
  return {
    situacao: "com_worktree",
    branch: "orquestrador/o1",
    caminho: "C:/dados/worktrees/o1",
    emUso: false,
    commitsNaBranch: 0,
    arquivos: [
      { caminho: "a.ts", caminhoAnterior: null, situacao: "modificado", adicoes: 1, remocoes: 0, binario: false },
      { caminho: "b.ts", caminhoAnterior: null, situacao: "adicionado", adicoes: 3, remocoes: 0, binario: false },
      { caminho: "c.ts", caminhoAnterior: null, situacao: "removido", adicoes: 0, remocoes: 9, binario: false },
    ],
    ...parcial,
  };
}

function canvas(estado: EstadoDaConversa): ValorDoCanvas {
  return {
    orquestradores: new Map(),
    conversas: new Map([["o1", estado]]),
    conexoes: new Map(),
    sinais: new Map(),
    bixinhosLimpos: new Map(),
    servidor: { conectado: true, caiuEm: null, voltouEm: null, reiniciou: false, memoria: null },
    acoes: {
      abrirTerminal: vi.fn(),
      fecharTerminal: vi.fn(),
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

function arvore(estado: EstadoDaConversa) {
  return (
    <ContextoDoCanvas.Provider value={canvas(estado)}>
      <BotaoDeAlteracoes orquestradorId="o1" />
    </ContextoDoCanvas.Provider>
  );
}

function botao(): HTMLElement {
  return screen.getByRole("button", { name: "Alterações do worktree" });
}

describe("BotaoDeAlteracoes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("mostra a contagem de arquivos e abre o painel, lendo a lista de novo", async () => {
    const consultar = vi.spyOn(apiDeAlteracoes, "consultar").mockResolvedValue(alteracoes());
    render(arvore(ESTADO_INICIAL));

    expect(await screen.findByTestId("contagem-de-alteracoes")).toHaveTextContent("3");
    expect(consultar).toHaveBeenCalledWith("o1");
    expect(botao()).toBeEnabled();
    expect(botao()).toHaveAttribute("title", expect.stringContaining("3 arquivos alterados"));

    fireEvent.click(botao());

    expect(screen.getByRole("dialog", { name: "Alterações do worktree" })).toBeInTheDocument();
    expect(botao()).toHaveAttribute("aria-expanded", "true");
    expect(consultar).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole("button", { name: /a\.ts/ })).toBeInTheDocument();
  });

  it("relê quando o pedido termina (trabalhando → ocioso), e não a cada render", async () => {
    const consultar = vi.spyOn(apiDeAlteracoes, "consultar").mockResolvedValue(alteracoes());
    const { rerender } = render(arvore(trabalhando));
    await screen.findByTestId("contagem-de-alteracoes");
    expect(consultar).toHaveBeenCalledTimes(1);

    // Eventos do pedido em andamento não relêem.
    rerender(arvore(trabalhandoComSubagente));
    rerender(arvore(trabalhandoComSubagente));
    expect(consultar).toHaveBeenCalledTimes(1);

    rerender(arvore(ocioso));
    expect(consultar).toHaveBeenCalledTimes(2);

    // Já ocioso: novos renders não relêem.
    rerender(arvore(ocioso));
    rerender(arvore(ocioso));
    expect(consultar).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(botao()).toHaveAttribute("title", expect.stringContaining("3 arquivos")));
  });

  it("fica esmaecido sem alterações, com o motivo no title", async () => {
    vi.spyOn(apiDeAlteracoes, "consultar").mockResolvedValue(
      alteracoes({ situacao: "sem_worktree", branch: null, caminho: null, arquivos: [] }),
    );
    render(arvore(ESTADO_INICIAL));

    await waitFor(() => expect(botao()).toHaveAttribute("title", TEXTO_SEM_ALTERACOES));
    expect(botao()).toBeDisabled();
    expect(screen.queryByTestId("contagem-de-alteracoes")).not.toBeInTheDocument();
  });

  it("fica esmaecido em pasta sem git", async () => {
    vi.spyOn(apiDeAlteracoes, "consultar").mockResolvedValue(
      alteracoes({ situacao: "sem_git", branch: null, caminho: null, arquivos: [] }),
    );
    render(arvore(ESTADO_INICIAL));

    await waitFor(() => expect(botao()).toHaveAttribute("title", TEXTO_SEM_GIT));
    expect(botao()).toBeDisabled();
  });

  it("sem arquivos mas com commits na branch, continua abrível", async () => {
    vi.spyOn(apiDeAlteracoes, "consultar").mockResolvedValue(alteracoes({ arquivos: [], commitsNaBranch: 2 }));
    render(arvore(ESTADO_INICIAL));

    await waitFor(() => expect(botao()).toBeEnabled());
    expect(botao()).toHaveAttribute("title", expect.stringContaining("2 commits na branch orquestrador/o1"));
  });

  it("na falha, continua usável com o erro no title, e o painel tenta de novo", async () => {
    const consultar = vi
      .spyOn(apiDeAlteracoes, "consultar")
      .mockRejectedValue(new ErroDaApi("Não foi possível ler as alterações do worktree.", 500));
    render(arvore(ESTADO_INICIAL));

    await waitFor(() =>
      expect(botao()).toHaveAttribute("title", expect.stringContaining("Não foi possível ler as alterações do worktree.")),
    );
    expect(botao()).toBeEnabled();

    fireEvent.click(botao());
    const tentar = await screen.findByRole("button", { name: "tentar de novo" });
    await waitFor(() => expect(tentar).toBeEnabled());
    consultar.mockResolvedValue(alteracoes());
    fireEvent.click(tentar);

    expect(await screen.findByRole("button", { name: /b\.ts/ })).toBeInTheDocument();
    expect(consultar).toHaveBeenCalledTimes(3);
  });

  it("Esc fecha o painel e devolve o foco ao botão", async () => {
    vi.spyOn(apiDeAlteracoes, "consultar").mockResolvedValue(alteracoes());
    render(arvore(ESTADO_INICIAL));
    await screen.findByTestId("contagem-de-alteracoes");

    fireEvent.click(botao());
    // A releitura feita ao abrir termina antes de fechar.
    await screen.findByRole("button", { name: "atualizar" });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(botao()).toHaveFocus();
  });

  it("clique fora fecha o painel", async () => {
    vi.spyOn(apiDeAlteracoes, "consultar").mockResolvedValue(alteracoes());
    render(arvore(ESTADO_INICIAL));
    await screen.findByTestId("contagem-de-alteracoes");

    fireEvent.click(botao());
    await screen.findByRole("button", { name: "atualizar" });
    fireEvent.mouseDown(screen.getByTestId("fundo-do-painel-de-alteracoes"));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(botao()).toHaveAttribute("aria-expanded", "false");
  });
});
