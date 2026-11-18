import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { apiDasRotinas, type DadosDaExecucao, type ResumoDaRotina } from "../../shared/api/rotinas";
import type { RotinasAoVivo } from "../../shared/hooks/useRotinas";
import { PainelDeRotinas } from "./PainelDeRotinas";

const ORQUESTRADORES = [
  { id: "o1", nome: "Backend" },
  { id: "o2", nome: "Documentação" },
];

function execucao(id: string, rotinaId: string, alteracoes: Partial<DadosDaExecucao> = {}): DadosDaExecucao {
  return {
    id,
    rotinaId,
    rotinaNome: `Rotina ${rotinaId}`,
    origem: "agendada",
    situacao: "concluida",
    etapaAtual: null,
    etapas: [
      { tipo: "pedido", orquestradorId: "o1", texto: "Rode os testes", modo: "execucao" },
      { tipo: "aprovacao", mensagem: "Posso seguir?" },
    ],
    resultados: [
      { tipo: "pedido", situacao: "concluida", iniciadaEm: "2026-11-17T12:00:00Z", encerradaEm: "2026-11-17T12:02:00Z", resposta: "Todos os testes passaram.", plano: null, erro: null },
      { tipo: "aprovacao", situacao: "concluida", iniciadaEm: "2026-11-17T12:02:00Z", encerradaEm: "2026-11-17T12:03:00Z", resposta: null, plano: null, erro: null },
    ],
    iniciadaEm: "2026-11-17T12:00:00Z",
    encerradaEm: "2026-11-17T12:03:00Z",
    motivo: null,
    pendencia: null,
    ...alteracoes,
  };
}

function rotina(id: string, alteracoes: Partial<ResumoDaRotina> = {}): ResumoDaRotina {
  return {
    id,
    nome: `Rotina ${id}`,
    ativa: true,
    gatilho: { tipo: "semanal", dias: [1], hora: "09:00" },
    etapas: [{ tipo: "pedido", orquestradorId: "o1", texto: "Rode os testes", modo: "execucao" }],
    aoPerder: "pular",
    criadaEm: "2026-11-05T12:00:00Z",
    ultimaExecucaoEm: null,
    proximaExecucaoEm: null,
    execucaoAtiva: null,
    ...alteracoes,
  };
}

function rotinasFalsas(lista: ResumoDaRotina[], alteracoes: Partial<RotinasAoVivo> = {}): RotinasAoVivo {
  const execucaoQualquer = Promise.resolve(execucao("e0", "r1"));
  return {
    lista,
    carregada: true,
    erro: null,
    indisponivel: false,
    conexao: "conectado",
    ativas: lista.filter((item) => item.ativa).length,
    aprovacoesPendentes: lista.flatMap((item) =>
      item.execucaoAtiva?.situacao === "aguardando_aprovacao" ? [{ execucao: item.execucaoAtiva, rotinaNome: item.execucaoAtiva.rotinaNome }] : [],
    ),
    recarregar: vi.fn(),
    criar: vi.fn((nova) => Promise.resolve(rotina("novo", { nome: nova.nome }))),
    alterar: vi.fn((id: string) => Promise.resolve(rotina(id))),
    apagar: vi.fn(() => Promise.resolve()),
    executarAgora: vi.fn(() => execucaoQualquer),
    aprovar: vi.fn(() => execucaoQualquer),
    recusar: vi.fn(() => execucaoQualquer),
    cancelar: vi.fn(() => execucaoQualquer),
    ...alteracoes,
  };
}

/** Renderiza e espera o histórico (lido ao abrir a rotina) assentar, para o React não reclamar de estado fora do `act`. */
async function montar(rotinas: RotinasAoVivo, orquestradores = ORQUESTRADORES) {
  const aoFechar = vi.fn();
  let utilitarios: ReturnType<typeof render> | undefined;
  await act(async () => {
    utilitarios = render(<PainelDeRotinas rotinas={rotinas} orquestradores={orquestradores} aoFechar={aoFechar} />);
  });
  if (utilitarios === undefined) {
    throw new Error("O painel não foi renderizado.");
  }
  return { aoFechar, ...utilitarios };
}

