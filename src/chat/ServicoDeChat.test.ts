import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { ControleDeExecucoesEmMemoria } from "../infraestrutura/execucoes/ControleDeExecucoesEmMemoria";
import { Anexo } from "../orquestracao/Anexo";
import { ArmazemDeAnexos } from "../orquestracao/ArmazemDeAnexos";
import { JanelaDaCota } from "../orquestracao/EventoDeOrquestracao";
import { ConversaDoChat } from "./ConversaDoChat";
import { EventoDoChat, EventoDoChatRegistrado, SinalDoChat } from "./EventoDoChat";
import {
  EventoDoMotorDeChat,
  MotorDeChat,
  PerguntaAoMotorDeChat,
  ResultadoDaResposta,
  UsoDaResposta,
} from "./MotorDeChat";
import { PreferenciasDoChat } from "./PreferenciasDoChat";
import { ConversaDoChatArquivada, RepositorioDoChat } from "./RepositorioDoChat";
import { ServicoDeChat } from "./ServicoDeChat";

const raiz = path.resolve("/projetos");
const uso: UsoDaResposta = { duracaoMs: 5, tokensDeEntrada: 30_000, tokensDeSaida: 50, modeloUsado: "claude-opus" };

function sucesso(
  resposta: string,
  extras: Partial<Extract<ResultadoDaResposta, { sucesso: true }>> = {},
): ResultadoDaResposta {
  return { sucesso: true, resposta, uso, autorizacaoPendente: null, avisos: [], ...extras };
}

class RepositorioDoChatEmMemoria implements RepositorioDoChat {
  atual = ConversaDoChat.nova("sessao-1");
  prefs = PreferenciasDoChat.padrao();
  eventos: EventoDoChatRegistrado[] = [];
  arquivadas = 0;
  salvamentos = 0;

  conversa(): ConversaDoChat {
    return this.atual;
  }
  async salvar(conversa: ConversaDoChat): Promise<void> {
    this.atual = conversa;
    this.salvamentos += 1;
  }
  preferencias(): PreferenciasDoChat {
    return this.prefs;
  }
  async salvarPreferencias(preferencias: PreferenciasDoChat): Promise<void> {
    this.prefs = preferencias;
  }
  anexarEvento(evento: EventoDoChat): EventoDoChatRegistrado {
    const registrado = { ...evento, sequencia: this.ultimaSequencia() + 1, em: "agora" };
    this.eventos.push(registrado);
    return registrado;
  }
  arquivarConversa(conversa: ConversaDoChat, evento: EventoDoChat): ConversaDoChatArquivada {
    this.atual = conversa;
    this.arquivadas += 1;
    const registrado = { ...evento, sequencia: this.ultimaSequencia() + 1, em: "agora" };
    this.eventos = [registrado];
    return { registrado, gravacao: Promise.resolve() };
  }
  lerEventos(depois: number): readonly EventoDoChatRegistrado[] {
    return this.eventos.filter((evento) => evento.sequencia > depois);
  }
  ultimaSequencia(): number {
    return this.eventos.at(-1)?.sequencia ?? 0;
  }
  ultimaCota(): JanelaDaCota[] | null {
    for (const evento of [...this.eventos].reverse()) {
      if (evento.tipo === "uso_da_cota") {
        return evento.janelas;
      }
    }
    return null;
  }
}

/** Motor controlado pelo teste: emite eventos e termina quando mandado. */
class MotorFalso implements MotorDeChat {
  readonly perguntas: PerguntaAoMotorDeChat[] = [];
  private observar: ((evento: EventoDoMotorDeChat) => void) | null = null;
  private terminar: ((resultado: ResultadoDaResposta) => void) | null = null;

  responder(
    pergunta: PerguntaAoMotorDeChat,
    aoObservar: (evento: EventoDoMotorDeChat) => void,
    sinal: AbortSignal,
  ): Promise<ResultadoDaResposta> {
    this.perguntas.push(pergunta);
    this.observar = aoObservar;
    return new Promise((resolver) => {
      this.terminar = resolver;
      sinal.addEventListener("abort", () => resolver({ sucesso: false, motivo: "cancelado", uso: null }));
    });
  }

  emitir(evento: EventoDoMotorDeChat): void {
    this.observar?.(evento);
  }

  concluir(resultado: ResultadoDaResposta): void {
    this.terminar?.(resultado);
  }
}

