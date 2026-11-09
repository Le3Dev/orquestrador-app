import { MAXIMO_DE_IMAGENS_POR_MENSAGEM } from "../orquestracao/Anexo";
import { copiarPergunta, PerguntaDoApp } from "../perguntas/PerguntaDoApp";
import type { AcaoDoApp } from "./AcaoDoApp";
import { ErroDoChat } from "./ErroDoChat";
import type { EventoDoChat } from "./EventoDoChat";
import { AutorizacaoPendente, DadosDaMensagemDoChat, ImagemDaMensagem, MensagemDoChat } from "./MensagemDoChat";
import type { UsoDaResposta } from "./MotorDeChat";
import type { OrigemDaPergunta } from "./OrigemDaPergunta";

export const TAMANHO_MAXIMO_DA_PERGUNTA = 50_000;

/** Motivo gravado numa resposta que estava em andamento quando o servidor parou. */
export const MOTIVO_DA_INTERRUPCAO = "interrompida";

export type SituacaoDaConversa = "ocioso" | "respondendo";

export interface DadosDaConversaDoChat {
  sessaoId: string;
  sessaoIniciada: boolean;
  /** Conversas gravadas antes do campo não o têm: valem `false`. */
  alteracoesAutorizadas: boolean;
  mensagens: DadosDaMensagemDoChat[];
}

export interface NovaPergunta {
  mensagemDoUsuarioId: string;
  mensagemDoClaudeId: string;
  texto: string;
  imagens: readonly ImagemDaMensagem[];
  agora: Date;
  /** De onde veio a pergunta, quando não foi digitada (ex.: "escuta"). */
  origem?: OrigemDaPergunta;
}

/**
 * Raiz do agregado: a conversa do chat rápido com o Claude — uma só, com as
 * mensagens trocadas e a sessão do Claude Code que dá memória a ela.
 *
 * A regra central mora aqui: uma pergunta por vez. Enquanto o Claude
 * responde, não dá para perguntar de novo nem limpar a conversa.
 *
 * A conversa também guarda se o usuário autorizou o chat a editar arquivos e
 * rodar comandos. A autorização é única: vale para todas as perguntas
 * seguintes até ser revogada ou até a conversa ser limpa ("/clear").
 */
export class ConversaDoChat {
  private constructor(
    private sessaoAtual: string,
    private sessaoJaIniciada: boolean,
    private alteracoesJaAutorizadas: boolean,
    private mensagensAtuais: MensagemDoChat[],
  ) {}

  static nova(sessaoId: string): ConversaDoChat {
    return new ConversaDoChat(sessaoId, false, false, []);
  }

  static reconstituir(dados: DadosDaConversaDoChat): ConversaDoChat {
    if (typeof dados.sessaoId !== "string" || dados.sessaoId === "" || !Array.isArray(dados.mensagens)) {
      throw new Error("Conversa do chat com formato inesperado.");
    }
    return new ConversaDoChat(
      dados.sessaoId,
      dados.sessaoIniciada === true,
      dados.alteracoesAutorizadas === true,
      dados.mensagens.map((mensagem) => MensagemDoChat.reconstituir(mensagem)),
    );
  }

  /** A sessão do Claude Code desta conversa; muda quando a conversa é limpa. */
  get sessaoId(): string {
    return this.sessaoAtual;
  }

  /** Se a sessão já existe: a próxima pergunta a retoma em vez de criar outra. */
  get sessaoIniciada(): boolean {
    return this.sessaoJaIniciada;
  }

  get situacao(): SituacaoDaConversa {
    return this.respostaEmAndamento === null ? "ocioso" : "respondendo";
  }

  /** Se o chat pode editar arquivos e rodar comandos nas próximas perguntas. */
  get alteracoesAutorizadas(): boolean {
    return this.alteracoesJaAutorizadas;
  }

  get respostaEmAndamento(): MensagemDoChat | null {
    return this.mensagensAtuais.find((mensagem) => mensagem.respondendo) ?? null;
  }

  get totalDeMensagens(): number {
    return this.mensagensAtuais.length;
  }

  /** A pergunta que originou a resposta em andamento. */
  get perguntaEmAndamento(): MensagemDoChat | null {
    const resposta = this.respostaEmAndamento;
    if (resposta === null) {
      return null;
    }
    const indice = this.mensagensAtuais.indexOf(resposta);
    return this.mensagensAtuais[indice - 1] ?? null;
  }

  get mensagens(): DadosDaMensagemDoChat[] {
    return this.mensagensAtuais.map((mensagem) => mensagem.paraDados());
  }

  perguntar(pergunta: NovaPergunta): EventoDoChat {
    const texto = pergunta.texto.trim();
    if (texto === "" && pergunta.imagens.length === 0) {
      throw new ErroDoChat("dados_invalidos", "Escreva uma mensagem ou anexe uma imagem.");
    }
    if (texto.length > TAMANHO_MAXIMO_DA_PERGUNTA) {
      throw new ErroDoChat(
        "dados_invalidos",
        `A mensagem deve ter até ${TAMANHO_MAXIMO_DA_PERGUNTA} caracteres.`,
      );
    }
    if (pergunta.imagens.length > MAXIMO_DE_IMAGENS_POR_MENSAGEM) {
      throw new ErroDoChat(
        "dados_invalidos",
        `Anexe até ${MAXIMO_DE_IMAGENS_POR_MENSAGEM} imagens por mensagem.`,
      );
    }
    if (this.respostaEmAndamento !== null) {
      throw new ErroDoChat("em_andamento", "Já há uma resposta em andamento.");
    }

    const doUsuario = MensagemDoChat.pergunta(
      pergunta.mensagemDoUsuarioId,
      texto,
      pergunta.imagens,
      pergunta.agora,
      pergunta.origem,
    );
    const doClaude = MensagemDoChat.resposta(pergunta.mensagemDoClaudeId, pergunta.agora);
    this.mensagensAtuais.push(doUsuario, doClaude);
    return { tipo: "pergunta_enviada", mensagemDoUsuario: doUsuario.paraDados(), mensagemDoClaude: doClaude.paraDados() };
  }

