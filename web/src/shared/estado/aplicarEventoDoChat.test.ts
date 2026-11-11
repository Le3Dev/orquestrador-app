import type { EventoDoChat, EventoDoChatRegistrado, MensagemDoChat } from "../api/tipos";
import {
  aplicarAtividadeDoChat,
  aplicarEventoDoChat,
  aplicarTrechoDoChat,
  carregarEstadoDoChat,
  ESTADO_INICIAL_DO_CHAT,
  type EstadoDoChatNaTela,
  pedidoDeAutorizacaoAtual,
  textoParaMostrar,
  ultimoModeloUsado,
} from "./aplicarEventoDoChat";

const EM = "2026-11-04T12:00:00Z";

function mensagem(id: string, papel: MensagemDoChat["papel"], alteracoes: Partial<MensagemDoChat> = {}): MensagemDoChat {
  return {
    id,
    papel,
    texto: "",
    anexos: [],
    criadaEm: EM,
    situacao: papel === "usuario" ? "concluida" : "respondendo",
    acoes: [],
    avisos: [],
    uso: null,
    ...alteracoes,
  };
}

function registrado(evento: EventoDoChat, sequencia: number): EventoDoChatRegistrado {
  return { ...evento, sequencia, em: EM };
}

/** Aplica os eventos em ordem, numerando as sequências a partir de 1. */
function aplicar(eventos: EventoDoChat[], inicial: EstadoDoChatNaTela = ESTADO_INICIAL_DO_CHAT): EstadoDoChatNaTela {
  return eventos.reduce(
    (estado, evento, indice) => aplicarEventoDoChat(estado, registrado(evento, indice + 1)),
    inicial,
  );
}

const pergunta: EventoDoChat = {
  tipo: "pergunta_enviada",
  mensagemDoUsuario: mensagem("u1", "usuario", { texto: "oi" }),
  mensagemDoClaude: mensagem("c1", "claude"),
};

