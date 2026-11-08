import { describe, expect, it } from "vitest";

import { abrirOrquestrador } from "./AcaoDoApp";
import { ConversaDoChat, MOTIVO_DA_INTERRUPCAO, NovaPergunta } from "./ConversaDoChat";
import { ErroDoChat } from "./ErroDoChat";
import { UsoDaResposta } from "./MotorDeChat";
import { PreferenciasDoChat } from "./PreferenciasDoChat";

const agora = new Date("2026-11-04T12:00:00Z");
const uso: UsoDaResposta = { duracaoMs: 10, tokensDeEntrada: 100, tokensDeSaida: 20, modeloUsado: "claude-opus" };

function pergunta(texto = "Qual a versão LTS do Node?", extras: Partial<NovaPergunta> = {}): NovaPergunta {
  return { mensagemDoUsuarioId: "u1", mensagemDoClaudeId: "c1", texto, imagens: [], agora, ...extras };
}

describe("ConversaDoChat", () => {
  it("perguntar cria a pergunta concluída e a resposta vazia em andamento", () => {
    const conversa = ConversaDoChat.nova("s1");
    const evento = conversa.perguntar(pergunta("  oi  "));

    expect(evento).toMatchObject({
      tipo: "pergunta_enviada",
      mensagemDoUsuario: { id: "u1", papel: "usuario", texto: "oi", situacao: "concluida", acoes: [] },
      mensagemDoClaude: { id: "c1", papel: "claude", texto: "", situacao: "respondendo" },
    });
    expect(conversa.situacao).toBe("respondendo");
    expect(conversa.perguntaEmAndamento?.texto).toBe("oi");
  });

  it("recusa outra pergunta enquanto há resposta em andamento", () => {
    const conversa = ConversaDoChat.nova("s1");
    conversa.perguntar(pergunta());

    expect(() => conversa.perguntar(pergunta("de novo", { mensagemDoUsuarioId: "u2", mensagemDoClaudeId: "c2" }))).toThrow(
      expect.objectContaining({ motivo: "em_andamento", message: "Já há uma resposta em andamento." }),
    );
  });

  it("recusa texto vazio sem imagens, mas aceita só imagem", () => {
    const conversa = ConversaDoChat.nova("s1");
    expect(() => conversa.perguntar(pergunta("   "))).toThrow(ErroDoChat);

    conversa.perguntar(pergunta("", { imagens: [{ arquivo: "a.png", nome: "print", tipoDeMidia: "image/png" }] }));
    expect(conversa.mensagens[0]?.imagens).toHaveLength(1);
  });

  it("recusa mais de 5 imagens", () => {
    const imagem = { arquivo: "a.png", nome: "x", tipoDeMidia: "image/png" } as const;
    expect(() =>
      ConversaDoChat.nova("s1").perguntar(pergunta("oi", { imagens: Array.from({ length: 6 }, () => imagem) })),
    ).toThrow(/até 5 imagens/);
  });

  it("acumula os trechos da resposta em andamento e ignora trechos sem resposta", () => {
    const conversa = ConversaDoChat.nova("s1");
    expect(conversa.acrescentarTrecho("perdido")).toBe(false);

    conversa.perguntar(pergunta());
    conversa.acrescentarTrecho("Node ");
    conversa.acrescentarTrecho("24");

    expect(conversa.mensagens[1]?.texto).toBe("Node 24");
  });

  it("concluir grava texto final, ações, avisos e uso, e marca a sessão como iniciada", () => {
    const conversa = ConversaDoChat.nova("s1");
    conversa.perguntar(pergunta());
    conversa.acrescentarTrecho("parcial");
    const acao = abrirOrquestrador("app", "/p/app", null);

    const evento = conversa.concluir("final", [acao], ["aviso"], uso);

    expect(evento).toEqual({
      tipo: "resposta_concluida",
      mensagemId: "c1",
      texto: "final",
      acoes: [acao],
      perguntas: [],
      avisos: ["aviso"],
      uso,
      autorizacaoPendente: null,
    });
    expect(conversa.mensagens[1]).toMatchObject({ texto: "final", situacao: "concluida", acoes: [acao], avisos: ["aviso"], uso });
    expect(conversa.sessaoIniciada).toBe(true);
    expect(conversa.situacao).toBe("ocioso");
  });

  it("concluir com perguntas as leva ao evento e à mensagem, e elas sobrevivem a reabrir", () => {
    const conversa = ConversaDoChat.nova("s1");
    conversa.perguntar(pergunta());
    const perguntas = [
      { pergunta: "Qual banco?", opcoes: [{ rotulo: "Postgres", descricao: "já usado" }, { rotulo: "SQLite", descricao: null }], multipla: false },
    ];

    const evento = conversa.concluir("Preciso decidir.", [], [], uso, null, perguntas);

    expect(evento).toMatchObject({ tipo: "resposta_concluida", perguntas });
    expect(conversa.mensagens[1]?.perguntas).toEqual(perguntas);
    expect(conversa.mensagens[0]?.perguntas).toEqual([]);
    expect(ConversaDoChat.reconstituir(conversa.paraDados()).mensagens[1]?.perguntas).toEqual(perguntas);
  });

  it("mensagem gravada antes do campo perguntas é lida com []", () => {
    const conversa = ConversaDoChat.nova("s1");
    conversa.perguntar(pergunta());
    conversa.concluir("ok", [], [], uso);
    const dados = conversa.paraDados();
    const semCampo = dados.mensagens.map(({ perguntas: _perguntas, ...resto }) => resto);

    const reaberta = ConversaDoChat.reconstituir({ ...dados, mensagens: semCampo as typeof dados.mensagens });

    expect(reaberta.mensagens.map((mensagem) => mensagem.perguntas)).toEqual([[], []]);
  });

  it("falhar guarda o motivo como aviso; com uso, a sessão conta como iniciada", () => {
    const semUso = ConversaDoChat.nova("s1");
    semUso.perguntar(pergunta());
    expect(semUso.falhar("caiu", null)).toEqual({ tipo: "resposta_falhou", mensagemId: "c1", motivo: "caiu", uso: null });
    expect(semUso.mensagens[1]).toMatchObject({ situacao: "falhou", avisos: ["caiu"] });
    expect(semUso.sessaoIniciada).toBe(false);

    const comUso = ConversaDoChat.nova("s2");
    comUso.perguntar(pergunta());
    comUso.falhar("erro do modelo", uso);
    expect(comUso.sessaoIniciada).toBe(true);
  });

  it("registrarSessaoIniciada vale uma vez e sobrevive ao cancelamento", () => {
    const conversa = ConversaDoChat.nova("s1");
    conversa.perguntar(pergunta());
    expect(conversa.registrarSessaoIniciada()).toBe(true);
    expect(conversa.registrarSessaoIniciada()).toBe(false);

    conversa.acrescentarTrecho("meio");
    expect(conversa.cancelar()).toEqual({ tipo: "resposta_cancelada", mensagemId: "c1" });
    expect(conversa.mensagens[1]).toMatchObject({ situacao: "cancelada", texto: "meio" });
    expect(conversa.sessaoIniciada).toBe(true);
  });

  it("cancelar sem resposta em andamento é recusado", () => {
    expect(() => ConversaDoChat.nova("s1").cancelar()).toThrow(
      expect.objectContaining({ motivo: "sem_resposta_em_andamento" }),
    );
  });

  it("limpar troca a sessão, volta sessaoIniciada a falso e esvazia as mensagens", () => {
    const conversa = ConversaDoChat.nova("s1");
    conversa.perguntar(pergunta());
    conversa.concluir("ok", [], [], uso);

    expect(conversa.limpar("s2")).toEqual({ tipo: "conversa_limpa" });
    expect(conversa.sessaoId).toBe("s2");
    expect(conversa.sessaoIniciada).toBe(false);
    expect(conversa.totalDeMensagens).toBe(0);
  });

  it("limpar é recusado durante a resposta", () => {
    const conversa = ConversaDoChat.nova("s1");
    conversa.perguntar(pergunta());
    expect(() => conversa.limpar("s2")).toThrow(expect.objectContaining({ motivo: "em_andamento" }));
    expect(conversa.sessaoId).toBe("s1");
  });

  it("ao reabrir, a resposta que estava em andamento vira falha 'interrompida'", () => {
    const original = ConversaDoChat.nova("s1");
    original.perguntar(pergunta());
    original.acrescentarTrecho("pela metade");

    const reaberta = ConversaDoChat.reconstituir(JSON.parse(JSON.stringify(original.paraDados())));
    const evento = reaberta.interromperRespostaEmAndamento();

    expect(evento).toEqual({ tipo: "resposta_falhou", mensagemId: "c1", motivo: MOTIVO_DA_INTERRUPCAO, uso: null });
    expect(reaberta.mensagens[1]).toMatchObject({ situacao: "falhou", texto: "pela metade" });
    expect(reaberta.interromperRespostaEmAndamento()).toBeNull();
  });

  it("reconstituir recusa dados sem sessão ou sem mensagens", () => {
    expect(() =>
      ConversaDoChat.reconstituir({ sessaoId: "", sessaoIniciada: false, alteracoesAutorizadas: false, mensagens: [] }),
    ).toThrow();
  });
});

