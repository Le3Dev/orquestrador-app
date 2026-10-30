import { fireEvent, render, screen } from "@testing-library/react";

import type { DadosDaConfiguracao, EventoDeOrquestracao, EventoRegistrado } from "../../shared/api/tipos";
import { aplicarEvento, ESTADO_INICIAL, type TurnoNaTela } from "../../shared/estado/aplicarEvento";
import { type AcoesDoPlano, CartaoDoPlano } from "./CartaoDoPlano";

const configuracao: DadosDaConfiguracao = {
  modeloDoOrquestrador: "opus",
  esforcoDoOrquestrador: "padrao",
  modeloDosSubagentes: "sonnet",
  esforcoDosSubagentes: "padrao",
  quantidadeDeSubagentes: { modo: "automatica", limite: 3 },
  nivelDePermissao: "leitura",
  permitirCommitEPush: false,
};

function turnoDoPlano(...decisao: EventoDeOrquestracao[]): TurnoNaTela {
  const eventos: EventoDeOrquestracao[] = [
    { tipo: "turno_iniciado", turnoId: "t1", texto: "planeje", configuracao, modo: "planejamento" },
    {
      tipo: "turno_concluido",
      turnoId: "t1",
      resposta: "1. Ler o domínio",
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

describe("CartaoDoPlano", () => {
  it("plano pendente no último pedido: avisa da somente leitura e oferece as três ações", () => {
    const acoesDoPlano = acoes();
    render(
      <CartaoDoPlano turno={turnoDoPlano()} configuracao={configuracao} ultimo desconectado={false} acoes={acoesDoPlano} />,
    );

    expect(screen.getByText(/somente leitura: a execução não poderá alterar arquivos/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ajustar plano" }));
    expect(acoesDoPlano.aoAjustar).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Aprovar e executar" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Descartar" })).toBeEnabled();
  });

  it("plano já decidido mostra só o plano e a decisão", () => {
    render(
      <CartaoDoPlano
        turno={turnoDoPlano({ tipo: "plano_aprovado", turnoId: "t1" })}
        configuracao={configuracao}
        ultimo
        desconectado={false}
        acoes={acoes()}
      />,
    );

    expect(screen.getByText("plano proposto · aprovado")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("desconectado, as ações ficam desabilitadas", () => {
    render(<CartaoDoPlano turno={turnoDoPlano()} configuracao={configuracao} ultimo desconectado acoes={acoes()} />);

    expect(screen.getByRole("button", { name: "Aprovar e executar" })).toBeDisabled();
  });
});