describe("PainelDeRotinas", () => {
  beforeEach(() => {
    vi.spyOn(apiDasRotinas, "listarExecucoes").mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lista cada rotina com o gatilho em texto humano, a próxima execução, se está ativa e a situação atual", async () => {
    const amanha = new Date();
    amanha.setDate(amanha.getDate() + 1);
    amanha.setHours(9, 0, 0, 0);
    await montar(
      rotinasFalsas([
        rotina("r1", { nome: "Resumo semanal", proximaExecucaoEm: amanha.toISOString() }),
        rotina("r2", { nome: "Limpeza", ativa: false, gatilho: { tipo: "intervalo", minutos: 120 } }),
        rotina("r3", { nome: "Testes", execucaoAtiva: execucao("e3", "r3", { situacao: "em_andamento", etapaAtual: 0 }) }),
      ]),
    );

    const lista = screen.getByRole("list", { name: "Lista de rotinas" });
    const itens = within(lista).getAllByRole("listitem");
    expect(itens).toHaveLength(3);
    expect(itens[0]).toHaveTextContent("Resumo semanal");
    expect(itens[0]).toHaveTextContent("Toda segunda às 09:00");
    expect(itens[0]).toHaveTextContent("Ativa · amanhã às 09:00");
    expect(itens[1]).toHaveTextContent("A cada 2 horas");
    expect(itens[1]).toHaveTextContent("Desativada");
    expect(itens[2]).toHaveTextContent("Em andamento");
  });

  it("mostra 'Rotinas indisponíveis' quando a lista não carrega, sem quebrar, e deixa tentar de novo", async () => {
    const rotinas = rotinasFalsas([], { carregada: false, indisponivel: true, erro: "O servidor respondeu com erro 404." });
    const { aoFechar } = await montar(rotinas);

    expect(screen.getByRole("alert")).toHaveTextContent("Rotinas indisponíveis");
    expect(screen.getByRole("alert")).toHaveTextContent("O servidor respondeu com erro 404.");
    expect(screen.queryByRole("list", { name: "Lista de rotinas" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(rotinas.recarregar).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Fechar rotinas" }));
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });

  it("mostra 'carregando…' antes da primeira resposta", async () => {
    await montar(rotinasFalsas([], { carregada: false }));

    expect(screen.getByText("carregando…")).toBeInTheDocument();
  });

  it("sem rotinas, explica e abre o editor pelo + Nova rotina", async () => {
    await montar(rotinasFalsas([]));

    expect(screen.getByText("Nenhuma rotina ainda")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "+ Nova rotina" }));

    expect(screen.getByRole("form", { name: "Nova rotina" })).toBeInTheDocument();
  });

  it("o Esc fecha o painel", async () => {
    const { aoFechar } = await montar(rotinasFalsas([rotina("r1")]));

    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(aoFechar).toHaveBeenCalledTimes(1);
  });

  describe("cartão de aprovação", () => {
    const parada = execucao("e1", "r2", {
      situacao: "aguardando_aprovacao",
      etapaAtual: 1,
      resultados: [],
      encerradaEm: null,
      pendencia: { tipo: "plano", plano: "1. Ler o código\n2. Escrever os testes" },
    });

    it("aparece no topo, com o plano, mesmo com outra rotina aberta", async () => {
      await montar(rotinasFalsas([rotina("r1"), rotina("r2", { execucaoAtiva: parada })]));

      const regiao = screen.getByRole("region", { name: "Aprovações pendentes" });
      expect(within(regiao).getByText(/A rotina “Rotina r2” aguarda sua aprovação/)).toBeInTheDocument();
      expect(within(regiao).getByLabelText("Plano proposto")).toHaveTextContent("2. Escrever os testes");
      // A rotina aberta é a primeira (r1), que não tem nada pendente.
      expect(screen.getByLabelText("Rotina Rotina r1")).toBeInTheDocument();
    });

    it("Aprovar e Recusar chamam as ações da execução", async () => {
      const rotinas = rotinasFalsas([rotina("r2", { execucaoAtiva: parada })]);
      await montar(rotinas);
      const regiao = screen.getByRole("region", { name: "Aprovações pendentes" });

      fireEvent.click(within(regiao).getByRole("button", { name: "Aprovar" }));
      await waitFor(() => expect(rotinas.aprovar).toHaveBeenCalledWith("e1"));
      // Enquanto a decisão está a caminho os botões ficam travados.
      await waitFor(() => expect(within(regiao).getByRole("button", { name: "Recusar" })).toBeEnabled());

      fireEvent.click(within(regiao).getByRole("button", { name: "Recusar" }));
      await waitFor(() => expect(rotinas.recusar).toHaveBeenCalledWith("e1", ""));
    });

    it("sem nada pendente, não há a região", async () => {
      await montar(rotinasFalsas([rotina("r1")]));

      expect(screen.queryByRole("region", { name: "Aprovações pendentes" })).not.toBeInTheDocument();
    });
  });

  describe("detalhe da rotina", () => {
    it("Executar agora começa uma execução; fica desligado se já há uma em curso", async () => {
      const rotinas = rotinasFalsas([rotina("r1")]);
      const { rerender } = await montar(rotinas);

      fireEvent.click(screen.getByRole("button", { name: "Executar agora" }));
      await waitFor(() => expect(rotinas.executarAgora).toHaveBeenCalledWith("r1"));

      const emCurso = rotinasFalsas([rotina("r1", { execucaoAtiva: execucao("e1", "r1", { situacao: "em_andamento", etapaAtual: 0, encerradaEm: null }) })]);
      await act(async () => rerender(<PainelDeRotinas rotinas={emCurso} orquestradores={ORQUESTRADORES} aoFechar={vi.fn()} />));
      expect(screen.getByRole("button", { name: "Executar agora" })).toBeDisabled();
      expect(screen.getByText("Etapa 1 de 2")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Cancelar execução" }));
      await waitFor(() => expect(emCurso.cancelar).toHaveBeenCalledWith("e1"));
    });

    it("Desativar e Ativar mudam só o `ativa`", async () => {
      const ligada = rotinasFalsas([rotina("r1")]);
      const { unmount } = await montar(ligada);
      fireEvent.click(screen.getByRole("button", { name: "Desativar" }));
      await waitFor(() => expect(ligada.alterar).toHaveBeenCalledWith("r1", { ativa: false }));
      unmount();

      const desligada = rotinasFalsas([rotina("r1", { ativa: false })]);
      await montar(desligada);
      fireEvent.click(screen.getByRole("button", { name: "Ativar" }));
      await waitFor(() => expect(desligada.alterar).toHaveBeenCalledWith("r1", { ativa: true }));
    });

    it("mostra a mensagem do servidor quando uma ação falha", async () => {
      const rotinas = rotinasFalsas([rotina("r1", { ativa: false })], {
        alterar: vi.fn(() => Promise.reject(new Error("O horário desta rotina de execução única já passou."))),
      });
      await montar(rotinas);

      fireEvent.click(screen.getByRole("button", { name: "Ativar" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("O horário desta rotina de execução única já passou.");
    });

    it("Apagar pede confirmação: só apaga depois do 'Apagar de vez'", async () => {
      const rotinas = rotinasFalsas([rotina("r1", { nome: "Resumo" })]);
      await montar(rotinas);

      fireEvent.click(screen.getByRole("button", { name: "Apagar" }));
      expect(screen.getByRole("alertdialog")).toHaveTextContent("Apagar a rotina “Resumo”");
      expect(rotinas.apagar).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Manter" }));
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(rotinas.apagar).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Apagar" }));
      fireEvent.click(screen.getByRole("button", { name: "Apagar de vez" }));
      await waitFor(() => expect(rotinas.apagar).toHaveBeenCalledWith("r1"));
    });

    it("mostra o histórico com o resultado de cada etapa", async () => {
      vi.spyOn(apiDasRotinas, "listarExecucoes").mockResolvedValue([
        execucao("e2", "r1", { situacao: "falhou", motivo: "O orquestrador não respondeu.", resultados: [
          { tipo: "pedido", situacao: "falhou", iniciadaEm: "2026-11-17T12:00:00Z", encerradaEm: "2026-11-17T12:01:00Z", resposta: null, plano: null, erro: "Tempo esgotado." },
        ] }),
        execucao("e1", "r1", { origem: "manual" }),
      ]);
      await montar(rotinasFalsas([rotina("r1")]));

      const historico = await screen.findByRole("region", { name: "Histórico de execuções" });
      await waitFor(() => expect(historico).toHaveTextContent("Falhou"));
      expect(historico).toHaveTextContent("O orquestrador não respondeu.");
      expect(historico).toHaveTextContent("Tempo esgotado.");
      expect(historico).toHaveTextContent("Todos os testes passaram.");
      expect(historico).toHaveTextContent("manual");
      expect(historico).toHaveTextContent("Pedido (executar) para Backend: Rode os testes");
      expect(historico).toHaveTextContent("não chegou a rodar");
    });

    it("sem execuções, diz que a rotina ainda não rodou", async () => {
      await montar(rotinasFalsas([rotina("r1")]));

      expect(await screen.findByText("Esta rotina ainda não rodou.")).toBeInTheDocument();
    });
  });

  describe("editor", () => {
    it("criar: o Salvar manda o corpo do servidor e abre a rotina criada", async () => {
      const rotinas = rotinasFalsas([rotina("r1")]);
      await montar(rotinas);

      fireEvent.click(screen.getByRole("button", { name: "+ Nova rotina" }));
      fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Relatório" } });
      fireEvent.change(screen.getByLabelText("Orquestrador da etapa 1"), { target: { value: "o2" } });
      fireEvent.change(screen.getByLabelText("Pedido da etapa 1"), { target: { value: "Resuma o que mudou." } });
      fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

      await waitFor(() =>
        expect(rotinas.criar).toHaveBeenCalledWith({
          nome: "Relatório",
          gatilho: { tipo: "diario", hora: "09:00" },
          etapas: [{ tipo: "pedido", orquestradorId: "o2", texto: "Resuma o que mudou.", modo: "execucao" }],
          aoPerder: "pular",
        }),
      );
      await waitFor(() => expect(screen.queryByRole("form")).not.toBeInTheDocument());
    });

    it("editar: abre com os dados da rotina e envia só o que mudou", async () => {
      const rotinas = rotinasFalsas([rotina("r1", { nome: "Resumo" })]);
      await montar(rotinas);

      fireEvent.click(screen.getByRole("button", { name: "Editar" }));
      expect(screen.getByLabelText("Nome")).toHaveValue("Resumo");
      expect(screen.getByLabelText("Orquestrador da etapa 1")).toHaveValue("o1");
      fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Resumo da semana" } });
      fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

      await waitFor(() => expect(rotinas.alterar).toHaveBeenCalledWith("r1", { nome: "Resumo da semana" }));
      await waitFor(() => expect(screen.queryByRole("form")).not.toBeInTheDocument());
    });

    it("cancelar a edição volta ao detalhe", async () => {
      await montar(rotinasFalsas([rotina("r1")]));

      fireEvent.click(screen.getByRole("button", { name: "Editar" }));
      fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

      expect(screen.queryByRole("form")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Executar agora" })).toBeInTheDocument();
      // O detalhe voltou e lê o histórico de novo.
      expect(await screen.findByText("Esta rotina ainda não rodou.")).toBeInTheDocument();
    });

    it("com um só orquestrador, o primeiro pedido já sai com ele", async () => {
      await montar(rotinasFalsas([]), [{ id: "o1", nome: "Backend" }]);

      fireEvent.click(screen.getByRole("button", { name: "+ Nova rotina" }));

      expect(screen.getByLabelText("Orquestrador da etapa 1")).toHaveValue("o1");
    });
  });
});