describe("ConversaDoChat — autorização para alterar", () => {
  it("nasce sem autorização", () => {
    const conversa = ConversaDoChat.nova("s1");

    expect(conversa.alteracoesAutorizadas).toBe(false);
    expect(conversa.paraDados().alteracoesAutorizadas).toBe(false);
  });

  it("autorizar e revogar geram os eventos; repetir o mesmo estado não gera", () => {
    const conversa = ConversaDoChat.nova("s1");

    expect(conversa.revogarAlteracoes()).toBeNull();
    expect(conversa.autorizarAlteracoes()).toEqual({ tipo: "alteracoes_autorizadas" });
    expect(conversa.alteracoesAutorizadas).toBe(true);
    expect(conversa.autorizarAlteracoes()).toBeNull();

    expect(conversa.revogarAlteracoes()).toEqual({ tipo: "autorizacao_revogada" });
    expect(conversa.alteracoesAutorizadas).toBe(false);
    expect(conversa.revogarAlteracoes()).toBeNull();
  });

  it("vale também durante uma resposta, sem mexer nela", () => {
    const conversa = ConversaDoChat.nova("s1");
    conversa.perguntar(pergunta());

    expect(conversa.autorizarAlteracoes()).toEqual({ tipo: "alteracoes_autorizadas" });
    expect(conversa.situacao).toBe("respondendo");
  });

  it("o /clear começa a conversa nova sem autorização", () => {
    const conversa = ConversaDoChat.nova("s1");
    conversa.autorizarAlteracoes();

    conversa.limpar("s2");

    expect(conversa.alteracoesAutorizadas).toBe(false);
  });

  it("a autorização é gravada com a conversa", () => {
    const conversa = ConversaDoChat.nova("s1");
    conversa.autorizarAlteracoes();

    const reaberta = ConversaDoChat.reconstituir(JSON.parse(JSON.stringify(conversa.paraDados())));

    expect(reaberta.alteracoesAutorizadas).toBe(true);
  });

  it("conversa gravada antes do campo carrega sem autorização, e as mensagens sem pendência", () => {
    const gravadaAntes = JSON.parse(
      JSON.stringify({
        sessaoId: "s1",
        sessaoIniciada: true,
        mensagens: [
          { id: "u1", papel: "usuario", texto: "oi", imagens: [], criadaEm: agora.toISOString(), situacao: "concluida", acoes: [], avisos: [], uso: null },
          { id: "c1", papel: "claude", texto: "olá", imagens: [], criadaEm: agora.toISOString(), situacao: "concluida", acoes: [], avisos: [], uso },
        ],
      }),
    );

    const reaberta = ConversaDoChat.reconstituir(gravadaAntes);

    expect(reaberta.alteracoesAutorizadas).toBe(false);
    expect(reaberta.mensagens.map((mensagem) => mensagem.autorizacaoPendente)).toEqual([null, null]);
  });

  it("concluir guarda a autorização pendente na resposta e no evento", () => {
    const conversa = ConversaDoChat.nova("s1");
    conversa.perguntar(pergunta());

    const evento = conversa.concluir("Preciso da autorização.", [], [], uso, { acao: "editar", detalhe: "src/x.ts" });

    expect(evento).toMatchObject({ tipo: "resposta_concluida", autorizacaoPendente: { acao: "editar", detalhe: "src/x.ts" } });
    expect(conversa.mensagens[1]?.autorizacaoPendente).toEqual({ acao: "editar", detalhe: "src/x.ts" });
    expect(conversa.mensagens[0]?.autorizacaoPendente).toBeNull();

    const reaberta = ConversaDoChat.reconstituir(JSON.parse(JSON.stringify(conversa.paraDados())));
    expect(reaberta.mensagens[1]?.autorizacaoPendente).toEqual({ acao: "editar", detalhe: "src/x.ts" });
  });

  it("concluir sem pendência grava nulo", () => {
    const conversa = ConversaDoChat.nova("s1");
    conversa.perguntar(pergunta());

    expect(conversa.concluir("ok", [], [], uso, null)).toMatchObject({ autorizacaoPendente: null });
    expect(conversa.mensagens[1]?.autorizacaoPendente).toBeNull();
  });
});

describe("PreferenciasDoChat", () => {
  it("nasce com opus e esforço alto", () => {
    expect(PreferenciasDoChat.padrao().paraDados()).toEqual({ modelo: "opus", esforco: "alto" });
  });

  it("com() cria outra e não altera a original", () => {
    const original = PreferenciasDoChat.padrao();
    const alterada = original.com({ modelo: "fable" });

    expect(alterada.paraDados()).toEqual({ modelo: "fable", esforco: "alto" });
    expect(original.modelo).toBe("opus");
    expect(Object.isFrozen(original)).toBe(true);
  });

  it("recusa modelo e esforço inválidos", () => {
    expect(() => PreferenciasDoChat.de({ modelo: "gpt", esforco: "alto" })).toThrow("Modelo inválido.");
    expect(() => PreferenciasDoChat.de({ modelo: "opus", esforco: "enorme" })).toThrow("Esforço inválido.");
  });

  it("aceita o esforço ultracode", () => {
    expect(PreferenciasDoChat.padrao().com({ esforco: "ultracode" }).paraDados()).toEqual({
      modelo: "opus",
      esforco: "ultracode",
    });
  });
});
