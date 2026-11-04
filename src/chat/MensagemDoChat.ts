import type { TipoDeImagem } from "../orquestracao/Anexo";
import type { AcaoDoApp } from "./AcaoDoApp";
import type { UsoDaResposta } from "./MotorDeChat";

export type PapelNaConversa = "usuario" | "claude";

export type SituacaoDaMensagem = "respondendo" | "concluida" | "falhou" | "cancelada";

/** Imagem anexada a uma pergunta: o arquivo guardado e o nome original. */
export interface ImagemDaMensagem {
  arquivo: string;
  nome: string;
  tipoDeMidia: TipoDeImagem;
}

export interface DadosDaMensagemDoChat {
  id: string;
  papel: PapelNaConversa;
  texto: string;
  imagens: ImagemDaMensagem[];
  criadaEm: string;
  situacao: SituacaoDaMensagem;
  acoes: AcaoDoApp[];
  /** Avisos legíveis: ações ignoradas, o motivo de uma falha. */
  avisos: string[];
  uso: UsoDaResposta | null;
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
    private avisosAtuais: readonly string[],
    private usoAtual: UsoDaResposta | null,
  ) {}

  static pergunta(id: string, texto: string, imagens: readonly ImagemDaMensagem[], agora: Date): MensagemDoChat {
    return new MensagemDoChat(id, "usuario", texto, [...imagens], agora.getTime(), "concluida", [], [], null);
  }

  static resposta(id: string, agora: Date): MensagemDoChat {
    return new MensagemDoChat(id, "claude", "", [], agora.getTime(), "respondendo", [], [], null);
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
      dados.avisos ?? [],
      dados.uso ?? null,
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

  acrescentar(trecho: string): void {
    this.textoAtual += trecho;
  }

  concluir(texto: string, acoes: readonly AcaoDoApp[], avisos: readonly string[], uso: UsoDaResposta): void {
    this.textoAtual = texto;
    this.acoesAtuais = [...acoes];
    this.avisosAtuais = [...avisos];
    this.usoAtual = uso;
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
      avisos: [...this.avisosAtuais],
      uso: this.usoAtual === null ? null : { ...this.usoAtual },
    };
  }
}
