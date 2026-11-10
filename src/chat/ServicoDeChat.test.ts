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
import { SubagenteDoChat } from "./SubagentesDoChat";

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
  /** Ids de documentos cujo texto "foi extraído". */
  readonly comTexto = new Set<string>();
  async caminhoDoTexto(id: string, anexoId: string): Promise<string | null> {
    return this.comTexto.has(anexoId) ? path.join("/dados/anexos", id, `${anexoId}.texto.txt`) : null;
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
  let listarSubagentes: () => Promise<SubagenteDoChat[]>;

  beforeEach(() => {
    repositorio = new RepositorioDoChatEmMemoria();
    motor = new MotorFalso();
    armazem = new ArmazemFalso();
    publicados = [];
    sinais = [];
    ids = 0;
    listarSubagentes = async () => [{ nome: "revisor", descricao: "Revisa o diff procurando bugs", modelo: "herdar" }];
    servico = new ServicoDeChat({
      repositorio,
      motor,
      projetos: {
        listarProjetos: async () => [{ nome: "painel-app", caminho: path.join(raiz, "painel-app") }],
        listarOrquestradores: async () => [
          {
            nome: "Painel",
            pasta: path.join(raiz, "painel-app"),
            situacao: "trabalhando",
            pedidoAtual: "rodar os testes",
            turnoIniciadoEm: new Date("2026-11-04T11:55:00Z"),
            tamanhoDaFila: 1,
            planoPendente: false,
            branch: "orquestrador/abc",
            alteracoesSemCommit: null,
          },
        ],
      },
      subagentes: { listarSubagentesProntos: () => listarSubagentes() },
      anexos: armazem,
      publicador: { publicar: (evento) => publicados.push(evento), sinalizar: (sinal) => sinais.push(sinal) },
      execucoes: new ControleDeExecucoesEmMemoria(),
      pastaDaSessao: "/dados/chat/sessao",
      pastaDosProjetos: raiz,
      pastaDeArtefatos: "/dados/artefatos/entrada/chat",
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
      pastaDeArtefatos: "/dados/artefatos/entrada/chat",
      modelo: "opus",
      esforco: "alto",
      imagens: [],
      pastaDasImagens: null,
    });
    expect(enviada?.mensagem).toMatch(/^<contexto-do-app>[\s\S]*- painel-app[\s\S]*Abra o painel$/);
    expect(enviada?.mensagem).toContain("grave UM arquivo autocontido na pasta /dados/artefatos/entrada/chat");
    expect(enviada?.mensagem).toContain(
      `- Painel → ${path.join(raiz, "painel-app")} (trabalhando há 5 min em "rodar os testes", 1 na fila, branch orquestrador/abc)`,
    );

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
      acoes: [
        {
          tipo: "abrir_orquestrador",
          projeto: "painel-app",
          pasta: path.join(raiz, "painel-app"),
          pedido: null,
          novo: false,
          orquestrador: null,
          nome: null,
        },
      ],
      avisos: [],
      uso,
    });
    const estado = servico.estado();
    expect(estado.situacao).toBe("ocioso");
    expect(estado.mensagens[1]).toMatchObject({ situacao: "concluida", texto: "Vou abrir." });
    expect(estado.ultimaSequencia).toBe(2);
  });

  it("valida o orquestrador indicado na ação contra os orquestradores da pasta", async () => {
    const { conclusao } = await servico.perguntar({ texto: "Commite no painel" });
    await aguardarMotor();
    motor.concluir(
      sucesso(
        [
          "Entra na fila do Painel.",
          "```acao-do-app",
          '{"tipo":"abrir_orquestrador","projeto":"painel-app","orquestrador":"painel","pedido":"commitar"}',
          "```",
          "```acao-do-app",
          '{"tipo":"abrir_orquestrador","projeto":"painel-app","orquestrador":"Inventado","pedido":"outro"}',
          "```",
        ].join("\n"),
      ),
    );
    await conclusao;

    expect(publicados.at(-1)).toMatchObject({
      tipo: "resposta_concluida",
      acoes: [
        { pedido: "commitar", orquestrador: "Painel" },
        { pedido: "outro", orquestrador: null },
      ],
      avisos: [],
    });
  });

  it("leva os subagentes prontos ao contexto, sem o prompt, e extrai as ações de criar e editar", async () => {
    const { conclusao } = await servico.perguntar({ texto: "Crie um documentador e troque o modelo do revisor" });
    await aguardarMotor();

    const enviada = motor.perguntas[0]?.mensagem ?? "";
    expect(enviada).toContain("Subagentes prontos (nome · modelo: quando usar):\n- revisor · herdar: Revisa o diff procurando bugs");
    expect(enviada).toContain('"tipo":"criar_subagente"');

    motor.concluir(
      sucesso(
        [
          "Dois cartões:",
          "```acao-do-app",
          '{"tipo":"criar_subagente","nome":"documentador","descricao":"Atualiza o README","prompt":"Documente o que mudou."}',
          "```",
          "```acao-do-app",
          '{"tipo":"editar_subagente","nome":"revisor","modelo":"opus"}',
          "```",
        ].join("\n"),
      ),
    );
    await conclusao;

    expect(publicados.at(-1)).toMatchObject({
      tipo: "resposta_concluida",
      texto: "Dois cartões:",
      acoes: [
        { tipo: "criar_subagente", nome: "documentador", descricao: "Atualiza o README", prompt: "Documente o que mudou.", modelo: "herdar" },
        { tipo: "editar_subagente", nome: "revisor", descricao: null, prompt: null, modelo: "opus" },
      ],
      avisos: [],
    });
    expect(servico.estado().mensagens[1]?.acoes).toHaveLength(2);
  });

  it("sem a lista de subagentes, o chat responde e o contexto diz nenhum", async () => {
    listarSubagentes = async () => {
      throw new Error("preferências ilegíveis");
    };
    const { conclusao } = await servico.perguntar({ texto: "oi" });
    await aguardarMotor();

    expect(motor.perguntas[0]?.mensagem).toContain("Subagentes prontos (nome · modelo: quando usar):\n- (nenhum)");
    motor.concluir(sucesso("olá"));
    await conclusao;
    expect(publicados.at(-1)).toMatchObject({ tipo: "resposta_concluida", texto: "olá" });
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

  it("a origem da pergunta vai para a mensagem do usuário e para o evento pergunta_enviada", async () => {
    await servico.perguntar({ texto: "Qual o prazo?", origem: "escuta" });
    await aguardarMotor();

    expect(publicados[0]).toMatchObject({ tipo: "pergunta_enviada", mensagemDoUsuario: { origem: "escuta" } });
    expect(servico.estado().mensagens[0]?.origem).toBe("escuta");
    expect(servico.estado().mensagens[1]).not.toHaveProperty("origem");
    // O texto que vai ao Claude é o mesmo de uma pergunta digitada.
    expect(motor.perguntas[0]?.mensagem).toMatch(/Qual o prazo\?$/);
  });

  it("pergunta sem origem não ganha o campo", async () => {
    await servico.perguntar({ texto: "oi" });

    expect(servico.estado().mensagens[0]).not.toHaveProperty("origem");
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

  it("cancelar após só a abertura da sessão deixa a sessão como iniciada", async () => {
    const { conclusao } = await servico.perguntar({ texto: "oi" });
    await aguardarMotor();
    motor.emitir({ tipo: "sessao_aberta" });

    await servico.cancelar();
    await conclusao;
    await servico.perguntar({ texto: "de novo" });
    await aguardarMotor(2);

    expect(motor.perguntas[1]).toMatchObject({ sessaoId: "sessao-1", sessaoIniciada: true });
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
      { arquivo: "id1.png", nome: "print.png", tipoDeMidia: "image/png", categoria: "imagem" },
    ]);
  });

  it("guarda documentos e cita o original e o texto extraído na mensagem ao motor", async () => {
    armazem.comTexto.add("id1");
    await servico.perguntar({
      texto: "resuma",
      imagens: [{ nome: "relatorio.pdf", tipoDeMidia: "application/pdf", conteudo: new Uint8Array([1, 2, 3]) }],
    });
    await aguardarMotor();

    const pergunta = motor.perguntas[0];
    expect(armazem.guardados).toEqual(["chat/id1.pdf"]);
    expect(pergunta?.imagens).toEqual([]);
    expect(pergunta?.pastaDasImagens).toBe(path.join("/dados/anexos", "chat"));
    expect(pergunta?.mensagem).toContain(`"relatorio.pdf": texto extraído em ${path.join("/dados/anexos", "chat", "id1.texto.txt")}`);
    expect(pergunta?.mensagem).toContain(`(original: ${path.join("/dados/anexos", "chat", "id1.pdf")})`);
    expect(servico.estado().mensagens[0]?.imagens).toEqual([
      { arquivo: "id1.pdf", nome: "relatorio.pdf", tipoDeMidia: "application/pdf", categoria: "documento" },
    ]);
  });

  it("avisa no prompt quando não foi possível extrair o texto, sem derrubar a mensagem", async () => {
    await servico.perguntar({
      texto: "veja",
      imagens: [{ nome: "dados.csv", tipoDeMidia: "", conteudo: new Uint8Array([1]) }],
    });
    await aguardarMotor();

    expect(motor.perguntas[0]?.mensagem).toContain('"dados.csv": não foi possível extrair o texto');
    expect(servico.estado().mensagens[0]?.imagens[0]).toMatchObject({ tipoDeMidia: "text/csv", categoria: "documento" });
  });

  it("recusa mais de 5 documentos por mensagem", async () => {
    const documentos = Array.from({ length: 6 }, (_, indice) => ({
      nome: `d${indice}.txt`,
      tipoDeMidia: "text/plain",
      conteudo: new Uint8Array([1]),
    }));

    await expect(servico.perguntar({ texto: "oi", imagens: documentos })).rejects.toMatchObject({
      motivo: "dados_invalidos",
      message: expect.stringMatching(/até 5 documentos/),
    });
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
    expect(estado.preferencias).toEqual({ modelo: "fable", esforco: "alto", permitirArtefatosOnline: false });
    expect(estado.alteracoesAutorizadas).toBe(false);
  });

  it("limpar é recusado durante a resposta e não faz nada numa conversa vazia", async () => {
    expect(await servico.limpar()).toEqual({ totalDeMensagens: 0 });
    expect(repositorio.arquivadas).toBe(0);

    await servico.perguntar({ texto: "oi" });
    await expect(servico.limpar()).rejects.toMatchObject({ motivo: "em_andamento" });
  });

  it("alterarPreferencias publica o evento e vale para a próxima pergunta", async () => {
    expect(await servico.alterarPreferencias({ esforco: "maximo" })).toEqual({
      modelo: "opus",
      esforco: "maximo",
      permitirArtefatosOnline: false,
    });
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

  it("a pergunta leva ao Claude a regra das perguntas com opções", async () => {
    await servico.perguntar({ texto: "oi" });
    await aguardarMotor();

    expect(motor.perguntas[0]?.mensagem).toContain("```pergunta-do-app\n");
    expect(motor.perguntas[0]?.instrucoes).toContain("pergunta-do-app");
  });

  it("tira do texto as perguntas com opções, junto com as ações, e as leva ao evento e à mensagem", async () => {
    const { mensagemId, conclusao } = await servico.perguntar({ texto: "Abra o painel" });
    await aguardarMotor();
    motor.concluir(
      sucesso(
        [
          "Antes, uma decisão.",
          "```acao-do-app",
          '{"tipo":"abrir_orquestrador","projeto":"painel-app","pedido":null}',
          "```",
          "```pergunta-do-app",
          '{"perguntas":[{"pergunta":"Qual banco usar?","opcoes":[{"rotulo":"Postgres","descricao":"já usado no projeto"},"SQLite"]}]}',
          "```",
          "```pergunta-do-app",
          "{quebrado",
          "```",
        ].join("\n"),
        { avisos: ["do motor"] },
      ),
    );
    await conclusao;

    const perguntas = [
      {
        pergunta: "Qual banco usar?",
        opcoes: [
          { rotulo: "Postgres", descricao: "já usado no projeto" },
          { rotulo: "SQLite", descricao: null },
        ],
        multipla: false,
      },
    ];
    expect(publicados.at(-1)).toMatchObject({
      tipo: "resposta_concluida",
      mensagemId,
      texto: "Antes, uma decisão.",
      acoes: [{ projeto: "painel-app" }],
      perguntas,
      avisos: ["do motor", "O Claude fez uma pergunta com opções em formato inválido; ela foi ignorada."],
    });
    expect(servico.estado().mensagens[1]).toMatchObject({ texto: "Antes, uma decisão.", perguntas });
  });

  it("resposta sem bloco de perguntas conclui com perguntas vazias", async () => {
    const { conclusao } = await servico.perguntar({ texto: "oi" });
    await aguardarMotor();
    motor.concluir(sucesso("olá"));
    await conclusao;

    expect(publicados.at(-1)).toMatchObject({ tipo: "resposta_concluida", texto: "olá", perguntas: [] });
  });

  it("ao subir, marca como interrompida a resposta que ficou em andamento", async () => {
    repositorio.atual.perguntar({ mensagemDoUsuarioId: "u", mensagemDoClaudeId: "c", texto: "oi", imagens: [], agora: new Date() });

    expect(await servico.interromperRespostaPendente()).toBe(true);
    expect(publicados.at(-1)).toMatchObject({ tipo: "resposta_falhou", mensagemId: "c", motivo: "interrompida" });
    expect(await servico.interromperRespostaPendente()).toBe(false);
  });
});