describe("aplicarEventoDoChat", () => {
  it("pergunta enviada: as duas mensagens entram e o chat fica respondendo", () => {
    const estado = aplicar([pergunta]);

    expect(estado.situacao).toBe("respondendo");
    expect(estado.mensagens.map((item) => item.id)).toEqual(["u1", "c1"]);
    expect(estado.ultimaSequencia).toBe(1);
  });

  it("trechos se concatenam na resposta em andamento; a atividade guarda só a mais recente", () => {
    let estado = aplicar([pergunta]);
    estado = aplicarTrechoDoChat(estado, { mensagemId: "c1", texto: "Olá, " });
    estado = aplicarTrechoDoChat(estado, { mensagemId: "c1", texto: "tudo bem?" });
    estado = aplicarAtividadeDoChat(estado, { mensagemId: "c1", ferramenta: "WebSearch", detalhe: "clima" });
    estado = aplicarAtividadeDoChat(estado, { mensagemId: "c1", ferramenta: "Read", detalhe: "README.md" });

    expect(estado.mensagens[1]?.texto).toBe("Olá, tudo bem?");
    expect(estado.atividade).toEqual({ mensagemId: "c1", ferramenta: "Read", detalhe: "README.md" });
    // Trecho de uma mensagem desconhecida não muda nada.
    expect(aplicarTrechoDoChat(estado, { mensagemId: "x", texto: "?" })).toBe(estado);
  });

  it("a conclusão substitui o texto dos trechos e traz ações, avisos e uso", () => {
    let estado = aplicar([pergunta]);
    estado = aplicarTrechoDoChat(estado, { mensagemId: "c1", texto: "parcial ```acao-do-app\n{" });
    estado = aplicarEventoDoChat(
      estado,
      registrado(
        {
          tipo: "resposta_concluida",
          mensagemId: "c1",
          texto: "Final.",
          acoes: [{ tipo: "abrir_orquestrador", projeto: "app", pasta: "C:\\p\\app", pedido: null }],
          avisos: ["cuidado"],
          uso: { duracaoMs: 10, tokensDeEntrada: 1, tokensDeSaida: 2, modeloUsado: "claude-opus-5-5" },
        },
        2,
      ),
    );

    const resposta = estado.mensagens[1];
    expect(resposta).toMatchObject({ situacao: "concluida", texto: "Final.", avisos: ["cuidado"] });
    expect(resposta?.acoes).toHaveLength(1);
    expect(estado.situacao).toBe("ocioso");
    expect(estado.atividade).toBeNull();
    expect(ultimoModeloUsado(estado)).toBe("claude-opus-5-5");
    // Depois de concluída, trechos atrasados não mexem no texto.
    expect(aplicarTrechoDoChat(estado, { mensagemId: "c1", texto: "!" })).toBe(estado);
  });

  it("falha guarda o motivo; cancelamento marca a resposta", () => {
    const falhou = aplicar([pergunta, { tipo: "resposta_falhou", mensagemId: "c1", motivo: "sem cota", uso: null }]);
    expect(falhou.mensagens[1]).toMatchObject({ situacao: "falhou", motivoDaFalha: "sem cota" });
    expect(falhou.situacao).toBe("ocioso");

    const cancelada = aplicar([pergunta, { tipo: "resposta_cancelada", mensagemId: "c1" }]);
    expect(cancelada.mensagens[1]?.situacao).toBe("cancelada");
    expect(cancelada.situacao).toBe("ocioso");
  });

  it("limpar esvazia a conversa; preferências e cota são atualizadas", () => {
    const estado = aplicar([
      pergunta,
      { tipo: "resposta_cancelada", mensagemId: "c1" },
      { tipo: "conversa_limpa" },
      { tipo: "preferencias_alteradas", preferencias: { modelo: "haiku", esforco: "baixo", permitirArtefatosOnline: false } },
      { tipo: "uso_da_cota", janelas: [{ nome: "5 horas", utilizacao: 0.4, renovaEm: null, situacao: "ok" }] },
    ]);

    expect(estado.mensagens).toEqual([]);
    expect(estado.preferencias).toEqual({ modelo: "haiku", esforco: "baixo", permitirArtefatosOnline: false });
    expect(estado.cota?.[0]?.utilizacao).toBe(0.4);
    expect(estado.ultimaSequencia).toBe(5);
  });

  it("ignora eventos repetidos ou fora de ordem pela sequência", () => {
    const estado = aplicar([pergunta, { tipo: "conversa_limpa" }]);

    expect(aplicarEventoDoChat(estado, registrado(pergunta, 1))).toBe(estado);
    expect(aplicarEventoDoChat(estado, registrado(pergunta, 2))).toBe(estado);
    expect(estado.mensagens).toEqual([]);
  });

  it("o estado carregado do servidor substitui o da tela", () => {
    const estado = carregarEstadoDoChat({
      sessaoId: "s",
      situacao: "respondendo",
      preferencias: { modelo: "fable", esforco: "maximo", permitirArtefatosOnline: false },
      mensagens: [mensagem("c9", "claude", { texto: "já veio" })],
      ultimaSequencia: 42,
      cota: null,
    });

    expect(estado).toMatchObject({ carregado: true, situacao: "respondendo", ultimaSequencia: 42 });
    expect(estado.mensagens[0]).toMatchObject({ texto: "já veio", motivoDaFalha: null });
  });

  it("no estado carregado, o motivo de uma falha (último aviso) volta a ser o motivo", () => {
    const estado = carregarEstadoDoChat({
      sessaoId: "s",
      situacao: "ocioso",
      preferencias: { modelo: "opus", esforco: "alto", permitirArtefatosOnline: false },
      mensagens: [mensagem("c1", "claude", { situacao: "falhou", avisos: ["ação ignorada", "sem cota"] })],
      ultimaSequencia: 3,
      cota: null,
    });

    expect(estado.mensagens[0]).toMatchObject({ avisos: ["ação ignorada"], motivoDaFalha: "sem cota" });
  });

  describe("autorização de alterações", () => {
    const concluidaPedindo: EventoDoChat = {
      tipo: "resposta_concluida",
      mensagemId: "c1",
      texto: "Preciso rodar os testes.",
      acoes: [],
      avisos: [],
      uso: null,
      autorizacaoPendente: { acao: "rodar_comando", detalhe: "npm test" },
    };

    it("vem do GET; sem o campo (servidor antigo) vale falso, e mensagens sem o campo não pedem nada", () => {
      const base = {
        sessaoId: "s",
        situacao: "ocioso" as const,
        preferencias: { modelo: "opus" as const, esforco: "alto" as const, permitirArtefatosOnline: false },
        ultimaSequencia: 4,
        cota: null,
      };
      const autorizado = carregarEstadoDoChat({
        ...base,
        alteracoesAutorizadas: true,
        mensagens: [
          mensagem("c1", "claude", {
            situacao: "concluida",
            autorizacaoPendente: { acao: "editar", detalhe: "src/x.ts" },
          }),
        ],
      });
      expect(autorizado.alteracoesAutorizadas).toBe(true);
      expect(autorizado.mensagens[0]?.autorizacaoPendente).toEqual({ acao: "editar", detalhe: "src/x.ts" });

      const antigo = carregarEstadoDoChat({ ...base, mensagens: [mensagem("c1", "claude", { situacao: "concluida" })] });
      expect(antigo.alteracoesAutorizadas).toBe(false);
      expect(antigo.mensagens[0]?.autorizacaoPendente).toBeNull();
    });

    it("alteracoes_autorizadas liga, autorizacao_revogada desliga e o /clear (conversa_limpa) zera", () => {
      const autorizado = aplicar([{ tipo: "alteracoes_autorizadas" }]);
      expect(autorizado.alteracoesAutorizadas).toBe(true);

      expect(aplicar([{ tipo: "alteracoes_autorizadas" }, { tipo: "autorizacao_revogada" }]).alteracoesAutorizadas).toBe(
        false,
      );

      const limpo = aplicar([{ tipo: "alteracoes_autorizadas" }, { tipo: "conversa_limpa" }]);
      expect(limpo.alteracoesAutorizadas).toBe(false);
      expect(limpo.ultimaSequencia).toBe(2);
    });

    it("eventos de autorização repetidos ou fora de ordem são ignorados pela sequência", () => {
      const revogado = aplicar([{ tipo: "alteracoes_autorizadas" }, { tipo: "autorizacao_revogada" }]);

      // A autorização (sequência 1) chega de novo numa reconexão: não volta a valer.
      expect(aplicarEventoDoChat(revogado, registrado({ tipo: "alteracoes_autorizadas" }, 1))).toBe(revogado);
      expect(revogado.alteracoesAutorizadas).toBe(false);
    });

    it("a resposta concluída guarda o pedido de autorização; sem o campo, fica nulo", () => {
      const pedindo = aplicar([pergunta, concluidaPedindo]);
      expect(pedindo.mensagens[1]?.autorizacaoPendente).toEqual({ acao: "rodar_comando", detalhe: "npm test" });

      const semCampo = aplicar([
        pergunta,
        { tipo: "resposta_concluida", mensagemId: "c1", texto: "Ok.", acoes: [], avisos: [], uso: null },
      ]);
      expect(semCampo.mensagens[1]?.autorizacaoPendente).toBeNull();
      // Também na mensagem que chega na pergunta, sem o campo.
      expect(aplicar([pergunta]).mensagens[1]?.autorizacaoPendente).toBeNull();
    });

    it("o pedido que vale é só o da última resposta do Claude", () => {
      const pedindo = aplicar([pergunta, concluidaPedindo]);
      expect(pedidoDeAutorizacaoAtual(pedindo)).toEqual({
        mensagemId: "c1",
        autorizacao: { acao: "rodar_comando", detalhe: "npm test" },
      });

      // Uma pergunta nova: a resposta nova (sem pedido) passa a ser a última.
      const depois = aplicarEventoDoChat(
        pedindo,
        registrado(
          {
            tipo: "pergunta_enviada",
            mensagemDoUsuario: mensagem("u2", "usuario", { texto: "Autorizado. Continue de onde parou." }),
            mensagemDoClaude: mensagem("c2", "claude"),
          },
          3,
        ),
      );
      expect(pedidoDeAutorizacaoAtual(depois)).toBeNull();
      expect(pedidoDeAutorizacaoAtual(ESTADO_INICIAL_DO_CHAT)).toBeNull();
    });
  });
});

