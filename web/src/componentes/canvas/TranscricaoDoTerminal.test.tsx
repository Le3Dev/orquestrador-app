import { render, screen } from "@testing-library/react";

import type {
  DadosDaConfiguracao,
  EventoDeOrquestracao,
  EventoRegistrado,
  SinalDeVida,
} from "../../shared/api/tipos";
import { aplicarEvento, ESTADO_INICIAL, type EstadoDaConversa } from "../../shared/estado/aplicarEvento";
import type { AcoesDoPlano } from "./CartaoDoPlano";
import { TranscricaoDoTerminal } from "./TranscricaoDoTerminal";

const analises = vi.hoisted(() => ({ total: 0 }));

// Conta as análises de Markdown sem mudar o que o react-markdown produz.
vi.mock("react-markdown", async (importOriginal) => {
  const original = await importOriginal<typeof import("react-markdown")>();
  return {
    ...original,
    default: (opcoes: Parameters<typeof original.default>[0]) => {
      analises.total += 1;
      return original.default(opcoes);
    },
  };
});

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

const USO = { duracaoMs: 1000, tokensDeEntrada: 1, tokensDeSaida: 1, subagentesLancados: 0 };

const acoesDoPlano: AcoesDoPlano = {
  aoAprovar: async () => undefined,
  aoAjustar: () => undefined,
  aoDescartar: async () => undefined,
};

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

function Transcricao({ conversa, sinal }: { conversa: EstadoDaConversa; sinal?: SinalDeVida }) {
  return (
    <TranscricaoDoTerminal
      orquestradorId="o1"
      nome="Painel de salas"
      pastaDeTrabalho="C:\projetos\painel"
      configuracao={configuracao}
      turnos={conversa.turnos}
      conversaIniciadaEm={conversa.conversaIniciadaEm}
      sinal={sinal}
      desconectado={false}
      acoesDoPlano={acoesDoPlano}
    />
  );
}

