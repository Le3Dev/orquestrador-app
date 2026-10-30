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
});