describe("perguntas com opções", () => {
  const PERGUNTAS = [
    {
      pergunta: "Qual banco usar?",
      opcoes: [
        { rotulo: "PostgreSQL", descricao: "Relacional" },
        { rotulo: "SQLite", descricao: null },
      ],
      multipla: false,
    },
  ];

  it("a conclusão traz as perguntas; sem o campo (evento antigo), ficam vazias", () => {
    const comPerguntas = aplicar([
      pergunta,
      { tipo: "resposta_concluida", mensagemId: "c1", texto: "Preciso saber.", acoes: [], perguntas: PERGUNTAS, avisos: [], uso: null },
    ]);
    expect(comPerguntas.mensagens[1]?.perguntas).toEqual(PERGUNTAS);

    const semCampo = aplicar([
      pergunta,
      { tipo: "resposta_concluida", mensagemId: "c1", texto: "Ok.", acoes: [], avisos: [], uso: null },
    ]);
    expect(semCampo.mensagens[1]?.perguntas).toEqual([]);
    // A mensagem que chega na pergunta, sem o campo, também.
    expect(aplicar([pergunta]).mensagens[1]?.perguntas).toEqual([]);
  });

  it("vêm do GET; mensagens gravadas sem o campo ficam sem perguntas", () => {
    const estado = carregarEstadoDoChat({
      sessaoId: "s",
      situacao: "ocioso",
      preferencias: { modelo: "opus", esforco: "alto", permitirArtefatosOnline: false },
      ultimaSequencia: 2,
      cota: null,
      mensagens: [
        mensagem("c1", "claude", { situacao: "concluida", perguntas: PERGUNTAS }),
        mensagem("c2", "claude", { situacao: "concluida" }),
      ],
    });
    expect(estado.mensagens[0]?.perguntas).toEqual(PERGUNTAS);
    expect(estado.mensagens[1]?.perguntas).toEqual([]);
  });
});

