import { fireEvent, render, screen } from "@testing-library/react";

import type { DadosDaConfiguracao, EventoDeOrquestracao, EventoRegistrado } from "../../shared/api/tipos";
import { ProvedorDoCanvas, type ValorDoCanvas } from "../../shared/canvas/contexto";
import type { BixinhosLimpos } from "../../shared/canvas/layout";
import { aplicarEvento, ESTADO_INICIAL, type EstadoDaConversa } from "../../shared/estado/aplicarEvento";
import { BotaoDeLimparBixinhos } from "./BotaoDeLimparBixinhos";

const contagem = vi.hoisted(() => ({ leiturasDoCanvas: 0 }));

// Conta as leituras do canvas feitas pelos componentes (cada hook roda uma vez por render de quem o usa),
// sem mudar o que elas devolvem: zero leituras é zero renders de quem lê o canvas.
vi.mock("../../shared/canvas/contexto", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../shared/canvas/contexto")>();
  type Seletor = Parameters<typeof original.useSeletorDoCanvas>[0];
  const contar = () => {
    contagem.leiturasDoCanvas += 1;
  };
  return {
    ...original,
    useCanvas: () => (contar(), original.useCanvas()),
    useSeletorDoCanvas: (selecionar: Seletor) => (contar(), original.useSeletorDoCanvas(selecionar)),
    useAcoesDoCanvas: () => (contar(), original.useAcoesDoCanvas()),
    useConversaDoCanvas: (id: string) => (contar(), original.useConversaDoCanvas(id)),
  };
});

const configuracao: DadosDaConfiguracao = {
  modeloDoOrquestrador: "opus",
  esforcoDoOrquestrador: "padrao",
  modeloDosSubagentes: "haiku",
  esforcoDosSubagentes: "padrao",
  quantidadeDeSubagentes: { modo: "fixa", limite: 2 },
  nivelDePermissao: "leitura",
  permitirCommitEPush: false,
  permitirArtefatosOnline: false,
  instrucoesPersonalizadas: "",
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

function canvasCom(estado: EstadoDaConversa, limpos?: BixinhosLimpos, limparBixinhos = vi.fn()): ValorDoCanvas {
  return {
    orquestradores: new Map(),
    conversas: new Map([["o1", estado]]),
    conexoes: new Map(),
    sinais: new Map(),
    bixinhosLimpos: new Map<string, BixinhosLimpos>(limpos === undefined ? [] : [["o1", limpos]]),
    servidor: { conectado: true, caiuEm: null, voltouEm: null, reiniciou: false, memoria: null },
    acoes: {
      abrirTerminal: vi.fn(),
      fecharTerminal: vi.fn(),
      minimizarOuRestaurarTerminal: vi.fn(),
      limparBixinhos,
      fecharBixinho: vi.fn(),
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

function renderizar(estado: EstadoDaConversa, limpos?: BixinhosLimpos) {
  const limparBixinhos = vi.fn();
  const canvas = canvasCom(estado, limpos, limparBixinhos);
  const { container } = render(
    <ProvedorDoCanvas valor={canvas}>
      <BotaoDeLimparBixinhos orquestradorId="o1" />
    </ProvedorDoCanvas>,
  );
  return { limparBixinhos, container, botao: screen.queryByRole("button", { name: "Limpar bixinhos" }) };
}

describe("BotaoDeLimparBixinhos", () => {
  it("mostra quantos bixinhos parados vai limpar e limpa os do próprio orquestrador", () => {
    const { limparBixinhos, botao } = renderizar(umProntoUmTrabalhando);

    expect(botao).toBeInTheDocument();
    expect(botao).toBeEnabled();
    expect(botao).toHaveTextContent("limpar (1)");
    fireEvent.click(botao as HTMLElement);

    expect(limparBixinhos).toHaveBeenCalledWith("o1");
  });

  it("não renderiza nada quando todos os bixinhos estão executando", () => {
    const { botao, container } = renderizar(soTrabalhando);

    expect(botao).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it("não renderiza nada quando os parados já foram limpos", () => {
    const { botao } = renderizar(umProntoUmTrabalhando, { turnoId: "t1", subagentes: ["s1"] });

    expect(botao).not.toBeInTheDocument();
  });

  it("não renderiza nada sem conversa", () => {
    const { botao, container } = renderizar(ESTADO_INICIAL);

    expect(botao).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it("só re-renderiza quando a quantidade muda, não com eventos de outro orquestrador", () => {
    // O mesmo elemento a cada troca do valor: só re-renderiza o que o próprio botão pedir.
    const botao = <BotaoDeLimparBixinhos orquestradorId="o1" />;
    const inicial = canvasCom(umProntoUmTrabalhando);
    const { rerender } = render(<ProvedorDoCanvas valor={inicial}>{botao}</ProvedorDoCanvas>);
    expect(contagem.leiturasDoCanvas).toBeGreaterThan(0);
    contagem.leiturasDoCanvas = 0;

    // Um evento na conversa de o2 e uma troca do servidor: o botão de o1 fica quieto.
    const doOutro: ValorDoCanvas = {
      ...inicial,
      conversas: new Map(inicial.conversas).set("o2", soTrabalhando),
      servidor: { ...inicial.servidor },
    };
    rerender(<ProvedorDoCanvas valor={doOutro}>{botao}</ProvedorDoCanvas>);
    expect(contagem.leiturasDoCanvas).toBe(0);

    // Evento de o1 que não muda a quantidade (outra conversa com 1 parado): também quieto.
    const mesmaQuantidade: ValorDoCanvas = { ...doOutro, conversas: new Map(doOutro.conversas).set("o1", { ...umProntoUmTrabalhando }) };
    rerender(<ProvedorDoCanvas valor={mesmaQuantidade}>{botao}</ProvedorDoCanvas>);
    expect(contagem.leiturasDoCanvas).toBe(0);

    // Os parados limpos: a quantidade cai a zero e o botão some.
    const limpos: ValorDoCanvas = {
      ...mesmaQuantidade,
      bixinhosLimpos: new Map([["o1", { turnoId: "t1", subagentes: ["s1"] }]]),
    };
    rerender(<ProvedorDoCanvas valor={limpos}>{botao}</ProvedorDoCanvas>);
    expect(contagem.leiturasDoCanvas).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Limpar bixinhos" })).not.toBeInTheDocument();
  });
});