describe("TranscricaoDoTerminal", () => {
  beforeEach(() => {
    // O girador e o relógio do pedido em andamento não disparam no meio do
    // teste, e o "agora" fica logo depois dos eventos (sem aviso de travado).
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T12:00:06Z"));
    analises.total = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("linha nova de log e sinal de vida não re-analisam as respostas antigas", () => {
    const anterior = aplicar(
      ESTADO_INICIAL,
      { tipo: "turno_iniciado", turnoId: "t1", texto: "resuma o projeto", configuracao },
      { tipo: "turno_concluido", turnoId: "t1", resposta: "## Resumo\n\n**primeira** resposta", uso: USO },
      { tipo: "turno_iniciado", turnoId: "t2", texto: "planeje a migração", configuracao, modo: "planejamento" },
      { tipo: "turno_concluido", turnoId: "t2", resposta: "1. Ler o domínio", uso: USO },
      { tipo: "plano_descartado", turnoId: "t2" },
      { tipo: "turno_iniciado", turnoId: "t3", texto: "corrija o bug", configuracao },
    );
    const { rerender } = render(<Transcricao conversa={anterior} />);
    expect(analises.total).toBe(2);

    const comLinhaNova = aplicar(anterior, { tipo: "texto_do_orquestrador", turnoId: "t3", texto: "lendo o código" });
    rerender(<Transcricao conversa={comLinhaNova} />);
    rerender(
      <Transcricao conversa={comLinhaNova} sinal={{ turnoId: "t3", em: "2026-10-28T12:00:05Z", tokensPensando: 120 }} />,
    );

    expect(screen.getByText("lendo o código")).toBeInTheDocument();
    expect(screen.getByText(/120 tokens de raciocínio/)).toBeInTheDocument();
    expect(analises.total).toBe(2);
  });

  it("decidir o plano troca o rótulo sem re-analisar o plano", () => {
    const pendente = aplicar(
      ESTADO_INICIAL,
      { tipo: "turno_iniciado", turnoId: "t1", texto: "planeje", configuracao, modo: "planejamento" },
      { tipo: "turno_concluido", turnoId: "t1", resposta: "1. Ler o domínio", uso: USO },
    );
    const { rerender } = render(<Transcricao conversa={pendente} />);
    expect(screen.getByRole("button", { name: "Aprovar e executar" })).toBeInTheDocument();
    expect(analises.total).toBe(1);

    rerender(<Transcricao conversa={aplicar(pendente, { tipo: "plano_aprovado", turnoId: "t1" })} />);

    expect(screen.getByText("plano proposto · aprovado")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(analises.total).toBe(1);
  });

  it("plano proposto num pedido de execução aparece no cartão, com as ações", () => {
    const conversa = aplicar(
      ESTADO_INICIAL,
      { tipo: "turno_iniciado", turnoId: "t1", texto: "migre o projeto inteiro", configuracao },
      { tipo: "turno_concluido", turnoId: "t1", resposta: "1. Ler o domínio", uso: USO, planoPendente: true },
    );
    render(<Transcricao conversa={conversa} />);

    expect(screen.getByText("plano proposto")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aprovar e executar" })).toBeInTheDocument();
    expect(screen.getByText(/plano proposto · aguardando aprovação/)).toBeInTheDocument();
  });

  it("resposta comum de execução não vira cartão de plano", () => {
    const conversa = aplicar(
      ESTADO_INICIAL,
      { tipo: "turno_iniciado", turnoId: "t1", texto: "corrija o bug", configuracao },
      { tipo: "turno_concluido", turnoId: "t1", resposta: "Corrigido.", uso: USO, planoPendente: false },
    );
    render(<Transcricao conversa={conversa} />);

    expect(screen.getByText("Corrigido.")).toBeInTheDocument();
    expect(screen.queryByText("plano proposto")).not.toBeInTheDocument();
  });

  it("o custo do turno só aparece depois de medido, no fim do pedido", () => {
    const concluido = aplicar(
      ESTADO_INICIAL,
      { tipo: "turno_iniciado", turnoId: "t1", texto: "corrija o bug", configuracao },
      { tipo: "turno_concluido", turnoId: "t1", resposta: "Corrigido.", uso: USO },
    );
    const { rerender } = render(<Transcricao conversa={concluido} />);
    expect(screen.queryByText(/custo do turno/)).not.toBeInTheDocument();

    const medido = aplicar(concluido, {
      tipo: "consumo_do_turno_medido",
      turnoId: "t1",
      consumo: {
        principal: { entrada: 100_000, criacaoDeCache: 0, leituraDeCache: 0, saida: 27_000 },
        subagentes: { entrada: 0, criacaoDeCache: 0, leituraDeCache: 0, saida: 0 },
        subagentesMedidos: 0,
        parcial: true,
        indiceDeCusto: 235_000,
        modeloDoPrincipal: null,
      },
    });
    rerender(<Transcricao conversa={medido} />);

    expect(screen.getByRole("button", { name: /≈ custo do turno · índice 235\smil · parcial/ })).toBeInTheDocument();
  });

  it("marca a configuração com a etiqueta \"econômico\" só quando ela corresponde ao modo econômico", () => {
    const { rerender } = render(<Transcricao conversa={ESTADO_INICIAL} />);
    expect(screen.queryByText("econômico")).not.toBeInTheDocument();

    rerender(
      <TranscricaoDoTerminal
        orquestradorId="o1"
        nome="Painel de salas"
        pastaDeTrabalho="C:\projetos\painel"
        configuracao={configuracao}
        predefinicao="economico"
        turnos={[]}
        conversaIniciadaEm={null}
        sinal={undefined}
        desconectado={false}
        acoesDoPlano={acoesDoPlano}
      />,
    );
    expect(screen.getByText("econômico")).toHaveClass("chip");
  });

  it("depois do /clear, mostra o separador da conversa nova e só os pedidos dela", () => {
    const anterior = aplicar(
      ESTADO_INICIAL,
      { tipo: "turno_iniciado", turnoId: "t1", texto: "resuma o projeto", configuracao },
      { tipo: "turno_concluido", turnoId: "t1", resposta: "Resumo", uso: USO },
    );
    const { rerender } = render(<Transcricao conversa={anterior} />);
    expect(screen.queryByText(/conversa nova iniciada/)).not.toBeInTheDocument();
    expect(screen.getByText(/1 pedido nesta conversa · \/clear começa uma nova/)).toBeInTheDocument();

    const limpa = aplicar(anterior, {
      tipo: "conversa_limpa",
      turnosAnteriores: 1,
      planoDescartado: false,
      worktreeComAlteracoes: false,
    });
    rerender(<Transcricao conversa={limpa} />);

    expect(screen.getByText(/^— conversa nova iniciada às \d{2}:\d{2} —$/)).toBeInTheDocument();
    expect(screen.queryByText("resuma o projeto")).not.toBeInTheDocument();
    expect(screen.getByText(/digite um pedido e pressione enter/)).toBeInTheDocument();
  });
});
