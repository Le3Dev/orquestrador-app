import type { TipoDeImagem } from "../orquestracao/Anexo";
import { copiarPergunta, PerguntaDoApp } from "../perguntas/PerguntaDoApp";
import type { AcaoDoApp } from "./AcaoDoApp";
import type { UsoDaResposta } from "./MotorDeChat";
import { ehOrigemDaPergunta, OrigemDaPergunta } from "./OrigemDaPergunta";

export type PapelNaConversa = "usuario" | "claude";

export type SituacaoDaMensagem = "respondendo" | "concluida" | "falhou" | "cancelada";

/** Imagem anexada a uma pergunta: o arquivo guardado e o nome original. */
export interface ImagemDaMensagem {
  arquivo: string;
  nome: string;
  tipoDeMidia: TipoDeImagem;
}

/** O que o Claude tentou fazer e precisa da autorização do usuário. */
export type AcaoQuePedeAutorizacao = "editar" | "rodar_comando";

/**
 * A primeira ação de uma resposta que não aconteceu por falta de
 * autorização: editar um arquivo ou rodar um comando. Objeto de valor.
 */
export interface AutorizacaoPendente {
  readonly acao: AcaoQuePedeAutorizacao;
  /** O caminho do arquivo (`editar`) ou o comando (`rodar_comando`). */
  readonly detalhe: string;
}

export interface DadosDaMensagemDoChat {
  id: string;
  papel: PapelNaConversa;
  texto: string;
  imagens: ImagemDaMensagem[];
  criadaEm: string;
  situacao: SituacaoDaMensagem;
  acoes: AcaoDoApp[];
  /** Perguntas com opções clicáveis da resposta; ausente nas mensagens gravadas antes do campo (vale []). */
  perguntas: PerguntaDoApp[];
  /** Avisos legíveis: ações ignoradas, ações bloqueadas, o motivo de uma falha. */
  avisos: string[];
  uso: UsoDaResposta | null;
  /** Só numa resposta concluída; nulo em mensagens gravadas antes do campo. */
  autorizacaoPendente: AutorizacaoPendente | null;
  /**
   * Só numa pergunta que não foi digitada (ex.: detectada pela escuta). Ausente
   * nas digitadas, nas respostas e nas mensagens gravadas antes do campo.
   */
  origem?: OrigemDaPergunta;
}

/**
 * Uma fala da conversa do chat: a pergunta do usuário ou a resposta do
 * Claude. Objeto interno do agregado `ConversaDoChat` — só muda por ele.
 *
 * A pergunta já nasce concluída; a resposta nasce "respondendo", acumula o
 * texto que chega aos poucos e termina concluída, com falha ou cancelada.
 */
export class MensagemDoChat {
  private constructor(
    public readonly id: string,
    public readonly papel: PapelNaConversa,
    private textoAtual: string,
    public readonly imagens: readonly ImagemDaMensagem[],
    private readonly criadaEmMs: number,
    private situacaoAtual: SituacaoDaMensagem,
    private acoesAtuais: readonly AcaoDoApp[],
    private perguntasAtuais: readonly PerguntaDoApp[],
    private avisosAtuais: readonly string[],
    private usoAtual: UsoDaResposta | null,
    private autorizacaoPendenteAtual: AutorizacaoPendente | null,
    /** De onde veio a pergunta, quando não foi digitada; ausente nas demais mensagens. */
    public readonly origem?: OrigemDaPergunta,
  ) {}

  static pergunta(
    id: string,
    texto: string,
    imagens: readonly ImagemDaMensagem[],
    agora: Date,
    origem?: OrigemDaPergunta,
  ): MensagemDoChat {
    return new MensagemDoChat(
      id,
      "usuario",
      texto,
      [...imagens],
      agora.getTime(),
      "concluida",
      [],
      [],
      [],
      null,
      null,
      ehOrigemDaPergunta(origem) ? origem : undefined,
    );
  }

  static resposta(id: string, agora: Date): MensagemDoChat {
    return new MensagemDoChat(id, "claude", "", [], agora.getTime(), "respondendo", [], [], [], null, null);
  }

  static reconstituir(dados: DadosDaMensagemDoChat): MensagemDoChat {
    return new MensagemDoChat(
      dados.id,
      dados.papel,
      dados.texto,
      dados.imagens ?? [],
      Date.parse(dados.criadaEm),
      dados.situacao,
      dados.acoes ?? [],
      (dados.perguntas ?? []).map(copiarPergunta),
      dados.avisos ?? [],
      dados.uso ?? null,
      copiarAutorizacaoPendente(dados.autorizacaoPendente ?? null),
      // O arquivo pode trazer qualquer coisa: só uma origem conhecida sobrevive.
      ehOrigemDaPergunta(dados.origem) ? dados.origem : undefined,
    );
  }

  get texto(): string {
    return this.textoAtual;
  }

  get situacao(): SituacaoDaMensagem {
    return this.situacaoAtual;
  }

  get respondendo(): boolean {
    return this.situacaoAtual === "respondendo";
  }

  get autorizacaoPendente(): AutorizacaoPendente | null {
    return this.autorizacaoPendenteAtual;
  }

  get perguntas(): readonly PerguntaDoApp[] {
    return this.perguntasAtuais;
  }

  acrescentar(trecho: string): void {
    this.textoAtual += trecho;
  }

  concluir(
    texto: string,
    acoes: readonly AcaoDoApp[],
    avisos: readonly string[],
    uso: UsoDaResposta,
    autorizacaoPendente: AutorizacaoPendente | null,
    perguntas: readonly PerguntaDoApp[] = [],
  ): void {
    this.textoAtual = texto;
    this.acoesAtuais = [...acoes];
    this.perguntasAtuais = perguntas.map(copiarPergunta);
    this.avisosAtuais = [...avisos];
    this.usoAtual = uso;
    this.autorizacaoPendenteAtual = copiarAutorizacaoPendente(autorizacaoPendente);
    this.situacaoAtual = "concluida";
  }

  /** Guarda o texto que chegou até a falha; o motivo vira aviso, para a tela mostrar. */
  falhar(motivo: string, uso: UsoDaResposta | null): void {
    this.avisosAtuais = [...this.avisosAtuais, motivo];
    this.usoAtual = uso;
    this.situacaoAtual = "falhou";
  }

  cancelar(): void {
    this.situacaoAtual = "cancelada";
  }

  paraDados(): DadosDaMensagemDoChat {
    return {
      id: this.id,
      papel: this.papel,
      texto: this.textoAtual,
      imagens: this.imagens.map((imagem) => ({ ...imagem })),
      criadaEm: new Date(this.criadaEmMs).toISOString(),
      situacao: this.situacaoAtual,
      acoes: this.acoesAtuais.map((acao) => ({ ...acao })),
      perguntas: this.perguntasAtuais.map(copiarPergunta),
      avisos: [...this.avisosAtuais],
      uso: this.usoAtual === null ? null : { ...this.usoAtual },
      autorizacaoPendente: this.autorizacaoPendenteAtual === null ? null : { ...this.autorizacaoPendenteAtual },
      // Só quando existe: as mensagens sem origem continuam com o mesmo formato de antes.
      ...(this.origem === undefined ? {} : { origem: this.origem }),
    };
  }
}

/** Cópia congelada, só com os dois campos: o objeto de valor não muda depois de criado. */
function copiarAutorizacaoPendente(pendente: AutorizacaoPendente | null): AutorizacaoPendente | null {
  return pendente === null ? null : Object.freeze({ acao: pendente.acao, detalhe: pendente.detalhe });
}