describe("textoParaMostrar", () => {
  it("esconde o bloco de ação ainda aberto durante a resposta", () => {
    expect(textoParaMostrar("Vou abrir.\n\n```acao-do-app\n{\"tipo\":", true)).toBe("Vou abrir.");
  });

  it("esconde o bloco fechado e mantém o que vem depois", () => {
    expect(textoParaMostrar("Antes\n```acao-do-app\n{}\n```\nDepois", false)).toBe("Antes\nDepois");
  });

  it("esconde a cerca ainda pela metade no fim só durante a resposta", () => {
    expect(textoParaMostrar("Texto\n```aca", true)).toBe("Texto");
    expect(textoParaMostrar("Texto\n```aca", false)).toBe("Texto\n```aca");
  });

  it("esconde também o bloco de pergunta, aberto durante a resposta ou fechado no meio", () => {
    expect(textoParaMostrar("Preciso saber.\n\n```pergunta-do-app\n{\"perguntas\":[", true)).toBe("Preciso saber.");
    expect(textoParaMostrar("Antes\n```pergunta-do-app\n{}\n```\nDepois", false)).toBe("Antes\nDepois");
    expect(textoParaMostrar("Texto\n```perg", true)).toBe("Texto");
    // Os dois tipos de bloco na mesma resposta.
    expect(
      textoParaMostrar("A\n```acao-do-app\n{}\n```\nB\n```pergunta-do-app\n{}\n```\nC", false),
    ).toBe("A\nB\nC");
  });

  it("esconde o bloco de prévias a fechar, inclusive pela metade durante a resposta", () => {
    expect(textoParaMostrar("Feito.\n\n```previa-do-app\n{\"fechar\":[", true)).toBe("Feito.");
    expect(textoParaMostrar("Feito.\n```previa-do-app\n{}\n```\nFim", false)).toBe("Feito.\nFim");
    expect(textoParaMostrar("Texto\n```previa", true)).toBe("Texto");
  });

  it("não mexe em outros blocos de código", () => {
    const texto = "```ts\nconst a = 1;\n```";
    expect(textoParaMostrar(texto, false)).toBe(texto);
  });
});