class ArmazemFalso implements ArmazemDeAnexos {
  readonly guardados: string[] = [];
  async guardar(id: string, anexo: Anexo): Promise<void> {
    this.guardados.push(`${id}/${anexo.arquivo}`);
  }
  caminhoDe(id: string, arquivo: string): string {
    return path.join("/dados/anexos", id, arquivo);
  }
  pastaDe(id: string): string {
    return path.join("/dados/anexos", id);
  }
  async removerTodos(): Promise<void> {}
}

describe("ServicoDeChat", () => {
  let repositorio: RepositorioDoChatEmMemoria;
  let motor: MotorFalso;
  let armazem: ArmazemFalso;
  let publicados: EventoDoChatRegistrado[];
  let sinais: SinalDoChat[];
  let servico: ServicoDeChat;
  let ids: number;

  beforeEach(() => {
    repositorio = new RepositorioDoChatEmMemoria();
    motor = new MotorFalso();
    armazem = new ArmazemFalso();
    publicados = [];
    sinais = [];
    ids = 0;
    servico = new ServicoDeChat({
      repositorio,
      motor,
      projetos: {
        listarProjetos: async () => [{ nome: "painel-app", caminho: path.join(raiz, "painel-app") }],
        listarOrquestradores: async () => [{ nome: "Painel", pasta: path.join(raiz, "painel-app") }],
      },
      anexos: armazem,
      publicador: { publicar: (evento) => publicados.push(evento), sinalizar: (sinal) => sinais.push(sinal) },
      execucoes: new ControleDeExecucoesEmMemoria(),
      pastaDaSessao: "/dados/chat/sessao",
      pastaDosProjetos: raiz,
      gerarId: () => `id${++ids}`,
      agora: () => new Date("2026-11-04T12:00:00Z"),
    });
  });

  async function aguardarMotor(quantas = 1): Promise<void> {
    await expect.poll(() => motor.perguntas.length).toBe(quantas);
  }

  it("fluxo completo: pergunta, trechos ao vivo, ação extraída e resposta gravada", async () => {
    const { mensagemId, conclusao } = await servico.perguntar({ texto: "Abra o painel" });
    await aguardarMotor();

    const enviada = motor.perguntas[0];
    expect(enviada).toMatchObject({
      sessaoId: "sessao-1",
      sessaoIniciada: false,
      instrucoes: expect.stringContaining("Orquestrador de agentes"),
      pastaDaSessao: "/dados/chat/sessao",
      pastaDosProjetos: raiz,
      modelo: "opus",
      esforco: "alto",
      imagens: [],
      pastaDasImagens: null,
    });
    expect(enviada?.mensagem).toMatch(/^<contexto-do-app>[\s\S]*- painel-app[\s\S]*Abra o painel$/);

    motor.emitir({ tipo: "trecho_da_resposta", texto: "Vou " });
    motor.emitir({ tipo: "ferramenta_do_chat", ferramenta: "WebSearch", detalhe: "node lts" });
    motor.emitir({ tipo: "trecho_da_resposta", texto: "abrir." });
    expect(servico.estado()).toMatchObject({ situacao: "respondendo" });
    expect(servico.estado().mensagens[1]?.texto).toBe("Vou abrir.");
    expect(repositorio.conversa().sessaoIniciada).toBe(true);

    motor.concluir(
      sucesso('Vou abrir.\n```acao-do-app\n{"tipo":"abrir_orquestrador","projeto":"painel-app","pedido":null}\n```'),
    );
    await conclusao;

    expect(sinais).toEqual([
      { tipo: "trecho", mensagemId, texto: "Vou " },
      { tipo: "atividade", mensagemId, ferramenta: "WebSearch", detalhe: "node lts" },
      { tipo: "trecho", mensagemId, texto: "abrir." },
    ]);
    expect(publicados.map((evento) => evento.tipo)).toEqual(["pergunta_enviada", "resposta_concluida"]);
    expect(publicados[1]).toMatchObject({
      mensagemId,
      texto: "Vou abrir.",
      acoes: [{ tipo: "abrir_orquestrador", projeto: "painel-app", pasta: path.join(raiz, "painel-app"), pedido: null }],
      avisos: [],
      uso,
    });
    const estado = servico.estado();
    expect(estado.situacao).toBe("ocioso");
    expect(estado.mensagens[1]).toMatchObject({ situacao: "concluida", texto: "Vou abrir." });
    expect(estado.ultimaSequencia).toBe(2);
  });

  it("a segunda pergunta retoma a sessão", async () => {
    const primeira = await servico.perguntar({ texto: "oi" });
    await aguardarMotor();
    motor.concluir(sucesso("olá"));
    await primeira.conclusao;

    await servico.perguntar({ texto: "e aí" });
    await aguardarMotor(2);
    expect(motor.perguntas[1]).toMatchObject({ sessaoId: "sessao-1", sessaoIniciada: true });
  });

  it("recusa outra pergunta durante a resposta", async () => {
    await servico.perguntar({ texto: "oi" });
    await expect(servico.perguntar({ texto: "de novo" })).rejects.toThrow("Já há uma resposta em andamento.");
  });

  it("cancelar interrompe o motor e registra a resposta como cancelada", async () => {
    const { mensagemId, conclusao } = await servico.perguntar({ texto: "oi" });
    await aguardarMotor();
    motor.emitir({ tipo: "trecho_da_resposta", texto: "começo" });

    await servico.cancelar();
    await conclusao;

    expect(publicados.at(-1)).toMatchObject({ tipo: "resposta_cancelada", mensagemId });
    expect(servico.estado().mensagens[1]).toMatchObject({ situacao: "cancelada", texto: "começo" });
    expect(servico.estado().situacao).toBe("ocioso");
  });

  it("cancelar sem resposta em andamento é recusado", async () => {
    await expect(servico.cancelar()).rejects.toMatchObject({ motivo: "sem_resposta_em_andamento" });
  });

  it("falha do motor vira resposta_falhou com o motivo", async () => {
    const { mensagemId, conclusao } = await servico.perguntar({ texto: "oi" });
    await aguardarMotor();
    motor.concluir({ sucesso: false, motivo: "Limite atingido.", uso: null });
    await conclusao;

    expect(publicados.at(-1)).toEqual(
      expect.objectContaining({ tipo: "resposta_falhou", mensagemId, motivo: "Limite atingido.", uso: null }),
    );
    expect(servico.estado().mensagens[1]?.avisos).toEqual(["Limite atingido."]);
  });

  it("uso da cota vira evento gravado e aparece no estado", async () => {
    const { conclusao } = await servico.perguntar({ texto: "oi" });
    await aguardarMotor();
    const janelas = [{ nome: "5 horas", utilizacao: 0.4, renovaEm: null, situacao: "allowed" }];
    motor.emitir({ tipo: "uso_da_cota", janelas });
    motor.concluir(sucesso("ok"));
    await conclusao;

    expect(publicados.map((evento) => evento.tipo)).toContain("uso_da_cota");
    expect(servico.estado().cota).toEqual(janelas);
  });

  it("guarda as imagens no armazém do chat e passa os caminhos ao motor", async () => {
    await servico.perguntar({
      texto: "",
      imagens: [{ nome: "print.png", tipoDeMidia: "image/png", conteudo: new Uint8Array([1, 2, 3]) }],
    });
    await aguardarMotor();

    expect(armazem.guardados).toEqual(["chat/id1.png"]);
    expect(motor.perguntas[0]).toMatchObject({
      imagens: [{ caminho: path.join("/dados/anexos", "chat", "id1.png"), tipoDeMidia: "image/png" }],
      pastaDasImagens: path.join("/dados/anexos", "chat"),
    });
    expect(servico.estado().mensagens[0]?.imagens).toEqual([
      { arquivo: "id1.png", nome: "print.png", tipoDeMidia: "image/png" },
    ]);
  });

  it("recusa imagem de formato não suportado", async () => {
    await expect(
      servico.perguntar({ texto: "oi", imagens: [{ nome: "a.bmp", tipoDeMidia: "image/bmp", conteudo: new Uint8Array([1]) }] }),
    ).rejects.toMatchObject({ motivo: "dados_invalidos" });
    expect(publicados).toEqual([]);
  });

  it("limpar arquiva a conversa, troca a sessão e mantém as preferências", async () => {
    await servico.alterarPreferencias({ modelo: "fable" });
    await servico.alterarAutorizacao(true);
    const { conclusao } = await servico.perguntar({ texto: "oi" });
    await aguardarMotor();
    motor.concluir(sucesso("ok"));
    await conclusao;

    expect(await servico.limpar()).toEqual({ totalDeMensagens: 0 });

    expect(repositorio.arquivadas).toBe(1);
    expect(publicados.at(-1)).toMatchObject({ tipo: "conversa_limpa" });
    const estado = servico.estado();
    expect(estado.sessaoId).not.toBe("sessao-1");
    expect(estado.mensagens).toEqual([]);
    expect(estado.preferencias).toEqual({ modelo: "fable", esforco: "alto" });
    expect(estado.alteracoesAutorizadas).toBe(false);
  });

  it("limpar é recusado durante a resposta e não faz nada numa conversa vazia", async () => {
    expect(await servico.limpar()).toEqual({ totalDeMensagens: 0 });
    expect(repositorio.arquivadas).toBe(0);

    await servico.perguntar({ texto: "oi" });
    await expect(servico.limpar()).rejects.toMatchObject({ motivo: "em_andamento" });
  });

  it("alterarPreferencias publica o evento e vale para a próxima pergunta", async () => {
    expect(await servico.alterarPreferencias({ esforco: "maximo" })).toEqual({ modelo: "opus", esforco: "maximo" });
    expect(publicados.at(-1)).toMatchObject({ tipo: "preferencias_alteradas", preferencias: { esforco: "maximo" } });

    await servico.perguntar({ texto: "oi" });
    await aguardarMotor();
    expect(motor.perguntas[0]?.esforco).toBe("maximo");
  });

  it("a pergunta leva alteracoesAutorizadas ao motor e ao bloco de contexto", async () => {
    const { conclusao } = await servico.perguntar({ texto: "edite o README" });
    await aguardarMotor();

    expect(motor.perguntas[0]?.alteracoesAutorizadas).toBe(false);
    expect(motor.perguntas[0]?.mensagem).toContain("Alterações NÃO autorizadas ainda");
    motor.concluir(sucesso("ok"));
    await conclusao;
  });

  it("alterarAutorizacao publica e grava o evento; repetir não gera outro", async () => {
    expect(await servico.alterarAutorizacao(true)).toEqual({ autorizado: true });
    expect(await servico.alterarAutorizacao(true)).toEqual({ autorizado: true });
    expect(await servico.alterarAutorizacao(false)).toEqual({ autorizado: false });
    expect(await servico.alterarAutorizacao(false)).toEqual({ autorizado: false });

    expect(publicados.map((evento) => evento.tipo)).toEqual(["alteracoes_autorizadas", "autorizacao_revogada"]);
    expect(publicados.map((evento) => evento.sequencia)).toEqual([1, 2]);
    expect(repositorio.salvamentos).toBe(2);
    expect(servico.estado().alteracoesAutorizadas).toBe(false);
  });

  it("autorizar durante uma resposta não muda essa resposta e vale na próxima pergunta", async () => {
    const primeira = await servico.perguntar({ texto: "edite o README" });
    await aguardarMotor();
    expect(motor.perguntas[0]?.alteracoesAutorizadas).toBe(false);

    expect(await servico.alterarAutorizacao(true)).toEqual({ autorizado: true });
    expect(servico.estado()).toMatchObject({ situacao: "respondendo", alteracoesAutorizadas: true });
    motor.concluir(sucesso("Preciso da autorização.", { autorizacaoPendente: { acao: "editar", detalhe: "README.md" } }));
    await primeira.conclusao;

    await servico.perguntar({ texto: "pode editar" });
    await aguardarMotor(2);
    expect(motor.perguntas[1]?.alteracoesAutorizadas).toBe(true);
    expect(motor.perguntas[1]?.mensagem).toContain("Alterações AUTORIZADAS");
  });

  it("a autorização pendente e os avisos do motor vão para a resposta concluída", async () => {
    const { mensagemId, conclusao } = await servico.perguntar({ texto: "rode os testes" });
    await aguardarMotor();
    motor.concluir(
      sucesso("Preciso da autorização para rodar comandos.", {
        autorizacaoPendente: { acao: "rodar_comando", detalhe: "npm test" },
        avisos: ["Bloqueado pelas permissões do chat: Read · .env"],
      }),
    );
    await conclusao;

    expect(publicados.at(-1)).toMatchObject({
      tipo: "resposta_concluida",
      mensagemId,
      autorizacaoPendente: { acao: "rodar_comando", detalhe: "npm test" },
      avisos: ["Bloqueado pelas permissões do chat: Read · .env"],
    });
    expect(servico.estado().mensagens[1]).toMatchObject({
      autorizacaoPendente: { acao: "rodar_comando", detalhe: "npm test" },
      avisos: ["Bloqueado pelas permissões do chat: Read · .env"],
    });
  });

  it("ao subir, marca como interrompida a resposta que ficou em andamento", async () => {
    repositorio.atual.perguntar({ mensagemDoUsuarioId: "u", mensagemDoClaudeId: "c", texto: "oi", imagens: [], agora: new Date() });

    expect(await servico.interromperRespostaPendente()).toBe(true);
    expect(publicados.at(-1)).toMatchObject({ tipo: "resposta_falhou", mensagemId: "c", motivo: "interrompida" });
    expect(await servico.interromperRespostaPendente()).toBe(false);
  });
});
