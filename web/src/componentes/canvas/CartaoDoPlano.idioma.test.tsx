import { fireEvent, render, screen } from "@testing-library/react";

import type { DadosDaConfiguracao, EventoDeOrquestracao, EventoRegistrado } from "../../shared/api/tipos";
import { aplicarEvento, ESTADO_INICIAL, type TurnoNaTela } from "../../shared/estado/aplicarEvento";
import { definirIdioma } from "../../shared/idioma/idioma";
import { type AcoesDoPlano, CartaoDoPlano } from "./CartaoDoPlano";

const configuracao: DadosDaConfiguracao = {
  modeloDoOrquestrador: "opus",
  esforcoDoOrquestrador: "padrao",
  modeloDosSubagentes: "sonnet",
  esforcoDosSubagentes: "padrao",
  quantidadeDeSubagentes: { modo: "automatica", limite: 3 },
  nivelDePermissao: "leitura",
  permitirCommitEPush: false,
  permitirArtefatosOnline: false,
  instrucoesPersonalizadas: "",
};

function turnoDoPlano(...decisao: EventoDeOrquestracao[]): TurnoNaTela {
  const eventos: EventoDeOrquestracao[] = [
    { tipo: "turno_iniciado", turnoId: "t1", texto: "planeje", configuracao, modo: "planejamento" },
    {
      tipo: "turno_concluido",
      turnoId: "t1",
      resposta: "1. Read the domain",
      uso: { duracaoMs: 1000, tokensDeEntrada: 1, tokensDeSaida: 1, subagentesLancados: 0 },
    },
    ...decisao,
  ];
  const [turno] = eventos
    .map((evento, indice): EventoRegistrado => ({ ...evento, sequencia: indice + 1, em: "2026-10-28T12:00:00Z" }))
    .reduce(aplicarEvento, ESTADO_INICIAL).turnos;
  if (turno === undefined) {
    throw new Error("O histórico de teste não gerou turno.");
  }
  return turno;
}

function acoes(): AcoesDoPlano {
  return { aoAprovar: vi.fn(async () => undefined), aoAjustar: vi.fn(), aoDescartar: vi.fn(async () => undefined) };
}

describe("CartaoDoPlano: idioma", () => {
  beforeEach(() => {
    localStorage.clear();
    definirIdioma("en");
  });
  afterEach(() => {
    definirIdioma("pt-BR");
    localStorage.clear();
  });

  it("em inglês, avisa da somente leitura e oferece as três ações", () => {
    const acoesDoPlano = acoes();
    render(
      <CartaoDoPlano turno={turnoDoPlano()} configuracao={configuracao} ultimo desconectado={false} acoes={acoesDoPlano} />,
    );

    expect(screen.getByText("proposed plan")).toBeInTheDocument();
    expect(screen.getByText(/Permissions are set to read-only/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Adjust plan" }));
    expect(acoesDoPlano.aoAjustar).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Approve and run" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Discard" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Descartar" })).not.toBeInTheDocument();
  });

  it("em inglês, o plano já decidido mostra a decisão traduzida", () => {
    render(
      <CartaoDoPlano
        turno={turnoDoPlano({ tipo: "plano_aprovado", turnoId: "t1" })}
        configuracao={configuracao}
        ultimo
        desconectado={false}
        acoes={acoes()}
      />,
    );

    expect(screen.getByText("proposed plan · approved")).toBeInTheDocument();
  });
});
