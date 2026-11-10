import { act, fireEvent, render, screen } from "@testing-library/react";

import type {
  DadosDaConfiguracao,
  EventoDeOrquestracao,
  EventoRegistrado,
  SinalDeVida,
} from "../../shared/api/tipos";
import { api } from "../../shared/api/cliente";
import { aparenciaDoBixinho } from "../../shared/canvas/bixinhos";
import { aplicarEvento, ESTADO_INICIAL, type EstadoDaConversa } from "../../shared/estado/aplicarEvento";
import { esquecerAutorrecuperacao } from "../../shared/hooks/useAutorrecuperacao";
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
  permitirArtefatosOnline: false,
  instrucoesPersonalizadas: "",
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

const semResposta = async () => undefined;

function Transcricao({
  conversa,
  sinal,
  desconectado = false,
  aoResponderPergunta = semResposta,
}: {
  conversa: EstadoDaConversa;
  sinal?: SinalDeVida;
  desconectado?: boolean;
  aoResponderPergunta?: (texto: string) => Promise<void>;
}) {
  return (
    <TranscricaoDoTerminal
      orquestradorId="o1"
      nome="Painel de salas"
      pastaDeTrabalho="C:\projetos\painel"
      configuracao={configuracao}
      turnos={conversa.turnos}
      conversaIniciadaEm={conversa.conversaIniciadaEm}
      avisosDaConversaNova={conversa.avisosDaConversaNova}
      sinal={sinal}
      desconectado={desconectado}
      acoesDoPlano={acoesDoPlano}
      aoResponderPergunta={aoResponderPergunta}
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

  it("no log, o subagente pronto aparece pelo nome dele; executor, workflow e evento antigo, pelo nome do bicho", () => {
    const concluiu = (subagenteId: string): EventoDeOrquestracao => ({
      tipo: "subagente_concluido",
      turnoId: "t1",
      subagenteId,
      situacao: "concluido",
      resumo: "feito",
      tokens: 10,
      duracaoMs: 1000,
    });
    const iniciou = (subagenteId: string, papel?: string): EventoDeOrquestracao => ({
      tipo: "subagente_iniciado",
      turnoId: "t1",
      subagenteId,
      descricao: "parte",
      tarefa: "faça a parte",
      ...(papel === undefined ? {} : { papel }),
    });
    const conversa = aplicar(
      ESTADO_INICIAL,
      { tipo: "turno_iniciado", turnoId: "t1", texto: "faça o vídeo", configuracao },
      iniciou("sub-aaaa", "diretor-de-video"),
      iniciou("sub-bbbb", "executor"),
      iniciou("sub-cccc", "workflow"),
      iniciou("sub-dddd"),
      concluiu("sub-aaaa"),
      concluiu("sub-bbbb"),
      concluiu("sub-cccc"),
      concluiu("sub-dddd"),
    );
    const { container } = render(<Transcricao conversa={conversa} />);

    const origens = [...container.querySelectorAll(".linha-origem-bixinho")].map((origem) => origem.textContent);
    expect(origens).toEqual([
      "diretor-de-video#aaaa",
      `${aparenciaDoBixinho("sub-bbbb").nome}#bbbb`,
      `${aparenciaDoBixinho("sub-cccc").nome}#cccc`,
      `${aparenciaDoBixinho("sub-dddd").nome}#dddd`,
    ]);
    // O nome inteiro fica no title: um nome longo corta com reticências.
    expect(screen.getByText("diretor-de-video#aaaa")).toHaveAttribute("title", "diretor-de-video#aaaa");
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

  describe("progresso das tarefas", () => {
    const comTarefas = () =>
      aplicar(
        ESTADO_INICIAL,
        { tipo: "turno_iniciado", turnoId: "t1", texto: "corrija o bug", configuracao },
        {
          tipo: "tarefas_atualizadas",
          turnoId: "t1",
          tarefas: [
            { texto: "Ler o código", situacao: "concluida" },
            { texto: "Corrigir o cálculo", situacao: "concluida" },
            { texto: "Rodando os testes", situacao: "em_andamento" },
            { texto: "Atualizar o README", situacao: "pendente" },
          ],
        },
      );

    it("o pedido em andamento mostra a barra com a contagem e a tarefa atual; o clique abre a lista", () => {
      render(<Transcricao conversa={comTarefas()} />);

      const resumo = screen.getByRole("button", { name: /2 de 4 tarefas/ });
      expect(resumo).toHaveTextContent("· Rodando os testes");
      expect(resumo).toHaveAttribute("title", "✓ Ler o código\n✓ Corrigir o cálculo\n▸ Rodando os testes\n○ Atualizar o README");
      expect(screen.getByRole("progressbar", { name: "Tarefas concluídas" })).toHaveAttribute("aria-valuenow", "2");
      expect(screen.queryByRole("list", { name: "Tarefas do orquestrador" })).not.toBeInTheDocument();

      fireEvent.click(resumo);

      const lista = screen.getByRole("list", { name: "Tarefas do orquestrador" });
      expect(resumo).toHaveAttribute("aria-expanded", "true");
      expect([...lista.querySelectorAll("li")].map((item) => [item.className, item.textContent])).toEqual([
        ["tarefa-concluida", "✓Ler o código (concluída)"],
        ["tarefa-concluida", "✓Corrigir o cálculo (concluída)"],
        ["tarefa-em_andamento", "▸Rodando os testes (em andamento)"],
        ["tarefa-pendente", "○Atualizar o README (pendente)"],
      ]);
    });

    it("some quando o pedido termina, e sem lista não aparece", () => {
      const { rerender } = render(
        <Transcricao
          conversa={aplicar(ESTADO_INICIAL, { tipo: "turno_iniciado", turnoId: "t1", texto: "corrija", configuracao })}
        />,
      );
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();

      rerender(
        <Transcricao
          conversa={aplicar(comTarefas(), { tipo: "turno_concluido", turnoId: "t1", resposta: "Corrigido.", uso: USO })}
        />,
      );
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
      expect(screen.queryByText(/de 4 tarefas/)).not.toBeInTheDocument();
    });
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
        aoResponderPergunta={semResposta}
      />,
    );
    expect(screen.getByText("econômico")).toHaveClass("chip");
  });

  describe("perguntas com opções", () => {
    const perguntas = [
      {
        pergunta: "Qual banco usar?",
        opcoes: [
          { rotulo: "PostgreSQL", descricao: "Relacional" },
          { rotulo: "SQLite", descricao: null },
        ],
        multipla: false,
      },
    ];
    const perguntando = () =>
      aplicar(
        ESTADO_INICIAL,
        { tipo: "turno_iniciado", turnoId: "t1", texto: "crie o cadastro", configuracao },
        { tipo: "turno_concluido", turnoId: "t1", resposta: "Antes, uma dúvida.", uso: USO, perguntas },
      );

    it("o turno que terminou perguntando mostra o cartão, e o clique responde pelo envio do terminal", async () => {
      const aoResponderPergunta = vi.fn<(texto: string) => Promise<void>>().mockResolvedValue(undefined);
      render(<Transcricao conversa={perguntando()} aoResponderPergunta={aoResponderPergunta} />);

      expect(screen.getByText("Antes, uma dúvida.")).toBeInTheDocument();
      expect(screen.getByRole("group", { name: "Pergunta do Claude" })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "PostgreSQL" }));
      await act(async () => undefined);

      expect(aoResponderPergunta).toHaveBeenCalledWith("Qual banco usar? → PostgreSQL");
      expect(screen.getByText(/· respondida/)).toBeInTheDocument();
    });

    it("com um pedido depois, fica travado; com um pedido rodando ou sem servidor, desabilitado", () => {
      const conversa = perguntando();
      const { rerender } = render(<Transcricao conversa={conversa} desconectado />);
      expect(screen.getByRole("button", { name: "SQLite" })).toBeDisabled();
      expect(screen.queryByText(/· respondida/)).not.toBeInTheDocument();

      const comPedidoDepois = aplicar(conversa, {
        tipo: "turno_iniciado",
        turnoId: "t2",
        texto: "Qual banco usar? → SQLite",
        configuracao,
      });
      rerender(<Transcricao conversa={comPedidoDepois} />);
      expect(screen.getByRole("button", { name: "SQLite" })).toBeDisabled();
      expect(screen.getByText(/· respondida/)).toBeInTheDocument();
    });

    it("o bloco cru da pergunta não aparece no log enquanto o pedido roda", () => {
      const conversa = aplicar(
        ESTADO_INICIAL,
        { tipo: "turno_iniciado", turnoId: "t1", texto: "crie o cadastro", configuracao },
        { tipo: "texto_do_orquestrador", turnoId: "t1", texto: "```pergunta-do-app\n{\"perguntas\":[" },
        { tipo: "texto_do_orquestrador", turnoId: "t1", texto: "Antes, uma dúvida." },
      );
      render(<Transcricao conversa={conversa} />);

      expect(screen.getByText("Antes, uma dúvida.")).toBeInTheDocument();
      expect(screen.queryByText(/pergunta-do-app/)).not.toBeInTheDocument();
      expect(screen.queryByRole("group", { name: "Pergunta do Claude" })).not.toBeInTheDocument();
    });
  });

  describe("autorrecuperação", () => {
    beforeEach(() => {
      esquecerAutorrecuperacao();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    const emAndamento = () =>
      aplicar(ESTADO_INICIAL, { tipo: "turno_iniciado", turnoId: "t1", texto: "rode os testes", configuracao });
    const linhaDoSinal = (texto: string | RegExp) => screen.getByText(texto).closest(".linha-do-terminal");

    it("diagnóstico \"trabalhando\": uma linha neutra com o resumo, sem alarme", () => {
      const lerPreferencias = vi.spyOn(api, "lerPreferencias");
      render(
        <Transcricao
          conversa={emAndamento()}
          sinal={{
            turnoId: "t1",
            em: "2026-10-28T12:00:05Z",
            tokensPensando: 0,
            diagnostico: { situacao: "trabalhando", resumo: "rodando `npm test` há 6 min" },
          }}
        />,
      );

      const linha = linhaDoSinal("rodando `npm test` há 6 min");
      expect(linha).toHaveClass("linha-sistema");
      expect(linha).not.toHaveClass("linha-erro");
      expect(screen.queryByText(/sem notícias/)).not.toBeInTheDocument();
      // Sem suspeita, nem precisa saber da preferência.
      expect(lerPreferencias).not.toHaveBeenCalled();
    });

    it("diagnóstico \"suspeito\": avisa que o app retoma sozinho; com a autorrecuperação desligada, orienta cancelar", async () => {
      const sinal: SinalDeVida = {
        turnoId: "t1",
        em: "2026-10-28T12:00:05Z",
        tokensPensando: 0,
        diagnostico: { situacao: "suspeito", resumo: "sem saída há 3 min, sem CPU" },
      };
      const lerPreferencias = vi
        .spyOn(api, "lerPreferencias")
        .mockResolvedValue({ instrucoesPadrao: "", subagentesProntos: [], autorrecuperacao: true });
      const { unmount } = render(<Transcricao conversa={emAndamento()} sinal={sinal} />);
      await act(async () => undefined);

      const texto = "sem notícias do Claude há 6s: sem saída há 3 min, sem CPU. O app retoma sozinho se travar.";
      expect(linhaDoSinal(texto)).toHaveClass("linha-erro");
      expect(lerPreferencias).toHaveBeenCalledTimes(1);
      unmount();

      esquecerAutorrecuperacao();
      lerPreferencias.mockResolvedValue({ instrucoesPadrao: "", subagentesProntos: [], autorrecuperacao: false });
      render(<Transcricao conversa={emAndamento()} sinal={sinal} />);
      await act(async () => undefined);

      expect(
        screen.getByText(
          "sem notícias do Claude há 6s: sem saída há 3 min, sem CPU. Se continuar assim, cancele (esc) e reenvie.",
        ),
      ).toBeInTheDocument();
    });

    it("diagnóstico sem lista de processos (Windows): orienta cancelar mesmo com a autorrecuperação ligada", async () => {
      vi.spyOn(api, "lerPreferencias").mockResolvedValue({
        instrucoesPadrao: "",
        subagentesProntos: [],
        autorrecuperacao: true,
      });
      const resumo = "sem saída há 6 min; não dá para ver os processos neste sistema, então o app não encerra o pedido sozinho";
      render(
        <Transcricao
          conversa={emAndamento()}
          sinal={{
            turnoId: "t1",
            em: "2026-10-28T12:00:05Z",
            tokensPensando: 0,
            diagnostico: { situacao: "suspeito", resumo, semRetomadaAutomatica: true },
          }}
        />,
      );
      await act(async () => undefined);

      const texto = `sem notícias do Claude há 6s: ${resumo}. Se continuar assim, cancele (esc) e reenvie.`;
      expect(linhaDoSinal(texto)).toHaveClass("linha-erro");
      expect(screen.queryByText(/retoma sozinho/)).not.toBeInTheDocument();
    });

    it("silêncio longo sem diagnóstico do servidor: a mesma orientação, conforme a preferência", async () => {
      vi.setSystemTime(new Date("2026-10-28T12:03:00Z"));
      const lerPreferencias = vi
        .spyOn(api, "lerPreferencias")
        .mockResolvedValue({ instrucoesPadrao: "", subagentesProntos: [], autorrecuperacao: true });
      const { unmount } = render(<Transcricao conversa={emAndamento()} />);
      await act(async () => undefined);

      const ligada = "sem notícias do Claude há 3min 00s — pode ter travado. O app retoma sozinho se travar.";
      expect(linhaDoSinal(ligada)).toHaveClass("linha-erro");
      expect(screen.queryByText(/reenvie/)).not.toBeInTheDocument();
      unmount();

      esquecerAutorrecuperacao();
      lerPreferencias.mockResolvedValue({ instrucoesPadrao: "", subagentesProntos: [], autorrecuperacao: false });
      render(<Transcricao conversa={emAndamento()} />);
      await act(async () => undefined);

      expect(
        screen.getByText("sem notícias do Claude há 3min 00s — pode ter travado. Se continuar assim, cancele (esc) e reenvie."),
      ).toBeInTheDocument();
    });

    const aguardando = () =>
      aplicar(
        emAndamento(),
        {
          tipo: "recuperacao_do_turno",
          turnoId: "t1",
          etapa: "encerrado",
          causa: "silencio",
          tentativa: 1,
          de: 2,
          resumo: "sem saída há 5 min",
          retomaEm: null,
        },
        { tipo: "turno_falhou", turnoId: "t1", motivo: "O Claude ficou em silêncio." },
        {
          tipo: "recuperacao_do_turno",
          turnoId: "t1",
          etapa: "aguardando",
          causa: "silencio",
          tentativa: 1,
          de: 2,
          resumo: "o Claude ficou calado",
          retomaEm: "2026-10-28T12:02:11Z",
        },
      );

    it("aguardando: cartão com a contagem regressiva e o \"cancelar retomada\", que cancela o orquestrador", async () => {
      const cancelar = vi.spyOn(api, "cancelar").mockResolvedValue({ cancelando: true });
      render(<Transcricao conversa={aguardando()} />);

      const cartao = screen.getByRole("status", { name: "Retomada automática" });
      expect(cartao).toHaveTextContent("Retomando em 02:05 (tentativa 1 de 2) · o Claude ficou calado");
      act(() => vi.advanceTimersByTime(5_000));
      expect(cartao).toHaveTextContent("Retomando em 02:00 (tentativa 1 de 2)");

      fireEvent.click(screen.getByRole("button", { name: "cancelar retomada" }));
      await act(async () => undefined);

      expect(cancelar).toHaveBeenCalledWith("o1");
      expect(screen.getByRole("button", { name: "cancelando…" })).toBeDisabled();
    });

    it("o cartão some quando a retomada é cancelada ou o turno novo começa", () => {
      const conversa = aguardando();
      const { rerender } = render(<Transcricao conversa={conversa} />);
      expect(screen.getByRole("status", { name: "Retomada automática" })).toBeInTheDocument();

      rerender(
        <Transcricao
          conversa={aplicar(conversa, {
            tipo: "recuperacao_do_turno",
            turnoId: "t1",
            etapa: "cancelada",
            causa: "silencio",
            tentativa: 1,
            de: 2,
            resumo: "",
            retomaEm: null,
          })}
        />,
      );
      expect(screen.queryByRole("status", { name: "Retomada automática" })).not.toBeInTheDocument();
      expect(screen.getByText("retomada cancelada")).toBeInTheDocument();
    });

    it("o turno de retomada aparece como retomada automática, com a mensagem recolhida", () => {
      const conversa = aplicar(aguardando(), {
        tipo: "turno_iniciado",
        turnoId: "t2",
        texto: "Continue de onde parou.",
        configuracao,
        retomada: { deTurnoId: "t1", tentativa: 1 },
      });
      render(<Transcricao conversa={conversa} />);

      expect(screen.getByText("retomada automática (tentativa 1)")).toBeInTheDocument();
      expect(screen.getByText("Continue de onde parou.").closest("details")).not.toHaveAttribute("open");
      expect(screen.queryByRole("status", { name: "Retomada automática" })).not.toBeInTheDocument();
    });

    it("desistiu: cartão de alerta com o diagnóstico e a orientação", () => {
      const conversa = aplicar(aguardando(), {
        tipo: "recuperacao_do_turno",
        turnoId: "t1",
        etapa: "desistiu",
        causa: "silencio",
        tentativa: 2,
        de: 2,
        resumo: "Tentei 2 vezes; o Claude travou nas duas no mesmo comando.",
        retomaEm: null,
      });
      render(<Transcricao conversa={conversa} />);

      const cartao = screen.getByRole("group", { name: "Retomada automática sem sucesso" });
      expect(cartao).toHaveTextContent("Não consegui retomar sozinho (Claude em silêncio, 2 de 2 tentativas)");
      expect(cartao).toHaveTextContent("Tentei 2 vezes; o Claude travou nas duas no mesmo comando.");
      expect(cartao).toHaveTextContent(/reenvie o pedido .* ou confira o log acima/);
      expect(screen.queryByRole("button", { name: "cancelar retomada" })).not.toBeInTheDocument();
    });
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
    // Sem worktree alterada nem plano descartado, o separador fica sozinho.
    expect(screen.queryByRole("note", { name: "Avisos da conversa nova" })).not.toBeInTheDocument();
  });

  it("depois do /clear, avisa junto do separador que a worktree tem alterações e que o plano foi descartado", () => {
    const limpa = (worktreeComAlteracoes: boolean, planoDescartado: boolean) =>
      aplicar(ESTADO_INICIAL, { tipo: "conversa_limpa", turnosAnteriores: 1, planoDescartado, worktreeComAlteracoes });

    const { rerender } = render(<Transcricao conversa={limpa(true, true)} />);
    const aviso = screen.getByRole("note", { name: "Avisos da conversa nova" });
    expect(aviso).toHaveTextContent("a worktree tem alterações da conversa anterior · o plano pendente foi descartado");
    expect(aviso).toHaveClass("hint-warning");

    rerender(<Transcricao conversa={limpa(true, false)} />);
    expect(screen.getByRole("note", { name: "Avisos da conversa nova" })).toHaveTextContent(
      /^a worktree tem alterações da conversa anterior$/,
    );

    rerender(<Transcricao conversa={limpa(false, true)} />);
    expect(screen.getByRole("note", { name: "Avisos da conversa nova" })).toHaveTextContent(
      /^o plano pendente foi descartado$/,
    );
  });
});