  /**
   * O Claude Code deu sinal de vida na sessão (mandou texto, usou uma
   * ferramenta, devolveu um resultado): ela existe a partir daqui, mesmo que a
   * resposta venha a falhar ou ser cancelada — como a `sessao_iniciada` do
   * Orquestrador. Devolve verdadeiro só na primeira vez.
   */
  registrarSessaoIniciada(): boolean {
    if (this.sessaoJaIniciada) {
      return false;
    }
    this.sessaoJaIniciada = true;
    return true;
  }

  /** Acumula um trecho do texto da resposta. Sem resposta em andamento, é ignorado. */
  acrescentarTrecho(trecho: string): boolean {
    const resposta = this.respostaEmAndamento;
    if (resposta === null) {
      return false;
    }
    resposta.acrescentar(trecho);
    return true;
  }

  concluir(
    texto: string,
    acoes: readonly AcaoDoApp[],
    avisos: readonly string[],
    uso: UsoDaResposta,
    autorizacaoPendente: AutorizacaoPendente | null = null,
    perguntas: readonly PerguntaDoApp[] = [],
  ): EventoDoChat {
    const resposta = this.respostaAtiva();
    // Uma resposta concluída prova que a sessão foi criada.
    this.sessaoJaIniciada = true;
    resposta.concluir(texto, acoes, avisos, uso, autorizacaoPendente, perguntas);
    return {
      tipo: "resposta_concluida",
      mensagemId: resposta.id,
      texto,
      acoes: [...acoes],
      perguntas: resposta.perguntas.map(copiarPergunta),
      avisos: [...avisos],
      uso,
      autorizacaoPendente: resposta.autorizacaoPendente === null ? null : { ...resposta.autorizacaoPendente },
    };
  }

  /**
   * O usuário autoriza o chat a editar arquivos e rodar comandos. Pode
   * acontecer a qualquer momento, inclusive durante uma resposta: vale a
   * partir da próxima pergunta. Já autorizado, não gera evento (nulo).
   */
  autorizarAlteracoes(): EventoDoChat | null {
    if (this.alteracoesJaAutorizadas) {
      return null;
    }
    this.alteracoesJaAutorizadas = true;
    return { tipo: "alteracoes_autorizadas" };
  }

  /** Tira a autorização; vale a partir da próxima pergunta. Sem autorização, não gera evento (nulo). */
  revogarAlteracoes(): EventoDoChat | null {
    if (!this.alteracoesJaAutorizadas) {
      return null;
    }
    this.alteracoesJaAutorizadas = false;
    return { tipo: "autorizacao_revogada" };
  }

  falhar(motivo: string, uso: UsoDaResposta | null): EventoDoChat {
    const resposta = this.respostaAtiva();
    if (uso !== null) {
      // Com consumo informado, o Claude Code chegou a rodar a sessão.
      this.sessaoJaIniciada = true;
    }
    resposta.falhar(motivo, uso);
    return { tipo: "resposta_falhou", mensagemId: resposta.id, motivo, uso };
  }

  cancelar(): EventoDoChat {
    const resposta = this.respostaAtiva();
    resposta.cancelar();
    return { tipo: "resposta_cancelada", mensagemId: resposta.id };
  }

  /**
   * Começa uma conversa nova ("/clear"): as mensagens saem do agregado (o
   * histórico é arquivado pelo repositório), a próxima pergunta abre outra
   * sessão do Claude Code, sem memória da anterior, e a autorização para
   * alterar volta a não existir.
   */
  limpar(novaSessaoId: string): EventoDoChat {
    if (this.respostaEmAndamento !== null) {
      throw new ErroDoChat(
        "em_andamento",
        "Aguarde a resposta terminar ou cancele antes de limpar a conversa.",
      );
    }
    this.mensagensAtuais = [];
    this.sessaoAtual = novaSessaoId;
    this.sessaoJaIniciada = false;
    this.alteracoesJaAutorizadas = false;
    return { tipo: "conversa_limpa" };
  }

  /** Usado ao subir o servidor: a resposta que rodava quando ele parou não tem mais processo. */
  interromperRespostaEmAndamento(): EventoDoChat | null {
    if (this.respostaEmAndamento === null) {
      return null;
    }
    return this.falhar(MOTIVO_DA_INTERRUPCAO, null);
  }

  paraDados(): DadosDaConversaDoChat {
    return {
      sessaoId: this.sessaoAtual,
      sessaoIniciada: this.sessaoJaIniciada,
      alteracoesAutorizadas: this.alteracoesJaAutorizadas,
      mensagens: this.mensagens,
    };
  }

  private respostaAtiva(): MensagemDoChat {
    const resposta = this.respostaEmAndamento;
    if (resposta === null) {
      throw new ErroDoChat("sem_resposta_em_andamento", "Não há resposta em andamento.");
    }
    return resposta;
  }
}
