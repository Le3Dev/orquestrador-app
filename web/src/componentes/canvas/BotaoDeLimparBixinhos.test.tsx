import { fireEvent, render, screen } from "@testing-library/react";

import type { DadosDaConfiguracao, EventoDeOrquestracao, EventoRegistrado } from "../../shared/api/tipos";
import { ContextoDoCanvas, type ValorDoCanvas } from "../../shared/canvas/contexto";
import type { BixinhosLimpos } from "../../shared/canvas/layout";
import { aplicarEvento, ESTADO_INICIAL, type EstadoDaConversa } from "../../shared/estado/aplicarEvento";
import { BotaoDeLimparBixinhos } from "./BotaoDeLimparBixinhos";

const configuracao: DadosDaConfiguracao = {
  modeloDoOrquestrador: "opus",
  esforcoDoOrquestrador: "padrao",
  modeloDosSubagentes: "haiku",
  esforcoDosSubagentes: "padrao",
  quantidadeDeSubagentes: { modo: "fixa", limite: 2 },
  nivelDePermissao: "leitura",
  permitirCommitEPush: false,
};

function conversa(eventos: EventoDeOrquestracao[]): EstadoDaConversa {
  return eventos
    .map((evento, indice): EventoRegistrado => ({ ...evento, sequencia: indice + 1, em: "2026-10-28T12:00:00Z" }))
    .reduce(aplicarEvento, ESTADO_INICIAL);
}

const umProntoUmTrabalhando = conversa([
  { tipo: "turno_iniciado", turnoId: "t1", texto: "analise", configuracao },
  { tipo: "subagente_iniciado", turnoId: "t1", subagenteId: "s1", descricao: "A", tarefa: "" },
  { tipo: "subagente_iniciado", turnoId: "t1", subagenteId: "s2", descricao: "B", tarefa: "" },
  { tipo: "subagente_concluido", turnoId: "t1", subagenteId: "s1", situacao: "concluido", resumo: "", tokens: 1, duracaoMs: 1 },
]);

const soTrabalhando = conversa([
  { tipo: "turno_iniciado", turnoId: "t1", texto: "analise", configuracao },
  { tipo: "subagente_iniciado", turnoId: "t1", subagenteId: "s1", descricao: "A", tarefa: "" },
]);

function renderizar(estado: EstadoDaConversa, limpos?: BixinhosLimpos) {
  const limparBixinhos = vi.fn();
  const canvas: ValorDoCanvas = {
    orquestradores: new Map(),
    conversas: new Map([["o1", estado]]),
    conexoes: new Map(),
    sinais: new Map(),
    bixinhosLimpos: new Map<string, BixinhosLimpos>(limpos === undefined ? [] : [["o1", limpos]]),
    servidor: { conectado: true, caiuEm: null, voltouEm: null, reiniciou: false, memoria: null },
    acoes: {
      abrirTerminal: vi.fn(),
      fecharTerminal: vi.fn(),
      limparBixinhos,
      orquestradorCriado: vi.fn(),
      descartarRascunho: vi.fn(),
      recarregar: vi.fn(async () => undefined),
    },
  };
  render(
    <ContextoDoCanvas.Provider value={canvas}>
      <BotaoDeLimparBixinhos orquestradorId="o1" />
    </ContextoDoCanvas.Provider>,
  );
  return { limparBixinhos, botao: screen.getByRole("button", { name: "Limpar bixinhos" }) };
}

describe("BotaoDeLimparBixinhos", () => {
  it("mostra quantos bixinhos parados vai limpar e limpa os do próprio orquestrador", () => {
    const { limparBixinhos, botao } = renderizar(umProntoUmTrabalhando);

    expect(botao).toBeEnabled();
    expect(botao).toHaveTextContent("limpar (1)");
    fireEvent.click(botao);

    expect(limparBixinhos).toHaveBeenCalledWith("o1");
  });

  it("fica desabilitado quando todos os bixinhos estão executando", () => {
    const { botao } = renderizar(soTrabalhando);

    expect(botao).toBeDisabled();
    expect(botao).toHaveTextContent("limpar");
  });

  it("fica desabilitado quando os parados já foram limpos", () => {
    const { botao } = renderizar(umProntoUmTrabalhando, { turnoId: "t1", subagentes: ["s1"] });

    expect(botao).toBeDisabled();
  });

  it("fica desabilitado sem conversa", () => {
    const { botao } = renderizar(ESTADO_INICIAL);

    expect(botao).toBeDisabled();
  });
});
